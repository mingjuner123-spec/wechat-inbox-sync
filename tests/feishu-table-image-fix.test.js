// 验证飞书 docx 表格重建 + 图片 token 占位修复
// 用法: node tests/feishu-table-image-fix.test.js
const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

// mock obsidian / electron，使 main.js 可在纯 node 环境加载
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
// 末尾注入测试入口（function 声明会 hoist，末尾可访问全部）
src += '\nglobal.__feishuTest = {\n' +
  '  extractFeishuMarkdownFromClientVars, formatFeishuClientVarTableBlock, formatFeishuClientVarBlock,\n' +
  '  replaceFeishuImageTokenPlaceholders, buildFeishuClientVarBlockSequence, getFeishuBlockType,\n' +
  '  isFeishuTableType, isFeishuTableCellType, isFeishuImageType, extractFeishuImageToken,\n' +
  '  getFeishuCellTextFromBlock, getFeishuBlockChildrenIds\n};\n';

const tmpPath = path.join(__dirname, '_tmp_main_for_feishu_test.js');
fs.writeFileSync(tmpPath, src);
let T;
try {
  require(tmpPath);
  T = global.__feishuTest;
} finally {
  // 保留临时文件便于排查，测试末尾删除
}

assert.ok(T && T.extractFeishuMarkdownFromClientVars, '应成功加载目标函数');

// ---- 构造飞书 docx client_vars mock（基于官方 block 数据结构）----
const mockClientVars = {
  block_sequence: ['root', 'h1', 'p1', 'tbl', 'p2', 'img1'],
  block_map: {
    root: { type: 'page', data: { type: 'page', children: ['h1', 'p1', 'tbl', 'p2', 'img1'] } },
    h1: { type: 'heading2', data: { type: 'heading2', text: '配置要求' } },
    p1: { type: 'text', data: { type: 'text', text: '这是普通段落' } },
    tbl: {
      type: 'table',
      data: {
        type: 'table',
        table: {
          property: { row_size: 3, column_size: 2 },
          cells: ['c00', 'c01', 'c10', 'c11', 'c20', 'c21'],
        },
      },
    },
    c00: { type: 'table_cell', data: { type: 'table_cell', children: ['t00'] } },
    c01: { type: 'table_cell', data: { type: 'table_cell', children: ['t01'] } },
    c10: { type: 'table_cell', data: { type: 'table_cell', children: ['t10'] } },
    c11: { type: 'table_cell', data: { type: 'table_cell', children: ['t11'] } },
    c20: { type: 'table_cell', data: { type: 'table_cell', children: ['t20'] } },
    c21: { type: 'table_cell', data: { type: 'table_cell', children: ['t21'] } },
    t00: { type: 'text', data: { type: 'text', text: '组件' } },
    t01: { type: 'text', data: { type: 'text', text: '要求' } },
    t10: { type: 'text', data: { type: 'text', text: 'CPU' } },
    t11: { type: 'text', data: { type: 'text', text: '4核以上' } },
    t20: { type: 'text', data: { type: 'text', text: '内存' } },
    t21: { type: 'text', data: { type: 'text', text: '8GB以上' } },
    p2: { type: 'text', data: { type: 'text', text: '表格之后的段落' } },
    img1: {
      type: 'image',
      data: {
        type: 'image',
        image: { token: 'imgV3_abc123', width: 800, height: 600 },
      },
    },
  },
};

const md = T.extractFeishuMarkdownFromClientVars({ data: { clientVars: mockClientVars } });
console.log('===== 提取结果 =====');
console.log(md);
console.log('====================');

