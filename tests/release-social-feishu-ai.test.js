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
        requestUrl: async (options) => {
          const url = typeof options === 'string' ? options : (options && options.url) || '';
          if (url.includes('xiaohongshu.com')) {
            return {
              status: 200,
              text: [
                '<html><head><meta property="og:title" content="小红书测试">',
                '<meta name="description" content="小红书正文"></head><body>',
                '<div class="comment-item"><span class="user-name">一级用户</span><span class="comment-content">一级评论</span></div>',
                '</body></html>',
              ].join(''),
            };
          }
          if (url.includes('mp.weixin.qq.com')) {
            return {
              status: 200,
              text: '<html><head><title>公众号测试</title></head><body><div id="js_content"><p>公众号正文</p></div></body></html>',
            };
          }
          return { status: 200, json: { success: true }, text: '{"success":true}' };
        },
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
assert.strictEqual(manifest.version, '1.2.49');
assert.strictEqual(versions['1.2.49'], manifest.minAppVersion);

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
      <div id="js_content"><p>这是一段足够长的公众号正文内容，用来确认正文可以正常转成 Markdown。</p></div>
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
assert.ok(helpers.htmlToMarkdown(wechatScriptCommentHtml).includes('足够长的公众号正文内容'));
assert.ok(!helpers.htmlToMarkdown(wechatScriptCommentHtml).includes('**读者B**：评论来自脚本数据'));
const wechatTableMarkdown = helpers.htmlToMarkdown(`
  <html>
    <body>
      <div id="js_content">
        <p>SAR后向散射特性与传感器频段相关。</p>
        <table>
          <tbody>
            <tr><th>频段</th><th>频率</th><th>波长</th><th>应用方向</th></tr>
            <tr><td>Ka</td><td>27-40°GHz</td><td>1.1-0.8°cm</td><td>SAR中应用较少</td></tr>
            <tr><td>X</td><td>8-12°GHz</td><td>3.8-2.4°cm</td><td>适用于城市监测、冰雪环境</td></tr>
          </tbody>
        </table>
      </div>
    </body>
  </html>
`);
assert.ok(wechatTableMarkdown.includes('| 频段 | 频率 | 波长 | 应用方向 |'));
assert.ok(wechatTableMarkdown.includes('| Ka | 27-40°GHz | 1.1-0.8°cm | SAR中应用较少 |'));
assert.ok(wechatTableMarkdown.includes('| X | 8-12°GHz | 3.8-2.4°cm | 适用于城市监测、冰雪环境 |'));
const flattenedWechatTableMarkdown = helpers.cleanMarkdownForStorage([
  'SAR后向散射特性与传感器的工作频率、波长密切相关。',
  '',
  '频段',
  '',
  '频率',
  '',
  '波长',
  '',
  '应用方向',
  '',
  'Ka',
  '',
  '27-40°GHz',
  '',
  '1.1-0.8°cm',
  '',
  'SAR中应用较少',
  '',
  'K',
  '',
  '18-27°GHz',
  '',
  '1.7-1.1°cm',
  '',
  'SAR中应用较少',
  '',
  '与此同时，雷达波长与空间分辨率呈负相关。',
].join('\n'));
assert.ok(flattenedWechatTableMarkdown.includes('| 频段 | 频率 | 波长 | 应用方向 |'));
assert.ok(flattenedWechatTableMarkdown.includes('| Ka | 27-40°GHz | 1.1-0.8°cm | SAR中应用较少 |'));
assert.ok(flattenedWechatTableMarkdown.includes('| K | 18-27°GHz | 1.7-1.1°cm | SAR中应用较少 |'));
assert.ok(flattenedWechatTableMarkdown.includes('\n与此同时，雷达波长与空间分辨率呈负相关。'));
assert.strictEqual(typeof helpers.htmlToMarkdownOrFallback, 'function');
assert.ok(helpers.htmlToMarkdownOrFallback(
  '<html><head><title>短公众号</title></head><body><div id="js_content"><p>短</p></div></body></html>',
  'https://mp.weixin.qq.com/s?__biz=short',
).includes('短公众号'));

