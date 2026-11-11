const assert = require('assert');

const {
  isZhihuUrl,
  isToutiaoUrl,
  isPlatformArticleUrl,
  getPlatformArticleKind,
  isToutiaoArticleIdentityUrl,
  matchesPlatformArticleRenderIdentity,
  getPlatformArticleLabel,
  getPlatformArticleReferer,
  isAllowedPlatformArticleNavigation,
  normalizePlatformArticleUrl,
  selectPlatformArticleBody,
  parseToutiaoRenderData,
  parseToutiaoInfoV2,
  parseZhihuInitialData,
  parseZhihuTardisPage,
  getPlatformArticleFallbackRequests,
  extractPlatformArticleFromHtml,
} = require('../obsidian-plugin/wechat-inbox-sync/src/platform-article-utils');

function articleDocument({ singleAnswer = null, answerItems = null, answerBodies = [], selectors = {}, canonical = '' } = {}) {
  const canonicalNode = canonical ? { getAttribute: name => name === 'href' ? canonical : '' } : null;
  return {
    querySelector(selector) { return selectors[selector] || null; },
    querySelectorAll(selector) {
      if (selector === '.AnswerItem') return answerItems || (singleAnswer ? [singleAnswer] : []);
      if (selector === '.AnswerItem .RichText' || selector === '.QuestionAnswer-content .RichText' || selector === '.RichText.ztext') return answerBodies;
      if (selector === 'link[rel="canonical"],meta[property="og:url"]') return canonicalNode ? [canonicalNode] : [];
      return [];
    },
  };
}

assert.strictEqual(isZhihuUrl('https://zhuanlan.zhihu.com/p/123456'), true);
assert.strictEqual(isZhihuUrl('https://www.zhihu.com/question/123/answer/456'), true);
assert.strictEqual(isZhihuUrl('https://link.zhihu.com/?target=https%3A%2F%2Fzhuanlan.zhihu.com%2Fp%2F1'), true);
assert.strictEqual(isZhihuUrl('https://zhihu.com.evil.example/p/1'), false);
assert.strictEqual(isZhihuUrl('https://notzhihu.com/p/1'), false);
assert.strictEqual(isZhihuUrl('not a url'), false);

assert.strictEqual(isToutiaoUrl('https://www.toutiao.com/article/7123456789012345678/'), true);
assert.strictEqual(isToutiaoUrl('https://m.toutiao.com/i7123456789012345678/'), true);
assert.strictEqual(isToutiaoUrl('https://toutiao.com.evil.example/a123456'), false);
assert.strictEqual(isToutiaoUrl('https://example.com/a123456'), false);
assert.strictEqual(isToutiaoArticleIdentityUrl('https://www.toutiao.com/article/7123456789012345678/'), true);
assert.strictEqual(isToutiaoArticleIdentityUrl('https://m.toutiao.com/channel/hot/'), false);
assert.strictEqual(isToutiaoArticleIdentityUrl('https://m.toutiao.com/i7123456789012345678/'), true);
assert.strictEqual(isToutiaoArticleIdentityUrl('http://www.toutiao.com/article/7123456789012345678/'), false);
assert.strictEqual(isToutiaoArticleIdentityUrl('https://toutiao.com.evil.example/article/7123456789012345678/'), false);
assert.strictEqual(matchesPlatformArticleRenderIdentity('https://m.toutiao.com/is/short123/', 'https://m.toutiao.com/channel/hot/'), false,
  'a Toutiao short link resolving to a channel/feed is not the target article');
assert.strictEqual(matchesPlatformArticleRenderIdentity('https://m.toutiao.com/is/short123/', 'https://www.toutiao.com/article/7123456789012345678/'), true,
  'a Toutiao short link resolving to an HTTPS article identity is valid');

const zhihuBody = { textContent: '正文' };
const zhihuLegacyDom = articleDocument({ selectors: { '.RichText.ztext': zhihuBody }, answerBodies: [zhihuBody] });
assert.strictEqual(selectPlatformArticleBody(zhihuLegacyDom, 'zhihu', { platform: 'zhihu', type: 'answer', id: '456' }), zhihuBody,
  'restore the 1.3.196 narrow RichText fallback when the answer id is absent from the DOM');
const zhihuSingleAnswer = {
  getAttribute: () => '',
  querySelector: selector => selector === '.RichText' ? zhihuBody : null,
  querySelectorAll: () => [],
};
assert.strictEqual(selectPlatformArticleBody(articleDocument({ singleAnswer: zhihuSingleAnswer }), 'zhihu', { platform: 'zhihu', type: 'answer', id: '456' }), zhihuBody,
  'a single answer container on the identity-checked answer URL is safe to use');
