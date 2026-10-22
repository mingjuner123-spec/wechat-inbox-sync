const assert = require('assert');

const {
  isZhihuUrl,
  isToutiaoUrl,
  isPlatformArticleUrl,
  getPlatformArticleKind,
  getPlatformArticleLabel,
  getPlatformArticleReferer,
  isAllowedPlatformArticleNavigation,
  normalizePlatformArticleUrl,
  parseToutiaoRenderData,
  parseZhihuInitialData,
  extractPlatformArticleFromHtml,
} = require('../obsidian-plugin/wechat-inbox-sync/src/platform-article-utils');

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

const toutiaoPlain = parseToutiaoRenderData(`<script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify({
  articleInfo: { title: '纯文本', content: 'A'.repeat(200) },
}))}</script>`);
assert.ok(toutiaoPlain);
assert.strictEqual(toutiaoPlain.contentHtml, '');
assert.strictEqual(toutiaoPlain.contentText.length, 200);

assert.strictEqual(parseToutiaoRenderData('<html>no data</html>'), null);
assert.strictEqual(parseToutiaoRenderData('<script id="RENDER_DATA">not json</script>'), null);

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
