'use strict';

const assert = require('assert');
const {
  classifyWechatArticleHtml,
  extractWechatArticleFallbackMetadata,
  buildWechatArticleFallbackMarkdown,
  isWechatArticleUrl,
  normalizeWechatArticleUrl,
} = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const { runWechatArticlePipeline } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');

const articleHtml = [
  '<html><head><title>Real article title</title></head><body>',
  '<div id="js_content"><p>This is a long enough WeChat article body. It proves the article page is usable.</p></div>',
  '</body></html>',
].join('');

const guideHtml = [
  '<html><head>',
  '<meta property="og:title" content="Useful title">',
  '<meta property="og:description" content="Useful description">',
  '<meta property="og:image" content="https://mmbiz.qpic.cn/cover.jpg">',
  '</head><body>Open in WeChat to continue reading this content.</body></html>',
].join('');

const genericGuideHtml = [
  '<html><head><title>WeChat Official Accounts Platform</title>',
  '<meta property="og:image" content="javascript:bad"></head>',
  '<body>Open in WeChat to continue reading this content.</body></html>',
].join('');

const unavailableHtml = '<p>\u5185\u5bb9\u4e0d\u5b58\u5728\uff0c\u8be5\u6587\u7ae0\u5df2\u88ab\u5220\u9664\u3002</p>';
const captchaHtml = '<p>\u73af\u5883\u5f02\u5e38\uff0c\u5b8c\u6210\u9a8c\u8bc1\u540e\u5373\u53ef\u7ee7\u7eed\u8bbf\u95ee\u3002</p>';

assert.strictEqual(classifyWechatArticleHtml(articleHtml), 'article');
assert.strictEqual(
  classifyWechatArticleHtml('<div id="js_content"><p>Short.</p><p>This later paragraph contains enough article content to prove the whole article body is present.</p></div>'),
  'article',
);
assert.strictEqual(
  classifyWechatArticleHtml('<div id="js_content"><p>This is valid body content long enough to win over hidden guide copy.</p></div><div style="display:none">Open in WeChat</div>'),
  'article',
);
assert.strictEqual(
  classifyWechatArticleHtml('<div id="js_content"><p>Short.</p></div>'),
  'article',
);
assert.strictEqual(
  classifyWechatArticleHtml('<div id="js_content"><img data-src="https://mmbiz.qpic.cn/example.jpg"></div>'),
  'article',
);

assert.deepStrictEqual(extractWechatArticleFallbackMetadata(guideHtml), {
  title: 'Useful title',
  description: 'Useful description',
  coverUrl: 'https://mmbiz.qpic.cn/cover.jpg',
});
assert.deepStrictEqual(extractWechatArticleFallbackMetadata(genericGuideHtml), {
  title: '',
  description: '',
  coverUrl: '',
});

assert.strictEqual(isWechatArticleUrl('https://mp.weixin.qq.com/s/example'), true);
assert.strictEqual(isWechatArticleUrl('https://mp.weixin.qq.com.evil.example/s?__biz=test'), false);
assert.strictEqual(isWechatArticleUrl('https://mp.weixin.qq.com/s/example/extra'), false);
assert.strictEqual(isWechatArticleUrl('https://mp.weixin.qq.com/s//example'), false);
assert.strictEqual(isWechatArticleUrl('https://mp.weixin.qq.com/s/'), false);
assert.strictEqual(normalizeWechatArticleUrl('https://mp.weixin.qq.com/s/example?scene=1#rd'), 'https://mp.weixin.qq.com/s/example');
assert.strictEqual(
  normalizeWechatArticleUrl('https://mp.weixin.qq.com/s?scene=169&mid=2&sn=signature&pass_ticket=secret&__biz=biz&idx=1#rd'),
  'https://mp.weixin.qq.com/s?__biz=biz&mid=2&idx=1&sn=signature',
);
assert.strictEqual(normalizeWechatArticleUrl('https://mp.weixin.qq.com.evil.example/s?__biz=test'), '');

const fallbackMarkdown = buildWechatArticleFallbackMarkdown({
  url: 'https://mp.weixin.qq.com/s/example',
  state: 'guide',
  title: 'Useful title',
  description: 'Useful description',
  coverUrl: 'https://mmbiz.qpic.cn/cover.jpg',
});
assert.match(fallbackMarkdown, /https:\/\/mp\.weixin\.qq\.com\/s\/example/);
assert.match(fallbackMarkdown, /!\[.*\]\(https:\/\/mmbiz\.qpic\.cn\/cover\.jpg\)/);