assert.strictEqual(typeof helpers.extractWechatCommentRequestParams, 'function');
assert.strictEqual(typeof helpers.extractWechatCommentsFromPayload, 'function');
assert.strictEqual(typeof helpers.buildWechatArticleMarkdownWithComments, 'function');
assert.strictEqual(typeof helpers.buildWechatCommentApiUrl, 'function');
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
const wechatCommentApiWithoutToken = helpers.buildWechatCommentApiUrl('https://mp.weixin.qq.com/s?__biz=MzA-test&mid=2247489999&idx=1&sn=abcdef', {
  comment_id: '987654321',
  __biz: 'MzA-test',
  mid: '2247489999',
  idx: '1',
});
assert.ok(wechatCommentApiWithoutToken.includes('/mp/appmsg_comment?'));
assert.ok(wechatCommentApiWithoutToken.includes('comment_id=987654321'));
assert.ok(wechatCommentApiWithoutToken.includes('appmsg_token='));
assert.strictEqual(typeof helpers.getWechatInPageCommentFetchScript, 'function');
const wechatInPageCommentScript = helpers.getWechatInPageCommentFetchScript();
assert.ok(wechatInPageCommentScript.includes('/mp/appmsg_comment'));
assert.ok(wechatInPageCommentScript.includes("credentials: 'include'"));
assert.ok(wechatInPageCommentScript.includes('comment_id'));
assert.strictEqual(typeof helpers.shouldRetryWechatCommentsWithVisibleReader, 'function');
assert.strictEqual(helpers.shouldRetryWechatCommentsWithVisibleReader({ ret: -3, errmsg: 'no session' }, []), true);
assert.strictEqual(helpers.shouldRetryWechatCommentsWithVisibleReader(null, []), true);
assert.strictEqual(helpers.shouldRetryWechatCommentsWithVisibleReader(null, [{ author: '读者', content: '已抓到' }]), false);
assert.deepStrictEqual(helpers.extractWechatCommentsFromPayload({
  elected_comment: [{
    nick_name: '接口读者',
    content: '这条评论来自微信接口',
    create_time: '2026-06-22',
    like_num: 18,
    reply: {
      nick_name: '作者',
      content: '谢谢你的反馈',
      create_time: '2026-06-22',
    },
  }],
}), [
  {
    author: '接口读者',
    content: '这条评论来自微信接口',
    time: '2026-06-22',
    likes: '18',
    replies: [{ author: '作者', content: '谢谢你的反馈', time: '2026-06-22', likes: '', replyTo: '接口读者' }],
  },
]);
const wechatMarkdownWithApiComments = helpers.buildWechatArticleMarkdownWithComments(
  '公众号正文',
  wechatArticleForCommentApi,
  [{ author: '接口读者', content: '这条评论来自微信接口', replies: [{ author: '作者', content: '谢谢你的反馈', replyTo: '接口读者' }] }],
);
assert.ok(wechatMarkdownWithApiComments.includes('## 评论区'));
assert.ok(wechatMarkdownWithApiComments.includes('**接口读者**：这条评论来自微信接口'));
assert.ok(wechatMarkdownWithApiComments.includes('  - **作者** 回复 **接口读者**：谢谢你的反馈'));
const wechatMarkdownWithoutComments = helpers.buildWechatArticleMarkdownWithComments('公众号正文', wechatArticleForCommentApi, []);
assert.ok(!wechatMarkdownWithoutComments.includes('## 评论区'));
assert.ok(!wechatMarkdownWithoutComments.includes('未抓取到公开评论'));
const wechatMarkdownWithEmbeddedCommentsDisabled = helpers.buildWechatArticleMarkdownWithComments('公众号正文', wechatScriptCommentHtml, []);
assert.ok(!wechatMarkdownWithEmbeddedCommentsDisabled.includes('## 评论区'));
assert.ok(!wechatMarkdownWithEmbeddedCommentsDisabled.includes('评论来自脚本数据'));

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

