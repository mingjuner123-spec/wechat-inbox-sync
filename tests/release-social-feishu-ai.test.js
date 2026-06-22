const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');
const manifestPath = path.resolve(__dirname, '..', 'manifest.json');
const versionsPath = path.resolve(__dirname, '..', 'versions.json');

function loadPlugin() {
  delete require.cache[pluginPath];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'obsidian') {
      class Plugin {
        addCommand() {}
        addRibbonIcon() {}
        addSettingTab() {}
        addStatusBarItem() { return { setText() {} }; }
        async loadData() { return null; }
        async saveData() {}
      }
      class PluginSettingTab {}
      class Notice {}
      return {
        Notice,
        Plugin,
        PluginSettingTab,
        Setting: class Setting {},
        requestUrl: async () => ({ status: 200, json: { success: true }, text: '{"success":true}' }),
        Platform: { isMobile: false, isDesktop: true, isWin: true },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(pluginPath);
  } finally {
    Module._load = originalLoad;
  }
}

const Plugin = loadPlugin();
const helpers = Plugin.__test;

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
assert.strictEqual(manifest.version, '1.2.35');
assert.strictEqual(versions['1.2.35'], manifest.minAppVersion);

assert.strictEqual(typeof helpers.extractFeishuMarkdownFromHtml, 'function');
const feishuMarkdown = helpers.extractFeishuMarkdownFromHtml(`
  <html>
    <body>
      <h1>一级标题</h1>
      <h2>二级标题</h2>
      <p>正文第一段</p>
      <h3>三级标题</h3>
      <img src="https://example.com/a.png" alt="流程图">
      <script>
        window.__DATA__ = {
          "block_type":"heading2",
          "text":"脚本二级标题",
          "url":"https://example.com/b.jpg"
        };
      </script>
    </body>
  </html>
`);
assert.ok(feishuMarkdown.includes('## 目录'));
assert.ok(feishuMarkdown.includes('- [一级标题](#一级标题)'));
assert.ok(feishuMarkdown.includes('  - [二级标题](#二级标题)'));
assert.ok(feishuMarkdown.includes('    - [三级标题](#三级标题)'));
assert.ok(feishuMarkdown.includes('# 一级标题'));
assert.ok(feishuMarkdown.includes('## 二级标题'));
assert.ok(feishuMarkdown.includes('### 三级标题'));
assert.ok(feishuMarkdown.includes('![流程图](https://example.com/a.png)'));
assert.ok(feishuMarkdown.includes('![图片](https://example.com/b.jpg)'));
const feishuRichImagesMarkdown = helpers.extractFeishuMarkdownFromHtml(`
  <html><body>
    <h1>飞书图片测试</h1>
    <picture><source srcset="https://example.com/source.webp 2x"><img data-src="https://example.com/picture.png"></picture>
    <div style="background-image:url('https://example.com/bg.jpg')">背景图</div>
    <script>window.__DATA__={"imageUrl":"https:\\/\\/example.com\\/script.png","preview_url":"https://example.com/preview.jpeg"}</script>
  </body></html>
`);
assert.ok(feishuRichImagesMarkdown.includes('https://example.com/source.webp'));
assert.ok(feishuRichImagesMarkdown.includes('https://example.com/bg.jpg'));
assert.ok(feishuRichImagesMarkdown.includes('https://example.com/script.png'));
assert.ok(feishuRichImagesMarkdown.includes('https://example.com/preview.jpeg'));

const wechatScriptCommentHtml = `
  <html>
    <body>
      <div id="js_content"><p>正文内容</p></div>
      <script>
        window.cgiData = {
          elected_comment: [{
            nick_name: "读者B",
            content: "评论来自脚本数据",
            create_time: "2026-06-22",
            like_num: 12
          }]
        };
      </script>
    </body>
  </html>
`;
assert.deepStrictEqual(helpers.extractWechatCommentsFromHtml(wechatScriptCommentHtml), [
  { author: '读者B', content: '评论来自脚本数据', time: '2026-06-22', likes: '12' },
]);
assert.ok(helpers.htmlToMarkdown(wechatScriptCommentHtml).includes('**读者B**：评论来自脚本数据'));