async function runPipelineTests() {
  let invalidFetchCalls = 0;
  const invalidUrl = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/example/extra?pass_ticket=secret',
    fetchStatic: async () => { invalidFetchCalls += 1; return articleHtml; },
  });
  assert.strictEqual(invalidFetchCalls, 0);
  assert.strictEqual(invalidUrl.kind, 'fallback');
  assert.doesNotMatch(invalidUrl.markdown, /pass_ticket/);

  const browserArticle = [
    '<html><head><title>Browser article title</title></head><body>',
    '<div id="js_content"><p>This browser-rendered body is long enough and should be saved as the complete article.</p></div>',
    '</body></html>',
  ].join('');
  let browserCalls = 0;
  let staticTargetUrl = '';
  let browserTargetUrl = '';
  const recovered = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/recovered?scene=1&pass_ticket=secret',
    fetchStatic: async (targetUrl) => { staticTargetUrl = targetUrl; return guideHtml; },
    renderBrowser: async (targetUrl) => {
      browserTargetUrl = targetUrl;
      browserCalls += 1;
      return { html: browserArticle, title: 'Browser article title', assets: [{ src: 'https://mmbiz.qpic.cn/body.jpg' }] };
    },
  });
  assert.strictEqual(browserCalls, 1);
  assert.strictEqual(staticTargetUrl, 'https://mp.weixin.qq.com/s/recovered');
  assert.strictEqual(browserTargetUrl, 'https://mp.weixin.qq.com/s/recovered');
  assert.deepStrictEqual(recovered, {
    kind: 'article',
    state: 'complete',
    source: 'browser',
    html: browserArticle,
    title: 'Browser article title',
    assets: [{ src: 'https://mmbiz.qpic.cn/body.jpg' }],
  });

  browserCalls = 0;
  const bodyMissingBrowser = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/partial',
    fetchStatic: async () => guideHtml,
    renderBrowser: async () => {
      browserCalls += 1;
      return { html: genericGuideHtml };
    },
  });
  assert.strictEqual(browserCalls, 1);
  assert.strictEqual(bodyMissingBrowser.kind, 'retryable');
  assert.strictEqual(bodyMissingBrowser.state, 'body_missing');
  assert.strictEqual(bodyMissingBrowser.source, 'browser');
  assert.strictEqual(bodyMissingBrowser.diagnostic.reason, 'wechat-article-body-missing');

  const bodyMissingStatic = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s?scene=1&mid=2&pass_ticket=secret&__biz=biz&idx=1&sn=signature',
    fetchStatic: async () => guideHtml,
  });
  assert.strictEqual(bodyMissingStatic.kind, 'retryable');
  assert.strictEqual(bodyMissingStatic.state, 'body_missing');
  assert.strictEqual(bodyMissingStatic.source, 'static');
  assert.strictEqual(bodyMissingStatic.diagnostic.reason, 'wechat-article-body-missing');

  const browserTransportFailure = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/browser-error',
    fetchStatic: async () => guideHtml,
    renderBrowser: async () => { throw new Error('browser unavailable'); },
  });
  assert.strictEqual(browserTransportFailure.kind, 'retryable');
  assert.strictEqual(browserTransportFailure.state, 'body_missing');
  assert.strictEqual(browserTransportFailure.source, 'browser');
  assert.match(browserTransportFailure.diagnostic.browserError, /browser unavailable/);

  browserCalls = 0;
  const captcha = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/captcha',
    fetchStatic: async () => captchaHtml,
    renderBrowser: async () => { browserCalls += 1; return { html: articleHtml }; },
  });
  assert.strictEqual(browserCalls, 0);
  assert.strictEqual(captcha.kind, 'fallback');
  assert.strictEqual(captcha.state, 'captcha');

  const unavailable = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/unavailable',
    fetchStatic: async () => unavailableHtml,
    renderBrowser: async () => ({ html: articleHtml }),
  });
  assert.strictEqual(unavailable.kind, 'fallback');
  assert.strictEqual(unavailable.state, 'unavailable');
}

runPipelineTests()
  .then(() => console.log('plugin-wechat-article-pipeline.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
