'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const { createWechatArticleRequestGate } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-request-gate');
const { buildFailureTechnicalReport } = require('../obsidian-plugin/wechat-inbox-sync/src/failure-technical-report');
const url = 'https://mp.weixin.qq.com/s/article-a';
const other = 'https://mp.weixin.qq.com/s/article-b';
const article = { bodyFound: true, markdown: '这是正常文章正文。'.repeat(30), html: '<div id="js_content">这是正常正文。</div>', assets: [] };
async function main() {
  let request, staticCalls = 0, browserCalls = 0;
  const load = Module._load;
  Module._load = function(name, ...args) {
    if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, TFile: class {}, normalizePath: x => x, requestUrl: async x => { staticCalls++; return request(x); } };
    return load.call(this, name, ...args);
  };
  try {
    const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main.js');
    function fresh() {
      const p = new Plugin(); p.settings = { socialArticleImageStorageMode: 'remote' };
      p.wechatArticleRequestGate = createWechatArticleRequestGate({ gapMs: 0 });
      p.renderWechatArticleWithElectron = async () => { browserCalls++; return article; };
      return p;
    }
    const hydrate = (p, link = url, signal) => p.hydrateWebpageMarkdown({ type: 'webpage', content: link, metadata: { url: link } }, 'inbox', 'fixture', 'fixture', null, { signal });
    request = async () => ({ status: 200, text: '<html><body>环境异常，完成验证后即可继续访问。去验证</body></html>' });
    let p = fresh();
    const saved = await hydrate(p);
    assert.equal(saved.metadata.conversionStatus, 'success');
    assert.ok(saved.metadata.markdown.includes('这是正常文章正文'));
    assert.equal(staticCalls, 1); assert.equal(browserCalls, 1);
    assert.equal(p.wechatArticleRequestGate.snapshot().remainingCooldownMs, 0);

    // A's browser challenge must be diagnosed, and B must still execute and save.
    p = fresh(); staticCalls = 0; browserCalls = 0;
    p.renderWechatArticleWithElectron = async target => {
      browserCalls++;
      if (target.includes('article-a')) throw Object.assign(Error('微信要求完成访问验证'), { status: 200, wechatArticleDiagnostic: { browserStarted: true, loadCompleted: true, browserPhase: 'loaded', bodyFound: false, finalPageKind: 'captcha', captchaRedirect: true, verificationMarker: true, httpStatus: 200 } });
      return article;
    };
    let failed;
    await assert.rejects(hydrate(p), e => { failed = e; return e.diagnostic?.accessPause?.scope === 'article'; });
    const technical = JSON.parse(buildFailureTechnicalReport({ error: failed }).text);
    const evidence = technical.failure.extractionDiagnostic.stages.find(s => s.stage === 'hidden-browser').evidence;
    assert.equal(evidence.browserStarted, true); assert.equal(evidence.loadCompleted, true);
    assert.equal(evidence.finalPageKind, 'captcha'); assert.equal(evidence.bodyFound, false);
    assert.equal(technical.failure.extractionDiagnostic.accessPause.scope, 'article');
    assert.equal(technical.failure.extractionDiagnostic.retryAfterMs, 0);
    assert.equal((await hydrate(p, other)).metadata.conversionStatus, 'success');
    assert.equal(staticCalls, 2); assert.equal(browserCalls, 2);

    p = fresh();
    request = async () => { throw Error('HTTP 403: PRIVATE_RESPONSE_MUST_NOT_LEAK'); };
    p.downloadWebpageHtmlViaNode = async () => { throw Error('HTTP 403: PRIVATE_RESPONSE_MUST_NOT_LEAK'); };
    p.downloadWechatArticleHtmlViaSession = async () => '';
    p.renderWechatArticleWithElectron = async () => { throw Error('HTTP 403: PRIVATE_RESPONSE_MUST_NOT_LEAK'); };
    await assert.rejects(hydrate(p), e => {
      assert.ok(!JSON.stringify(e.diagnostic).includes('PRIVATE_RESPONSE_MUST_NOT_LEAK'));
      assert.ok(JSON.stringify(e.diagnostic).includes('RESPONSE_BODY_OMITTED'));
      return true;
    });
    request = async () => ({ text: '<html><body>环境异常，完成验证后即可继续访问。去验证</body></html>' });

    // A browser 429 supersedes the static article challenge and blocks B.
    p = fresh(); staticCalls = 0;
    p.renderWechatArticleWithElectron = async () => { throw Object.assign(Error('HTTP 429'), { status: 429 }); };
    await assert.rejects(hydrate(p), e => e.diagnostic?.failureCategory === 'wechat-rate-limited' && e.diagnostic.accessPause.scope === 'global');
    const incident = p.wechatArticleRequestGate.snapshot().incidentId;
    assert.equal(p.wechatArticleRequestGate.confirmRecovery(incident), false);
    await assert.rejects(hydrate(p, other), e => e.diagnostic?.accessPause?.requestStarted === false);
    assert.equal(staticCalls, 1);

    // Cancel after static challenge: no browser and no global cooldown.
    p = fresh(); browserCalls = 0; const abort = new AbortController();
    request = async () => { abort.abort(); return { text: '<html><body>环境异常，完成验证后即可继续访问。去验证</body></html>' }; };
    await assert.rejects(hydrate(p, url, abort.signal), { name: 'AbortError' });
    assert.equal(browserCalls, 0); assert.equal(p.wechatArticleRequestGate.snapshot().remainingCooldownMs, 0);

    // Concurrent article challenges do not poison queued work; 429 still does.
    const gate = createWechatArticleRequestGate({ gapMs: 0 });
    const first = gate.run(async () => ({ html: '<html><body>环境异常，完成验证后即可继续访问。去验证</body></html>' }));
    const second = gate.run(async () => 'next article');
    await assert.rejects(first, e => e.accessPause.scope === 'article');
    assert.equal(await second, 'next article');

    // Verified content is retained after hydration until the actual note commits.
    p = fresh();
    const { createVerifiedArticleCache } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-access-recovery');
    p.wechatVerifiedArticleCache = createVerifiedArticleCache(); p.wechatVerifiedArticleCache.put(url, article);
    await assert.rejects(p.wechatArticleRequestGate.run(async () => ({ status: 429 })));
    const files = new Map(); let failDisk = false;
    p.settings.inboxDir = 'inbox'; p.settings.notePropertyFields = 'title,url';
    p.app = { vault: { adapter: { exists: async f => files.has(f), write: async (f,s) => { if(failDisk)throw Error('DISK_FAILED');files.set(f,s); }, remove: async f => files.delete(f) }, create: async (f,s) => { files.set(f,s); }, getMarkdownFiles: () => [] } };
    p.showSyncProgress = () => {}; p.ensureFolder = async () => {};
    p.nextRecordTitle = async () => 'fixture'; p.nextTitle = async () => 'fixture';
    p.alignSocialArticleImageFolder = async record => ({ record }); p.saveSourceMediaAttachment = async r => r;
    const cancelled = new AbortController();
    p.enrichRecordMetadataWithAi = async r => { cancelled.abort(); return r; };
    const record = { id: 'cache-commit', type: 'webpage', content: url, metadata: { url }, createdAt: '2026-10-15T00:00:00Z' };
    await assert.rejects(p.writeRecord(record, record.createdAt, null, false, { signal: cancelled.signal }), { name: 'AbortError' });
    assert.equal(p.wechatVerifiedArticleCache.peek(url), article); assert.equal(files.size, 0);
    failDisk = true;
    await assert.rejects(p.writeRecord(record, record.createdAt, null, false, { skipAi: true }), /DISK_FAILED/);
    assert.equal(p.wechatVerifiedArticleCache.peek(url), article);
    failDisk = false;
    const written = await p.writeRecord(record, record.createdAt, null, false, { skipAi: true });
    assert.equal(written.committed, true); assert.ok(files.get(written.filePath).includes('这是正常文章正文'));
    assert.equal(p.wechatVerifiedArticleCache.peek(url), null);
  } finally { Module._load = load; }
  console.log('PASS: built plugin static challenge/browser recovery, per-article isolation, persisted browser evidence, 429 and cancellation');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