assert.strictEqual(typeof helpers.extractWechatCommentRequestParams, 'function');
assert.strictEqual(typeof helpers.extractWechatCommentsFromPayload, 'function');
assert.strictEqual(typeof helpers.buildWechatArticleMarkdownWithComments, 'function');
const wechatArticleForCommentApi = `
  <html>
    <body>
      <div id="js_content"><p>公众号正文</p></div>
      <script>
        var appmsg_token = "token-from-page";
        var comment_id = "123456789";
        var biz = "MzA-test";
        var mid = "2247489999";
        var idx = "1";
        var sn = "abcdef";
      </script>
    </body>
  </html>
`;
assert.deepStrictEqual(helpers.extractWechatCommentRequestParams(wechatArticleForCommentApi, 'https://mp.weixin.qq.com/s?__biz=MzA-test&mid=2247489999&idx=1&sn=abcdef'), {
  appmsg_token: 'token-from-page',
  comment_id: '123456789',
  __biz: 'MzA-test',
  mid: '2247489999',
  idx: '1',
  sn: 'abcdef',
});
assert.deepStrictEqual(helpers.extractWechatCommentsFromPayload({
  elected_comment: [{
    nick_name: '接口读者',
    content: '这条评论来自微信接口',
    create_time: '2026-06-22',
    like_num: 18,
  }],
}), [
  { author: '接口读者', content: '这条评论来自微信接口', time: '2026-06-22', likes: '18' },
]);
const wechatMarkdownWithApiComments = helpers.buildWechatArticleMarkdownWithComments(
  '公众号正文',
  wechatArticleForCommentApi,
  [{ author: '接口读者', content: '这条评论来自微信接口' }],
);
assert.ok(wechatMarkdownWithApiComments.includes('## 评论区'));
assert.ok(wechatMarkdownWithApiComments.includes('**接口读者**：这条评论来自微信接口'));
const wechatMarkdownWithoutComments = helpers.buildWechatArticleMarkdownWithComments('公众号正文', wechatArticleForCommentApi, []);
assert.ok(wechatMarkdownWithoutComments.includes('## 评论区'));
assert.ok(wechatMarkdownWithoutComments.includes('未抓取到公开评论'));

const xhsNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Note Title">',
  '<meta name="description" content="正文第一段。 #tagOne">',
  '<meta property="og:image" content="https://img.example.com/cover.jpg">',
  '</head><body>',
  '<div class="comment-item"><span class="user-name">用户甲</span><span class="comment-content">这个角度太有用了</span><span class="like-count">9</span></div>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/123');
assert.ok(xhsNote.markdown.includes('## 评论区'));
assert.ok(xhsNote.markdown.includes('**用户甲**：这个角度太有用了'));
assert.deepStrictEqual(xhsNote.comments, [
  { author: '用户甲', content: '这个角度太有用了', time: '', likes: '9' },
]);

const xhsNestedCommentNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Nested Comment">',
  '<meta name="description" content="我每次起标题都会花巨量时间，于是我就把起标题的核心知识做成了一个skill。（其实做成skill的方式也很值得分享，我放到下一期）这样确实会节省不少时间，我看小红书也在推redskill，索性直接发出来了。">',
  '</head><body>',
  '<script>',
  'window.__INITIAL_STATE__ = {"note":{"noteDetailMap":{"abc":{"note":{"desc":"正文"}}}},"comments":{"list":[{"id":"c1","content":"评论在小红书脚本状态里","create_time":"2026-06-22","liked_count":31,"user_info":{"nickname":"脚本用户"}}]}};',
  '</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/456');
assert.ok(xhsNestedCommentNote.markdown.includes('## 评论区'));
assert.ok(xhsNestedCommentNote.markdown.includes('**脚本用户**：评论在小红书脚本状态里'));
assert.deepStrictEqual(xhsNestedCommentNote.comments, [
  { author: '脚本用户', content: '评论在小红书脚本状态里', time: '2026-06-22', likes: '31' },
]);

assert.strictEqual(typeof helpers.normalizeGeneratedKeywords, 'function');
assert.deepStrictEqual(
  helpers.normalizeGeneratedKeywords('#飞书机器人, Obsidian，效率提升  AI'),
  ['飞书机器人', 'Obsidian', '效率提升', 'AI'],
);
assert.deepStrictEqual(
  helpers.parseGeneratedMetadataResponse('```json\n{"description":"一句话总结","keywords":["飞书机器人","Obsidian","效率"]}\n```'),
  {
    description: '一句话总结',
    keywords: ['飞书机器人', 'Obsidian', '效率'],
  },
);

const settings = helpers.mergeSettings({
  aiMetadataEnabled: true,
  deepseekApiKey: 'sk-test',
  deepseekModel: 'deepseek-chat',
  notePropertyFields: 'title,description,keywords',
});
assert.strictEqual(settings.aiMetadataEnabled, true);
assert.strictEqual(settings.deepseekApiKey, 'sk-test');
assert.strictEqual(settings.deepseekModel, 'deepseek-chat');
assert.strictEqual(settings.notePropertyFields, 'title,description,keywords');

