// 验证飞书非 docx 节点（思维笔记/表格等）映射为可操作的中文提示
// 用法: node tests/feishu-unsupported-node-type.test.js
const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const origRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  if (name === 'obsidian') {
    return {
      Notice: class Notice { constructor() {} },
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting { constructor() {} },
      requestUrl: () => Promise.resolve({ json: {}, text: '' }),
    };
  }
  if (name === 'electron') {
    return { BrowserWindow: class {}, session: { fromPartition: () => ({}) } };
  }
  return origRequire.apply(this, arguments);
};

const mainPath = path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'main.js');
let src = fs.readFileSync(mainPath, 'utf-8');
src += '\nglobal.__feishuUnsupportedTest = { buildFeishuUnsupportedNodeTypeError };\n';

const tmpPath = path.join(__dirname, '_tmp_main_for_feishu_unsupported_test.js');
fs.writeFileSync(tmpPath, src);
let T;
try {
  require(tmpPath);
  T = global.__feishuUnsupportedTest;
} finally {
  try { fs.unlinkSync(tmpPath); } catch (e) {}
}

assert.ok(T && typeof T.buildFeishuUnsupportedNodeTypeError === 'function', '应成功加载提示映射函数');

const mindnote = T.buildFeishuUnsupportedNodeTypeError(
  new Error('Feishu wiki node is not a document: mindnote'),
);
assert.ok(mindnote, 'mindnote 应映射为中文提示');
assert.ok(mindnote.message.includes('思维笔记'), '提示应说明是思维笔记');
assert.ok(mindnote.message.includes('暂不支持转存'), '提示应说明暂不支持转存');
assert.ok(/另存为文档/.test(mindnote.message), '提示应给出下一步');
assert.strictEqual(mindnote.code, 'EXTRACTION_FAILED');
assert.strictEqual(mindnote.diagnostic.nodeType, 'mindnote');
assert.strictEqual(mindnote.diagnostic.stopReason, 'unsupported_node_type');

const sheet = T.buildFeishuUnsupportedNodeTypeError(
  new Error('Feishu wiki node is not a document: sheet'),
);
assert.ok(sheet && sheet.message.includes('电子表格'), 'sheet 应显示电子表格');

const bitable = T.buildFeishuUnsupportedNodeTypeError(
  new Error('Feishu wiki node is not a document: bitable'),
);
assert.ok(bitable && bitable.message.includes('多维表格'), 'bitable 应显示多维表格');

const unknown = T.buildFeishuUnsupportedNodeTypeError(
  new Error('Feishu wiki node is not a document: board'),
);
assert.ok(unknown && unknown.message.includes('当前类型'), '未知类型应使用通用中文标签');

assert.strictEqual(
  T.buildFeishuUnsupportedNodeTypeError(new Error('Feishu is not connected. Please connect Feishu first.')),
  null,
  '授权错误不应被误判为不支持类型',
);
assert.strictEqual(T.buildFeishuUnsupportedNodeTypeError(null), null, '空错误应返回 null');

console.log('===== 全部测试通过 =====');
