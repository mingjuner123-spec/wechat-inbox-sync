# 抖音持久登录会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件内的抖音登录态稳定复用于短链解析和本地转写。

**Architecture:** 增加独立的 Electron 持久 Session，与微信和小红书完全隔离。抖音详情请求和隐藏浏览器都取同一 Session；隐藏浏览器通过一个队列串行运行，防止共享请求监听器并发覆盖。

**Tech Stack:** Obsidian Electron remote API、Node 单元测试、现有单文件构建脚本。

---

### Task 1: 锁定 Session 选择与登录状态

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Test: `tests/plugin-douyin-media.test.js`

- [ ] **Step 1: 写失败测试**

```js
assert.strictEqual(helpers.hasDouyinLoginCookies([{ name: 'sessionid', value: 'valid-session' }]), true);
assert.strictEqual(helpers.hasDouyinLoginCookies([{ name: 'sessionid', value: '' }]), false);
```

- [ ] **Step 2: 运行测试，确认当前没有实现**

Run: `node tests/plugin-douyin-media.test.js`

Expected: FAIL，`hasDouyinLoginCookies` 未定义。

- [ ] **Step 3: 最小实现**

```js
const DOUYIN_SESSION_PARTITION = 'persist:wechat-inbox-sync-douyin';
function getDouyinSession() { return getElectronRemote()?.session.fromPartition(DOUYIN_SESSION_PARTITION) || null; }
function hasDouyinLoginCookies(cookies = []) {
  return cookies.some(({ name, value }) => /^(?:sessionid|sid_guard)$/i.test(String(name || '')) && String(value || '').trim().length >= 8);
}
```

- [ ] **Step 4: 用抖音 Session 替代当前借用的微信 Session**

```js
session = getDouyinSession()
```

用于详情解析、媒体下载和隐藏渲染；不得读取系统浏览器 Cookie。

- [ ] **Step 5: 运行测试**

Run: `node tests/plugin-douyin-media.test.js`

Expected: PASS。

### Task 2: 可见登录窗口与设置入口

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 写失败测试**

```js
assert.ok(helpers.buildDouyinLoginPageConfig().loginUrl.includes('douyin.com'));
```

- [ ] **Step 2: 实现登录、状态和清除函数**

登录窗口使用 `getDouyinSession()`，只能由设置按钮显式打开；窗口关闭后检查登录 Cookie。清除函数只清理该分区 Cookie。

- [ ] **Step 3: 在设置中增加“登录抖音转写”折叠面板**

包含打开登录、检测状态、退出登录三个按钮。退出操作使用 Obsidian 确认弹窗。状态文字不显示 Cookie。

- [ ] **Step 4: 运行测试**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS 或仅保留已记录的无关失败。

### Task 3: 串行化、诊断和回归

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-douyin-media.test.js`

- [ ] **Step 1: 写失败测试**

```js
const trace = [];
await Promise.all([
  helpers.runWithDouyinBrowserSessionLock(async () => { trace.push('first'); }),
  helpers.runWithDouyinBrowserSessionLock(async () => { trace.push('second'); }),
]);
assert.deepStrictEqual(trace, ['first', 'second']);
```

- [ ] **Step 2: 实现单一抖音浏览器队列**

渲染入口在抖音 URL 时先获取队列锁；锁内才安装 `webRequest` 监听器。继续拒绝隐藏页的所有 `window.open`。

- [ ] **Step 3: 加入安全诊断**

诊断只增加 `hasPluginDouyinLogin` 和 `challengeDetected` 布尔值、阶段和安全加载错误码；不保存 Cookie、媒体 URL 或 HTML。

- [ ] **Step 4: 运行定向测试与构建**

Run: `node tests/plugin-douyin-media.test.js`

Run: `npm run check --prefix obsidian-plugin/wechat-inbox-sync`

Expected: PASS。

### Task 4: 发布候选与正式发布

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: generated `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 递增版本并构建**

从当前正式 `1.3.93` 递增到 `1.3.94`，运行构建，确认 `src/main.js` 与 `main.js` 无漂移。

- [ ] **Step 2: 回归与候选包**

运行 Douyin、核心、市场包、构建基础和发布身份检查，生成候选包；不替换任何本机插件或 `data.json`。

- [ ] **Step 3: 发布**

仅在权威仓库干净 `main`、候选包、tag、Release 五项资产完全一致时推送 `1.3.94` tag。发布后运行 postpublish 回读并同步综合工程镜像哈希。
