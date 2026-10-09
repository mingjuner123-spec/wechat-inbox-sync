'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { diagnosticRedact, readMatchingCrashSummary } = require('./asr-recovery-utils');
const asrDiagnosticEvidence = require('./asr-diagnostic-evidence');
const diagnosticNativeEvidence = require('./diagnostic-native-evidence');

const MAX_REPORT_TEXT_BYTES = 128 * 1024;
const MAX_SESSION_BYTES = 768 * 1024;
const UNAVAILABLE_REASONS = new Set([
  'not_applicable', 'no_matching_attempt', 'read_failed', 'size_limit',
  'redacted_empty', 'outbox_limit',
]);
const bytes = value => Buffer.byteLength(String(value || ''), 'utf8');
function iso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function nonnegativeInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function signedInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function redactTree(value, settings = {}) {
  if (typeof value === 'string') return diagnosticRedact(value, settings);
  if (Array.isArray(value)) return value.map(item => redactTree(item, settings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactTree(item, settings)]));
  }
  return value;
}
function takeUtf8(value, maxBytes, fromEnd = false) {
  const points = [...String(value || '')];
  if (fromEnd) points.reverse();
  let result = '', used = 0;
  for (const point of points) {
    const size = bytes(point);
    if (used + size > maxBytes) break;
    result = fromEnd ? point + result : result + point;
    used += size;
  }
  return result;
}
function truncateUtf8(value, maxBytes = MAX_REPORT_TEXT_BYTES) {
  const text = String(value || '');
  if (bytes(text) <= maxBytes) return { text, truncated: false };
  const marker = '\n[TRUNCATED: middle omitted to fit diagnostic size limit]\n';
  const remaining = Math.max(0, maxBytes - bytes(marker));
  const headBytes = Math.ceil(remaining / 2);
  return {
    text: takeUtf8(text, headBytes) + marker + takeUtf8(text, remaining - headBytes, true),
    truncated: true,
  };
}
const MEDIA_URL_KINDS = new Set(['canonical', 'share', 'shortlink', 'home', 'feed', 'other', 'unknown']);
const MEDIA_DIAGNOSTIC_SOURCES = new Set(['douyin-resolution', 'wechat-channels', 'xiaohongshu-browser']);
const MEDIA_OUTCOMES = new Set(['success', 'failed', 'cancelled']);
const MEDIA_COOKIE_STATES = new Set(['saved-unverified', 'not-found', 'unknown']);
const MEDIA_DEBUGGER_CAPABILITIES = new Set(['present', 'absent', 'unsupported', 'not-eligible', 'unknown']);
const MEDIA_DEBUGGER_REASONS = new Set(['target-id-missing', 'api-absent', 'api-unsupported', 'unknown']);
const WECHAT_ARTICLE_STAGES = new Set(['obsidian-request', 'node-fallback', 'wechat-session', 'hidden-browser']);
const WECHAT_ARTICLE_PAGE_STATES = new Set(['article', 'captcha', 'guide', 'unavailable', 'empty-shell', 'unknown']);
const WECHAT_ARTICLE_FINAL_STATES = new Set([...WECHAT_ARTICLE_PAGE_STATES, 'body_missing']);
const WECHAT_ARTICLE_OUTCOMES = new Set(['response', 'error', 'unknown']);
const WECHAT_ARTICLE_FAILURE_CATEGORIES = new Set([
  'extractor-selector-mismatch', 'wechat-verification-required', 'article-unavailable',
  'browser-transport-failed', 'request-profile-sensitive-response',
  'identical-empty-shell-across-request-profiles', 'wechat-empty-shell',
]);
function safeDiagnosticEnum(value, allowed) {
  const text = String(value || '').trim();
  return allowed.has(text) ? text : 'unknown';
}
function safeDiagnosticCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_.-]{0,63}$/.test(code) ? code : '';
}
function safeResolverVersion(value) {
  const version = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,79}$/.test(version) ? version : 'unknown';
}
function safeDiagnosticTextInfo(value, settings = {}, maxBytes = 512) {
  const redacted = diagnosticRedact(String(value || ''), settings)
    .replace(/\s+/g, ' ')
    .trim();
  const text = takeUtf8(redacted, maxBytes);
  return { text, truncated: bytes(redacted) > bytes(text), originalBytes: bytes(redacted), omittedBytes: Math.max(0, bytes(redacted) - bytes(text)) };
}
function safeDiagnosticText(value, settings = {}, maxBytes = 512) {
  return safeDiagnosticTextInfo(value, settings, maxBytes).text;
}
function safeMediaUrlKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return MEDIA_URL_KINDS.has(kind) ? kind : 'unknown';
}
function safeTargetIdState(value) {
  if (['recognized', 'missing', 'unknown'].includes(value)) return value;
  if (value === true) return 'recognized';
  if (value === false) return 'missing';
  return 'unknown';
}
function safeBoundedNumber(value, max = 1000) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, max) : null;
}
function safeWechatArticleCount(value, max = 10_000_000) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return Math.min(value, max);
}
function safeWechatArticleExtractionDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.source !== 'wechat-article') return null;
  const result = { component: 'wechat-article' };
  if (value.reason === 'wechat-article-body-missing') result.reasonCode = 'wechat-article-body-missing';
  if (WECHAT_ARTICLE_FAILURE_CATEGORIES.has(value.failureCategory)) result.failureCategory = value.failureCategory;
  if (value.finalKind === 'retryable' || value.finalKind === 'fallback') result.finalKind = value.finalKind;
  if (WECHAT_ARTICLE_FINAL_STATES.has(value.finalState)) result.finalState = value.finalState;
  if (['static', 'browser', 'fallback'].includes(value.finalSource)) result.finalSource = value.finalSource;
  if (WECHAT_ARTICLE_PAGE_STATES.has(value.staticState)) result.staticState = value.staticState;
  if (WECHAT_ARTICLE_PAGE_STATES.has(value.browserState)) result.browserState = value.browserState;
  if (Array.isArray(value.requestProfiles)) result.requestProfileCount = Math.min(value.requestProfiles.length, 8);

  const stages = Array.isArray(value.stages) ? value.stages : [];
  result.stages = stages.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !WECHAT_ARTICLE_STAGES.has(item.stage)) return [];
    const stage = { stage: item.stage, outcome: WECHAT_ARTICLE_OUTCOMES.has(item.outcome) ? item.outcome : 'unknown' };
    if (WECHAT_ARTICLE_PAGE_STATES.has(item.state)) stage.state = item.state;
    const status = safeWechatArticleCount(item.status, 599);
    if (status !== null && status >= 100) stage.httpStatus = status;
    if (item.statusSource === 'actual' || item.statusSource === 'inferred-success') stage.statusSource = item.statusSource;
    for (const key of ['htmlChars', 'markdownChars', 'assetCount', 'bodyTextChars', 'imageCount', 'imageCandidateCount', 'durationMs']) {
      const count = safeWechatArticleCount(item[key], 10_000_000);
      if (count !== null) stage[key] = count;
    }
    const diagnostic = item.diagnostic && typeof item.diagnostic === 'object' && !Array.isArray(item.diagnostic)
      ? item.diagnostic : null;
    if (diagnostic) {
      const evidence = {};
      if (WECHAT_ARTICLE_PAGE_STATES.has(diagnostic.pageKind)) evidence.pageKind = diagnostic.pageKind;
      if (WECHAT_ARTICLE_PAGE_STATES.has(diagnostic.classifiedState)) evidence.classifiedState = diagnostic.classifiedState;
      for (const key of ['hasHtml', 'hasJsContent']) {
        if (typeof diagnostic[key] === 'boolean') evidence[key] = diagnostic[key];
      }
      for (const key of ['bodyHtmlChars', 'bodyTextChars', 'imageCount', 'mediaCount', 'imageCandidateCount']) {
        const count = safeWechatArticleCount(diagnostic[key], 10_000_000);
        if (count !== null) evidence[key] = count;
      }
      const markers = diagnostic.markers && typeof diagnostic.markers === 'object' && !Array.isArray(diagnostic.markers)
        ? diagnostic.markers : null;
      if (markers) {
        const safeMarkers = {};
        for (const key of ['captcha', 'unavailable', 'guide', 'emptyShell']) {
          if (typeof markers[key] === 'boolean') safeMarkers[key] = markers[key];
        }
        if (Object.keys(safeMarkers).length) evidence.markers = safeMarkers;
      }
      if (Object.keys(evidence).length) stage.evidence = evidence;
    }
    return [stage];
  });

  const completeness = value.completeness && typeof value.completeness === 'object' && !Array.isArray(value.completeness)
    ? value.completeness : null;
  if (completeness) {
    const safeCompleteness = {};
    if (typeof completeness.articleBodyFound === 'boolean') safeCompleteness.articleBodyFound = completeness.articleBodyFound;
    for (const key of ['imageCandidates', 'successfulChannels', 'failedChannels']) {
      const count = safeWechatArticleCount(completeness[key], 1000);
      if (count !== null) safeCompleteness[key] = count;
    }
    if (Object.keys(safeCompleteness).length) result.completeness = safeCompleteness;
  }
  return result;
}
function safeMediaError(value, settings = {}) {
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  const code = safeDiagnosticCode(value.code);
  const browserCode = safeDiagnosticCode(value.browserCode);
  const status = safeBoundedNumber(value.status, 599);
  const exitCode = signedInt(value.exitCode);
  const messageInfo = safeDiagnosticTextInfo(value.message, settings);
  const inheritedMessageOmitted = safeBoundedNumber(value.messageOmittedBytes, Number.MAX_SAFE_INTEGER) || 0;
  const inheritedMessageOriginal = safeBoundedNumber(value.messageOriginalBytes, Number.MAX_SAFE_INTEGER) || 0;
  const messageOmittedBytes = inheritedMessageOmitted + messageInfo.omittedBytes;
  const messageTruncated = value.messageTruncated === true || messageOmittedBytes > 0;
  if (code) result.code = code;
  if (browserCode) result.browserCode = browserCode;
  if (status !== null) result.status = status;
  if (exitCode !== null) result.exitCode = exitCode;
  if (messageInfo.text) result.message = messageInfo.text;
  if (messageTruncated) {
    result.messageTruncated = true;
    result.messageOriginalBytes = Math.max(inheritedMessageOriginal, messageInfo.originalBytes + inheritedMessageOmitted);
    result.messageOmittedBytes = messageOmittedBytes;
  }
  return Object.keys(result).length ? result : undefined;
}
function isMediaResolutionDiagnostic(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (MEDIA_DIAGNOSTIC_SOURCES.has(String(value.source || ''))) return true;
  if (value.platform === 'bilibili' && Array.isArray(value.stages)) return true;
  return Boolean(
    value.sourceKind || value.resolvedKind || value.targetIdState
      || value.mediaCandidateCount !== undefined
      || (Array.isArray(value.stages) && value.stages.some(stage => stage && (stage.mediaCount !== undefined || stage.inputKind))),
  );
}
function getMediaResolutionDiagnostic(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.mediaResolutionDiagnostic && typeof error.mediaResolutionDiagnostic === 'object') {
    return error.mediaResolutionDiagnostic;
  }
  const diagnostic = error.diagnostic && typeof error.diagnostic === 'object'
    ? error.diagnostic
    : null;
  if (!diagnostic) return null;
  if (diagnostic.mediaResolutionDiagnostic && typeof diagnostic.mediaResolutionDiagnostic === 'object') {
    return diagnostic.mediaResolutionDiagnostic;
  }
  return isMediaResolutionDiagnostic(diagnostic) ? diagnostic : null;
}
function safeMediaStage(value, settings = {}) {
  if (!value || typeof value !== 'object') return null;
  const stage = {};
  const stageName = safeDiagnosticText(value.stage, settings, 64);
  const inputKind = safeDiagnosticText(value.inputKind, settings, 64);
  const sourceKind = safeMediaUrlKind(value.sourceKind);
  const resolvedKind = safeMediaUrlKind(value.resolvedKind);
  const targetIdState = safeTargetIdState(value.targetIdState);
  const rejectionReason = safeDiagnosticText(value.rejectionReason, settings, 96);
  if (stageName) stage.stage = stageName;
  stage.resolverVersion = safeResolverVersion(value.resolverVersion);
  if (inputKind) stage.inputKind = inputKind;
  stage.sourceKind = sourceKind;
  stage.resolvedKind = resolvedKind;
  stage.attempted = value.attempted !== false;
  stage.ok = value.ok === true;
  stage.targetIdState = targetIdState;
  if (typeof value.targetIdRecognized === 'boolean') stage.targetIdRecognized = value.targetIdRecognized;
  if (typeof value.targetStageEligible === 'boolean') stage.targetStageEligible = value.targetStageEligible;
  const identityOutcome = safeDiagnosticText(value.identityOutcome, settings, 64);
  if (identityOutcome) stage.identityOutcome = identityOutcome;
  if (typeof value.preciseMediaFound === 'boolean') stage.preciseMediaFound = value.preciseMediaFound;
  const mediaCount = safeBoundedNumber(value.mediaCount, 100);
  const durationMs = safeBoundedNumber(value.durationMs, 30 * 60 * 1000);
  if (mediaCount !== null) stage.mediaCount = mediaCount;
  if (durationMs !== null) stage.durationMs = durationMs;
  if (rejectionReason) stage.rejectionReason = rejectionReason;
  const error = safeMediaError(value.error || (value.code || value.message ? value : null), settings);
  if (error) stage.error = error;
  return stage;
}
function safeMediaResolutionDiagnostic(error, settings = {}) {
  const source = getMediaResolutionDiagnostic(error);
  if (!source) return null;
  const result = {
    source: safeDiagnosticText(typeof source.source === 'string' ? source.source : '', settings, 64) || 'unknown',
    outcome: safeDiagnosticEnum(source.outcome || (source.failureCode ? 'failed' : ''), MEDIA_OUTCOMES),
    cookieState: safeDiagnosticEnum(source.cookieState || (typeof source.pluginDouyinLogin === 'boolean' ? (source.pluginDouyinLogin ? 'saved-unverified' : 'not-found') : ''), MEDIA_COOKIE_STATES),
    debuggerCapability: safeDiagnosticEnum(source.debuggerCapability, MEDIA_DEBUGGER_CAPABILITIES),
    debuggerReason: safeDiagnosticEnum(source.debuggerReason, MEDIA_DEBUGGER_REASONS),
    resolverVersion: safeResolverVersion(
      source.resolverVersion
        || (source.resolver && source.resolver.version)
        || (Array.isArray(source.stages) && source.stages.find(stage => stage && stage.resolverVersion)?.resolverVersion)
        || (Array.isArray(source.attempts) && source.attempts.find(stage => stage && stage.resolverVersion)?.resolverVersion),
    ),
    sourceKind: safeMediaUrlKind(source.sourceKind),
    resolvedKind: safeMediaUrlKind(source.resolvedKind),
    targetIdState: safeTargetIdState(source.targetIdState),
    targetIdRecognized: typeof source.targetIdRecognized === 'boolean' ? source.targetIdRecognized : null,
    targetStageEligible: typeof source.targetStageEligible === 'boolean' ? source.targetStageEligible : null,
    failureCode: safeDiagnosticCode(source.failureCode || source.errorCode || (source.failure && source.failure.code)) || 'UNKNOWN',
    finalOutcome: safeDiagnosticText(source.finalOutcome, settings, 96) || 'unknown',
  };
  const selectedStage = safeDiagnosticText(source.selectedStage, settings, 96);
  if (selectedStage) result.selectedStage = selectedStage;
  const redirectCount = safeBoundedNumber(source.redirectCount, 32);
  if (redirectCount !== null) result.redirectCount = redirectCount;
  if (typeof source.redirected === 'boolean') result.redirected = source.redirected;
  const mediaCandidateCount = safeBoundedNumber(source.mediaCandidateCount, 100);
  if (mediaCandidateCount !== null) result.mediaCandidateCount = mediaCandidateCount;
  if (typeof source.preciseMediaFound === 'boolean') result.preciseMediaFound = source.preciseMediaFound;
  const failure = safeMediaError(source.failure, settings);
  if (failure) {
    result.failure = {
      ...failure,
      stage: safeDiagnosticText(source.failure.stage, settings, 64) || 'unknown',
    };
  }
  const rawStages = Array.isArray(source.stages)
    ? source.stages
    : (Array.isArray(source.attempts) ? source.attempts : []);
  const omittedStages = Math.max(0, rawStages.length - 12);
  const inheritedOmittedStages = safeBoundedNumber(source.stagesOmittedCount, Number.MAX_SAFE_INTEGER) || 0;
  const stagesOmittedCount = inheritedOmittedStages + omittedStages;
  result.stages = rawStages.slice(-12).map(stage => safeMediaStage(stage, settings)).filter(Boolean);
  if (stagesOmittedCount) result.stagesOmittedCount = stagesOmittedCount;
  const mediaErrors = [
    failure,
    ...result.stages.map(stage => stage.error),
  ].filter(Boolean);
  const messageOmittedBytes = Math.max(
    safeBoundedNumber(source.messageOmittedBytes, Number.MAX_SAFE_INTEGER) || 0,
    mediaErrors.reduce((total, item) => total + (Number(item.messageOmittedBytes) || 0), 0),
  );
  if (messageOmittedBytes) result.messageOmittedBytes = messageOmittedBytes;
  if (source.truncated === true || stagesOmittedCount || messageOmittedBytes) result.truncated = true;
  return result;
}
function safeReason(value) { return UNAVAILABLE_REASONS.has(value) ? value : 'read_failed'; }
function unavailableTechnicalReport(reason, now = new Date().toISOString(), originalBytes = 0) {
  const unavailableReason = safeReason(reason);
  const text = JSON.stringify({ schemaVersion: 1, kind: 'sync_failure', unavailableReason });
  return {
    schemaVersion: 1,
    kind: 'sync_failure',
    capturedAt: iso(now) || new Date().toISOString(),
    text,
    truncated: false,
    originalBytes: Math.max(nonnegativeInt(originalBytes) || 0, bytes(text)),
    unavailableReason,
  };
}
function readSession(root) {
  try {
    const filename = path.join(String(root || ''), 'asr-diagnostic-last.json');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SESSION_BYTES) return { reason: 'read_failed' };
    const session = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!session || typeof session !== 'object' || Array.isArray(session)) return { reason: 'read_failed' };
    return { session };
  } catch (error) {
    return { reason: error && error.code === 'ENOENT' ? 'no_matching_attempt' : 'read_failed' };
  }
}
function safeRunningCheckpoint(item = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const capturedAt = iso(item.capturedAt);
  if (!capturedAt) return null;
  const attemptValue = item.attempt === null || item.attempt === undefined || item.attempt === '' ? null : nonnegativeInt(item.attempt);
  const pidValue = item.pid === null || item.pid === undefined || item.pid === '' ? null : nonnegativeInt(item.pid);
  const wrapperPidValue = item.wrapperPid === null || item.wrapperPid === undefined || item.wrapperPid === '' ? null : nonnegativeInt(item.wrapperPid);
  const sourceValue = (value) => ['native_log', 'wrapper_process', 'unknown'].includes(value) ? value : 'unknown';
  const result = {
    attempt: attemptValue,
    capturedAt,
    stage: safeDiagnosticText(item.stage, {}, 64) || 'unknown',
    pid: pidValue,
    pidSource: sourceValue(item.pidSource),
    processState: ['running', 'exited', 'unknown'].includes(item.processState) ? item.processState : 'unknown',
    processStateSource: sourceValue(item.processStateSource),
    wrapperPid: wrapperPidValue,
    wrapperProcessState: ['running', 'exited', 'unknown'].includes(item.wrapperProcessState) ? item.wrapperProcessState : 'unknown',
    progressSource: sourceValue(item.progressSource),
    kind: item.kind === 'real_progress' ? 'real_progress' : 'heartbeat',
    progressObserved: item.progressObserved === true,
  };
  const progress = item.progress && typeof item.progress === 'object' && !Array.isArray(item.progress)
    ? item.progress : null;
  if (progress) {
    const safeProgress = {};
    const stage = safeDiagnosticText(progress.stage, {}, 64);
    if (stage) safeProgress.stage = stage;
    for (const key of ['current', 'total']) {
      const value = nonnegativeInt(progress[key]);
      if (value !== null) safeProgress[key] = value;
    }
    const percent = Number(progress.percent);
    if (Number.isFinite(percent) && percent >= 0 && percent <= 100) safeProgress.percent = Math.round(percent * 100) / 100;
    for (const key of ['startedAt', 'heartbeatAt']) {
      const value = iso(progress[key]);
      if (value) safeProgress[key] = value;
    }
    if (Object.keys(safeProgress).length) result.progress = safeProgress;
  }
  const rssValue = item.rssKiB;
  const rssKiB = rssValue === null || rssValue === undefined || rssValue === '' ? null : nonnegativeInt(rssValue);
  if (rssKiB !== null) result.rssKiB = rssKiB;
  const cpuValue = item.cpuTimeMs;
  const cpuTimeMs = cpuValue === null || cpuValue === undefined || cpuValue === '' ? null : nonnegativeInt(cpuValue);
  if (cpuTimeMs !== null) result.cpuTimeMs = cpuTimeMs;
  return result;
}
function safeInputIdentity(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = asrDiagnosticEvidence.buildAsrInputIdentity({
    recordId: value.recordId,
    attemptId: value.attemptId,
    sourceUrl: value.sourceUrl,
    workId: value.workId,
    durationSeconds: value.durationSeconds,
    durationHintSeconds: value.durationHintSeconds,
  });
  if (value.media && typeof value.media === 'object' && !Array.isArray(value.media)) {
    const media = {};
    if (value.media.status === 'captured' || value.media.status === 'unavailable') media.status = value.media.status;
    if (value.media.mediaKind === 'downloaded_media') media.mediaKind = 'downloaded_media';
    if (value.media.audioStatus === 'unavailable' || value.media.audioStatus === 'measured') media.audioStatus = value.media.audioStatus;
    if (value.media.audioStatus === 'unavailable' && /^[a-z0-9_-]{1,64}$/i.test(String(value.media.audioReason || ''))) media.audioReason = String(value.media.audioReason);
    if (/^[a-f0-9]{64}$/i.test(String(value.media.sha256 || ''))) media.sha256 = String(value.media.sha256).toLowerCase();
    const byteLengthValue = value.media.byteLength;
    const byteLength = byteLengthValue === null || byteLengthValue === undefined || byteLengthValue === '' ? null : nonnegativeInt(byteLengthValue);
    if (byteLength !== null) media.byteLength = byteLength;
    const durationValue = value.media.durationSeconds;
    const duration = durationValue === null || durationValue === undefined || durationValue === '' ? NaN : Number(durationValue);
    if (Number.isFinite(duration) && duration >= 0 && duration <= 24 * 60 * 60) media.durationSeconds = Math.round(duration * 1000) / 1000;
    const durationHintValue = value.media.durationHintSeconds;
    const durationHint = durationHintValue === null || durationHintValue === undefined || durationHintValue === '' ? NaN : Number(durationHintValue);
    if (Number.isFinite(durationHint) && durationHint >= 0 && durationHint <= 24 * 60 * 60) media.durationHintSeconds = Math.round(durationHint * 1000) / 1000;
    if (['measured', 'measured_log', 'unavailable'].includes(value.media.durationStatus)) media.durationStatus = value.media.durationStatus;
    if (value.media.durationStatus === 'unavailable' && /^[a-z0-9_-]{1,64}$/i.test(String(value.media.durationReason || ''))) media.durationReason = String(value.media.durationReason);
    const capturedAt = iso(value.media.capturedAt);
    if (capturedAt) media.capturedAt = capturedAt;
    if (value.media.status === 'unavailable' && /^[a-z0-9_-]{1,64}$/i.test(String(value.media.reason || ''))) media.reason = String(value.media.reason);
    if (Object.keys(media).length) source.media = media;
  }
  return Object.values(source).some(valuePart => valuePart !== '' && valuePart !== null && valuePart !== undefined)
    ? source : null;
}
function safeStartupGuard(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    status: ['skipped', 'waiting', 'permission_granted', 'timed_out', 'disabled'].includes(value.status) ? value.status : 'skipped',
    reason: /^[a-z0-9_]{1,64}$/.test(value.reason || '') ? value.reason : 'unknown',
    timeoutMs: nonnegativeInt(value.timeoutMs),
    elapsedIdleMs: nonnegativeInt(value.elapsedIdleMs),
    permissionGranted: value.permissionGranted === true,
    nativeStartStatus: value.status === 'timed_out' && value.reason === 'timeout_won_atomic_gate' ? 'not_started' : 'unknown',
    originalScriptSha256: /^[a-f0-9]{64}$/i.test(value.originalScriptSha256 || '') ? value.originalScriptSha256 : '',
    instrumentedScriptSha256: /^[a-f0-9]{64}$/i.test(value.instrumentedScriptSha256 || '') ? value.instrumentedScriptSha256 : '',
  };
}
function safeAttempt(item = {}) {
  const requestedMode = ['default', 'cpu_compatibility'].includes(item.requestedMode) ? item.requestedMode : 'unknown';
  const freshness = ['fresh', 'stale', 'unavailable'].includes(item.logFreshness) ? item.logFreshness : 'unavailable';
  const signal = /^[A-Z0-9_]{1,32}$/.test(String(item.signal || '')) ? String(item.signal) : '';
  const qualityStatus = ['passed', 'rejected'].includes(item.qualityStatus) ? item.qualityStatus : 'unknown';
  const qualityIssue = ['repeated-lines', 'prompt-leak'].includes(item.qualityIssue) ? item.qualityIssue : 'unknown';
  const qualityReason = item.qualityReason === 'quality_guard_rejected' ? item.qualityReason : 'unknown';
  const attemptValue = item.attempt === null || item.attempt === undefined || item.attempt === '' ? null : nonnegativeInt(item.attempt);
  const peakRssValue = item.peakRssKiB;
  const peakRssKiB = peakRssValue === null || peakRssValue === undefined || peakRssValue === '' ? null : nonnegativeInt(peakRssValue);
  const freeMemoryValue = item.freeMemoryBytesAfter;
  const freeMemoryBytesAfter = freeMemoryValue === null || freeMemoryValue === undefined || freeMemoryValue === '' ? null : nonnegativeInt(freeMemoryValue);
  return {
    attempt: attemptValue,
    cpuCompatibilityRequested: requestedMode === 'cpu_compatibility' || item.cpu === true,
    requestedMode,
    qualityStatus,
    qualityIssue,
    qualityReason,
    backendObserved: ['cpu', 'gpu'].includes(item.backendObserved) ? item.backendObserved : 'unknown',
    status: ['success', 'failed', 'cancelled'].includes(item.status) ? item.status : 'unknown',
    stage: String(item.stage || 'unknown'),
    logFreshness: freshness,
    startedAt: iso(item.startedAt),
    finishedAt: iso(item.finishedAt),
    exitCode: item.exitCode == null ? null : signedInt(item.exitCode),
    signal,
    nativeExitCode: item.nativeExitCode == null ? null : signedInt(item.nativeExitCode),
    nativeExitAssociation: ['matched', 'incomplete_native_process', 'no_matched_native_exit', 'stage_mismatch'].includes(item.nativeExitAssociation) ? item.nativeExitAssociation : 'unknown',
    nativePids: (Array.isArray(item.nativePids) ? item.nativePids : []).map(nonnegativeInt).filter(pid => pid > 0),
    peakRssKiB,
    timeoutCode: ['ASR_TIMEOUT', 'ASR_STARTUP_TIMEOUT'].includes(item.timeoutCode) ? item.timeoutCode : '',
    startupGuard: safeStartupGuard(item.startupGuard),
    timeoutCleanupStatus: ['group_cleanup_attempted', 'direct_child_fallback', 'process_already_exited', 'failed', 'unknown'].includes(item.timeoutCleanupStatus) ? item.timeoutCleanupStatus : '',
    timeoutCleanupError: /^[A-Za-z0-9_.-]{1,64}$/.test(item.timeoutCleanupError || '') ? String(item.timeoutCleanupError) : '',
    logSnapshotAt: iso(item.logSnapshotAt),
    freeMemoryBytesAfter,
    runningCheckpoints: (Array.isArray(item.runningCheckpoints) ? item.runningCheckpoints : [])
      .slice(-asrDiagnosticEvidence.MAX_CHECKPOINTS)
      .map(safeRunningCheckpoint).filter(Boolean),
    error: String(item.error || ''),
    runLog: freshness === 'fresh' ? String(item.runLog || '') : '[' + freshness + ': per-attempt log omitted]',
  };
}
function safeError(error, settings = {}) {
  const source = error && typeof error === 'object' ? error : { message: String(error || '') };
  const allFrames = String(source.stack || '').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^at\s|^[A-Za-z][A-Za-z0-9_]*Error:/.test(line));
  const messageSource = String(source.message || '');
  const message = takeUtf8(messageSource, 16 * 1024);
  const value = {
    name: /^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(String(source.name || '')) ? String(source.name) : 'Error',
    code: /^[A-Za-z0-9_-]{1,64}$/.test(String(source.code || '')) ? String(source.code) : 'UNKNOWN',
    status: nonnegativeInt(source.status || source.statusCode || source.response && source.response.status),
    message,
    messageTruncated: bytes(messageSource) > bytes(message),
    messageOriginalBytes: bytes(messageSource),
    stackFrames: allFrames.slice(0, 16),
    stackFramesOmittedCount: Math.max(0, allFrames.length - 16),
  };
  const mediaResolutionDiagnostic = safeMediaResolutionDiagnostic(source, settings);
  if (mediaResolutionDiagnostic) value.mediaResolutionDiagnostic = mediaResolutionDiagnostic;
  const extractionDiagnostic = safeWechatArticleExtractionDiagnostic(source.diagnostic);
  if (extractionDiagnostic) value.extractionDiagnostic = extractionDiagnostic;
  return redactTree(value, settings);
}
function matchAsrSession(session, { recordId, attemptId, now }) {
  if (String(session.recordId || '') !== String(recordId || '')
    || String(session.syncAttemptId || '') !== String(attemptId || '')
    || !['failed', 'cancelled', 'no_speech'].includes(String(session.status || '').toLowerCase())) {
    return { reason: 'no_matching_attempt' };
  }
  const startedAt = iso(session.startedAt);
  const finishedAt = iso(session.finishedAt);
  const finishMs = Date.parse(finishedAt || '');
  const nowMs = Date.parse(now || '');
  if (!startedAt || !finishedAt || !Number.isFinite(nowMs)
    || finishMs > nowMs + 60 * 1000 || nowMs - finishMs > 24 * 60 * 60 * 1000) {
    return { reason: 'no_matching_attempt' };
  }
  const system = session.system || {};
  const runtime = session.runtime || {};
  const model = session.model || {};
  return { value: {
    status: String(session.status),
    inputIdentity: safeInputIdentity(session.inputIdentity),
    startedAt,
    finishedAt,
    platform: ['darwin', 'win32', 'linux'].includes(session.platform) ? session.platform : 'unknown',
    system: {
      platform: String(system.platform || 'unknown'),
      architecture: String(system.architecture || 'unknown'),
      release: String(system.release || 'unknown'),
      cpuModel: String(system.cpuModel || 'unavailable'),
      logicalCpus: nonnegativeInt(system.logicalCpus),
      totalMemoryBytes: nonnegativeInt(system.totalMemoryBytes),
    },
    runtime: {
      nativeBuildVersion: String(runtime.nativeBuildVersion || 'unknown'),
      scriptSha256: /^[a-f0-9]{64}$/i.test(runtime.scriptSha256 || '') ? runtime.scriptSha256 : '',
      wrapperSha256: /^[a-f0-9]{64}$/i.test(runtime.wrapperSha256 || '') ? runtime.wrapperSha256 : '',
      binarySha256: /^[a-f0-9]{64}$/i.test(runtime.binarySha256 || '') ? runtime.binarySha256 : '',
      pythonPackages: Array.isArray(runtime.pythonPackages)
        ? runtime.pythonPackages.map(pkg => ({ name: String(pkg.name || 'unknown'), version: String(pkg.version || 'unknown') }))
        : 'not_reported',
    },
    model: {
      scope: model.scope === 'managed_default_component' ? 'managed_default_component' : 'custom_or_unknown',
      modelUsed: model.modelUsed === 'ggml-small.bin' ? 'ggml-small.bin' : 'unknown',
      sizeBytes: nonnegativeInt(model.sizeBytes),
    },
    freeMemoryBytesBefore: nonnegativeInt(session.freeMemoryBytesBefore),
    freeMemoryBytesAfter: nonnegativeInt(session.freeMemoryBytesAfter),
    abort: {
      requested: Boolean(session.abort && session.abort.requestedAt),
      source: session.abort && session.abort.source === 'user_stop' ? 'stop_requested'
        : session.abort && session.abort.source === 'upstream_abort' ? 'upstream_abort'
          : session.abort && session.abort.source === 'plugin_unload' ? 'plugin_unload' : 'unknown',
      trigger: ['stop_command', 'stop_button', 'programmatic_or_unknown'].includes(session.abort && session.abort.trigger)
        ? session.abort.trigger : 'programmatic_or_unknown',
      trustedEvent: typeof (session.abort && session.abort.trustedEvent) === 'boolean' ? session.abort.trustedEvent : null,
      technicalFrames: (Array.isArray(session.abort && session.abort.technicalFrames) ? session.abort.technicalFrames : []).slice(0, 8).map(frame => diagnosticRedact(String(frame || ''), {})),
      observedAt: iso(session.abort && session.abort.observedAt),
    },
    attempts: (Array.isArray(session.attempts) ? session.attempts : []).map(safeAttempt),
  } };
}
function selectNativeEvidenceAttempts(session) {
  const attempts = Array.isArray(session && session.attempts) ? session.attempts : [];
  const terminalStatuses = new Set(['failed', 'cancelled', 'no_speech']);
  const candidates = attempts.map((attempt, index) => ({ attempt, index }))
    .filter(({ attempt }) => attempt && typeof attempt === 'object' && !Array.isArray(attempt)
      && terminalStatuses.has(String(attempt.status || '').toLowerCase())
      && Array.isArray(attempt.nativePids) && attempt.nativePids.length)
    .slice(-4);
  return candidates
    .sort((left, right) => {
      const crashScore = item => {
        const code = signedInt(item.attempt.nativeExitCode);
        const signal = String(item.attempt.signal || '').toUpperCase();
        return code === 139 || signal === 'SIGSEGV' ? 1 : 0;
      };
      return crashScore(right) - crashScore(left) || right.index - left.index;
    })
    .map(({ attempt }) => attempt);
}
function compactNativeDiagnosticObject(value, settings = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ['type', 'name', 'code', 'signal', 'namespace', 'reason', 'subcode', 'description']) {
    if (typeof value[key] === 'string') result[key] = safeDiagnosticText(value[key], settings, 256);
    else if (Number.isSafeInteger(value[key])) result[key] = value[key];
  }
  return Object.keys(result).length ? result : null;
}
function compactNativeCrashEvidence(value, settings = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind === 'native_crash_evidence_set') return compactNativeEvidenceSet(value, settings);
  const status = ['matched', 'unavailable', 'not_applicable'].includes(value.status) ? value.status : 'unavailable';
  const result = {
    schemaVersion: 1,
    kind: 'native_crash_evidence',
    status,
    source: 'macos_diagnostic_report',
  };
  if (value.format === 'ips' || value.format === 'crash') result.format = value.format;
  if (value.truncated === true) result.truncated = true;
  const originalBytes = nonnegativeInt(value.originalBytes);
  if (originalBytes !== null) result.originalBytes = originalBytes;
  const unavailableReason = safeDiagnosticText(value.unavailableReason, settings, 160);
  if (unavailableReason) result.unavailableReason = unavailableReason;
  const summary = safeDiagnosticText(value.summary, settings, 2048);
  if (summary) result.summary = summary;
  const exception = compactNativeDiagnosticObject(value.exception, settings);
  const termination = compactNativeDiagnosticObject(value.termination, settings);
  if (exception) result.exception = exception;
  if (termination) result.termination = termination;
  if (value.faultThread && typeof value.faultThread === 'object' && !Array.isArray(value.faultThread)) {
    const faultThread = {};
    const rawThread = value.faultThread.thread;
    const thread = rawThread === null || rawThread === undefined || rawThread === ''
      ? null
      : nonnegativeInt(rawThread);
    if (thread !== null) faultThread.thread = thread;
    if (value.format === 'ips' && Array.isArray(value.faultThread.frames)) {
      const sourceFrames = value.faultThread.frames;
      faultThread.frames = sourceFrames.slice(0, 64).map(frame => {
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
        const safeFrameValue = {};
        for (const key of ['symbol', 'name', 'module', 'function', 'library', 'imageIndex', 'imageOffset', 'address', 'instruction', 'line', 'column']) {
          const item = frame[key];
          if (typeof item === 'string') safeFrameValue[key] = safeDiagnosticText(item, settings, 256);
          else if (Number.isSafeInteger(item)) safeFrameValue[key] = item;
        }
        return Object.keys(safeFrameValue).length ? safeFrameValue : null;
      }).filter(Boolean);
      const inheritedOmitted = nonnegativeInt(value.faultThread.framesOmitted) || 0;
      const omitted = inheritedOmitted + Math.max(0, sourceFrames.length - faultThread.frames.length);
      if (omitted) faultThread.framesOmitted = omitted;
    } else if (Array.isArray(value.faultThread.lines)) {
      const sourceLines = value.faultThread.lines;
      faultThread.lines = sourceLines.slice(0, 64).map(line => safeDiagnosticText(line, settings, 512)).filter(Boolean);
      const inheritedOmitted = nonnegativeInt(value.faultThread.linesOmitted) || 0;
      const omitted = inheritedOmitted + Math.max(0, sourceLines.length - faultThread.lines.length);
      if (omitted) faultThread.linesOmitted = omitted;
    }
    if (Object.keys(faultThread).length) result.faultThread = faultThread;
  }
  if (value.modules && typeof value.modules === 'object' && !Array.isArray(value.modules)) {
    const modules = {};
    if (value.format === 'ips' && Array.isArray(value.modules.items)) {
      const sourceItems = value.modules.items;
      modules.items = sourceItems.slice(0, 64).map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const safeModuleValue = {};
        for (const key of ['name', 'module', 'library', 'uuid', 'arch']) {
          if (typeof item[key] === 'string') safeModuleValue[key] = safeDiagnosticText(item[key], settings, 256);
        }
        for (const key of ['base', 'size', 'index']) if (Number.isSafeInteger(item[key])) safeModuleValue[key] = item[key];
        return Object.keys(safeModuleValue).length ? safeModuleValue : null;
      }).filter(Boolean);
      const inheritedOmitted = nonnegativeInt(value.modules.itemsOmitted) || 0;
      const omitted = inheritedOmitted + Math.max(0, sourceItems.length - modules.items.length);
      if (omitted) modules.itemsOmitted = omitted;
    } else if (Array.isArray(value.modules.lines)) {
      const sourceLines = value.modules.lines;
      modules.lines = sourceLines.slice(0, 64).map(line => safeDiagnosticText(line, settings, 512)).filter(Boolean);
      const inheritedOmitted = nonnegativeInt(value.modules.linesOmitted) || 0;
      const omitted = inheritedOmitted + Math.max(0, sourceLines.length - modules.lines.length);
      if (omitted) modules.linesOmitted = omitted;
    }
    if (Object.keys(modules).length) result.modules = modules;
  }
  return result;
}
function compactNativeEvidenceSet(value, settings = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sourceAttempts = Array.isArray(value.attempts) ? value.attempts : [];
  const attempts = sourceAttempts.slice(-4).map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const result = { attempt: nonnegativeInt(item.attempt) };
    const exitCode = signedInt(item.nativeExitCode);
    if (exitCode !== null) result.nativeExitCode = exitCode;
    const signal = String(item.signal || '').toUpperCase();
    if (/^SIG[A-Z0-9_]{1,16}$/.test(signal)) result.signal = signal;
    const evidence = compactNativeCrashEvidence(item.evidence, settings);
    if (evidence) {
      result.status = evidence.status;
      result.evidence = evidence;
    } else if (['matched', 'unavailable', 'not_applicable'].includes(item.status)) {
      result.status = item.status;
    } else {
      result.status = 'unavailable';
    }
    return result;
  }).filter(Boolean);
  const inheritedOmitted = nonnegativeInt(value.omittedAttempts) || 0;
  const omittedAttempts = inheritedOmitted + Math.max(0, sourceAttempts.length - attempts.length);
  const status = ['matched', 'unavailable', 'not_applicable'].includes(value.status) ? value.status
    : attempts.some(item => item.status === 'matched') ? 'matched' : 'unavailable';
  const result = {
    schemaVersion: 1,
    kind: 'native_crash_evidence_set',
    status,
    source: 'macos_diagnostic_report',
    attempts,
  };
  if (value.truncated === true || omittedAttempts || attempts.some(item => item.evidence && item.evidence.truncated)) result.truncated = true;
  if (omittedAttempts) result.omittedAttempts = omittedAttempts;
  return result;
}
function collectNativeEvidenceSet(session, attempts, { directories, settings } = {}) {
  if (!Array.isArray(attempts) || !attempts.length) return null;
  const budget = 64 * 1024;
  const perAttemptBudget = Math.max(4096, Math.floor((budget - 2048) / attempts.length));
  const collected = attempts.map(attempt => {
    let evidence;
    try {
      evidence = diagnosticNativeEvidence.collectNativeCrashEvidence({
        session,
        attempt,
        directories,
        settings,
        maxBytes: perAttemptBudget,
      });
    } catch (_) {
      evidence = {
        schemaVersion: 1,
        kind: 'native_crash_evidence',
        status: 'unavailable',
        source: 'macos_diagnostic_report',
        unavailableReason: 'collection_failed',
        summary: '[unavailable: native evidence collection failed]',
      };
    }
    const item = {
      attempt: nonnegativeInt(attempt.attempt),
      status: evidence && ['matched', 'unavailable', 'not_applicable'].includes(evidence.status) ? evidence.status : 'unavailable',
      evidence,
    };
    const exitCode = signedInt(attempt.nativeExitCode);
    if (exitCode !== null) item.nativeExitCode = exitCode;
    const signal = String(attempt.signal || '').toUpperCase();
    if (/^SIG[A-Z0-9_]{1,16}$/.test(signal)) item.signal = signal;
    return item;
  });
  const status = collected.some(item => item.status === 'matched') ? 'matched'
    : collected.every(item => item.status === 'not_applicable') ? 'not_applicable' : 'unavailable';
  const result = {
    schemaVersion: 1,
    kind: 'native_crash_evidence_set',
    status,
    source: 'macos_diagnostic_report',
    attempts: collected,
    truncated: collected.some(item => item.evidence && item.evidence.truncated === true),
  };
  return result;
}
function buildFailureTechnicalReport({ error, recordId, attemptId, stage, retryCount, asrRoot, settings = {}, now = new Date().toISOString(), nativeCrashReportDirectories } = {}) {
  const technical = {
    schemaVersion: 1,
    kind: 'sync_failure',
    dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
    failure: safeError(error, settings),
    stage: String(stage || 'unknown'),
    retryCount: nonnegativeInt(retryCount),
  };
  let unavailableReason = asrRoot ? 'no_matching_attempt' : 'not_applicable';
  if (asrRoot) {
    const loaded = readSession(asrRoot);
    if (!loaded.session) unavailableReason = loaded.reason;
    else {
      const matched = matchAsrSession(loaded.session, { recordId, attemptId, now });
      unavailableReason = matched.reason || '';
      if (matched.value) {
        technical.asr = matched.value;
        const crashSummary = readMatchingCrashSummary(loaded.session);
        technical.asr.crashSummary = String(crashSummary || '');
        technical.asr.crashSummaryStatus = crashSummary && !String(crashSummary).startsWith('[unavailable:')
          ? 'matched' : 'unavailable';
        const nativeAttempts = selectNativeEvidenceAttempts(loaded.session);
        if (nativeAttempts.length) {
          const nativeEvidenceSet = collectNativeEvidenceSet(loaded.session, nativeAttempts, {
            directories: Array.isArray(nativeCrashReportDirectories) ? nativeCrashReportDirectories : undefined,
            settings,
          });
          if (nativeEvidenceSet) technical.asr.nativeEvidence = nativeEvidenceSet;
        }
      }
    }
  }
  const safeTechnical = redactTree(technical, settings);
  const originalText = JSON.stringify(safeTechnical);
  if (!originalText.trim()) return unavailableTechnicalReport('redacted_empty', now);
  const originalBytes = bytes(originalText);
  let finalObject = safeTechnical;
  let text = originalText;
  let clipped = false;

  if (originalBytes > MAX_REPORT_TEXT_BYTES) {
    finalObject = JSON.parse(JSON.stringify(safeTechnical));
    clipped = true;
    // Reduce the largest diagnostic strings first while retaining their head
    // and tail; structure, attempt order, and non-text evidence stay intact.
    for (let pass = 0; pass < 64 && bytes(JSON.stringify(finalObject)) > MAX_REPORT_TEXT_BYTES; pass++) {
      const strings = [];
      const visit = (value, parent, key) => {
        if (typeof value === 'string' && bytes(value) > 256) strings.push({ parent, key, value, size: bytes(value) });
        else if (Array.isArray(value)) value.forEach((child, index) => visit(child, value, index));
        else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, value, childKey));
      };
      visit(finalObject, null, null);
      if (!strings.length) break;
      strings.sort((left, right) => right.size - left.size);
      const target = strings[0];
      const over = bytes(JSON.stringify(finalObject)) - MAX_REPORT_TEXT_BYTES;
      const keep = Math.max(128, target.size - over - 256);
      target.parent[target.key] = truncateUtf8(target.value, keep).text;
    }
    text = JSON.stringify(finalObject);
  }
  if (bytes(text) > MAX_REPORT_TEXT_BYTES) {
    const failure = safeTechnical.failure && typeof safeTechnical.failure === 'object' ? safeTechnical.failure : null;
    const compactFailure = {};
    if (failure) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(String(failure.name || ''))) compactFailure.name = String(failure.name);
      if (/^[A-Za-z0-9_-]{1,64}$/.test(String(failure.code || ''))) compactFailure.code = String(failure.code);
      if (Number.isSafeInteger(failure.status) && failure.status >= 0) compactFailure.status = failure.status;
      if (typeof failure.message === 'string') {
        const compactMessage = truncateUtf8(failure.message, 2048);
        if (compactMessage.text) compactFailure.message = compactMessage.text;
        if (failure.messageTruncated === true || compactMessage.truncated) compactFailure.messageTruncated = true;
      }
    }
    const fallback = {
      schemaVersion: 1,
      kind: 'sync_failure',
      dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
      summary: '[structured technical report reduced because its fields exceed the upload limit]',
      originalBytes,
      truncated: true,
      stage: safeTechnical.stage,
      retryCount: safeTechnical.retryCount,
      failureCode: safeTechnical.failure && safeTechnical.failure.code,
      ...(Object.keys(compactFailure).length ? { failure: compactFailure } : {}),
      asrAttemptCount: safeTechnical.asr && Array.isArray(safeTechnical.asr.attempts) ? safeTechnical.asr.attempts.length : 0,
      omittedTechnicalEvidence: true,
    };
    if (safeTechnical.asr && typeof safeTechnical.asr === 'object') {
      const compactAsr = {};
      if (safeTechnical.asr.inputIdentity && typeof safeTechnical.asr.inputIdentity === 'object') {
        compactAsr.inputIdentity = safeTechnical.asr.inputIdentity;
      }
      if (Array.isArray(safeTechnical.asr.attempts)) {
        compactAsr.attempts = safeTechnical.asr.attempts.slice(-16).map((attempt) => {
          const compactAttempt = {};
          for (const key of [
            'attempt', 'status', 'stage', 'exitCode', 'signal', 'nativeExitCode',
            'nativeExitAssociation', 'timeoutCode', 'timeoutCleanupStatus', 'startupGuard', 'peakRssKiB',
          ]) {
            if (attempt[key] !== undefined && attempt[key] !== '') compactAttempt[key] = attempt[key];
          }
          const checkpoints = Array.isArray(attempt.runningCheckpoints) ? attempt.runningCheckpoints : [];
          compactAttempt.runningCheckpointCount = checkpoints.length;
          const lastCheckpoint = checkpoints.at(-1);
          if (lastCheckpoint && typeof lastCheckpoint === 'object') {
            compactAttempt.lastRunningCheckpoint = {
              capturedAt: lastCheckpoint.capturedAt,
              pid: lastCheckpoint.pid,
              pidSource: lastCheckpoint.pidSource,
              processState: lastCheckpoint.processState,
              processStateSource: lastCheckpoint.processStateSource,
              wrapperPid: lastCheckpoint.wrapperPid,
              wrapperProcessState: lastCheckpoint.wrapperProcessState,
              progressSource: lastCheckpoint.progressSource,
              kind: lastCheckpoint.kind,
              progressObserved: lastCheckpoint.progressObserved === true,
              ...(lastCheckpoint.progress ? { progress: lastCheckpoint.progress } : {}),
            };
          }
          return compactAttempt;
        });
      }
      if (safeTechnical.asr.crashSummaryStatus) compactAsr.crashSummaryStatus = safeTechnical.asr.crashSummaryStatus;
      const compactNativeEvidence = compactNativeCrashEvidence(safeTechnical.asr.nativeEvidence);
      if (compactNativeEvidence) compactAsr.nativeEvidence = compactNativeEvidence;
      if (Object.keys(compactAsr).length) fallback.asr = compactAsr;
    }    text = JSON.stringify(fallback);
    clipped = true;
  }
  const mediaDiagnostic = safeTechnical.failure && safeTechnical.failure.mediaResolutionDiagnostic;
  const mediaDiagnosticTruncated = Boolean(mediaDiagnostic && (mediaDiagnostic.truncated || mediaDiagnostic.stagesOmittedCount || mediaDiagnostic.messageOmittedBytes));
  const fieldsTruncated = Boolean(safeTechnical.failure.messageTruncated || safeTechnical.failure.stackFramesOmittedCount || mediaDiagnosticTruncated);
  if (clipped || fieldsTruncated) {
    try {
      const finalParsed = JSON.parse(text);
      finalParsed.truncated = true;
      text = JSON.stringify(finalParsed);
    } catch (_) {
      return unavailableTechnicalReport('read_failed', now, originalBytes);
    }
  }
  return {
    schemaVersion: 1,
    kind: 'sync_failure',
    capturedAt: iso(now) || new Date().toISOString(),
    text,
    truncated: clipped || fieldsTruncated,
    originalBytes: Math.max(originalBytes, bytes(text)),
    ...(unavailableReason ? { unavailableReason: safeReason(unavailableReason) } : {}),
  };
}
function normalizeTechnicalReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1 || value.kind !== 'sync_failure' || typeof value.text !== 'string') return null;
  const originalBytes = nonnegativeInt(value.originalBytes);
  if (originalBytes === null) return null;
  let parsed;
  try { parsed = JSON.parse(value.text); } catch (_) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.schemaVersion !== 1 || parsed.kind !== 'sync_failure') return null;
  let safe = redactTree(parsed);
  let text = JSON.stringify(safe);
  let truncated = value.truncated === true || safe.truncated === true;
  if (bytes(text) > MAX_REPORT_TEXT_BYTES) {
    safe = JSON.parse(JSON.stringify(safe));
    truncated = true;
    for (let pass = 0; pass < 64 && bytes(JSON.stringify(safe)) > MAX_REPORT_TEXT_BYTES - 64; pass++) {
      const strings = [];
      const visit = (valuePart, parent, key) => {
        if (typeof valuePart === 'string' && bytes(valuePart) > 256) strings.push({ parent, key, value: valuePart, size: bytes(valuePart) });
        else if (Array.isArray(valuePart)) valuePart.forEach((child, index) => visit(child, valuePart, index));
        else if (valuePart && typeof valuePart === 'object') Object.entries(valuePart).forEach(([childKey, child]) => visit(child, valuePart, childKey));
      };
      visit(safe, null, null);
      if (!strings.length) break;
      strings.sort((left, right) => right.size - left.size);
      const target = strings[0];
      const over = bytes(JSON.stringify(safe)) - MAX_REPORT_TEXT_BYTES + 512;
      target.parent[target.key] = truncateUtf8(target.value, Math.max(128, target.size - over)).text;
    }
    safe.truncated = true;
    text = JSON.stringify(safe);
  }
  if (bytes(text) > MAX_REPORT_TEXT_BYTES) {
    safe = {
      schemaVersion: 1, kind: 'sync_failure',
      dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
      unavailableReason: 'size_limit', originalBytes: Math.max(originalBytes, bytes(value.text), bytes(text)),
      summary: '[structured technical report reduced because its fields exceed the upload limit]',
      truncated: true,
    };
    text = JSON.stringify(safe);
    truncated = true;
  }
  const clipped = truncateUtf8(text);
  if (clipped.truncated) return null; // The report builder and structured reducer must never cut JSON bytes.
  return {
    schemaVersion: 1,
    kind: 'sync_failure',
    capturedAt: iso(value.capturedAt) || new Date().toISOString(),
    text,
    truncated,
    originalBytes: Math.max(originalBytes, bytes(value.text), bytes(text)),
    ...(UNAVAILABLE_REASONS.has(value.unavailableReason) ? { unavailableReason: value.unavailableReason } : {}),
  };
}
function compactTechnicalReport(value, reason = 'outbox_limit') {
  const report = normalizeTechnicalReport(value);
  if (!report) return null;
  let parsed = null;
  try { parsed = JSON.parse(report.text); } catch (_) { parsed = null; }
  const compact = {
    schemaVersion: 1,
    kind: 'sync_failure',
    dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
    unavailableReason: safeReason(reason),
    originalBytes: report.originalBytes,
    truncated: true,
    evidenceCompleteness: {
      fullReportPending: true,
      fullReportSha256: crypto.createHash('sha256').update(report.text, 'utf8').digest('hex'),
      fullReportBytes: bytes(report.text),
    },
  };
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.capturedAt === 'string') compact.capturedAt = parsed.capturedAt;
    if (typeof parsed.stage === 'string') compact.stage = parsed.stage.slice(0, 64);
    if (Number.isSafeInteger(parsed.retryCount) && parsed.retryCount >= 0) compact.retryCount = parsed.retryCount;
    if (parsed.failure && typeof parsed.failure === 'object') {
      const failure = {};
      for (const key of ['name', 'code', 'status']) {
        if (typeof parsed.failure[key] === 'string' || Number.isSafeInteger(parsed.failure[key])) failure[key] = parsed.failure[key];
      }
      if (typeof parsed.failure.message === 'string') failure.message = takeUtf8(parsed.failure.message, 512);
      if (Object.keys(failure).length) compact.failure = failure;
    }
    if (parsed.asr && typeof parsed.asr === 'object') {
      const asr = {};
      if (parsed.asr.inputIdentity && typeof parsed.asr.inputIdentity === 'object') asr.inputIdentity = parsed.asr.inputIdentity;
      if (Array.isArray(parsed.asr.attempts)) {
        asr.attempts = parsed.asr.attempts.slice(-8).map((attempt) => {
          const result = {};
          for (const key of ['attempt', 'status', 'stage', 'exitCode', 'signal', 'nativeExitCode', 'nativeExitAssociation', 'timeoutCode', 'timeoutCleanupStatus', 'startupGuard', 'peakRssKiB']) {
            if (attempt[key] !== undefined && attempt[key] !== null && attempt[key] !== '') result[key] = attempt[key];
          }
          if (Array.isArray(attempt.runningCheckpoints)) {
            result.runningCheckpointCount = attempt.runningCheckpoints.length;
            const last = attempt.runningCheckpoints.at(-1);
            if (last && typeof last === 'object') {
              result.lastRunningCheckpoint = {
                capturedAt: last.capturedAt,
                pid: last.pid,
                pidSource: last.pidSource,
                processState: last.processState,
                processStateSource: last.processStateSource,
                wrapperPid: last.wrapperPid,
                wrapperProcessState: last.wrapperProcessState,
                progressSource: last.progressSource,
                kind: last.kind,
                progressObserved: last.progressObserved === true,
                ...(last.progress ? { progress: last.progress } : {}),
              };
            }
          }
          return result;
        });
      }
      if (parsed.asr.crashSummaryStatus) asr.crashSummaryStatus = parsed.asr.crashSummaryStatus;
      const compactNativeEvidence = compactNativeCrashEvidence(parsed.asr.nativeEvidence);
      if (compactNativeEvidence) asr.nativeEvidence = compactNativeEvidence;
      if (Object.keys(asr).length) compact.asr = asr;
    }
  }
  return {
    ...report,
    text: JSON.stringify(compact),
    truncated: true,
    unavailableReason: safeReason(reason),
  };
}
module.exports = {
  MAX_REPORT_TEXT_BYTES,
  UNAVAILABLE_REASONS,
  buildFailureTechnicalReport,
  normalizeTechnicalReport,
  compactTechnicalReport,
  unavailableTechnicalReport,
  bytes,
  truncateUtf8,
};
