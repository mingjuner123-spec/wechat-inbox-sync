'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  buildWechatArticleRequestProfiles,
  classifyWechatArticleHtml,
  diagnoseWechatArticleHtml,
 extractWechatArticleFallbackMetadata,
  getWechatArticleBodyStats,
  isWechatEmptyShellHtml,
  buildWechatArticleFallbackMarkdown,
  isWechatArticleUrl,
  isWechatImagePostHtml,
  isWechatImagePostUrl,
  normalizeWechatArticleUrl,
} = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const {
  getFailureCacheInfo,
  inferWechatArticleFailureCategory,
  redactDiagnosticText,
  runWechatArticlePipeline,
} = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const {
  collectWechatImagePostStructuredAssets,
  dedupeWechatImagePostAssets,
  getWechatImageAssetIdentity,
  normalizeWechatImagePostMarkdown,
} = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-image-post-utils');

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
const emptyShellHtml = '<html><body><div class="rich_media"><div class="toolbar">\u89c6\u9891 \u5c0f\u7a0b\u5e8f \u5728\u770b</div></div></body></html>';
const imagePostHtml = [
  '<html><head><title>公众号贴图短链</title></head><body>',
  '<script>window.cgiData={article_type:"newspic",image_list:[{"url":"https://mmbiz.qpic.cn/mmbiz_jpg/one/0"}]};</script>',
  '<div id="js_content">这是贴图短文案，不能因为存在文字就当成普通文章完成。</div>',
  '<div class="image-detail-swiper"><img src="https://mmbiz.qpic.cn/mmbiz_jpg/one/0"></div>',
  '</body></html>',
].join('');

