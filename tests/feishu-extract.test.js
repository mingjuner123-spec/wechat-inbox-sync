const assert = require('assert');
const { loadPlugin } = require('./helpers/load-plugin');

const helpers = loadPlugin().__test;

assert.strictEqual(typeof helpers.extractFeishuMarkdownFromHtml, 'function');

const markdown = helpers.extractFeishuMarkdownFromHtml(`
  <html>
    <body>
      <aside>Catalog First Second</aside>
      <img src="https://example.com/avatar.png" alt="avatar">
      <h1>Five trends</h1>
      <p>添加快捷方式</p>
      <h2>First trend</h2>
      <p>Main paragraph one.</p>
      <h3>Key action</h3>
      <p>Main paragraph two.</p>
      <table>
        <tr><th>Stage</th><th>Action</th></tr>
        <tr><td>Start</td><td>Validate demand</td></tr>
      </table>
      <img src="https://example.com/body-image.png" alt="body image">
      <script>
        window.__DATA__ = {
          "block_type":"heading2",
          "text":"Script heading",
          "imageUrl":"https:\\/\\/example.com\\/script-image.jpg"
        };
      </script>
    </body>
  </html>
`, 'https://my.feishu.cn/docx/demo');

assert.ok(markdown.includes('# Five trends'));
assert.ok(markdown.includes('## First trend'));
assert.ok(markdown.includes('### Key action'));
assert.ok(markdown.includes('Main paragraph one.'));
assert.ok(markdown.includes('| Stage | Action |'));
assert.ok(markdown.includes('| Start | Validate demand |'));
assert.ok(markdown.includes('![body image](https://example.com/body-image.png)'));
assert.ok(markdown.includes('![图片](https://example.com/script-image.jpg)'));
assert.strictEqual(markdown.includes('添加快捷方式'), false);
assert.strictEqual(markdown.includes('Catalog First Second'), false);
assert.strictEqual(markdown.includes('avatar.png'), false);

console.log('feishu extract boundary checks passed');
