# 抖音 Session 优先解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不依赖云端的前提下，让抖音链接优先通过持久化 Electron Session 的 HTTP 请求获得准确媒体，只有失败时才启动隐藏浏览器，并确保抖音外部 App 协议不进入 Windows。

**Architecture:** 保留现有静态页面与详情接口解析，新增可单测的抖音地址标准化和 Session HTTP 详情解析函数；`hydrateWebpageMarkdown` 将 Session 结果插在静态解析与隐藏浏览器之间。隐藏浏览器使用同一持久化 Session，并在 `loadURL` 前幂等注册 `bytedance`、`snssdk1128` 协议处理器，现有网络、导航、重定向和新窗口守卫继续作为第二层防御。

**Tech Stack:** Node.js、Electron Session/Protocol API、Obsidian 插件单文件 CommonJS、Node `assert` 回归测试。

---

### Task 0: 单独保存现有导航事件兼容修复

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Verify the existing focused regression**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS；对象参数和事件对象参数中的 `bytedance://` 都会触发 `preventDefault`。

- [ ] **Step 2: Commit only the existing compatibility change**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: handle electron navigation detail objects"
```

Expected: 提交只包含 `installExternalAppNavigationGuards` 的 URL 参数兼容与对应两条测试，不包含后续 Session 新架构。

## 文件结构

- Modify: `obsidian-plugin/wechat-inbox-sync/main.js` — 新增抖音地址标准化、Session HTTP 解析、Session 协议处理器，并接入现有解析顺序。
- Modify: `tests/plugin-main-ai.test.js` — 对纯函数、Session 请求、解析回退、协议处理幂等及非抖音隔离做回归测试。
- Modify: `docs/WORKLOG.md` — 记录代码、验证、本机安装和发布状态。

### Task 1: 标准化抖音自定义协议重定向

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing test**

在现有 `extractDouyinAwemeId` 测试后加入：

```js
assert.strictEqual(
  helpers.extractDouyinAwemeId('bytedance://aweme/detail/7644566503081119019'),
  '7644566503081119019',
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl(
    'https://v.douyin.com/demo/',
    'bytedance://aweme/detail/7644566503081119019',
  ),
  {
    awemeId: '7644566503081119019',
    url: 'https://www.douyin.com/video/7644566503081119019',
  },
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl(
    'https://v.douyin.com/demo/',
    'snssdk1128://aweme/detail/7644566503081119019',
  ),
  {
    awemeId: '7644566503081119019',
    url: 'https://www.douyin.com/video/7644566503081119019',
  },
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl('https://www.douyin.com/video/7644566503081119019', ''),
  {
    awemeId: '7644566503081119019',
    url: 'https://www.douyin.com/video/7644566503081119019',
  },
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl('https://v.douyin.com/demo/', 'bytedance://user/profile/abc'),
  { awemeId: '', url: '' },
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because `normalizeDouyinTargetUrl` is not exported and custom-protocol IDs are not parsed.

- [ ] **Step 3: Write minimal implementation**

扩展 `extractDouyinAwemeId` 的模式，并在它后面加入：

```js
function normalizeDouyinTargetUrl(originalUrl, resolvedUrl = '') {
  const original = String(originalUrl || '').trim();
  const resolved = String(resolvedUrl || '').trim();
  const awemeId = extractDouyinAwemeId(resolved) || extractDouyinAwemeId(original);
  if (awemeId) {
    return {
      awemeId,
      url: `https://www.douyin.com/video/${awemeId}`,
    };
  }
  const candidate = resolved || original;
  if (/^https?:\/\//i.test(candidate) && isDouyinUrl(candidate)) {
    return { awemeId: '', url: candidate };
  }
  return { awemeId: '', url: '' };
}
```

把 `normalizeDouyinTargetUrl` 加入 `__test` 导出。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: normalize douyin app redirects"
```

### Task 2: 新增 Session HTTP 详情解析器

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing tests**

在异步测试入口加入一个可记录请求的 Session：

