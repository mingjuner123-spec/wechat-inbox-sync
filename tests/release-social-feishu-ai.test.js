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
assert.strictEqual(manifest.version, '1.2.31');
assert.strictEqual(versions['1.2.31'], manifest.minAppVersion);

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

const source = fs.readFileSync(pluginPath, 'utf8');
assert.ok(source.includes("text: 'AI 简介与关键词（DeepSeek）'"));
assert.ok(source.includes(".setName('DeepSeek API Key')"));

console.log('release social, feishu, and AI metadata checks passed');