assert.strictEqual(typeof helpers.shouldRefreshAiDescription, 'function');
assert.strictEqual(typeof helpers.buildFallbackGeneratedKeywords, 'function');
assert.strictEqual(typeof helpers.mergeSocialCommentsIntoMarkdown, 'function');
assert.strictEqual(typeof helpers.buildXiaohongshuRecordFromExtraction, 'function');
const noisyXhsRecord = {
  type: 'webpage',
  content: 'https://www.xiaohongshu.com/explore/789',
  metadata: {
    platform: '小红书',
    title: '小红书标题方法',
    description: '我每次起标题都会花巨量时间，于是我就把起标题的核心知识做成了一个skill。（其实做成skill的方式也很值得分享，我放到下一期）这样确实会节省不少时间，我看小红书也在推redskill，索性直接发出来了。',
    markdown: '# 小红书标题方法\n\n这篇讲小红书爆款标题、内容选题和AI写作流程。\n\n#小红书 #标题方法 #AI写作',
  },
};
assert.strictEqual(helpers.shouldRefreshAiDescription(noisyXhsRecord.metadata, noisyXhsRecord), true);
assert.deepStrictEqual(
  helpers.buildFallbackGeneratedKeywords(noisyXhsRecord).slice(0, 4),
  ['小红书', '标题方法', 'AI写作', '小红书标题方法'],
);
const mergedXhsMarkdown = helpers.mergeSocialCommentsIntoMarkdown('## 正文\n\n内容', [
  { author: '渲染用户', content: '渲染后才出现的评论', likes: '5' },
]);
assert.ok(mergedXhsMarkdown.includes('## 评论区'));
assert.ok(mergedXhsMarkdown.includes('**渲染用户**：渲染后才出现的评论'));
const extractedWithoutComments = {
  title: '小红书标题方法',
  author: '',
  description: '正文',
  tags: [],
  markdown: '## 正文\n\n正文',
  imageUrls: [],
  videoUrl: '',
  comments: [],
};
const hydratedXhsRecord = helpers.buildXiaohongshuRecordFromExtraction(noisyXhsRecord, {
  metadata: noisyXhsRecord.metadata,
  url: noisyXhsRecord.content,
  extracted: extractedWithoutComments,
  renderedComments: [{ author: '渲染用户', content: '渲染后才出现的评论' }],
});
assert.ok(hydratedXhsRecord.metadata.markdown.includes('**渲染用户**：渲染后才出现的评论'));
const xhsRecordWithoutMetadataKeywords = helpers.buildXiaohongshuRecordFromExtraction({
  type: 'webpage',
  content: 'https://www.xiaohongshu.com/explore/999',
  metadata: { platform: '小红书', title: 'AI内容选题' },
}, {
  metadata: { platform: '小红书', title: 'AI内容选题' },
  url: 'https://www.xiaohongshu.com/explore/999',
  extracted: {
    title: 'AI内容选题',
    description: '这篇讲小红书内容选题和AI写作。',
    tags: [],
    markdown: '## 正文\n\n这篇讲小红书内容选题和AI写作。',
    imageUrls: [],
    videoUrl: '',
    comments: [],
  },
});
assert.ok(Array.isArray(xhsRecordWithoutMetadataKeywords.metadata.keywords));
assert.ok(xhsRecordWithoutMetadataKeywords.metadata.keywords.length > 0);

async function runAsyncChecks() {
  const plugin = new Plugin();
  plugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    deepseekApiKey: 'sk-test',
    notePropertyFields: 'title,description,keywords',
  });
  plugin.generateMetadataWithDeepSeek = async () => ({
    description: '把小红书标题方法沉淀成可复用的AI写作流程。',
    keywords: [],
  });
  const enriched = await plugin.enrichRecordMetadataWithAi(noisyXhsRecord);
  assert.strictEqual(enriched.metadata.description, '把小红书标题方法沉淀成可复用的AI写作流程。');
  assert.deepStrictEqual(enriched.metadata.keywords.slice(0, 3), ['小红书', '标题方法', 'AI写作']);

  const source = fs.readFileSync(pluginPath, 'utf8');
  assert.ok(source.includes("text: 'AI 简介与关键词（DeepSeek）'"));
  assert.ok(source.includes(".setName('DeepSeek API Key')"));

  console.log('release social, feishu, and AI metadata checks passed');
}

runAsyncChecks().catch((error) => {
  console.error(error);
  process.exit(1);
});