```js
const sessionFetchCalls = [];
const sessionMediaUrls = await helpers.fetchDouyinMediaUrlsWithSession({
  pageUrl: 'https://www.douyin.com/video/7644238277092174409',
  awemeId: '7644238277092174409',
  session: {
    fetch: async (url, options) => {
      sessionFetchCalls.push({ url, options });
      if (url === 'https://www.douyin.com/video/7644238277092174409') {
        return { text: async () => '<html><body>cookie warmup</body></html>' };
      }
      return {
        text: async () => JSON.stringify({
          aweme_detail: {
            aweme_id: '7644238277092174409',
            video: {
              play_addr: {
                url_list: ['https://v11-weba.douyinvod.com/session-target/?mime_type=video_mp4'],
              },
            },
          },
        }),
      };
    },
  },
});
assert.deepStrictEqual(sessionMediaUrls, [
  'https://v11-weba.douyinvod.com/session-target/?mime_type=video_mp4',
]);
assert.strictEqual(sessionFetchCalls[0].options.credentials, 'include');
assert.strictEqual(sessionFetchCalls.length, 2);

const mismatchedSessionMedia = await helpers.fetchDouyinMediaUrlsWithSession({
  pageUrl: 'https://www.douyin.com/video/7644238277092174409',
  awemeId: '7644238277092174409',
  session: {
    fetch: async (url) => ({
      text: async () => url.includes('/aweme/v1/web/aweme/detail/')
        ? JSON.stringify({
          aweme_detail: {
            aweme_id: '9999999999999999999',
            video: { play_addr: { url_list: ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'] } },
          },
        })
        : '',
    }),
  },
});
assert.deepStrictEqual(mismatchedSessionMedia, []);

assert.deepStrictEqual(await helpers.fetchDouyinMediaUrlsWithSession({
  pageUrl: 'https://www.douyin.com/video/7644238277092174409',
  awemeId: '7644238277092174409',
  session: null,
}), []);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because `fetchDouyinMediaUrlsWithSession` does not exist.

- [ ] **Step 3: Write minimal implementation**

新增以下函数并导出测试入口：

```js
function getDouyinDetailAwemeId(payload) {
  const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
  return String(detail && (detail.aweme_id || detail.awemeId) || '').trim();
}