const unrelatedAnswerBodies = [{}, {}];
assert.strictEqual(selectPlatformArticleBody(articleDocument({ answerBodies: unrelatedAnswerBodies }), 'zhihu', { platform: 'zhihu', type: 'answer', id: '456' }), null,
  'multiple unmarked answers must never be guessed');
const onlyVisibleWrongAnswerBody = {};
assert.strictEqual(selectPlatformArticleBody(articleDocument({
  answerItems: [{ getAttribute: () => '', querySelector: () => null, querySelectorAll: () => [] },
    { getAttribute: () => '', querySelector: () => null, querySelectorAll: () => [] }],
  answerBodies: [onlyVisibleWrongAnswerBody],
}), 'zhihu', { platform: 'zhihu', type: 'answer', id: '456' }), null,
'multiple answer containers with only one visible unmarked body must still fail closed');
const toutiaoArticleBody = { textContent: '头条正文' };
assert.strictEqual(selectPlatformArticleBody(articleDocument({ selectors: { article: toutiaoArticleBody } }), 'toutiao', { platform: 'toutiao', type: 'article', id: '7123456789012345678' }), toutiaoArticleBody,
  'restore the prior semantic article container fallback for Toutiao');

assert.strictEqual(isPlatformArticleUrl('https://zhuanlan.zhihu.com/p/1'), true);
assert.strictEqual(isPlatformArticleUrl('https://www.toutiao.com/a1234567/'), true);
assert.strictEqual(isPlatformArticleUrl('https://mp.weixin.qq.com/s/abc'), false);

assert.strictEqual(getPlatformArticleKind('https://zhuanlan.zhihu.com/p/1'), 'zhihu');
assert.strictEqual(getPlatformArticleKind('https://m.toutiao.com/i1234567/'), 'toutiao');
assert.strictEqual(getPlatformArticleKind('https://example.com'), '');
assert.strictEqual(getPlatformArticleLabel('https://zhuanlan.zhihu.com/p/1'), '知乎');
assert.strictEqual(getPlatformArticleLabel('https://m.toutiao.com/i1234567/'), '今日头条');
assert.strictEqual(getPlatformArticleLabel('https://example.com'), '');
assert.strictEqual(getPlatformArticleReferer('https://zhuanlan.zhihu.com/p/1'), 'https://www.zhihu.com/');
assert.strictEqual(getPlatformArticleReferer('https://m.toutiao.com/i1234567/'), 'https://www.toutiao.com/');
assert.strictEqual(getPlatformArticleReferer('https://example.com'), '');

// The hidden extraction window may only follow redirects inside the article's
// own official host. Toutiao redirects used to reach Obsidian's inherited
// will-navigate handler, which hands them to shell.openExternal and leaves the
// extraction window empty.
assert.strictEqual(
  isAllowedPlatformArticleNavigation('https://www.toutiao.com/article/7123456789012345678/', 'toutiao'),
  true,
);
assert.strictEqual(isAllowedPlatformArticleNavigation('https://m.toutiao.com/is/abc123/', 'toutiao'), true);
assert.strictEqual(
  isAllowedPlatformArticleNavigation('https://www.toutiao.com/article/1/', 'zhihu'),
  false,
);
assert.strictEqual(isAllowedPlatformArticleNavigation('https://www.zhihu.com/question/1/answer/2', 'zhihu'), true);
assert.strictEqual(
  isAllowedPlatformArticleNavigation('https://link.zhihu.com/?target=https%3A%2F%2Fwww.zhihu.com%2Fp%2F1', 'zhihu'),
  true,
);
for (const blocked of [
  'https://toutiao.com.evil.example/article/1/',
  'http://www.toutiao.com/article/1/',
  'https://www.toutiao.com:8443/article/1/',
  'https://user:pass@www.toutiao.com/article/1/',
  'snssdk143://detail?groupid=1',
  'javascript:alert(1)',
  'not a url',
]) {
  assert.strictEqual(isAllowedPlatformArticleNavigation(blocked, 'toutiao'), false, blocked);
}
assert.strictEqual(isAllowedPlatformArticleNavigation('https://www.toutiao.com/article/1/', 'weibo'), false);

