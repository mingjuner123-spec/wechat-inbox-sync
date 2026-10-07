'use strict';

const assert = require('node:assert/strict');
const report = require('../obsidian-plugin/wechat-inbox-sync/src/failure-technical-report');
const reporter = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');
const { buildRetryableBodyMissingResult } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const { diagnoseWechatArticleHtml } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');

function buildFixture() {
  const now = '2026-10-08T12:00:00.000Z';
  const sameRecordSourceUrl = 'https://mp.weixin.qq.com/s/fixture-article-id';
  const pipeline = buildRetryableBodyMissingResult({
    staticState: 'empty-shell',
    staticDiagnostic: diagnoseWechatArticleHtml('<html>FIXTURE_HTML_MUST_NOT_LEAK</html>'),
    browserState: 'unknown',
    browserError: null,
    attempts: [
      { channel: 'static', profile: 'fixture-desktop', outcome: 'guide', responseSignature: 'secret-signature' },
      { channel: 'browser', profile: 'fixture-browser', outcome: 'error', failureCategory: 'extractor-selector-mismatch' },
    ],
  });
  const diagnostic = {
    source: 'wechat-article',
    urlKind: 'slug',
    requestProfiles: [{ profile: 'fixture-profile', parameterNames: ['secret-query-key'] }],
    stages: [
      {
        stage: 'obsidian-request', outcome: 'response', state: 'empty-shell', status: 200,
        statusSource: 'actual', htmlChars: 0, bodyTextChars: 0, imageCandidateCount: 0,
        diagnostic: {
          pageKind: 'empty-shell', classifiedState: 'unknown', hasHtml: false, hasJsContent: false,
          bodyHtmlChars: 0, bodyTextChars: 0, imageCount: 0, mediaCount: 0, imageCandidateCount: 0,
          markers: { captcha: false, unavailable: false, guide: false, emptyShell: true, shellToolbar: true },
          rawHtml: '<html>RAW_HTML_MUST_NOT_LEAK</html>', sourceUrl: 'https://private.invalid/path?token=secret',
        },
        error: 'MESSAGE_MUST_NOT_LEAK token=fixture-secret',
      },
      {
        stage: 'hidden-browser', outcome: 'error', state: 'unknown', status: [200], htmlChars: false,
        markdownChars: [], assetCount: null, bodyTextChars: {}, imageCount: -1,
        diagnostic: { bodyHtmlChars: false, bodyTextChars: [], imageCount: null, mediaCount: {}, markers: { captcha: false } },
      },
      { stage: 'unrecognized-stage', outcome: 'error', state: 'article', status: 200 },
    ],
    ...pipeline.diagnostic,
    finalKind: pipeline.kind,
    finalState: pipeline.state,
    finalSource: pipeline.source,
    url: 'https://private.invalid/article?token=fixture-secret',
    requestPolicy: { secret: 'MUST_NOT_LEAK' },
  };
  const error = Object.assign(new Error('safe fixture failure'), {
    code: 'WECHAT_ARTICLE_BODY_MISSING',
    diagnostic,
  });
  const technicalReport = report.buildFailureTechnicalReport({
    error, recordId: 'record-fixture-123', attemptId: 'attempt-fixture-123', stage: 'parse', retryCount: 1, now,
  });
  const event = reporter.normalizeDiagnosticEvent({
    eventId: 'event-fixture-123', diagnosticId: 'diag-fixture-123', attemptId: 'attempt-fixture-123',
    syncRecordId: 'record-fixture-123', outcome: 'failed', errorType: 'EXTRACTION_FAILED',
    errorCode: 'WECHAT_ARTICLE_BODY_MISSING', stage: 'parse', platform: 'windows', pluginVersion: '1.3.182',
    occurredAt: now, retryCount: 1, technicalReport, sourceUrl: sameRecordSourceUrl,
  }, { now });
  return { now, sameRecordSourceUrl, technicalReport, event };
}

