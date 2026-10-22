'use strict';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SAFE_QUERY_KEYS = new Set(['width', 'height', 'policy', 'fallback_source', 'mount_node_token', 'mount_point', 'preview_type', 'image_type']);

function parseFeishuImageUrl(value) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'));
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !/(?:^|\.)(?:feishu\.cn|feishu\.net|larksuite\.com|larkoffice\.com)$/.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/space\/api\/box\/stream\/download\/(?:v2\/cover|preview)\/([a-zA-Z0-9_-]{6,200})\/?$/);
    if (!match || [...url.searchParams.keys()].some(key => !SAFE_QUERY_KEYS.has(key))) return null;
    return { url: url.href, token: match[1] };
  } catch (_) { return null; }
}

function decodeDisplayImage(value) {
  let bytes;
  if (typeof value === 'string') {
    const match = value.match(/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if (!match || match[1].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) throw new Error('invalid_image');
    bytes = Buffer.from(match[1], 'base64');
  } else {
    bytes = Buffer.from(value || []);
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('image_size_limit');
  let mime = '';
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
  else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) mime = 'image/gif';
  else if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') mime = 'image/webp';
  else if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp' && /^(?:avif|avis)$/.test(bytes.toString('ascii', 8, 12))) mime = 'image/avif';
  else if (bytes.length >= 26 && bytes.toString('ascii', 0, 2) === 'BM') mime = 'image/bmp';
  if (!mime) throw new Error('invalid_image');
  return { bytes, mime };
}

function safeFailureCode(error) {
  const message = String(error && error.message || '');
  if (/401|403|授权|权限|登录|绑定/.test(message)) return 'authorization_required';
  if (/timeout|timed out|超时/i.test(message)) return 'timeout';
  if (/invalid_image|image_size_limit/.test(message)) return 'invalid_image';
  return 'load_failed';
}

// Rendering only: no vault writes, persisted URLs, Cookie strings or raw error logs.
function createFeishuImageDisplay(options) {
  const root = options.root;
  const states = new Map();
  const jobs = [];
  const inflight = new Map();
  const createUrl = options.createObjectURL || (blob => URL.createObjectURL(blob));
  const revokeUrl = options.revokeObjectURL || (url => URL.revokeObjectURL(url));
  let running = 0;
  let stopped = false;
  let paused = false;
  let scheduled = false;
  let notified = false;
  let observer;
  const stats = { detected: 0, shown: 0, failed: 0, lastErrorCode: '' };

  function revoke(state) {
    if (state.displayUrl && !state.revoked) { revokeUrl(state.displayUrl); state.revoked = true; }
  }
  function showStatus(img, state, message, failed = false) {
    if (!state.message) {
      state.message = img.ownerDocument.createElement('span');
      state.message.setAttribute('role', 'status');
      img.after(state.message);
    }
    state.message.className = failed ? 'wechat-inbox-feishu-image-error' : 'wechat-inbox-feishu-image-loading';
    state.message.textContent = message;
  }
  function cleanup(img, state, restore = true) {
    state.cancelled = true;
    if (state.onLoad) img.removeEventListener('load', state.onLoad);
    if (state.onError) img.removeEventListener('error', state.onError);
    if (state.message) state.message.remove();
    revoke(state);
    if (restore && img.getAttribute('src') === state.displayUrl) {
      img.setAttribute('src', state.original);
      if (state.srcset !== null) img.setAttribute('srcset', state.srcset);
    }
    states.delete(img);
  }
  function fail(img, state, error) {
    if (stopped || state.cancelled || !img.isConnected || state.failed) return;
    state.failed = true;
    revoke(state);
    stats.failed += 1;
    stats.lastErrorCode = safeFailureCode(error);
    const message = stats.lastErrorCode === 'timeout'
      ? '飞书图片加载超时，后续图片已暂停；可运行“重新加载飞书图片”重试。'
      : stats.lastErrorCode === 'authorization_required'
      ? '飞书图片未能加载，请检查插件设置中的飞书连接与图片访问权限。'
      : '飞书图片加载失败，可运行“重新加载飞书图片”重试；详细状态见插件诊断。';
    showStatus(img, state, message, true);
    if (!notified && options.notify) { notified = true; options.notify(message); }
  }
  async function pump() {
    while (!stopped && !paused && running < 3 && jobs.length) {
      const {img, state} = jobs.shift();
      if (state.cancelled || !img.isConnected) continue;
      running += 1;
      showStatus(img, state, '飞书图片加载中…');
      const key = state.resource.url;
      let job = inflight.get(key);
      if (!job) {
        const controller = new AbortController();
        job = {controller};
        let abort;
        const timeout = setTimeout(() => { job.timedOut = true; controller.abort(); }, Math.max(1, Number(options.timeoutMs) || 20000));
        const aborted = new Promise((_, reject) => {
          abort = () => reject(new Error(job.timedOut ? 'timeout' : 'cancelled'));
          controller.signal.addEventListener('abort', abort, {once: true});
        });
        job.promise = Promise.race([
          Promise.resolve().then(() => options.loadImage({...state.resource, signal: controller.signal})),
          aborted,
        ])
          .then(decodeDisplayImage)
          .finally(() => { clearTimeout(timeout); controller.signal.removeEventListener('abort', abort); inflight.delete(key); });
        inflight.set(key, job);
      }
      job.promise.then(({bytes, mime}) => {
        if (stopped || state.cancelled || !img.isConnected || img.getAttribute('src') !== state.original) return;
        state.displayUrl = createUrl(new Blob([bytes], {type: mime}));
        state.onLoad = () => {
          if (state.cancelled || state.failed) return;
          if (!state.loaded) { state.loaded = true; stats.shown += 1; }
          if (state.message) { state.message.remove(); state.message = null; }
          revoke(state);
        };
        state.onError = () => fail(img, state, new Error('invalid_image'));
        img.addEventListener('load', state.onLoad);
        img.addEventListener('error', state.onError);
        img.removeAttribute('srcset');
        img.setAttribute('src', state.displayUrl);
      }).catch(error => {
        if (job.timedOut) {
          paused = true;
          for (const pending of jobs) {
            if (!pending.state.cancelled && pending.img.isConnected) {
              showStatus(pending.img, pending.state, '飞书图片加载已暂停，可运行“重新加载飞书图片”继续。');
            }
          }
        }
        fail(img, state, error);
      }).finally(() => { running -= 1; pump(); });
    }
  }
  function scan(container = root, sourcePath = '') {
    if (stopped || !container) return;
    for (const [img, state] of states) {
      if (!img.isConnected) cleanup(img, state);
      else if (img.getAttribute('src') !== state.original && img.getAttribute('src') !== state.displayUrl) cleanup(img, state, false);
    }
    const images = [...(container.querySelectorAll ? container.querySelectorAll('img') : [])];
    if (container.tagName === 'IMG') images.unshift(container);
    for (const img of images) {
      if (states.has(img) || !img.isConnected) continue;
      const original = img.getAttribute('src');
      const resource = parseFeishuImageUrl(original);
      if (!resource || !options.canDisplay(img, sourcePath)) continue;
      // A normal accessible image already loaded by Obsidian needs no authorized request.
      if (img.complete && img.naturalWidth > 0) continue;
      const state = {original, resource, srcset: img.getAttribute('srcset')};
      states.set(img, state); stats.detected += 1; jobs.push({img, state});
      showStatus(img, state, paused
        ? '飞书图片加载已暂停，可运行“重新加载飞书图片”继续。'
        : '等待加载飞书图片…');
    }
    pump();
  }
  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    Promise.resolve().then(() => { scheduled = false; scan(); });
  };
  const Observer = options.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  if (Observer && root) {
    observer = new Observer(schedule);
    observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset']});
  }
  return {
    scan,
    retry() {
      paused = false;
      notified = false;
      stats.lastErrorCode = '';
      for (const [img, state] of states) if (state.failed) cleanup(img, state);
      scan();
    },
    diagnostic: () => ({
      attempts: stats.detected,
      detected: states.size,
      shown: [...states.values()].filter(state => state.loaded && !state.failed).length,
      failed: [...states.values()].filter(state => state.failed).length,
      lastErrorCode: stats.lastErrorCode,
      paused,
      pending: jobs.filter(item => !item.state.cancelled).length,
      active: running,
    }),
    stop() {
      stopped = true;
      if (observer) observer.disconnect();
      jobs.length = 0;
      for (const job of inflight.values()) job.controller.abort();
      for (const [img, state] of states) cleanup(img, state);
    },
  };
}

module.exports = {MAX_IMAGE_BYTES, parseFeishuImageUrl, decodeDisplayImage, createFeishuImageDisplay};
