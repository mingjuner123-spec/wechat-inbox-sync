'use strict';

const assert = require('assert');
const {
  classifyWechatArticleHtml,
  extractWechatArticleFallbackMetadata,
  buildWechatArticleFallbackMarkdown,
} = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const { runWechatArticlePipeline } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');

const articleHtml = [
  '<html><head><title>真实文章标题</title></head><body>',
  '<div id="js_content"><p>这是足够长的公众号正文，用来确认页面不是打开引导页。</p></div>',
  '</body></html>',
].join('');

const guideHtml = [
  '<html><head>',
  '<meta property="og:title" content="值得保存的文章标题">',
  '<meta property="og:description" content="文章摘要">',
  '<meta property="og:image" content="https://mmbiz.qpic.cn/cover.jpg">',
  '</head><body>微信扫一扫可打开此内容 使用小程序</body></html>',
].join('');

const genericGuideHtml = '<html><head><title>微信公众平台</title><meta property="og:image" content="javascript:bad"></head><body>微信扫一扫可打开此内容 使用完整服务</body></html>';

assert.strictEqual(classifyWechatArticleHtml(articleHtml), 'article');
assert.strictEqual(
  classifyWechatArticleHtml('<div id="js_content"><p>短句。</p><p>This later paragraph contains enough article content to prove the whole article body is present.</p></div>'),
  'article',
);
assert.strictEqual(classifyWechatArticleHtml(guideHtml), 'guide');
assert.strictEqual(
  classifyWechatArticleHtml('<div id="js_content">微信扫一扫可打开此内容。使用完整服务。This guide-page shell has enough text to previously look like an article.</div>'),
  'guide',
);
assert.strictEqual(classifyWechatArticleHtml('<p>环境异常，完成验证后即可继续访问</p>'), 'captcha');

assert.deepStrictEqual(extractWechatArticleFallbackMetadata(guideHtml), {
  title: '值得保存的文章标题',
  description: '文章摘要',
  coverUrl: 'https://mmbiz.qpic.cn/cover.jpg',
});
assert.deepStrictEqual(extractWechatArticleFallbackMetadata(genericGuideHtml), {
  title: '',
  description: '',
  coverUrl: '',
});

const fallbackMarkdown = buildWechatArticleFallbackMarkdown({
  url: 'https://mp.weixin.qq.com/s/example',
  state: 'guide',
  title: '值得保存的文章标题',
  description: '文章摘要',
  coverUrl: 'https://mmbiz.qpic.cn/cover.jpg',
});
assert.match(fallbackMarkdown, /微信公众号未返回正文/);
assert.match(fallbackMarkdown, /原始链接：https:\/\/mp\.weixin\.qq\.com\/s\/example/);
assert.match(fallbackMarkdown, /!\[封面\]\(https:\/\/mmbiz\.qpic\.cn\/cover\.jpg\)/);

async function runPipelineTests() {
  const browserArticle = [
    '<html><head><title>浏览器正文标题</title></head><body>',
    '<div id="js_content"><p>这是浏览器兜底获得的足够长的公众号正文，应该作为完整文章保存。</p></div>',
    '</body></html>',
  ].join('');
  let browserCalls = 0;
  const recovered = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/recovered',
    fetchStatic: async () => guideHtml,
    renderBrowser: async () => {
      browserCalls += 1;
      return { html: browserArticle, title: '浏览器正文标题', assets: [{ src: 'https://mmbiz.qpic.cn/body.jpg' }] };
    },
  });
  assert.strictEqual(browserCalls, 1);
  assert.deepStrictEqual(recovered, {
    kind: 'article',
    state: 'complete',
    source: 'browser',
    html: browserArticle,
    title: '浏览器正文标题',
    assets: [{ src: 'https://mmbiz.qpic.cn/body.jpg' }],
  });

  browserCalls = 0;
  const partial = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/partial',
    fetchStatic: async () => guideHtml,
    renderBrowser: async () => {
      browserCalls += 1;
      return { html: genericGuideHtml };
    },
  });
  assert.strictEqual(browserCalls, 1);
  assert.strictEqual(partial.kind, 'fallback');
  assert.strictEqual(partial.state, 'guide');
  assert.strictEqual(partial.source, 'fallback');
  assert.match(partial.markdown, /微信公众号未返回正文/);
  assert.match(partial.markdown, /值得保存的文章标题/);

  browserCalls = 0;
  const captcha = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/captcha',
    fetchStatic: async () => '<p>环境异常，完成验证后即可继续访问</p>',
    renderBrowser: async () => { browserCalls += 1; return { html: articleHtml }; },
  });
  assert.strictEqual(browserCalls, 0);
  assert.strictEqual(captcha.kind, 'fallback');
  assert.strictEqual(captcha.state, 'captcha');
}

runPipelineTests()
  .then(() => console.log('plugin-wechat-article-pipeline.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
