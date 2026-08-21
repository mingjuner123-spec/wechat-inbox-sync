'use strict';

/**
 * Pure Douyin URL, page-state and media-candidate helpers.
 *
 * The plugin owns transport/session/browser orchestration in main.js.  This
 * module only owns the data transformations used by that orchestration, so
 * moving it does not change candidate ordering, retry policy, or extraction
 * rules.
 */
function createDouyinMediaHelpers({
  normalizeBrowserCapturedMediaUrls,
  getSocialRequestHeaders,
  douyinMobileShareUserAgent,
  pushUniqueMediaUrl,
  sortMediaUrlsForTranscription,
} = {}) {
  const normalizeCaptured = typeof normalizeBrowserCapturedMediaUrls === 'function'
    ? normalizeBrowserCapturedMediaUrls
    : () => [];
  const buildSocialHeaders = typeof getSocialRequestHeaders === 'function'
    ? getSocialRequestHeaders
    : () => ({});
  const addUniqueMediaUrl = typeof pushUniqueMediaUrl === 'function'
    ? pushUniqueMediaUrl
    : (list, value) => {
      if (!list.includes(value)) list.push(value);
    };
  const sortMedia = typeof sortMediaUrlsForTranscription === 'function'
    ? sortMediaUrlsForTranscription
    : (urls) => Array.from(new Set(Array.isArray(urls) ? urls : []));

  function isDouyinUrl(url) {
    const text = String(url || '').toLowerCase();
    return text.includes('douyin.com') || text.includes('iesdouyin.com') || text.includes('amemv.com');
  }

  function isDouyinMediaUrl(url) {
    return /douyinvod\.com|zjcdn\.com\/tos-|snssdk\.com\/aweme\/v1\/play|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video/i.test(String(url || ''));
  }

  function extractDouyinAwemeId(url) {
    const text = String(url || '');
    const patterns = [
      /\/video\/(\d{8,})/i,
      /\/share\/video\/(\d{8,})/i,
      /\/aweme\/detail\/(\d{8,})/i,
      /[?&](?:aweme_id|item_id|item_ids|modal_id)=(\d{8,})/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1];
    }
    return '';
  }

  function buildDouyinDomIdentityExtractorScript() {
    return String.raw`
    const collectIdentityIds = (node) => {
      const ids = [];
      const seenIds = new Set();
      const addIdentityText = (value) => {
        const text = String(value || '');
        const patterns = [
          /(?:\/video\/|\/share\/video\/|\/aweme\/detail\/)(\d{8,})/ig,
          /(?:aweme_id|item_id|item_ids|modal_id)[=:]+(\d{8,})/ig,
        ];
        patterns.forEach((pattern) => {
          let match;
          while ((match = pattern.exec(text))) {
            if (!seenIds.has(match[1])) {
              seenIds.add(match[1]);
              ids.push(match[1]);
            }
          }
        });
        if (/^\d{8,}$/.test(text) && !seenIds.has(text)) {
          seenIds.add(text);
          ids.push(text);
        }
      };
      let current = node;
      for (let depth = 0; current && depth < 7; depth += 1) {
        ['id', 'href', 'src', 'data-aweme-id', 'data-item-id', 'data-id'].forEach((name) => {
          try { addIdentityText(current.getAttribute && current.getAttribute(name)); } catch (error) {}
        });
        current = current.parentElement;
      }
      return ids;
    };
  `;
  }

  function selectPrimaryDouyinDomMediaUrls(candidates = [], targetAwemeId = '') {
    const targetId = String(targetAwemeId || '').trim();
    const ranked = (Array.isArray(candidates) ? candidates : [])
      .map((candidate, fallbackIndex) => {
        const urls = normalizeCaptured([candidate && candidate.urls]);
        const identityIds = Array.from(new Set(
          (Array.isArray(candidate && candidate.identityIds) ? candidate.identityIds : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
        ));
        if (!urls.length) return null;
        return {
          urls,
          exactIdentity: Boolean(targetId && identityIds.includes(targetId)),
          isPlaying: candidate && candidate.isPlaying === true,
          visibleInViewport: Boolean(candidate && candidate.visible && candidate.intersectsViewport),
          area: Math.max(0, Number(candidate && candidate.area) || 0),
          index: Number.isFinite(Number(candidate && candidate.index))
            ? Number(candidate.index)
            : fallbackIndex,
        };
      })
      .filter(Boolean)
      .sort((left, right) => (
        Number(right.exactIdentity) - Number(left.exactIdentity)
        || Number(right.isPlaying) - Number(left.isPlaying)
        || Number(right.visibleInViewport) - Number(left.visibleInViewport)
        || right.area - left.area
        || left.index - right.index
      ));
    return ranked.length ? ranked[0].urls : [];
  }

  function selectIdentityBoundDouyinBrowserMedia({
    targetAwemeId = '',
    finalUrl = '',
    canonicalUrl = '',
    debuggerMediaUrls = [],
    domMediaCandidates = [],
    pageIdentityIds = [],
    primaryDomMediaUrls = [],
  } = {}) {
    const targetId = String(targetAwemeId || '').trim();
    const finalRouteId = extractDouyinAwemeId(finalUrl);
    if (targetId && finalRouteId && finalRouteId !== targetId) return [];

    const exactPayloadMedia = normalizeCaptured([debuggerMediaUrls]);
    if (exactPayloadMedia.length) return exactPayloadMedia;

    const candidates = Array.isArray(domMediaCandidates) ? domMediaCandidates : [];
    if (candidates.length) return selectPrimaryDouyinDomMediaUrls(candidates, targetId);
    return normalizeCaptured([primaryDomMediaUrls]);
  }

  function normalizeDouyinTargetUrl(originalUrl, resolvedUrl = '') {
    const original = String(originalUrl || '').trim();
    const resolved = String(resolvedUrl || '').trim();
    const awemeId = extractDouyinAwemeId(resolved) || extractDouyinAwemeId(original);
    if (awemeId) {
      return { awemeId, url: `https://www.douyin.com/video/${awemeId}` };
    }
    const candidate = resolved || original;
    if (/^https?:\/\//i.test(candidate) && isDouyinUrl(candidate)) {
      return { awemeId: '', url: candidate };
    }
    return { awemeId: '', url: '' };
  }

  function buildDouyinBrowserFallbackRequest(originalUrl, resolvedUrl = '') {
    const target = normalizeDouyinTargetUrl(originalUrl, resolvedUrl);
    return {
      awemeId: target.awemeId,
      url: target.url,
      strictDouyinTarget: Boolean(target.awemeId),
    };
  }

  function buildDouyinBrowserFallbackRequests(originalUrl, resolvedUrl = '', knownAwemeId = '') {
    const original = String(originalUrl || '').trim();
    const resolved = String(resolvedUrl || '').trim();
    const inferredTarget = normalizeDouyinTargetUrl(original, resolved);
    const awemeId = String(knownAwemeId || inferredTarget.awemeId || '').trim();
    const target = awemeId
      ? { awemeId, url: `https://www.douyin.com/video/${encodeURIComponent(awemeId)}` }
      : inferredTarget;
    const requests = [];
    const seen = new Set();
    const addCurrentPage = (value, inputKind) => {
      const candidate = String(value || '').trim();
      if (!/^https?:\/\//i.test(candidate) || !isDouyinUrl(candidate) || seen.has(candidate)) return;
      seen.add(candidate);
      requests.push({
        awemeId: target.awemeId,
        url: candidate,
        strictDouyinTarget: false,
        inputKind,
      });
    };

    addCurrentPage(original, 'original-page');
    addCurrentPage(resolved, 'resolved-page');
    if (target.awemeId) addCurrentPage(target.url, 'target-page');
    if (!requests.length) addCurrentPage(target.url, 'target-page');
    return requests;
  }

  function getDouyinAwemeDetailUrls(awemeId) {
    const id = String(awemeId || '').trim();
    if (!id) return [];
    const query = `aweme_id=${encodeURIComponent(id)}&aid=6383&device_platform=webapp`;
    return [
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?${query}`,
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(id)}&aid=1128&device_platform=webapp`,
    ];
  }

  function getDouyinMobileSharePageUrls(awemeId) {
    const id = String(awemeId || '').trim();
    if (!id) return [];
    return [`https://www.iesdouyin.com/share/video/${encodeURIComponent(id)}/?from_ssr=1`];
  }

  function getDouyinMobileShareRequestHeaders(url) {
    return {
      ...buildSocialHeaders(url),
      'User-Agent': douyinMobileShareUserAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: 'https://www.iesdouyin.com/',
    };
  }

  function parseJsonObjectAssignedTo(source, variableName) {
    const text = String(source || '');
    const assignmentIndex = text.indexOf(variableName);
    if (assignmentIndex < 0) return null;
    const objectStart = text.indexOf('{', assignmentIndex + variableName.length);
    if (objectStart < 0) return null;
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = objectStart; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(objectStart, index + 1)); } catch (error) { return null; }
        }
      }
    }
    return null;
  }

  function parseJsonValueAt(source, valueStart) {
    const text = String(source || '');
    const first = text[valueStart];
    if (first !== '{' && first !== '[') return null;
    const close = first === '{' ? '}' : ']';
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = valueStart; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === first) depth += 1;
      if (char === close) {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(valueStart, index + 1)); } catch (error) { return null; }
        }
      }
    }
    return null;
  }

  function decodeDouyinStateText(value) {
    let text = String(value || '');
    const hasStructuredState = (candidate) => {
      const normalized = String(candidate || '').trim();
      return normalized.startsWith('{')
        || normalized.startsWith('[')
        || normalized.includes('"videoDetail"')
        || normalized.includes('\\"videoDetail\\"')
        || normalized.includes('"aweme_detail"')
        || normalized.includes('"awemeDetail"');
    };
    for (let index = 0; index < 2; index += 1) {
      if (hasStructuredState(text)) break;
      if (!/%(?:[0-9a-f]{2})/i.test(text)) break;
      try {
        const decoded = decodeURIComponent(text);
        if (!decoded || decoded === text) break;
        text = decoded;
      } catch (error) {
        break;
      }
    }
    return text;
  }

  function collectDouyinPaceStateValues(source) {
    const text = String(source || '');
    const values = [];
    const maxValues = 160;
    const maxTotalCharacters = 2000000;
    let totalCharacters = 0;
    const pushPattern = /self\.__pace_f\s*\.\s*push\s*\(/g;
    let match;
    while ((match = pushPattern.exec(text)) && values.length < maxValues && totalCharacters < maxTotalCharacters) {
      const arrayStart = text.indexOf('[', pushPattern.lastIndex);
      if (arrayStart < 0) continue;
      const payload = parseJsonValueAt(text, arrayStart);
      if (!Array.isArray(payload)) continue;
      payload.forEach((value) => {
        if (typeof value !== 'string' || values.length >= maxValues || totalCharacters >= maxTotalCharacters) return;
        const remaining = maxTotalCharacters - totalCharacters;
        const bounded = value.slice(0, remaining);
        if (!bounded) return;
        values.push(bounded);
        totalCharacters += bounded.length;
      });
      pushPattern.lastIndex = Math.max(pushPattern.lastIndex, arrayStart + 1);
    }
    return values;
  }

  function collectDouyinStatePayloadsFromText(value) {
    const source = String(value || '');
    const payloads = [];
    const addPayload = (payload, allowPrimary = true) => {
      if (payload && typeof payload === 'object' && payloads.length < 320) payloads.push({ payload, allowPrimary });
    };
    const inspect = (text) => {
      if (!text) return;
      const detailPattern = /"(?:videoDetail|aweme_detail|awemeDetail)"\s*:/g;
      const detailMatches = Array.from(text.matchAll(detailPattern));
      try { addPayload(JSON.parse(text)); } catch (error) {}
      const firstObjectStart = text.indexOf('{');
      if (firstObjectStart >= 0) addPayload(parseJsonValueAt(text, firstObjectStart), detailMatches.length <= 1);
      detailMatches.forEach((detailMatch) => {
        if (payloads.length >= 320) return;
        const detailStart = text.indexOf('{', Number(detailMatch.index) + detailMatch[0].length);
        if (detailStart < 0) return;
        const detail = parseJsonValueAt(text, detailStart);
        if (detail) addPayload({ videoDetail: detail }, false);
      });
    };
    inspect(source);
    if (/\\"(?:videoDetail|aweme_detail|awemeDetail)\\"/.test(source)) {
      inspect(source.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    }
    return payloads;
  }

  function collectDouyinPaceStatePayloads(source) {
    const values = collectDouyinPaceStateValues(source);
    const candidateTexts = [];
    const seenTexts = new Set();
    const addText = (value) => {
      const text = String(value || '');
      if (!text || seenTexts.has(text)) return;
      seenTexts.add(text);
      candidateTexts.push(text);
    };
    values.forEach((value) => addText(decodeDouyinStateText(value)));
    if (values.length > 1) {
      addText(decodeDouyinStateText(values.join('')));
      addText(values.map((value) => decodeDouyinStateText(value)).join(''));
    }
    const payloads = [];
    candidateTexts.forEach((text) => {
      collectDouyinStatePayloadsFromText(text).forEach((payload) => {
        if (payloads.length < 320) payloads.push(payload);
      });
    });
    return payloads;
  }

  function collectDouyinRouterStatePayloads(source) {
    const text = String(source || '');
    const payloads = [];
    const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptPattern.exec(text))) {
      const payload = parseJsonObjectAssignedTo(match[1], 'window._ROUTER_DATA');
      if (payload) payloads.push(payload);
    }
    const fallbackPayload = parseJsonObjectAssignedTo(text, 'window._ROUTER_DATA');
    if (fallbackPayload) payloads.push(fallbackPayload);
    return payloads;
  }

  function collectDouyinUrlList(value, urls) {
    if (!value) return;
    if (typeof value === 'string') {
      addUniqueMediaUrl(urls, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectDouyinUrlList(item, urls));
      return;
    }
    if (typeof value === 'object') {
      collectDouyinUrlList(value.url_list, urls);
      collectDouyinUrlList(value.urlList, urls);
      collectDouyinUrlList(value.url, urls);
      collectDouyinUrlList(value.src, urls);
    }
  }

  function extractDouyinMediaUrlsFromDetailPayload(payload) {
    const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
    if (!detail || typeof detail !== 'object') return [];
    const video = detail.video || {};
    const urls = [];
    collectDouyinUrlList(video.play_addr, urls);
    collectDouyinUrlList(video.download_addr, urls);
    collectDouyinUrlList(video.playAddr, urls);
    collectDouyinUrlList(video.downloadAddr, urls);
    (Array.isArray(video.bit_rate) ? video.bit_rate : []).forEach((item) => {
      collectDouyinUrlList(item && item.play_addr, urls);
      collectDouyinUrlList(item && item.playAddr, urls);
    });
    return sortMedia(urls);
  }

  function getDouyinDetailAwemeId(payload) {
    const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
    return String(detail && (detail.aweme_id || detail.awemeId) || '').trim();
  }

  function extractDouyinMediaUrlsForAweme(payload, awemeId) {
    const targetId = String(awemeId || '').trim();
    if (!targetId) return [];
    let root = payload;
    if (typeof root === 'string') {
      try { root = JSON.parse(root || '{}'); } catch (error) { return []; }
    }
    if (!root || typeof root !== 'object') return [];
    const urls = [];
    const seen = new Set();
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 16 || seen.size > 10000 || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      const candidateId = String(value.aweme_id || value.awemeId || '').trim();
      if (candidateId === targetId && value.video && typeof value.video === 'object') {
        extractDouyinMediaUrlsFromDetailPayload({ aweme_detail: value })
          .forEach((url) => addUniqueMediaUrl(urls, url));
      }
      Object.values(value).forEach((item) => visit(item, depth + 1));
    };
    visit(root);
    return sortMedia(urls);
  }

  function findDouyinDetailForAweme(payload, awemeId) {
    const targetId = String(awemeId || '').trim();
    if (!targetId || !payload || typeof payload !== 'object') return null;
    const seen = new Set();
    let matched = null;
    const visit = (value, depth = 0) => {
      if (matched || !value || typeof value !== 'object' || depth > 16 || seen.size > 10000 || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      const candidateId = String(value.aweme_id || value.awemeId || '').trim();
      if (candidateId === targetId) {
        matched = value;
        return;
      }
      Object.values(value).forEach((item) => visit(item, depth + 1));
    };
    visit(payload);
    return matched;
  }

  function collectExplicitDouyinPrimaryCandidates(payload) {
    const candidates = [];
    const addCandidate = (detail, priority) => {
      if (!detail || typeof detail !== 'object') return;
      const urls = extractDouyinMediaUrlsFromDetailPayload({ aweme_detail: detail });
      if (!urls.length) return;
      candidates.push({
        detail,
        priority,
        identity: String(detail.aweme_id || detail.awemeId || '').trim(),
        urls,
      });
    };
    if (!payload || typeof payload !== 'object') return candidates;
    addCandidate(payload.videoDetail, 100);
    addCandidate(payload.aweme_detail, 100);
    addCandidate(payload.awemeDetail, 100);
    if (payload.loaderData && typeof payload.loaderData === 'object') addCandidate(payload.loaderData.video, 80);
    return candidates;
  }

  function resolveDouyinMediaFromPayloads(payloads, awemeId) {
    const targetId = String(awemeId || '').trim();
    const exactUrls = [];
    let exactDetail = null;
    const primaryCandidates = [];
    (Array.isArray(payloads) ? payloads : []).forEach((entry) => {
      const isStateEntry = Boolean(
        entry && typeof entry === 'object'
        && Object.prototype.hasOwnProperty.call(entry, 'payload')
        && Object.prototype.hasOwnProperty.call(entry, 'allowPrimary'),
      );
      const payload = isStateEntry ? entry.payload : entry;
      if (targetId) {
        extractDouyinMediaUrlsForAweme(payload, targetId).forEach((url) => addUniqueMediaUrl(exactUrls, url));
        exactDetail = exactDetail || findDouyinDetailForAweme(payload, targetId);
      }
      if (!isStateEntry || entry.allowPrimary) collectExplicitDouyinPrimaryCandidates(payload)
        .forEach((candidate) => primaryCandidates.push(candidate));
    });
    const sortedExactUrls = sortMedia(exactUrls);
    if (sortedExactUrls.length) return { exactUrls: sortedExactUrls, primaryUrls: [], detail: exactDetail, identityOutcome: 'target-id-matched' };
    const bestPriority = primaryCandidates.reduce((highest, candidate) => Math.max(highest, Number(candidate.priority) || 0), -1);
    const bestCandidates = primaryCandidates.filter((candidate) => candidate.priority === bestPriority);
    const uniqueCandidates = new Map();
    bestCandidates.forEach((candidate) => {
      const key = candidate.identity || candidate.urls.join('|');
      if (!uniqueCandidates.has(key)) {
        uniqueCandidates.set(key, { ...candidate });
        return;
      }
      const previous = uniqueCandidates.get(key);
      previous.urls = sortMedia([...previous.urls, ...candidate.urls]);
    });
    if (uniqueCandidates.size === 1) {
      const candidate = Array.from(uniqueCandidates.values())[0];
      return { exactUrls: [], primaryUrls: candidate.urls, detail: candidate.detail, identityOutcome: 'unverified-primary-player' };
    }
    return { exactUrls: [], primaryUrls: [], detail: exactDetail, identityOutcome: '' };
  }

  function mergeDouyinMediaResolutions(...resolutions) {
    const exactUrls = [];
    const primaryCandidates = new Map();
    let exactDetail = null;
    resolutions.forEach((resolution) => {
      if (!resolution) return;
      (resolution.exactUrls || []).forEach((url) => addUniqueMediaUrl(exactUrls, url));
      if (resolution.exactUrls && resolution.exactUrls.length) exactDetail = exactDetail || resolution.detail;
      if (resolution.primaryUrls && resolution.primaryUrls.length) {
        const identity = String(resolution.detail && (resolution.detail.aweme_id || resolution.detail.awemeId) || '').trim();
        const key = identity || resolution.primaryUrls.join('|');
        if (!primaryCandidates.has(key)) primaryCandidates.set(key, { detail: resolution.detail, urls: sortMedia(resolution.primaryUrls) });
        else {
          const previous = primaryCandidates.get(key);
          previous.urls = sortMedia([...previous.urls, ...resolution.primaryUrls]);
        }
      }
    });
    const sortedExactUrls = sortMedia(exactUrls);
    const primaryCandidate = primaryCandidates.size === 1 ? Array.from(primaryCandidates.values())[0] : null;
    return {
      exactUrls: sortedExactUrls,
      primaryUrls: sortedExactUrls.length || !primaryCandidate ? [] : primaryCandidate.urls,
      detail: exactDetail || (primaryCandidate && primaryCandidate.detail) || null,
      identityOutcome: sortedExactUrls.length ? 'target-id-matched' : (primaryCandidate ? 'unverified-primary-player' : ''),
    };
  }

  function resolveDouyinMediaFromPaceState(source, awemeId) {
    return resolveDouyinMediaFromPayloads(collectDouyinPaceStatePayloads(source), awemeId);
  }

  function resolveDouyinMediaFromShareHtml(html, awemeId) {
    const source = String(html || '');
    return mergeDouyinMediaResolutions(
      resolveDouyinMediaFromPaceState(source, awemeId),
      resolveDouyinMediaFromPayloads(collectDouyinRouterStatePayloads(source), awemeId),
    );
  }

  function extractDouyinMediaUrlsFromPaceState(source, awemeId) {
    const resolution = resolveDouyinMediaFromPaceState(source, awemeId);
    return resolution.exactUrls.length ? resolution.exactUrls : resolution.primaryUrls;
  }

  function extractDouyinMediaUrlsFromShareHtml(html, awemeId) {
    const resolution = resolveDouyinMediaFromShareHtml(html, awemeId);
    return resolution.exactUrls.length ? resolution.exactUrls : resolution.primaryUrls;
  }

  function extractDouyinDetailFromShareHtml(html, awemeId) {
    return resolveDouyinMediaFromShareHtml(html, awemeId).detail;
  }

  return {
    isDouyinUrl,
    isDouyinMediaUrl,
    extractDouyinAwemeId,
    buildDouyinDomIdentityExtractorScript,
    selectPrimaryDouyinDomMediaUrls,
    selectIdentityBoundDouyinBrowserMedia,
    normalizeDouyinTargetUrl,
    buildDouyinBrowserFallbackRequest,
    buildDouyinBrowserFallbackRequests,
    getDouyinAwemeDetailUrls,
    getDouyinMobileSharePageUrls,
    getDouyinMobileShareRequestHeaders,
    parseJsonObjectAssignedTo,
    parseJsonValueAt,
    decodeDouyinStateText,
    collectDouyinPaceStateValues,
    collectDouyinStatePayloadsFromText,
    collectDouyinPaceStatePayloads,
    collectDouyinRouterStatePayloads,
    collectDouyinUrlList,
    extractDouyinMediaUrlsFromDetailPayload,
    getDouyinDetailAwemeId,
    extractDouyinMediaUrlsForAweme,
    findDouyinDetailForAweme,
    collectExplicitDouyinPrimaryCandidates,
    resolveDouyinMediaFromPayloads,
    mergeDouyinMediaResolutions,
    resolveDouyinMediaFromPaceState,
    resolveDouyinMediaFromShareHtml,
    extractDouyinMediaUrlsFromPaceState,
    extractDouyinMediaUrlsFromShareHtml,
    extractDouyinDetailFromShareHtml,
  };
}

module.exports = { createDouyinMediaHelpers };