function main() {
  const { now, sameRecordSourceUrl, technicalReport, event } = buildFixture();
  const parsed = JSON.parse(technicalReport.text);
  const extraction = parsed.failure.extractionDiagnostic;
  assert.equal(extraction.component, 'wechat-article');
  assert.equal(extraction.reasonCode, 'wechat-article-body-missing');
  assert.equal(extraction.finalKind, 'retryable');
  assert.equal(extraction.finalState, 'body_missing');
  assert.equal(extraction.failureCategory, 'extractor-selector-mismatch');
  assert.equal(extraction.requestProfileCount, 1);
  assert.equal(extraction.stages.length, 2, 'only known extractor stages survive');
  assert.equal(extraction.stages[0].httpStatus, 200);
  assert.equal(extraction.stages[0].htmlChars, 0, 'zero counts remain visible');
  assert.equal(extraction.stages[0].bodyTextChars, 0);
  assert.equal(extraction.stages[0].evidence.hasHtml, false, 'false markers remain visible');
  assert.equal(extraction.stages[0].evidence.markers.captcha, false);
  assert.equal(extraction.stages[0].evidence.markers.emptyShell, true);
  for (const key of ['httpStatus', 'htmlChars', 'markdownChars', 'assetCount', 'bodyTextChars', 'imageCount']) {
    assert.equal(Object.hasOwn(extraction.stages[1], key), false, `invalid numeric ${key} must be omitted`);
  }
  for (const key of ['bodyHtmlChars', 'bodyTextChars', 'imageCount', 'mediaCount']) {
    assert.equal(Object.hasOwn(extraction.stages[1].evidence, key), false, `invalid evidence count ${key} must be omitted`);
  }
  for (const forbidden of [
    'FIXTURE_HTML_MUST_NOT_LEAK', 'RAW_HTML_MUST_NOT_LEAK', 'private.invalid', 'secret-query-key',
    'fixture-secret', 'MESSAGE_MUST_NOT_LEAK', 'responseSignature', 'requestPolicy', 'shellToolbar',
  ]) assert.equal(technicalReport.text.includes(forbidden), false, `technical report leaked ${forbidden}`);

  assert.equal(event.syncRecordId, 'record-fixture-123');
  assert.equal(event.sourceUrl, sameRecordSourceUrl);
  assert.equal(JSON.parse(event.technicalReport.text).failure.extractionDiagnostic.component, 'wechat-article');

  const success = reporter.normalizeDiagnosticEvent({
    eventId: 'event-success-123', diagnosticId: 'diag-success-123', attemptId: 'attempt-success-123',
    syncRecordId: 'record-success-123', outcome: 'succeeded', sourceUrl: sameRecordSourceUrl,
  }, { now });
  const successOutbox = reporter.normalizeOutbox([{
    event: success, bindingFingerprint: 'a'.repeat(64), createdAt: now, nextAttemptAt: Date.parse(now), uploadAttempts: 0,
  }], { now: Date.parse(now) });
  assert.equal(successOutbox.length, 0, 'successful content is not queued as a diagnostic event');
  assert.equal(Object.hasOwn(success, 'technicalReport'), false, 'success does not attach a failure report');
  assert.equal(Object.hasOwn(success, 'sourceUrl'), false, 'successful source link is not uploaded as a diagnostic');

  const unknown = report.buildFailureTechnicalReport({
    error: Object.assign(new Error('empty diagnostic'), { code: 'EXTRACTION_FAILED', diagnostic: { source: 'unknown-source', html: '<secret>' } }),
    recordId: 'record-empty-123', attemptId: 'attempt-empty-123', stage: 'parse', now,
  });
  assert.equal(Object.hasOwn(JSON.parse(unknown.text).failure, 'extractionDiagnostic'), false);
  assert.equal(unknown.text.includes('<secret>'), false);

  console.log('plugin-extraction-report-context.test.js: PASS (report and event, strict allowlist, success exclusion, redaction)');
}

module.exports = { buildFixture };
if (require.main === module) main();