async function readSessionFetchText(session, url, headers, timeoutMs = 12000) {
  if (!session || typeof session.fetch !== 'function' || !/^https?:\/\//i.test(String(url || ''))) return '';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await session.fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      redirect: 'follow',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return response && typeof response.text === 'function' ? await response.text() : '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchDouyinMediaUrlsWithSession({ pageUrl, awemeId, session = getWechatSession() }) {
  const target = normalizeDouyinTargetUrl(pageUrl, pageUrl);
  const id = String(awemeId || target.awemeId || '').trim();
  if (!session || typeof session.fetch !== 'function' || !id || !target.url) return [];
  try {
    await readSessionFetchText(session, target.url, getSocialRequestHeaders(target.url));
    for (const detailUrl of getDouyinAwemeDetailUrls(id)) {
      try {
        const text = await readSessionFetchText(session, detailUrl, getSocialRequestHeaders(detailUrl));
        const payload = JSON.parse(text || '{}');
        if (getDouyinDetailAwemeId(payload) !== id) continue;
        const urls = extractDouyinMediaUrlsFromDetailPayload(payload)
          .filter((url) => /^https?:\/\//i.test(url));
        if (urls.length) return sortMediaUrlsForTranscription(urls);
      } catch (error) {}
    }
  } catch (error) {}
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "feat: resolve douyin media through electron session"
```

### Task 3: 把 Session 结果接入静态解析和隐藏浏览器之间

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing integration tests**

在现有抖音 hydration 测试后加入：

```js
const sessionFirstPlugin = new PluginClass();
sessionFirstPlugin.settings = { aiProvider: 'off' };
let sessionFirstRenderCalls = 0;
sessionFirstPlugin.fetchDouyinMediaUrlsWithSession = async (pageUrl, awemeId) => {
  assert.strictEqual(pageUrl, 'https://www.douyin.com/video/7644238277092174409');
  assert.strictEqual(awemeId, '7644238277092174409');
  return ['https://v11-weba.douyinvod.com/session-first/?mime_type=video_mp4'];
};
sessionFirstPlugin.renderSocialMediaUrls = async () => {
  sessionFirstRenderCalls += 1;
  return ['https://v11-weba.douyinvod.com/rendered-recommendation/?mime_type=video_mp4'];
};
requestUrlMock = async ({ url }) => {
  if (url === 'https://www.douyin.com/video/7644238277092174409') return { text: '<html></html>' };
  if (url.includes('/aweme/v1/web/aweme/detail/')) return { text: '' };
  throw new Error(`unexpected session-first request ${url}`);
};
const sessionFirstRecord = await sessionFirstPlugin.hydrateWebpageMarkdown({
  type: 'webpage',
  content: 'https://www.douyin.com/video/7644238277092174409',
  metadata: { url: 'https://www.douyin.com/video/7644238277092174409' },
}, '', '', 'Session 优先抖音');
assert.strictEqual(sessionFirstRecord.metadata.mediaUrl, 'https://v11-weba.douyinvod.com/session-first/?mime_type=video_mp4');
assert.strictEqual(sessionFirstRenderCalls, 0);

const sessionFallbackPlugin = new PluginClass();
sessionFallbackPlugin.settings = { aiProvider: 'off' };
let sessionFallbackRenderCalls = 0;
sessionFallbackPlugin.fetchDouyinMediaUrlsWithSession = async () => [];
sessionFallbackPlugin.renderSocialMediaUrls = async () => {
  sessionFallbackRenderCalls += 1;
  return ['https://www.douyin.com/aweme/v1/play/?video_id=sessionfallback&ratio=720p'];
};
requestUrlMock = async ({ url }) => {
  if (url === 'https://www.douyin.com/video/7644566503081119019') return { text: '<html></html>' };
  if (url.includes('/aweme/v1/web/aweme/detail/')) return { text: '' };
  throw new Error(`unexpected session-fallback request ${url}`);
};
const sessionFallbackRecord = await sessionFallbackPlugin.hydrateWebpageMarkdown({
  type: 'webpage',
  content: 'https://www.douyin.com/video/7644566503081119019',
  metadata: { url: 'https://www.douyin.com/video/7644566503081119019' },
}, '', '', 'Session 失败回退');
assert.strictEqual(sessionFallbackRecord.metadata.mediaUrl.includes('sessionfallback'), true);
assert.strictEqual(sessionFallbackRenderCalls, 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because hydration does not call the Session resolver.

- [ ] **Step 3: Write minimal integration**

在插件类中加入：

```js
async fetchDouyinMediaUrlsWithSession(pageUrl, awemeId) {
  return fetchDouyinMediaUrlsWithSession({ pageUrl, awemeId });
}
```

在短链解析后调用 `normalizeDouyinTargetUrl`，自定义协议含作品 ID 时改用规范 HTTPS；不含作品 ID 的外部协议仍拒绝。把作品 ID 保存为 `douyinAwemeId`，并在现有直接详情 API 中先用 `getDouyinDetailAwemeId(detailPayload) === douyinAwemeId` 核验作品，拒绝推荐视频结果。在直接详情循环结束后、隐藏浏览器判断前加入：

```js
if (!hasPreciseDouyinMedia && douyinAwemeId && typeof this.fetchDouyinMediaUrlsWithSession === 'function') {
  try {
    const sessionUrls = await this.fetchDouyinMediaUrlsWithSession(resolvedUrl, douyinAwemeId);
    if (sessionUrls.length) {
      mediaUrls = sortMediaUrlsForTranscription([...sessionUrls, ...mediaUrls]);
      mediaUrl = mediaUrls[0] || mediaUrl;
      hasPreciseDouyinMedia = true;
    }
  } catch (error) {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS, including existing小红书 tests.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "feat: prefer douyin session media before rendering"
```

### Task 4: 在专用 Session 协议层隔离外部 App 跳转

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing tests**

加入异步协议测试：

```js
const handledSchemes = [];
const modernProtocol = {
  handled: new Set(),
  isProtocolHandled(scheme) {
    return this.handled.has(scheme);
  },
  handle(scheme, handler) {
    handledSchemes.push({ scheme, handler });
    this.handled.add(scheme);
  },
};
const modernSession = { protocol: modernProtocol };
await helpers.installDouyinExternalProtocolHandlers(modernSession);
await helpers.installDouyinExternalProtocolHandlers(modernSession);
assert.deepStrictEqual(handledSchemes.map((item) => item.scheme), ['bytedance', 'snssdk1128']);
const blockedResponse = await handledSchemes[0].handler({ url: 'bytedance://aweme/detail/123' });
assert.strictEqual(blockedResponse.status, 204);

const legacyRegistered = [];
const legacyProtocol = {
  registered: new Set(),
  isProtocolRegistered(scheme) {
    return this.registered.has(scheme);
  },
  registerStringProtocol(scheme, handler) {
    legacyRegistered.push({ scheme, handler });
    this.registered.add(scheme);
  },
};
await helpers.installDouyinExternalProtocolHandlers({ protocol: legacyProtocol });
assert.deepStrictEqual(legacyRegistered.map((item) => item.scheme), ['bytedance', 'snssdk1128']);
let legacyPayload = null;
legacyRegistered[0].handler({}, (payload) => { legacyPayload = payload; });
assert.deepStrictEqual(legacyPayload, { data: '', mimeType: 'text/plain' });
```

同时加强源码顺序断言：

```js
assert.ok(
  socialMediaRendererSource.indexOf('await installDouyinExternalProtocolHandlers(wechatSession)')
    < socialMediaRendererSource.indexOf('new BrowserWindow'),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because the Session protocol handler does not exist.

- [ ] **Step 3: Write minimal implementation**

加入：

```js
const DOUYIN_EXTERNAL_PROTOCOLS = ['bytedance', 'snssdk1128'];

async function installDouyinExternalProtocolHandlers(session) {
  const protocol = session && session.protocol;
  if (!protocol) return false;
  let installedAny = false;
  for (const scheme of DOUYIN_EXTERNAL_PROTOCOLS) {
    try {
      if (typeof protocol.handle === 'function') {
        const handled = typeof protocol.isProtocolHandled === 'function'
          ? protocol.isProtocolHandled(scheme)
          : false;
        if (!handled) {
          protocol.handle(scheme, async () => new Response(null, { status: 204 }));
          installedAny = true;
        }
        continue;
      }
      if (typeof protocol.registerStringProtocol === 'function') {
        const registered = typeof protocol.isProtocolRegistered === 'function'
          ? protocol.isProtocolRegistered(scheme)
          : false;
        if (!registered) {
          protocol.registerStringProtocol(scheme, (_request, callback) => callback({ data: '', mimeType: 'text/plain' }));
          installedAny = true;
        }
      }
    } catch (error) {}
  }
  return installedAny;
}
```

在 `renderSocialMediaUrlsWithElectron` 获取 `wechatSession` 后、创建 `BrowserWindow` 前加入：

```js
if (isDouyinUrl(url)) {
  await installDouyinExternalProtocolHandlers(wechatSession);
}
```

继续保留 `installExternalAppNavigationGuards` 及当前对象/事件参数兼容改动，并导出新函数供测试。

- [ ] **Step 4: Run focused tests**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS.

- [ ] **Step 5: Run syntax and marketplace tests**

```powershell
node --check obsidian-plugin/wechat-inbox-sync/main.js
node tests/plugin-marketplace-package.test.js
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: isolate douyin app protocols in electron session"
```

### Task 5: 本机候选安装与回归验收

**Files:**
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Run the complete relevant regression suite**

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: every command exits 0.

说明：正式 `1.3.28` 基线没有 `inbox-core.test.js`、`plugin-core.test.js`、`plugin-sync-core.test.js`；移动端测试读取的是仓库根目录旧发布镜像，`release-social-feishu-ai.test.js` 仍硬编码 `1.2.97`，两者不作为本次唯一发布源 `obsidian-plugin/wechat-inbox-sync/` 的验收门槛。

- [ ] **Step 2: Install only the candidate main.js locally**

先整目录备份目标插件，再把正式 `1.3.28` 的 `main.js`、`manifest.json`、`styles.css`、`local-asr/`、`local-ocr/` 与本次候选代码一起安装到：

```text
D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\main.js
```

安装前后比较所有运行文件与 `data.json` 的 SHA-256；不得创建 Release。

- [ ] **Step 3: Verify installed-file identity and syntax**

```powershell
Get-FileHash obsidian-plugin/wechat-inbox-sync/main.js -Algorithm SHA256
Get-FileHash 'D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\main.js' -Algorithm SHA256
node --check 'D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\main.js'
```

Expected: hashes match and syntax exits 0.

- [ ] **Step 4: Run real-link acceptance in Obsidian**

重载插件后依次处理本次真实链接与仓库保存的两条旧抖音链接，确认：三条均获得目标作品媒体；无 Microsoft Store 弹窗；保存原始音视频开关开/关都能转写；开启时 MP4 落入原附件目录；再连续处理至少 10 条链接，确认没有推荐视频串单。

- [ ] **Step 5: Update worklog**

在 `docs/WORKLOG.md` 顶部记录目标、修改文件、实际测试输出、本机安装哈希、真实链接实测结果、未发布状态及剩余风险。如果实机步骤未执行或失败，必须写明“尚未完成”，不能记录为已修复。

- [ ] **Step 6: Final status check**

Run: `git status --short`

Expected: only本任务文件或明确列出的既有脏文件；不得包含 ZIP、安装备份、用户 `data.json` 或临时缓存。