assert.strictEqual(typeof helpers.extractXiaohongshuCommentsFromPayload, 'function');
assert.deepStrictEqual(helpers.extractXiaohongshuCommentsFromPayload({
  data: {
    comments: [{
      id: 'root-1',
      content: '接口返回的小红书评论',
      create_time: 1782115200,
      like_count: '27',
      user_info: { nickname: '接口用户' },
      sub_comments: [{
        id: 'reply-1',
        content: '楼中楼回复',
        create_time: 1782115300,
        like_count: 3,
        user_info: { nickname: '回复用户' },
        target_comment: { user_info: { nickname: '接口用户' } },
      }],
    }],
  },
}), [
  {
    author: '接口用户',
    content: '接口返回的小红书评论',
    time: '1782115200',
    likes: '27',
    replies: [{ author: '回复用户', content: '楼中楼回复', time: '1782115300', likes: '3', replyTo: '接口用户' }],
  },
]);
const xhsThreadMarkdown = helpers.buildSocialCommentsMarkdown(helpers.extractXiaohongshuCommentsFromPayload({
  data: {
    comments: [{
      id: 'root-1',
      content: '接口返回的小红书评论',
      user_info: { nickname: '接口用户' },
      sub_comments: [{
        id: 'reply-1',
        content: '楼中楼回复',
        user_info: { nickname: '回复用户' },
        target_comment: { user_info: { nickname: '接口用户' } },
      }],
    }],
  },
}));
assert.ok(xhsThreadMarkdown.includes('- **接口用户**：接口返回的小红书评论'));
assert.ok(xhsThreadMarkdown.includes('  - **回复用户** 回复 **接口用户**：楼中楼回复'));
assert.ok(xhsThreadMarkdown.includes('\n\n- **'));
const nestedThreadMarkdown = helpers.buildSocialCommentsMarkdown([{
  author: 'Root',
  content: 'root comment',
  replies: [{
    author: 'Reply A',
    replyTo: 'Root',
    content: 'first reply',
    replies: [{
      author: 'Reply B',
      replyTo: 'Reply A',
      content: 'second reply',
    }],
  }],
}]);
assert.ok(nestedThreadMarkdown.includes('- **Root**：root comment'));
assert.ok(nestedThreadMarkdown.includes('  - **Reply A** 回复 **Root**：first reply'));
assert.ok(nestedThreadMarkdown.includes('    - **Reply B** 回复 **Reply A**：second reply'));
const manyXhsComments = helpers.extractXiaohongshuCommentsFromPayload({
  data: {
    comments: Array.from({ length: 35 }, (_, index) => ({
      content: `第${index + 1}条评论`,
      user_info: { nickname: `用户${index + 1}` },
    })),
  },
});
assert.strictEqual(manyXhsComments.length, 35);
assert.strictEqual(typeof helpers.getXiaohongshuCommentExpansionScript, 'function');
const xhsExpandScript = helpers.getXiaohongshuCommentExpansionScript();
assert.ok(xhsExpandScript.includes('展开'));
assert.ok(xhsExpandScript.includes('更多回复'));
assert.ok(xhsExpandScript.includes('scrollTop'));
assert.ok(xhsExpandScript.includes('comment'));
assert.strictEqual(typeof helpers.getXiaohongshuDomCommentExtractScript, 'function');
const xhsDomScript = helpers.getXiaohongshuDomCommentExtractScript();
assert.ok(xhsDomScript.includes('note-text'));
assert.ok(xhsDomScript.includes('comment-content'));
assert.ok(xhsDomScript.includes('SOCIAL_COMMENT_LIMIT'));
assert.strictEqual(typeof helpers.getXiaohongshuInPageCommentFetchScript, 'function');
const xhsInPageCommentScript = helpers.getXiaohongshuInPageCommentFetchScript('https://www.xiaohongshu.com/explore/abc123?xsec_token=token-1');
assert.ok(xhsInPageCommentScript.includes('/api/sns/web/v2/comment/page'));
assert.ok(xhsInPageCommentScript.includes('/api/sns/web/v2/comment/sub/page'));
assert.ok(xhsInPageCommentScript.includes("credentials: 'include'"));
assert.ok(xhsInPageCommentScript.includes('comment.sub_comments = currentReplies'));
assert.ok(xhsInPageCommentScript.includes('payloads.push({ data: { comments: roots } })'));
assert.ok(xhsInPageCommentScript.includes('root_comment_id'));
assert.ok(xhsInPageCommentScript.includes('xsec_token'));