const structuredImagePostAssets = collectWechatImagePostStructuredAssets({
  picture_page_info_list: [
    {
      cdn_url: 'http://mmbiz.qpic.cn/mmbiz_png/page-one/0?wx_fmt=png',
      width: '1080',
      height: '1440',
      watermark_info: { cdn_url: 'https://mmbiz.qpic.cn/sz_mmbiz_png/watermark/0' },
      share_cover: { cdn_url: 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/share-cover/0' },
    },
    { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/page-two/0?wx_fmt=png' },
    { cdn_url: '//mmbiz.qpic.cn/sz_mmbiz_jpg/page-three/0?wx_fmt=jpeg' },
    { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/page-one/0?from=appmsg&wxfrom=12&tp=webp' },
  ],
  cgiDataNew: {
    picture_page_info_list: [
      { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/page-one/0?wx_fmt=png' },
      { cdn_url: 'https://example.com/not-wechat-content.jpg' },
    ],
  },
});
assert.deepStrictEqual(
  structuredImagePostAssets.map((asset) => asset.src.replace(/^http:/, 'https:')),
  [
    'https://mmbiz.qpic.cn/mmbiz_png/page-one/0?wx_fmt=png',
    'https://mmbiz.qpic.cn/mmbiz_png/page-two/0?wx_fmt=png',
    'https://mmbiz.qpic.cn/sz_mmbiz_jpg/page-three/0?wx_fmt=jpeg',
  ],
);
assert.strictEqual(structuredImagePostAssets[0].width, 1080);
assert.strictEqual(structuredImagePostAssets[0].height, 1440);
assert.strictEqual(
  getWechatImageAssetIdentity('http://mmbiz.qpic.cn/mmbiz_png/page-one/0?wx_fmt=png'),
  'https://mmbiz.qpic.cn/mmbiz_png/page-one/0',
);
assert.deepStrictEqual(
  dedupeWechatImagePostAssets([
    { src: 'https://mmbiz.qpic.cn/mmbiz_png/cover/0?wx_fmt=png', alt: '贴图 1', localIndex: 1 },
    { src: 'https://mmbiz.qpic.cn/mmbiz_png/page-two/0?wx_fmt=png', alt: '贴图 2', localIndex: 2 },
    { src: 'https://mmbiz.qpic.cn/mmbiz_png/cover/0?from=appmsg&tp=webp', alt: '贴图 3', localIndex: 3 },
  ]).map((asset) => ({ alt: asset.alt, localIndex: asset.localIndex })),
  [
    { alt: '贴图 1', localIndex: 1 },
    { alt: '贴图 2', localIndex: 2 },
  ],
);
assert.strictEqual(
  normalizeWechatImagePostMarkdown([
    '这是一个很长的贴图正文，末尾的这个汉字与下一行开头属于同一个段落，虽然现',
    '在全民 AI 时代，正文不应该留下页面软换行。',
    '',
    '![贴图 1](https://mmbiz.qpic.cn/mmbiz_png/cover/0?wx_fmt=png&from=appmsg)',
    '',
    '![贴图 2](https://mmbiz.qpic.cn/mmbiz_png/page-two/0?wx_fmt=png)',
    '',
    '![贴图 3](https://mmbiz.qpic.cn/mmbiz_png/cover/0?from=appmsg&wxfrom=12&tp=webp)',
  ].join('\n')),
  [
    '这是一个很长的贴图正文，末尾的这个汉字与下一行开头属于同一个段落，虽然现在全民 AI 时代，正文不应该留下页面软换行。',
    '',
    '![贴图 1](https://mmbiz.qpic.cn/mmbiz_png/cover/0?wx_fmt=png&from=appmsg)',
    '',
    '![贴图 2](https://mmbiz.qpic.cn/mmbiz_png/page-two/0?wx_fmt=png)',
  ].join('\n'),
);

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
assert.strictEqual(isWechatEmptyShellHtml(emptyShellHtml), true);
assert.strictEqual(diagnoseWechatArticleHtml(emptyShellHtml).pageKind, 'empty-shell');
assert.strictEqual(isWechatImagePostHtml(imagePostHtml), true);
assert.strictEqual(classifyWechatArticleHtml(imagePostHtml), 'image-post');
assert.strictEqual(diagnoseWechatArticleHtml(imagePostHtml).markers.imagePost, true);
const imageStats = getWechatArticleBodyStats('<div id="js_content"><p>Body</p><img data-src="//mmbiz.qpic.cn/image.jpg"></div>');
assert.strictEqual(imageStats.hasJsContent, true);
assert.strictEqual(imageStats.bodyTextChars, 4);
assert.strictEqual(imageStats.imageCount, 1);
assert.deepStrictEqual(imageStats.imageCandidates, ['https://mmbiz.qpic.cn/image.jpg']);

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
  normalizeWechatArticleUrl('https://mp.weixin.qq.com/s?scene=169&mid=2&sn=signature&chksm=abc123&pass_ticket=secret&__biz=biz&idx=1#rd'),
  'https://mp.weixin.qq.com/s?__biz=biz&mid=2&idx=1&sn=signature&chksm=abc123&scene=169',
);
assert.strictEqual(normalizeWechatArticleUrl('https://mp.weixin.qq.com.evil.example/s?__biz=test'), '');

const imagePostUrl = 'https://mp.weixin.qq.com/s?t=pages/image_detail&scene=1&__biz=image-post-biz&mid=2247487525&idx=1&sn=image-post-signature&from_masonry=1&sharer_shareinfo=private-share#wechat_redirect';
const normalizedImagePostUrl = normalizeWechatArticleUrl(imagePostUrl);
const normalizedImagePost = new URL(normalizedImagePostUrl);
assert.strictEqual(isWechatImagePostUrl(imagePostUrl), true);
assert.strictEqual(isWechatImagePostUrl('https://mp.weixin.qq.com/s?__biz=image-post-biz&mid=1'), false);
assert.strictEqual(normalizedImagePost.searchParams.get('t'), 'pages/image_detail');
assert.strictEqual(normalizedImagePost.searchParams.get('__biz'), 'image-post-biz');
assert.strictEqual(normalizedImagePost.searchParams.get('mid'), '2247487525');
assert.strictEqual(normalizedImagePost.searchParams.has('from_masonry'), false);
assert.strictEqual(normalizedImagePost.searchParams.has('sharer_shareinfo'), false);
assert.strictEqual(new URL(normalizedImagePostUrl).hash, '');
const imagePostProfiles = buildWechatArticleRequestProfiles(imagePostUrl);
assert.strictEqual(imagePostProfiles[0].urlShape.contentKind, 'image-post');
assert.strictEqual(imagePostProfiles[1].urlShape.contentKind, 'image-post');
assert.strictEqual(new URL(imagePostProfiles[1].url).searchParams.get('t'), 'pages/image_detail');

const requestProfiles = buildWechatArticleRequestProfiles(
  'https://mp.weixin.qq.com/s/recovered?scene=1&pass_ticket=secret#rd',
);
assert.strictEqual(requestProfiles.length, 2);
assert.strictEqual(requestProfiles[0].id, 'original-desktop');
assert.strictEqual(requestProfiles[0].url, 'https://mp.weixin.qq.com/s/recovered?scene=1&pass_ticket=secret#rd');
assert.strictEqual(requestProfiles[1].id, 'canonical-mobile');
assert.strictEqual(requestProfiles[1].url, 'https://mp.weixin.qq.com/s/recovered');
assert.deepStrictEqual(requestProfiles[0].urlShape.parameterNames, ['pass_ticket', 'scene']);
assert.deepStrictEqual(requestProfiles[0].urlShape.strippedParameterNames, ['pass_ticket']);

const fallbackMarkdown = buildWechatArticleFallbackMarkdown({
  url: 'https://mp.weixin.qq.com/s/example',
  state: 'guide',
  title: 'Useful title',
  description: 'Useful description',
  coverUrl: 'https://mmbiz.qpic.cn/cover.jpg',
});
assert.match(fallbackMarkdown, /https:\/\/mp\.weixin\.qq\.com\/s\/example/);
assert.match(fallbackMarkdown, /!\[.*\]\(https:\/\/mmbiz\.qpic\.cn\/cover\.jpg\)/);

const pluginMainSource = fs.readFileSync(
  require.resolve('../obsidian-plugin/wechat-inbox-sync/src/main.js'),
  'utf8',
);
assert.match(pluginMainSource, /redactDiagnosticText\(details\.error/);
assert.match(pluginMainSource, /sanitizeDiagnosticValue\(details\.diagnostic\)/);
assert.match(pluginMainSource, /redactDiagnosticText\(source\.message/);

const generatedPluginMainSource = fs.readFileSync(
  require.resolve('../obsidian-plugin/wechat-inbox-sync/main.js'),
  'utf8',
);
const bundledCollectorMatch = /function (collectWechatImagePostStructuredAssets\w*)\(pageWindow\) \{[\s\S]*?\n\s*\}\n\s*__name\(\1,/.exec(generatedPluginMainSource);
assert.ok(bundledCollectorMatch, 'bundled WeChat image-post collector must be present');
const bundledCollectorSource = bundledCollectorMatch[0].slice(
  0,
  bundledCollectorMatch[0].lastIndexOf('\n    __name('),
).trim();
assert.doesNotMatch(bundledCollectorSource, /\b__name\b/);
const bundledCollector = Function(`return (${bundledCollectorSource});`)();
assert.strictEqual(bundledCollector({
  picture_page_info_list: [
    { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/bundled-page-one/0' },
    { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/bundled-page-two/0' },
  ],
}).length, 2);

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
  const staticTargets = [];
  const browserTargets = [];
  const recovered = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/recovered?scene=1&pass_ticket=secret',
    fetchStatic: async (targetUrl, profile) => {
      staticTargets.push({ targetUrl, profile: profile.id, userAgentProfile: profile.userAgentProfile });
      return guideHtml;
    },
    renderBrowser: async (targetUrl) => {
      browserTargets.push(targetUrl);
      browserCalls += 1;
      return { html: browserArticle, title: 'Browser article title', assets: [{ src: 'https://mmbiz.qpic.cn/body.jpg' }] };
    },
  });
  assert.strictEqual(browserCalls, 1);
  assert.deepStrictEqual(staticTargets, [
    {
      targetUrl: 'https://mp.weixin.qq.com/s/recovered?scene=1&pass_ticket=secret',
      profile: 'original-desktop',
      userAgentProfile: 'desktop',
    },
    {
      targetUrl: 'https://mp.weixin.qq.com/s/recovered',
      profile: 'canonical-mobile',
      userAgentProfile: 'mobile',
    },
  ]);
  assert.deepStrictEqual(browserTargets, ['https://mp.weixin.qq.com/s/recovered?scene=1&pass_ticket=secret']);
  assert.strictEqual(recovered.kind, 'article');
  assert.strictEqual(recovered.state, 'complete');
  assert.strictEqual(recovered.source, 'browser');
  assert.strictEqual(recovered.html, browserArticle);
  assert.strictEqual(recovered.title, 'Browser article title');
  assert.deepStrictEqual(recovered.assets, [{ src: 'https://mmbiz.qpic.cn/body.jpg' }]);
  assert.strictEqual(recovered.diagnostic.completeness.articleBodyFound, true);
  assert.strictEqual(recovered.diagnostic.browser.pageKind, 'article');
  assert.strictEqual(recovered.diagnostic.selectedProfile.profile, 'original-desktop');
  assert.doesNotMatch(JSON.stringify(recovered.diagnostic), /secret/);

  let imagePostBrowserCalls = 0;
  const recoveredImagePost = await runWechatArticlePipeline({
    url: imagePostUrl,
    // A picture-post page may put only its caption inside #js_content. This
    // must not short-circuit the browser carousel extractor.
    fetchStatic: async () => articleHtml,
    renderBrowser: async (targetUrl) => {
      imagePostBrowserCalls += 1;
      assert.strictEqual(isWechatImagePostUrl(targetUrl), true);
      return {
        title: '公众号贴图测试',
        markdown: '贴图短文案\n\n![贴图 1](https://mmbiz.qpic.cn/mmbiz_jpg/image-post/0)',
        assets: [{ src: 'https://mmbiz.qpic.cn/mmbiz_jpg/image-post/0', alt: '贴图 1', localIndex: 1 }],
        bodyFound: true,
        imageCount: 1,
        imageCandidateCount: 3,
        diagnostic: { contentKind: 'image-post' },
      };
    },
  });
  assert.strictEqual(imagePostBrowserCalls, 1);
  assert.strictEqual(recoveredImagePost.kind, 'article');
  assert.strictEqual(recoveredImagePost.source, 'browser');
  assert.strictEqual(recoveredImagePost.assets.length, 1);
  assert.strictEqual(recoveredImagePost.diagnostic.selectedProfile.contentKind, 'image-post');

  let slugImagePostBrowserCalls = 0;
  const recoveredSlugImagePost = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/oH-HPRVNP1s1__C85xHyqA',
    fetchStatic: async () => imagePostHtml,
    renderBrowser: async () => {
      slugImagePostBrowserCalls += 1;
      return {
        title: 'Obsidian常用的5个插件',
        markdown: '贴图短文案\n\n![贴图 1](https://mmbiz.qpic.cn/mmbiz_jpg/slug-image-post/0)',
        assets: [{ src: 'https://mmbiz.qpic.cn/mmbiz_jpg/slug-image-post/0', alt: '贴图 1', localIndex: 1 }],
        bodyFound: true,
        diagnostic: { contentKind: 'image-post' },
      };
    },
  });
  assert.strictEqual(slugImagePostBrowserCalls, 1);
  assert.strictEqual(recoveredSlugImagePost.kind, 'article');
  assert.strictEqual(recoveredSlugImagePost.source, 'browser');

  const profileSensitive = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/profile-sensitive?scene=1&pass_ticket=private-value',
    fetchStatic: async (_targetUrl, profile) => profile.id === 'original-desktop' ? guideHtml : articleHtml,
    renderBrowser: async () => { throw new Error('browser should not run'); },
  });
  assert.strictEqual(profileSensitive.kind, 'article');
  assert.strictEqual(profileSensitive.source, 'static');
  assert.strictEqual(profileSensitive.diagnostic.selectedProfile.profile, 'canonical-mobile');
  assert.doesNotMatch(JSON.stringify(profileSensitive.diagnostic), /private-value/);

  browserCalls = 0;
  const bodyMissingBrowser = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/partial',
    fetchStatic: async () => guideHtml,
    renderBrowser: async () => {
      browserCalls += 1;
      return { html: genericGuideHtml };
    },
  });
  assert.strictEqual(browserCalls, 2);
  assert.strictEqual(bodyMissingBrowser.kind, 'retryable');
  assert.strictEqual(bodyMissingBrowser.state, 'body_missing');
 assert.strictEqual(bodyMissingBrowser.source, 'browser');
 assert.strictEqual(bodyMissingBrowser.diagnostic.reason, 'wechat-article-body-missing');
  assert.deepStrictEqual(bodyMissingBrowser.diagnostic.attemptedChannels, ['static', 'static', 'browser', 'browser']);
  assert.strictEqual(bodyMissingBrowser.diagnostic.retryable, true);
  assert.strictEqual(bodyMissingBrowser.diagnostic.failureCategory, 'identical-empty-shell-across-request-profiles');
  const cachedFailure = getFailureCacheInfo('https://mp.weixin.qq.com/s/partial');
  assert.strictEqual(cachedFailure.cacheHit, true);
  let retryBrowserCalls = 0;
  const retriedBodyMissing = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/partial',
    fetchStatic: async () => guideHtml,
    renderBrowser: async () => {
      retryBrowserCalls += 1;
      return { html: genericGuideHtml };
    },
  });
  assert.strictEqual(retryBrowserCalls, 2);
  assert.strictEqual(retriedBodyMissing.kind, 'retryable');
  assert.strictEqual(retriedBodyMissing.diagnostic.previousFailure.cacheHit, true);

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

  const sensitiveFailure = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/sensitive?scene=1&pass_ticket=private-ticket',
    fetchStatic: async (targetUrl) => {
      throw new Error(`request failed for ${targetUrl}&token=private-token`);
    },
    renderBrowser: async (targetUrl) => {
      const error = new Error(`loadURL failed: ${targetUrl}&secret=private-secret`);
      error.wechatArticleDiagnostic = { currentUrl: targetUrl, pass_ticket: 'private-ticket' };
      throw error;
    },
  });
  const sensitiveDiagnostic = JSON.stringify(sensitiveFailure.diagnostic);
  assert.doesNotMatch(sensitiveDiagnostic, /private-ticket|private-token|private-secret/);
  assert.match(sensitiveDiagnostic, /pass_ticket/);
  assert.match(sensitiveDiagnostic, /\[REDACTED\]/);
  assert.doesNotMatch(redactDiagnosticText('token=secret-value'), /secret-value/);

  browserCalls = 0;
  const captcha = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/captcha',
    fetchStatic: async () => captchaHtml,
    renderBrowser: async () => { browserCalls += 1; return { html: articleHtml }; },
  });
  assert.strictEqual(browserCalls, 1);
  assert.strictEqual(captcha.kind, 'article');

  const terminalCaptcha = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/terminal-captcha',
    fetchStatic: async () => captchaHtml,
    renderBrowser: async () => ({ html: captchaHtml }),
  });
  assert.strictEqual(terminalCaptcha.kind, 'fallback');
  assert.strictEqual(terminalCaptcha.state, 'captcha');
  assert.strictEqual(terminalCaptcha.diagnostic.failureCategory, 'wechat-verification-required');

  const unavailable = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/unavailable',
    fetchStatic: async () => unavailableHtml,
    renderBrowser: async () => ({ html: articleHtml }),
  });
  assert.strictEqual(unavailable.kind, 'article');

  const terminalUnavailable = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/terminal-unavailable',
    fetchStatic: async () => unavailableHtml,
    renderBrowser: async () => ({ html: unavailableHtml }),
  });
  assert.strictEqual(terminalUnavailable.kind, 'fallback');
  assert.strictEqual(terminalUnavailable.state, 'unavailable');
  assert.strictEqual(terminalUnavailable.diagnostic.failureCategory, 'article-unavailable');

  const selectorMismatch = await runWechatArticlePipeline({
    url: 'https://mp.weixin.qq.com/s/selector-mismatch',
    fetchStatic: async () => emptyShellHtml,
    renderBrowser: async () => {
      const error = new Error('missing selector');
      error.wechatArticleDiagnostic = { hasJsContent: false, visibleTextChars: 600 };
      throw error;
    },
  });
  assert.strictEqual(selectorMismatch.kind, 'retryable');
  assert.strictEqual(selectorMismatch.diagnostic.failureCategory, 'extractor-selector-mismatch');

  assert.strictEqual(inferWechatArticleFailureCategory([
    { channel: 'static', profile: 'original-desktop', outcome: 'empty-shell' },
    { channel: 'static', profile: 'canonical-mobile', outcome: 'guide' },
  ]), 'request-profile-sensitive-response');
}

runPipelineTests()
  .then(() => console.log('plugin-wechat-article-pipeline.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
