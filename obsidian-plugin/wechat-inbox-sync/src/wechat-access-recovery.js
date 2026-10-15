'use strict';
const { normalizeWechatArticleUrl } = require('./wechat-article-utils');
function articleIdentity(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com' || url.username || url.password || url.port) return '';
    const normalized = normalizeWechatArticleUrl(url.href);
    if (!normalized) return '';
    const target = new URL(normalized);
    if (target.pathname === '/s') {
      if (!['__biz', 'mid', 'idx', 'sn'].every(k => target.searchParams.get(k))) return '';
      for (const k of [...target.searchParams.keys()]) if (!['__biz', 'mid', 'idx', 'sn'].includes(k)) target.searchParams.delete(k);
    }
    return target.href;
  } catch (_) { return ''; }
}
function createVerifiedArticleCache({ now = Date.now, ttlMs = 5 * 60 * 1000 } = {}) {
  let entry = null, timer = null;
  const clear = () => { entry = null; if (timer) clearTimeout(timer); timer = null; };
  return { clear,
    put(url, result) {
      const key = articleIdentity(url);
      if (!key || !result?.bodyFound || !String(result.markdown || '').trim()) return false;
      clear(); entry = { key, result, expiresAt: now() + ttlMs };
      timer = setTimeout(clear, ttlMs); timer.unref?.(); return true;
    },
    peek(url) {
      if (entry && now() >= entry.expiresAt) clear();
      if (!entry || entry.key !== articleIdentity(url)) return null;
      return entry.result;
    },
    take(url, expected) {
      if (!this.peek(url) || (expected && entry.result !== expected)) return null;
      const result = entry.result; clear(); return result;
    },
  };
}
// Human interaction only. Never solve, dismiss or bypass a verification challenge.
function openWechatArticleVerification({ url, BrowserWindow, session, renderArticle, gate, onWindow = () => {}, timeoutMs = 5 * 60 * 1000, pollMs = 1000 }) {
  const target = articleIdentity(url);
  if (!target || !BrowserWindow || !session) return Promise.reject(new Error('请粘贴完整的微信公众号文章 HTTPS 链接，并在桌面版 Obsidian 中打开。'));
  const epoch = gate.snapshot().incidentId;
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false, checking = false, timer, interval;
    const win = new BrowserWindow({ width: 900, height: 800, show: true, title: '公众号访问验证 — 完成验证后将自动检查正文', webPreferences: { session, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    onWindow(win);
    const wc = win.webContents;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); clearInterval(interval); controller.abort();
      wc.removeListener('did-finish-load', check);
      for (const event of ['will-navigate','will-frame-navigate','will-redirect']) wc.removeListener(event, guard);
      win.removeListener('closed', closed);
      if (!win.isDestroyed()) win.destroy();
      onWindow(null); if (error) reject(error); else resolve(result);
    };
    const closed = () => finish(null, { verified: false });
    const guard = (event, navigation) => {
      const value = typeof navigation === 'string' ? navigation : navigation?.url || event?.url;
      try { const u = new URL(value); if (u.protocol === 'https:' && u.hostname === 'mp.weixin.qq.com' && !u.username && !u.password && !u.port) return; } catch (_) {}
      event.preventDefault();
    };
    const check = async () => {
      if (settled || checking || win.isDestroyed() || articleIdentity(wc.getURL()) !== target) return;
      checking = true;
      try {
        const ready = await wc.executeJavaScript(`(() => { const root = document.querySelector('#js_content'); return Boolean(root && (String(root.innerText || root.textContent || '').trim() || root.querySelector('img,video,audio'))); })()`);
        if (!ready || settled || win.isDestroyed() || articleIdentity(wc.getURL()) !== target) return;
        const result = await renderArticle(target, { signal: controller.signal });
        if (settled || win.isDestroyed() || articleIdentity(wc.getURL()) !== target) return;
        if (result?.bodyFound && String(result.markdown || '').trim()) {
          const cooldownCleared = gate.confirmRecovery(epoch);
          finish(null, { verified: true, cooldownCleared, url: target, result });
        }
      } catch (_) {
        // A visible body alone is insufficient; keep the window for normal verification.
        // Do not repeatedly issue hidden requests after an extraction failure.
        clearInterval(interval); wc.removeListener('did-finish-load', check);
        finish(new Error('页面已打开，但插件仍未能提取正文；本次未解除访问保护，请保留诊断信息。'));
      } finally { checking = false; }
    };
    if (typeof wc.removeAllListeners !== 'function' || typeof wc.setWindowOpenHandler !== 'function') { finish(new Error('无法隔离公众号验证窗口的跳转处理')); return; }
    // New dedicated window only: remove Obsidian's inherited external-browser redirects.
    for (const event of ['will-navigate','will-frame-navigate','will-redirect']) { wc.removeAllListeners(event); wc.on(event, guard); }
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('did-finish-load', check);
    win.on('closed', closed);
    interval = setInterval(check, pollMs);
    timer = setTimeout(() => finish(new Error('验证窗口已超时；未确认正文恢复，访问保护保持不变。')), timeoutMs);
    Promise.resolve(win.loadURL(target)).catch(() => finish(new Error('原文打开失败；访问保护保持不变。')));
  });
}
module.exports = { articleIdentity, createVerifiedArticleCache, openWechatArticleVerification };