assert.strictEqual(typeof helpers.getSocialElectronPartition, 'function');
assert.strictEqual(helpers.getSocialElectronPartition('xiaohongshu'), 'persist:wechat-inbox-sync-xiaohongshu');
assert.strictEqual(helpers.getSocialElectronPartition('wechat'), 'persist:wechat-inbox-sync-wechat');
const xhsTranscriptMarkdown = helpers.buildAudioTranscriptMarkdown({
  url: 'https://www.xiaohongshu.com/explore/video123',
  transcription: '这是一段小红书视频转写',
  transcriptionStatus: 'success',
  transcriptionSource: 'local',
  comments: [{ author: '视频用户', content: '视频评论也要进入正文', likes: 6 }],
});
assert.ok(xhsTranscriptMarkdown.includes('## 评论区'));
assert.ok(xhsTranscriptMarkdown.includes('**视频用户**：视频评论也要进入正文'));

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

const aiMetadataCandidateRecord = {
  type: 'text',
  content: 'Obsidian content workflow with Xiaohongshu comments and AI metadata.',
  metadata: {
    title: 'AI metadata test',
    markdown: 'Obsidian content workflow with Xiaohongshu comments and AI metadata.',
  },
};

const settings = helpers.mergeSettings({
  aiMetadataEnabled: true,
  notePropertyFields: 'title,description,keywords',
});
assert.strictEqual(settings.aiMetadataEnabled, true);
assert.strictEqual(settings.deepseekApiKey, '');
assert.strictEqual(settings.notePropertyFields, 'title,description,keywords');
const defaultFeatureSettings = helpers.mergeSettings({});
assert.strictEqual(defaultFeatureSettings.aiMetadataEnabled, false);
assert.strictEqual(defaultFeatureSettings.xiaohongshuCommentsEnabled, false);
assert.strictEqual(helpers.shouldGenerateAiMetadata(defaultFeatureSettings, aiMetadataCandidateRecord), false);
const aiSettingsWithLegacyFields = helpers.mergeSettings({
  aiMetadataEnabled: true,
  notePropertyFields: 'title,author,url,synced_at,source',
});
assert.strictEqual(aiSettingsWithLegacyFields.notePropertyFields, 'title,author,url,synced_at,source,description,keywords');
assert.strictEqual(helpers.shouldGenerateAiMetadata(aiSettingsWithLegacyFields, aiMetadataCandidateRecord), true);
const aiSettingsWithOnlyGeneratedFields = helpers.mergeSettings({
  aiMetadataEnabled: true,
  notePropertyFields: 'description,keywords',
});
assert.strictEqual(aiSettingsWithOnlyGeneratedFields.notePropertyFields, 'title,author,url,synced_at,source,description,keywords');
const aiDisabledSettingsWithOnlyGeneratedFields = helpers.mergeSettings({
  aiMetadataEnabled: false,
  notePropertyFields: 'description,keywords',
});
assert.strictEqual(aiDisabledSettingsWithOnlyGeneratedFields.notePropertyFields, 'title,author,url,synced_at,source,description,keywords');

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
const xhsRecordWithFallbackKeywordsAndComments = helpers.buildXiaohongshuRecordFromExtraction({
  type: 'webpage',
  content: 'https://www.xiaohongshu.com/explore/keywords-comments',
  metadata: { platform: '小红书', title: 'AI内容选题' },
}, {
  metadata: { platform: '小红书', title: 'AI内容选题' },
  url: 'https://www.xiaohongshu.com/explore/keywords-comments',
  extracted: {
    title: 'AI内容选题',
    description: '这篇讲小红书内容选题和AI写作。',
    tags: [],
    markdown: '## 正文\n\n这篇讲小红书内容选题和AI写作。',
    imageUrls: [],
    videoUrl: '',
    comments: [],
  },
  renderedComments: [{ author: '评论用户', content: '关键词生成以后评论区也不能丢' }],
});
assert.ok(xhsRecordWithFallbackKeywordsAndComments.metadata.keywords.length > 0);
assert.ok(xhsRecordWithFallbackKeywordsAndComments.metadata.markdown.includes('## 评论区'));
assert.ok(xhsRecordWithFallbackKeywordsAndComments.metadata.markdown.includes('关键词生成以后评论区也不能丢'));