assert.strictEqual(
  normalizePlatformArticleUrl('https://zhuanlan.zhihu.com/p/123456?utm_source=wechat&share_code=abc#comments'),
  'https://zhuanlan.zhihu.com/p/123456',
);
assert.strictEqual(
  normalizePlatformArticleUrl('https://www.zhihu.com/question/123/answer/456?from=timeline&isappinstalled=0'),
  'https://www.zhihu.com/question/123/answer/456',
);
assert.strictEqual(
  normalizePlatformArticleUrl('https://link.zhihu.com/?target=https%3A%2F%2Fzhuanlan.zhihu.com%2Fp%2F987%3Futm_source%3Dx'),
  'https://zhuanlan.zhihu.com/p/987',
);
assert.strictEqual(
  normalizePlatformArticleUrl('https://www.toutiao.com/article/7123456789012345678/?source=share&utm_medium=weixin'),
  'https://www.toutiao.com/article/7123456789012345678/',
);
assert.strictEqual(
  normalizePlatformArticleUrl('https://m.toutiao.com/i7123456789012345678/?tt_from=weixin'),
  'https://m.toutiao.com/i7123456789012345678/',
);
// Unknown path keeps meaningful query parameters.
assert.strictEqual(
  normalizePlatformArticleUrl('https://www.toutiao.com/search?keyword=%E6%B5%8B%E8%AF%95&source=share'),
  'https://www.toutiao.com/search?keyword=%E6%B5%8B%E8%AF%95',
);
assert.strictEqual(normalizePlatformArticleUrl('https://example.com/p/1?utm_source=x'), 'https://example.com/p/1?utm_source=x');

const toutiaoHtml = `<html><body><script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify({
  app: {
    data: {
      articleInfo: {
        title: '测试头条文章',
        content: '<p>第一段内容，足够长以通过最小长度判断。</p><p>第二段内容，同样足够长。</p>',
        media_user: { screen_name: '头条作者' },
        publish_time: '2026-10-20 10:00',
      },
    },
  },
}))}</script></body></html>`;
const toutiao = parseToutiaoRenderData(toutiaoHtml);
assert.ok(toutiao);
assert.strictEqual(toutiao.title, '测试头条文章');
assert.strictEqual(toutiao.author, '头条作者');
assert.ok(toutiao.contentHtml.includes('第一段内容'));
assert.strictEqual(toutiao.contentText, '');
assert.strictEqual(toutiao.source, 'render-data');

const toutiaoSemanticHeadings = parseToutiaoRenderData(`<script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify({
  articleInfo: { title: '段落层级', content: '<p><strong>破解世界性难题的原创性成果</strong></p><p>这里是后续正文，包含正常句号。</p><p>这是一段<strong>正文强调</strong>，不能误判成标题。</p>' },
}))}</script>`);
assert.match(toutiaoSemanticHeadings.contentHtml, /<h2><strong>破解世界性难题的原创性成果<\/strong><\/h2>/,
  'standalone bold section headings should be restored as h2');
assert.match(toutiaoSemanticHeadings.contentHtml, /<p>这是一段<strong>正文强调<\/strong>，不能误判成标题。<\/p>/,
  'inline bold emphasis must remain a paragraph');

const toutiaoPlain = parseToutiaoRenderData(`<script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify({
  articleInfo: { title: '纯文本', content: 'A'.repeat(200) },
}))}</script>`);
assert.ok(toutiaoPlain);
assert.strictEqual(toutiaoPlain.contentHtml, '');
assert.strictEqual(toutiaoPlain.contentText.length, 200);

assert.strictEqual(parseToutiaoRenderData('<html>no data</html>'), null);
assert.strictEqual(parseToutiaoRenderData('<script id="RENDER_DATA">not json</script>'), null);

const toutiaoInfoV2Payload = {
  data: {
    group_id: '7123456789012345678',
    title: '移动端文章正文',
    content: '<p>移动端接口返回的第一段正文，包含足够长的可读内容。</p><p>第二段保留在结果里。</p>',
    media_user: { screen_name: '移动端作者' },
    poster_url: 'https://p3.toutiaoimg.com/cover.jpg',
  },
};
const toutiaoInfoV2 = parseToutiaoInfoV2(JSON.stringify(toutiaoInfoV2Payload), 'https://www.toutiao.com/article/7123456789012345678/');
assert.ok(toutiaoInfoV2);
assert.strictEqual(toutiaoInfoV2.title, '移动端文章正文');
assert.strictEqual(toutiaoInfoV2.author, '移动端作者');
assert.strictEqual(toutiaoInfoV2.source, 'toutiao-info-v2');
assert.ok(toutiaoInfoV2.contentHtml.includes('第一段正文'));
assert.strictEqual(parseToutiaoInfoV2({ data: { group_id: '999', title: '错文章', content: '<p>' + '正文'.repeat(100) + '</p>' } }, 'https://www.toutiao.com/article/7123456789012345678/'), null,
  'reject a Toutiao API payload whose article ID differs from the requested identity');