// 表格断言
assert.ok(md.includes('## 配置要求'), '应包含标题 ## 配置要求');
assert.ok(/\| 组件 \| 要求 \|/.test(md), '应包含表格表头 | 组件 | 要求 |');
assert.ok(/\| CPU \| 4核以上 \|/.test(md), '应包含表格数据行 CPU');
assert.ok(/\| 内存 \| 8GB以上 \|/.test(md), '应包含表格数据行 内存');
assert.ok(/---/.test(md), '应包含表格分隔行');
// table_cell 不应散落成纯文本
assert.ok(!/^\|?组件\|要求/.test(md.split('## 配置要求')[1] || '') || md.includes('| 组件 |'), '表格应成结构');
assert.ok(!md.match(/^table_cell$/m), '不应出现 table_cell 文本');
// 普通段落
assert.ok(md.includes('这是普通段落'), '应包含普通段落');
assert.ok(md.includes('表格之后的段落'), '应包含表格后段落');
// 图片占位
assert.ok(md.includes('![图片](feishu-image:imgV3_abc123)'), '应输出图片 token 占位 feishu-image:imgV3_abc123');
// 不应出现裸文件名（image block 无 name 时）
console.log('>> 表格 + 图片占位 断言通过');

// ---- 测试 replaceFeishuImageTokenPlaceholders：占位关联到 DOM 真实 src ----
const assets = [
  {
    src: 'https://shengcaiyoushu01.feishu.cn/space/api/box/stream/download/v2/cover/imgV3_abc123?width=0&height=0&policy=equal',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    alt: '图片',
  },
];
const replaced = T.replaceFeishuImageTokenPlaceholders(md, assets, 'https://shengcaiyoushu01.feishu.cn/wiki/Wl03wVv1kidw');
assert.ok(replaced.includes('https://shengcaiyoushu01.feishu.cn/space/api/box/stream/download/v2/cover/imgV3_abc123'), '占位应被替换为真实 DOM src');
assert.ok(!replaced.includes('feishu-image:imgV3_abc123'), '不应残留 feishu-image 占位');
console.log('>> 图片占位关联 DOM src 断言通过');

// ---- 测试无 assets 时的 fallback URL ----
const fallback = T.replaceFeishuImageTokenPlaceholders(md, [], 'https://shengcaiyoushu01.feishu.cn/wiki/abc');
assert.ok(fallback.includes('https://shengcaiyoushu01.feishu.cn/space/api/box/stream/download/v2/cover/imgV3_abc123'), '无 assets 时应构造飞书下载 URL 兜底');
assert.ok(!fallback.includes('feishu-image:'), '不应残留占位');
console.log('>> 图片 fallback URL 断言通过');

// ---- 测试数字 block_type 兼容（31=table, 32=table_cell, 27=image）----
const numMock = {
  block_sequence: ['r', 'tb', 'im'],
  block_map: {
    r: { block_type: 1, children: ['tb', 'im'] },
    tb: { block_type: 31, table: { property: { row_size: 2, column_size: 1 }, cells: ['nc0', 'nc1'] } },
    nc0: { block_type: 32, children: ['nt0'] },
    nc1: { block_type: 32, children: ['nt1'] },
    nt0: { block_type: 2, text: 'A' },
    nt1: { block_type: 2, text: 'B' },
    im: { block_type: 27, image: { token: 'numImg_token_001' } },
  },
};
const numMd = T.extractFeishuMarkdownFromClientVars({ data: { clientVars: numMock } });
assert.ok(/\| A \|/.test(numMd) && /\| B \|/.test(numMd), '数字 block_type 表格也应重建');
assert.ok(numMd.includes('feishu-image:numImg_token_001'), '数字 block_type 图片也应输出占位');
console.log('>> 数字 block_type 兼容断言通过');

// ---- 测试 table_cell 单独出现时被跳过 ----
assert.strictEqual(T.formatFeishuClientVarBlock({ type: 'table_cell', data: { type: 'table_cell', text: '不该出现' } }, {}), '', 'table_cell 单独出现应返回空');
console.log('>> table_cell 跳过断言通过');

console.log('\n===== 全部测试通过 =====');
try { fs.unlinkSync(tmpPath); } catch (e) {}
