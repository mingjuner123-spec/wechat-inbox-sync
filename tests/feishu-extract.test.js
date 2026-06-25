const assert = require('assert');
const { loadPlugin } = require('./helpers/load-plugin');

const helpers = loadPlugin().__test;

assert.strictEqual(typeof helpers.extractFeishuMarkdownFromHtml, 'function');

const markdown = helpers.extractFeishuMarkdownFromHtml(`
  <html>
    <body>
      <aside>目录 第一章 第二章</aside>
      <img src="https://example.com/avatar.png" alt="头像">
      <h1>踩中5次风口</h1>
      <p>添加快捷方式</p>
      <h2>第一次风口</h2>
      <p>这是正文第一段。</p>
      <h3>关键动作</h3>
      <p>这是正文第二段。</p>
      <table>
        <tr><th>阶段</th><th>动作</th></tr>
        <tr><td>启动</td><td>验证需求</td></tr>
      </table>
      <img src="https://example.com/body-image.png" alt="正文配图">
      <script>
        window.__DATA__ = {
          "block_type":"heading2",
          "text":"脚本标题",
          "imageUrl":"https:\\/\\/example.com\\/script-image.jpg"
        };
      </script>
    </body>
  </html>
`, 'https://my.feishu.cn/docx/demo');

assert.ok(markdown.includes('# 踩中5次风口'));
assert.ok(markdown.includes('## 第一次风口'));
assert.ok(markdown.includes('### 关键动作'));
assert.ok(markdown.includes('这是正文第一段。'));
assert.ok(markdown.includes('| 阶段 | 动作 |'));
assert.ok(markdown.includes('| 启动 | 验证需求 |'));
assert.ok(markdown.includes('![正文配图](https://example.com/body-image.png)'));
assert.ok(markdown.includes('![图片](https://example.com/script-image.jpg)'));
assert.strictEqual(markdown.includes('添加快捷方式'), false);
assert.strictEqual(markdown.includes('目录 第一章 第二章'), false);
assert.strictEqual(markdown.includes('avatar.png'), false);

console.log('feishu extract boundary checks passed');
