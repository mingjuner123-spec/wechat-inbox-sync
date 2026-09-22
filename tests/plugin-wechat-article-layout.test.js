'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const article = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const pictures = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-image-post-utils');
const { runWechatArticlePipeline } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const url = 'https://mp.weixin.qq.com/s/layout-fixture';
const image = n => `https://mmbiz.qpic.cn/mmbiz_png/layout-${n}/640`;
const prose = '这是图文教程的正常段落，图片应保留在当前步骤之后，下一步骤之前。'.repeat(3);
const body = `<div id="js_content"><h2>安装插件</h2><p>${prose}</p><img data-src="${image(1)}"><h3>绑定账号</h3><p>${prose}</p><img data-src="${image(2)}"><p>结束标记</p></div>`;
const html = `<html><head><title>图文教程标题</title></head><body><script>var appmsg_type = "9";\nvar item_show_type = "0";</script>${body}</body></html>`;
let Plugin;
const originalLoad = Module._load;
try {
  Module._load = function(name, ...args) {
    if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {} };
    return originalLoad.call(this, name, ...args);
  };
  Plugin = require('../obsidian-plugin/wechat-inbox-sync/main.js');
} finally { Module._load = originalLoad; }
const { htmlToMarkdown } = Plugin.__test;
const built = fs.readFileSync(require.resolve('../obsidian-plugin/wechat-inbox-sync/main.js'), 'utf8');
const detectorStart = built.search(/function detectWechatImagePostDocument\d*\(/);
const detectorEnd = built.indexOf('function readWechatImagePostHtmlData(', detectorStart);
const builtDetector = built.slice(detectorStart, detectorEnd).replace(/__name\(detectWechatImagePostDocument[^;]+;/g, '').replace(/function detectWechatImagePostDocument\d*/, 'function detectWechatImagePostDocument');
const builtContext = {URL}; vm.createContext(builtContext); vm.runInContext(builtDetector, builtContext);
assert.equal(builtContext.detectWechatImagePostDocument({html,bodyHtml:body,bodyText:prose,hasBody:true}), false);
function assertLayout(markdown) {
  const tokens = ['## 安装插件', image(1), '### 绑定账号', image(2), '结束标记'];
  const positions = tokens.map(token => markdown.indexOf(token));
  assert.ok(positions.every((position, i) => position >= 0 && (!i || position > positions[i - 1])), markdown);
}
async function run() {
  const headings = htmlToMarkdown('<h1><span><br></span></h1><h2>&nbsp;</h2><h4>四级标题</h4><h5>五级标题</h5><h6>六级标题</h6><p>足够长的正文，空标题不能生成多余井号。</p>');
  assert.doesNotMatch(headings, /^#{1,6}\s*$/m);
  for (const [level, title] of [[4, '四级标题'], [5, '五级标题'], [6, '六级标题']]) assert.ok(headings.includes('#'.repeat(level)+' '+title));
  for (const type of ['0', '"0"', "'0'"]) {
    const input = html.replace('item_show_type = "0"', `item_show_type = ${type}`);
    assert.equal(article.classifyWechatArticleHtml(input), 'article');
    const decision = article.inspectWechatArticleContent(input, url);
    assert.equal(decision.complete, true);
    assert.equal(decision.diagnostic.contentKind, 'article');
    assert.equal(decision.html, input);
    assertLayout(htmlToMarkdown(decision.html));
  }
  // Ordinary pages can carry an unrelated picture list; it must not replace the body.
  const withList = html.replace('</body>', `<script>window.cgiDataNew={title:"无关图片标题",picture_page_info_list:[{cdn_url:"${image(99)}"}]};</script></body>`);
  const decision = article.inspectWechatArticleContent(withList, url);
  assert.equal(decision.diagnostic.contentKind, 'article');
  assert.equal(decision.diagnostic.extractor, 'article-body');
  assert.equal(decision.title, '', 'unrelated picture data must not override article title');
  assert.equal(decision.html, withList);
  assertLayout(htmlToMarkdown(decision.html));
  const overlappingList = html.replace('</body>', '<script>window.cgiDataNew={picture_page_info_list:['+[1,2,99].map(n => JSON.stringify({cdn_url:image(n)})).join(',')+']};</script></body>');
  const overlapDecision = article.inspectWechatArticleContent(overlappingList, url);
  assert.equal(overlapDecision.diagnostic.contentKind, 'article'); assertLayout(htmlToMarkdown(overlapDecision.html));
  let browserCalls = 0;
  const result = await runWechatArticlePipeline({ url, fetchStatic: async () => withList, renderBrowser: async () => { browserCalls++; throw Error('unexpected'); } });
  assert.equal(browserCalls, 0);
  assert.equal(result.diagnostic.contentDecision.contentKind, 'article');
  assertLayout(htmlToMarkdown(result.html));
  // Keep true carousels, short/empty shells and strings in shared bundles safe.
  assert.equal(article.classifyWechatArticleHtml(html.replace('var item_show_type = "0";', '')), 'article');
  assert.equal(article.classifyWechatArticleHtml(html.replace(body, '<div id="js_content">短说明</div>')), 'image-post');
  assert.equal(article.classifyWechatArticleHtml(html.replace('var item_show_type = "0";', "const example = 'var item_show_type = 0;';")), 'article');
  assert.equal(article.classifyWechatArticleHtml(html.replace('var item_show_type = "0";', 'var item_show_type = 0; var article_type = "newspic";')), 'article');
  assert.equal(pictures.detectWechatImagePostDocument({ html, url: url+'?t=pages/image_detail', hasBody: true, bodyHtml: body, bodyText: prose }), false);

  const hinted = await runWechatArticlePipeline({ url: url+'?t=pages/image_detail', fetchStatic: async () => html,
    renderBrowser: async () => { throw Error('strong article layout must not fall back to a caption'); } });
  assert.equal(hinted.source, 'static'); assertLayout(htmlToMarkdown(hinted.html));
  const gallery = '<script>var appmsg_type=9; var item_show_type=0; window.cgiDataNew={picture_page_info_list:['
    + [1,2,3].map(n => JSON.stringify({cdn_url:image(n)})).join(',') + ']};</script><div id="js_content"><p>'+prose+'</p><img data-src="'+image(1)+'"></div>';
  const galleryResult = article.inspectWechatArticleContent(gallery, url);
  assert.equal(galleryResult.diagnostic.contentKind, 'image-post'); assert.equal(galleryResult.assets.length, 3);
  for (const prefix of ['https:', 'http:', '']) {
    const galleryWithFooter = article.inspectWechatArticleContent(gallery.replace('<img data-src="https:', '<img data-src="'+prefix).replace('</div>', '<p>'+prose+'</p></div>'), url);
    assert.equal(galleryWithFooter.diagnostic.contentKind, 'image-post'); assert.equal(galleryWithFooter.assets.length, 3);
  }
  const twoCovers = gallery.replace('</div>', '<img data-src="'+image(2)+'"><p>'+prose+'</p></div>');
  const twoCoversDecision = article.inspectWechatArticleContent(twoCovers, url);
  assert.equal(twoCoversDecision.diagnostic.contentKind, 'image-post'); assert.equal(twoCoversDecision.assets.length, 3);
  for (const tail of ['', '<img data-src="'+image(1)+'">']) {
    const longArticle = '<script>var appmsg_type=9;</script><div id="js_content"><h2>标题</h2><p>'+prose.repeat(4)+'</p>'+tail+'</div>';
    for (const link of [url, url+'?t=pages/image_detail']) {
      assert.equal(article.inspectWechatArticleContent(longArticle, link).diagnostic.contentKind, 'article');
      assert.equal(article.inspectWechatArticleContent(longArticle, link).complete, true);
    }
  }
  const incomplete = body.replace(image(2), '');
  assert.equal(article.inspectWechatArticleContent(incomplete, url).complete, false);
  assert.equal(article.inspectWechatArticleContent(incomplete, url).fallbackComplete, false);
  assert.equal(article.inspectWechatArticleContent(incomplete, url).diagnostic.unresolvedImageCount, 1);
  const missing = await runWechatArticlePipeline({url, fetchStatic: async () => incomplete,
    renderBrowser: async () => ({ bodyFound:true, markdown:'正文\n![图]('+image(1)+')', imageCount:1, imageCandidateCount:2, diagnostic:{contentKind:'article'} }),
    isUsableBrowserArticle: () => true });
  assert.equal(missing.kind, 'retryable');

  // Execute the actual emitted browser extraction, then the real shared converter.
  const source = fs.readFileSync(require.resolve('../obsidian-plugin/wechat-inbox-sync/src/main.js'), 'utf8');
  const renderer = source.slice(source.indexOf('async function renderWechatArticleToMarkdownWithElectron('), source.indexOf('async function renderUrlToMarkdownWithElectron('));
  let destroyed = false, scriptCalls = 0;
  const images = [1, 2].map(n => ({ getAttribute: key => key === 'data-src' ? image(n) : '', setAttribute() {}, remove() {} }));
  const clone = { outerHTML: body, querySelectorAll: selector => selector === 'img' ? images : [] };
  const root = { innerHTML: body, textContent: prose.repeat(2), innerText: prose.repeat(2), cloneNode: () => clone, querySelectorAll: selector => selector.startsWith('img') ? images : [] };
  const doc = { documentElement: { innerHTML: html }, body: { textContent: prose }, title: '图文教程标题', querySelector: selector => selector === '#js_content' ? root : selector === '#activity-name, h1' ? { textContent: '图文教程标题' } : null };
  class BrowserWindow {
    constructor() {
      this.webContents = new EventEmitter();
      this.webContents.getURL = () => url;
      this.webContents.executeJavaScript = async code => {
        new vm.Script(code);
        scriptCalls++;
        return scriptCalls === 1 ? true : vm.runInNewContext(code, { document: doc, window: { location: { href: url } }, URL });
      };
    }
    async loadURL() {}
    destroy() { destroyed = true; }
  }
  const noop = () => {};
  const context = { URL, htmlToMarkdown, isWechatImagePostUrl: article.isWechatImagePostUrl,
    detectWechatImagePostDocument: pictures.detectWechatImagePostDocument,
    collectWechatImagePostStructuredAssets: pictures.collectWechatImagePostStructuredAssets,
    dedupeWechatImagePostAssets: pictures.dedupeWechatImagePostAssets,
    normalizeWechatImagePostMarkdown: pictures.normalizeWechatImagePostMarkdown,
    throwIfAborted: noop, getElectronBrowserWindow: () => BrowserWindow, getWechatSession: () => null,
    bindBrowserWindowToAbortSignal: () => noop, installWechatArticleNavigationGuards: noop,
    installHiddenBrowserWindowGuards: () => noop, waitForWebContents: async () => {},
    assertWechatTransportResponse: noop, getSafeUrlDiagnostic: () => ({ host: 'mp.weixin.qq.com' }),
    WECHAT_ARTICLE_DESKTOP_USER_AGENT: 'fixture', WECHAT_ARTICLE_MOBILE_USER_AGENT: 'fixture' };
  vm.createContext(context); vm.runInContext(renderer, context);
  const rendered = await context.renderWechatArticleToMarkdownWithElectron(url+'?t=pages/image_detail');
  assert.equal(rendered.diagnostic.contentKind, 'article');
  assert.equal(rendered.title, '图文教程标题');
  assert.equal(rendered.assets.length, 2);
  assert.equal(rendered.markdown, htmlToMarkdown(body));
  assertLayout(rendered.markdown);
  assert.equal(destroyed, true);
  console.log('PASS: WeChat rich article identity, inline order, headings and browser/static parity');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