async function runAsyncChecks() {
  const plugin = new Plugin();
  plugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    notePropertyFields: 'title,description,keywords',
    token: 'token-123',
  });
  plugin.generateAiMetadataWithCloud = async () => ({
    description: '把小红书标题方法沉淀成可复用的AI写作流程。',
    keywords: [],
  });
  const enriched = await plugin.enrichRecordMetadataWithAi(noisyXhsRecord);
  assert.strictEqual(enriched.metadata.description, '把小红书标题方法沉淀成可复用的AI写作流程。');
  assert.deepStrictEqual(enriched.metadata.keywords.slice(0, 3), ['小红书', '标题方法', 'AI写作']);
  const enrichedMarkdown = helpers.buildMarkdownForRecord({
    record: enriched,
    title: '小红书标题方法',
    syncedAt: '2026-06-22T00:00:00.000Z',
    propertyFields: plugin.settings.notePropertyFields,
  });
  assert.ok(enrichedMarkdown.includes('description: 把小红书标题方法沉淀成可复用的AI写作流程。'));
  assert.ok(enrichedMarkdown.includes('keywords:'));
  assert.ok(enrichedMarkdown.includes('  - 小红书'));
  assert.ok(enrichedMarkdown.includes('  - 标题方法'));
  assert.ok(enrichedMarkdown.includes('  - AI写作'));
  const aiDisabledMarkdown = helpers.buildMarkdownForRecord({
    record: noisyXhsRecord,
    title: '小红书标题方法',
    syncedAt: '2026-06-22T00:00:00.000Z',
    propertyFields: 'title,author,url,synced_at,source,description,keywords',
    includeAiMetadataFields: false,
  });
  assert.ok(!aiDisabledMarkdown.includes('description:'));
  assert.ok(!aiDisabledMarkdown.includes('keywords:'));
  const existingMarkdownXhs = helpers.ensureRequiredMetadataFallbacks({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/existing',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/existing',
      title: '小红书关键词旧记录',
      markdown: '## 正文\n\n这篇讲小红书内容选题和AI写作。\n\n#小红书 #内容选题 #AI写作',
      keywords: [],
    },
  });
  const existingMarkdown = helpers.buildMarkdownForRecord({
    record: existingMarkdownXhs,
    title: '小红书关键词旧记录',
    syncedAt: '2026-06-22T00:00:00.000Z',
    propertyFields: 'title,description,keywords',
  });
  assert.ok(existingMarkdown.includes('keywords:'));
  assert.ok(existingMarkdown.includes('  - 小红书'));
  assert.ok(existingMarkdown.includes('  - 内容选题'));
  assert.ok(existingMarkdown.includes('  - AI写作'));

  const trialOnlyProFeaturePlugin = new Plugin();
  trialOnlyProFeaturePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    bindings: [{ token: 'trial-token', label: 'trial', status: 'bound', enabled: true }],
    clientId: 'trial-client',
  });
  trialOnlyProFeaturePlugin.requestJson = async (url) => ({
    data: url.includes('local_transcription_trial')
      ? { hasAccess: true, plan: 'local_transcription_trial', status: 'active' }
      : { hasAccess: false, plan: '', status: 'inactive' },
  });
  const trialOnlyProFeatureStatus = await trialOnlyProFeaturePlugin.getProFeatureEntitlementStatus();
  assert.strictEqual(trialOnlyProFeatureStatus.hasAccess, false);
  assert.notStrictEqual(trialOnlyProFeatureStatus.plan, 'local_transcription_trial');

  const activeProFeaturePlugin = new Plugin();
  activeProFeaturePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    bindings: [{ token: 'pro-token', label: 'pro', status: 'bound', enabled: true }],
    clientId: 'pro-client',
  });
  activeProFeaturePlugin.requestJson = async (url) => ({
    data: url.includes('local_transcription_beta')
      ? { hasAccess: true, plan: 'local_transcription_beta', status: 'active' }
      : { hasAccess: false, plan: '', status: 'inactive' },
  });
  const activeProFeatureStatus = await activeProFeaturePlugin.getProFeatureEntitlementStatus();
  assert.strictEqual(activeProFeatureStatus.hasAccess, true);
  assert.strictEqual(activeProFeatureStatus.plan, 'local_transcription_beta');

  const invalidBindingAiPlugin = new Plugin();
  invalidBindingAiPlugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    bindings: [{ token: 'invalid-token', label: 'invalid', status: 'bound', enabled: true }],
    clientId: 'invalid-client',
  });
  invalidBindingAiPlugin.requestJson = async () => {
    throw new Error('绑定码未绑定或已失效');
  };
  const invalidBindingAiResult = await invalidBindingAiPlugin.enrichRecordMetadataWithAi(aiMetadataCandidateRecord);
  assert.strictEqual(invalidBindingAiResult.metadata.description || '', '');
  assert.deepStrictEqual(invalidBindingAiResult.metadata.keywords || [], []);
  assert.strictEqual(invalidBindingAiPlugin.settings.aiMetadataEnabled, false);

  const inactiveProAiPlugin = new Plugin();
  inactiveProAiPlugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    bindings: [{ token: 'free-token', label: 'free', status: 'bound', enabled: true }],
    clientId: 'free-client',
  });
  inactiveProAiPlugin.requestJson = async (url) => {
    if (String(url).includes('/entitlements/status')) {
      return { data: { hasAccess: false, plan: 'pro', status: 'inactive' } };
    }
    if (url === '/metadata/generate') {
      throw new Error('metadata/generate should not be called without Pro');
    }
    return { data: {} };
  };
  const inactiveProAiResult = await inactiveProAiPlugin.enrichRecordMetadataWithAi(aiMetadataCandidateRecord);
  assert.strictEqual(inactiveProAiResult.metadata.description || '', '');
  assert.deepStrictEqual(inactiveProAiResult.metadata.keywords || [], []);
  assert.strictEqual(inactiveProAiPlugin.settings.aiMetadataEnabled, false);
  const inactiveProMarkdown = helpers.buildMarkdownForRecord({
    record: {
      ...noisyXhsRecord,
      metadata: {
        ...noisyXhsRecord.metadata,
        description: '这条来自历史 Pro 或网页 meta 的简介不应该继续写入',
        keywords: ['历史关键词'],
      },
    },
    title: '小红书标题方法',
    syncedAt: '2026-06-22T00:00:00.000Z',
    propertyFields: inactiveProAiPlugin.settings.notePropertyFields,
    includeAiMetadataFields: inactiveProAiPlugin.settings.aiMetadataEnabled,
  });
  assert.ok(!inactiveProMarkdown.includes('description:'));
  assert.ok(!inactiveProMarkdown.includes('keywords:'));

  const proClosedXhsRecord = helpers.ensureRequiredMetadataFallbacks({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/no-pro-keywords',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/no-pro-keywords',
      platform: '小红书',
      title: '小红书关键词不该生成',
      markdown: '## 正文\n\n这篇讲小红书内容选题和AI写作。\n\n#小红书 #内容选题 #AI写作',
      keywords: [],
    },
  }, { aiMetadataEnabled: false });
  assert.deepStrictEqual(proClosedXhsRecord.metadata.keywords || [], []);

  const multiBindingAiPlugin = new Plugin();
  multiBindingAiPlugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    bindings: [
      { token: 'invalid-token', label: 'old', status: 'bound', enabled: true },
      { token: 'pro-token', label: 'pro', status: 'bound', enabled: true },
    ],
    clientId: 'multi-client',
  });
  const metadataGenerateTokens = [];
  multiBindingAiPlugin.requestJson = async (url, method, body, binding) => {
    if (String(url).includes('/entitlements/status')) {
      if (binding && binding.token === 'INVALID-TOKEN') throw new Error('绑定码未绑定或已失效');
      return { data: { hasAccess: true, plan: 'local_transcription_beta', status: 'active' } };
    }
    if (url === '/metadata/generate') {
      metadataGenerateTokens.push(binding && binding.token);
      return { data: { description: 'Pro 绑定生成的简介', keywords: ['Pro关键词'] } };
    }
    return { data: {} };
  };
  const multiBindingAiResult = await multiBindingAiPlugin.enrichRecordMetadataWithAi(aiMetadataCandidateRecord);
  assert.deepStrictEqual(metadataGenerateTokens, ['PRO-TOKEN']);
  assert.strictEqual(multiBindingAiResult.metadata.description, 'Pro 绑定生成的简介');
  assert.deepStrictEqual(multiBindingAiResult.metadata.keywords, ['Pro关键词']);
  assert.deepStrictEqual(multiBindingAiPlugin.settings.bindings.map((item) => item.token), ['PRO-TOKEN']);
  const multiBindingConnectionResult = await multiBindingAiPlugin.testAiMetadataConnection();
  assert.ok(multiBindingConnectionResult.description || multiBindingConnectionResult.keywords.length);
  assert.deepStrictEqual(metadataGenerateTokens, ['PRO-TOKEN', 'PRO-TOKEN']);

  const xhsHydratePlugin = new Plugin();
  xhsHydratePlugin.settings = helpers.mergeSettings({ xiaohongshuCommentsEnabled: false });
  let xhsRenderCalledWhenDisabled = false;
  xhsHydratePlugin.renderXiaohongshuComments = async () => {
    xhsRenderCalledWhenDisabled = true;
    return [{ author: '不该出现', content: '关闭开关时不能抓评论' }];
  };
  const xhsDisabled = await xhsHydratePlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/static-comments',
    metadata: { url: 'https://www.xiaohongshu.com/explore/static-comments', platform: '小红书' },
  }, '', '', '小红书测试');
  assert.strictEqual(xhsRenderCalledWhenDisabled, false);
  assert.ok(xhsDisabled.metadata.markdown.includes('一级评论'));
  assert.ok(!xhsDisabled.metadata.markdown.includes('关闭开关时不能抓评论'));

  xhsHydratePlugin.settings = helpers.mergeSettings({ xiaohongshuCommentsEnabled: true });
  xhsHydratePlugin.ensureProFeatureAccess = async () => ({ hasAccess: true });
  let xhsRenderCalled = false;
  xhsHydratePlugin.renderXiaohongshuComments = async () => {
    xhsRenderCalled = true;
    return [{ author: '楼中楼用户', content: '展开后才出现的回复' }];
  };
  const xhsHydrated = await xhsHydratePlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/static-comments',
    metadata: { url: 'https://www.xiaohongshu.com/explore/static-comments', platform: '小红书' },
  }, '', '', '小红书测试');
  assert.strictEqual(xhsRenderCalled, true);
  assert.ok(xhsHydrated.metadata.markdown.includes('一级评论'));
  assert.ok(xhsHydrated.metadata.markdown.includes('展开后才出现的回复'));

  const wechatHydratePlugin = new Plugin();
  wechatHydratePlugin.settings = helpers.mergeSettings({});
  let wechatRenderCalled = false;
  wechatHydratePlugin.renderWechatComments = async () => {
    wechatRenderCalled = true;
    return [{ author: '公众号读者', content: '文章页登录态抓到的留言' }];
  };
  const wechatHydrated = await wechatHydratePlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://mp.weixin.qq.com/s?__biz=MzA-test&mid=1&idx=1&sn=abc',
    metadata: { url: 'https://mp.weixin.qq.com/s?__biz=MzA-test&mid=1&idx=1&sn=abc', platform: '公众号' },
  }, '', '', '公众号测试');
  assert.strictEqual(wechatRenderCalled, false);
  assert.ok(wechatHydrated.metadata.markdown.includes('公众号正文'));
  assert.ok(!wechatHydrated.metadata.markdown.includes('文章页登录态抓到的留言'));

  const source = fs.readFileSync(pluginPath, 'utf8');
  assert.ok(source.includes("text: 'AI 简介与关键词'"));
  assert.ok(source.includes("text: '小红书评论区抓取'"));
  assert.ok(!source.includes('login-wechat-for-comments'));
  assert.ok(!source.includes('公众号文章阅读态'));
  assert.ok(!source.includes('AI 简介与关键词（DeepSeek）'));
  assert.ok(!source.includes('服务端 DeepSeek'));
  assert.ok(!source.includes(".setName('DeepSeek API Key')"));
  assert.ok(!source.includes(".setName('DeepSeek 模型')"));
  assert.ok(!source.includes('sk-test'));

  console.log('release social, feishu, and AI metadata checks passed');
}

runAsyncChecks().catch((error) => {
  console.error(error);
  process.exit(1);
});