const zhihuTardisResponse = `<html><script>window.g_initialProps = ${JSON.stringify({
  title: 'SSR 问题标题',
  author: { name: 'SSR 作者' },
  renderHtml: '<div class="AnswerItem"><div class="RichContent-inner"><div class="RichText">' + '知乎公开回答正文。'.repeat(25) + '</div></div></div>',
})};</script></html>`;
const zhihuTardis = parseZhihuTardisPage(zhihuTardisResponse, 'https://www.zhihu.com/question/123/answer/456');
assert.ok(zhihuTardis);
assert.strictEqual(zhihuTardis.source, 'zhihu-tardis-ssr');
assert.strictEqual(zhihuTardis.targetId, '456');
assert.strictEqual(zhihuTardis.title, 'SSR 问题标题');
assert.ok(zhihuTardis.renderHtml.includes('知乎公开回答正文'));
assert.strictEqual(parseZhihuTardisPage(zhihuTardisResponse, 'https://www.toutiao.com/article/7123456789012345678/'), null);
assert.deepStrictEqual(getPlatformArticleFallbackRequests('https://www.zhihu.com/question/123/answer/456'), [{
  platform: 'zhihu', type: 'tardis-ssr', targetId: '456', url: 'https://www.zhihu.com/tardis/zm/ans/456',
}]);
assert.deepStrictEqual(getPlatformArticleFallbackRequests('https://zhuanlan.zhihu.com/p/789'), [{
  platform: 'zhihu', type: 'tardis-ssr', targetId: '789', url: 'https://www.zhihu.com/tardis/zm/art/789',
}]);
assert.deepStrictEqual(getPlatformArticleFallbackRequests('https://www.toutiao.com/article/7123456789012345678/'), [{
  platform: 'toutiao', type: 'info-v2', targetId: '7123456789012345678', url: 'https://m.toutiao.com/i7123456789012345678/info/v2/',
}]);

const safeToutiaoDiagnostic = require('../obsidian-plugin/wechat-inbox-sync/src/platform-article-utils').sanitizePlatformArticleDiagnostic({
  source: 'platform-article', platform: 'toutiao', failureCode: 'ARTICLE_DATA_MISSING',
  htmlChars: 321, renderDataPresent: true, renderDataArticleFound: false,
  bodySelectorFound: true, identityMatched: false,
  fallback: { attempts: [
    { type: 'info-v2', transport: 'obsidian-requestUrl', status: 200, ok: false, url: 'private-url' },
    { type: 'tardis-ssr', transport: 'node-http', status: 200, ok: true },
    { type: 'unknown', transport: 'obsidian-requestUrl', status: 200, ok: true },
  ], succeeded: 'tardis-ssr', secret: 'private-text' },
  reason: 'private text', sourceUrl: 'https://private.example/article',
});
assert.equal(safeToutiaoDiagnostic.failureCode, 'ARTICLE_DATA_MISSING');
assert.equal(safeToutiaoDiagnostic.htmlChars, 321);
assert.equal(safeToutiaoDiagnostic.renderDataPresent, true);
assert.equal(safeToutiaoDiagnostic.bodySelectorFound, true);
assert.deepStrictEqual(safeToutiaoDiagnostic.fallback, {
  attempts: [
    { type: 'info-v2', transport: 'obsidian-requestUrl', status: 200, ok: false },
    { type: 'tardis-ssr', transport: 'node-http', status: 200, ok: true },
  ],
  succeeded: 'tardis-ssr',
});
assert.equal(safeToutiaoDiagnostic.identityMatched, false);
assert.equal(JSON.stringify(safeToutiaoDiagnostic).includes('private'), false);

const zhihuHtml = `<html><body><script id="js-initialData" type="text/json">${JSON.stringify({
  initialState: {
    entities: {
      answers: {
        1: {
          content: '<p>这是一个知乎回答的正文内容，长度足够用于测试解析。第二句继续补充内容，确保超过最小长度阈值。</p>',
          author: { name: '知乎作者' },
          question: { title: '问题标题' },
          created: 1700000000,
        },
      },
    },
  },
})}</script></body></html>`;
const zhihu = parseZhihuInitialData(zhihuHtml);
assert.ok(zhihu);
assert.strictEqual(zhihu.author, '知乎作者');
assert.strictEqual(zhihu.title, '问题标题');
assert.ok(zhihu.contentHtml.includes('知乎回答'));
assert.strictEqual(zhihu.source, 'js-initial-data');
assert.strictEqual(parseZhihuInitialData('<html></html>'), null);

assert.strictEqual(extractPlatformArticleFromHtml(toutiaoHtml, 'toutiao').title, '测试头条文章');
assert.strictEqual(extractPlatformArticleFromHtml(zhihuHtml, 'zhihu').author, '知乎作者');
assert.strictEqual(extractPlatformArticleFromHtml(toutiaoHtml, 'zhihu'), null);

console.log('platform-article-utils.test.js passed');
