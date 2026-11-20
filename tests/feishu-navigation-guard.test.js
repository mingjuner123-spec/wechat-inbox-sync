// 验证飞书隐藏提取窗口的导航护栏：登录跳转不得被甩到系统浏览器
// 用法: node tests/feishu-navigation-guard.test.js
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
src += '\nglobal.__feishuGuardTest = {\n' +
  '  isAllowedFeishuNavigationUrl, installFeishuDocumentNavigationGuards\n' +
  '};\n';

const tmpPath = path.join(__dirname, '_tmp_main_for_feishu_guard_test.js');
fs.writeFileSync(tmpPath, src);
let T;
try {
  require(tmpPath);
  T = global.__feishuGuardTest;
} finally {
  try { fs.unlinkSync(tmpPath); } catch (e) {}
}

assert.ok(T && T.isAllowedFeishuNavigationUrl, '应成功加载飞书导航护栏');

const DOC_URL = 'https://ecnacdxocmp9.feishu.cn/wiki/VcITwhDqOiThXPkM24vcNVdgnMd';
const OAUTH_URL = 'https://accounts.doubao.com/flow-account/oauth/authorize?access_type=offline&biz_name=feishu&redirect_uri=https%3A%2F%2Fwww.feishu.cn%2Fsuite%2Fpassport%2Fauthentication%2Fidp%2Fdoubao%2Fcallback';
const PASSPORT_URL = 'https://www.feishu.cn/suite/passport/authentication/idp/doubao/callback';

// ---- 允许飞书文档域、飞书登录域与豆包账号域 ----
assert.strictEqual(T.isAllowedFeishuNavigationUrl(DOC_URL, DOC_URL), true, '应允许飞书文档链接');
assert.strictEqual(T.isAllowedFeishuNavigationUrl(OAUTH_URL, DOC_URL), true, '应允许飞书登录授权跳转在隐藏窗口内完成');
assert.strictEqual(T.isAllowedFeishuNavigationUrl(PASSPORT_URL, DOC_URL), true, '应允许飞书 passport 跳转');
assert.strictEqual(T.isAllowedFeishuNavigationUrl('https://docs.larksuite.com/docx/abc', DOC_URL), true, '应允许 Lark 国际站');
assert.strictEqual(T.isAllowedFeishuNavigationUrl('https://docs.example.com/doc/x', DOC_URL), false, '应拒绝非飞书自定义域');

// ---- 拒绝非飞书域、非 HTTPS 与非网页协议 ----
assert.strictEqual(T.isAllowedFeishuNavigationUrl('https://evil.example.com/', DOC_URL), false, '应拒绝外部域');
assert.strictEqual(T.isAllowedFeishuNavigationUrl('http://ecnacdxocmp9.feishu.cn/wiki/x', DOC_URL), false, '应拒绝非 HTTPS');
assert.strictEqual(T.isAllowedFeishuNavigationUrl('javascript:alert(1)', DOC_URL), false, '应拒绝 javascript 协议');
assert.strictEqual(T.isAllowedFeishuNavigationUrl('weixin://dl/business', DOC_URL), false, '应拒绝外部 App 协议');
assert.strictEqual(T.isAllowedFeishuNavigationUrl('https://docs.example.com/doc/x', DOC_URL), false, '自定义域只允许初始域');
console.log('>> URL 白名单断言通过');

// ---- 护栏必须清掉 Obsidian 继承的跳转监听，并拦截外部导航 ----
function createFakeWebContents() {
  const listeners = new Map();
  const calls = { removed: [], externalOpen: 0 };
  const wc = {
    calls,
    removeAllListeners(name) {
      calls.removed.push(name);
      listeners.delete(name);
    },
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    setWindowOpenHandler(fn) {
      wc.windowOpenHandler = fn;
    },
    fire(name, url) {
      let prevented = false;
      const event = { preventDefault() { prevented = true; } };
      (listeners.get(name) || []).forEach((fn) => fn(event, { url }));
      return prevented;
    },
    listenerCount(name) {
      return (listeners.get(name) || []).length;
    },
  };
  return wc;
}

const wc = createFakeWebContents();
// 模拟 Obsidian 在所有 webContents 上继承的监听：取消跳转并交给 shell.openExternal
for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
  wc.on(eventName, () => { wc.calls.externalOpen += 1; });
}
T.installFeishuDocumentNavigationGuards(wc, DOC_URL);
for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
  assert.ok(wc.calls.removed.includes(eventName), `应移除继承的 ${eventName} 监听`);
  assert.strictEqual(wc.listenerCount(eventName), 1, `${eventName} 只应保留护栏自身监听`);
}
assert.strictEqual(wc.fire('will-redirect', OAUTH_URL), false, '登录跳转不应被拦截，应在隐藏窗口内继续');
assert.strictEqual(wc.fire('will-navigate', 'https://evil.example.com/'), true, '外部网页导航应被拦截');
assert.strictEqual(wc.fire('will-redirect', 'weixin://dl/business'), true, '外部 App 跳转应被拦截');
assert.strictEqual(wc.fire('will-frame-navigate', 'https://player.example.com/embed'), false, '内嵌播放器 https 导航不应被拦截');
assert.strictEqual(wc.fire('will-frame-navigate', 'weixin://dl/business'), true, '内嵌框架的外部 App 跳转应被拦截');
assert.strictEqual(wc.calls.externalOpen, 0, '任何跳转都不应再交给系统浏览器');
assert.deepStrictEqual(wc.windowOpenHandler(), { action: 'deny' }, '应拒绝页面侧 window.open');

assert.throws(
  () => T.installFeishuDocumentNavigationGuards(createFakeWebContents(), 'https://evil.example.com/'),
  /飞书文档提取仅允许官方 HTTPS 页面/,
  '非飞书初始地址必须拒绝',
);
console.log('>> 继承监听隔离与导航拦截断言通过');

console.log('\n===== 全部测试通过 =====');
