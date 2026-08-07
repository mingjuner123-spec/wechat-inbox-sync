# 小红书视频与抖音结构化输出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成一个不发布的本地插件测试版，使小红书视频评论位于转写末尾且评论总上限为 1000，同时让抖音从目标作品结构化数据完整输出原文、标签、封面和互动属性。

**Architecture:** 抖音新增“目标作品对象 → 统一内容模型”的纯解析边界，页面 meta 只做字段兜底；小红书视频把评论 Markdown 作为 `trailingMarkdown` 独立传给通用转写渲染器。修改保持在插件发布源内，测试先针对纯函数和完整记录输出失败，再写最小实现。

**Tech Stack:** Node.js、CommonJS、Obsidian 插件、esbuild、`assert` 回归测试。

---

### Task 1: 抖音结构化内容模型

**Files:**
- Modify: `tests/plugin-social-media-transcript-context.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`

- [ ] **Step 1: 写结构化作品失败测试**

在测试中构造不含 `og:title`/`og:description`/`og:image`、但含目标作品 `window._ROUTER_DATA` 的移动分享页。目标作品包含：

```js
{
  aweme_id: '7644238277092174409',
  desc: '全平台内容，一键进 Obsidian #Obsidian #内容同步',
  text_extra: [
    { hashtag_name: 'Obsidian' },
    { hashtag_name: '内容同步' },
  ],
  statistics: {
    play_count: 12000,
    digg_count: 321,
    collect_count: 88,
    comment_count: 45,
    share_count: 12,
  },
  video: {
    cover: { url_list: ['https://img.example.com/douyin-structured-cover.jpg'] },
    play_addr: { url_list: ['https://v3-dy-o.zjcdn.com/tos-cn-ve-15/douyin-structured.mp4'] },
  },
}
```

同一 `ROUTER_DATA` 再放入另一个推荐作品，断言最终笔记只包含目标作品字段，并按“标题 → 原文正文 → 标签 → 封面 → 口播/音频文案”排序；断言 frontmatter 含 `views: 12000`、`likes: 321`、`collects: 88`、`comments: 45`、`shares: 12`。

- [ ] **Step 2: 运行测试并确认因结构化正文缺失而失败**

Run:

```powershell
$env:PLUGIN_MAIN_PATH = (Resolve-Path 'obsidian-plugin\wechat-inbox-sync\src\main.js')
node tests\plugin-social-media-transcript-context.test.js
```

Expected: FAIL，提示缺少结构化原文、封面或数据属性，而不是测试夹具语法错误。

- [ ] **Step 3: 实现纯内容模型**

在 `src/main.js` 中新增纯函数，接口固定为：

```js
function buildDouyinStructuredContent(detail = {}, fallback = {}) {
  return {
    title: '',
    description: '',
    tags: [],
    coverUrl: '',
    socialMetrics: {},
  };
}
```

实现规则：

- 标题读取 `title`、`preview_title`、`desc`，按顺序取首个有效值。
- 正文保留 `desc`/`description`。
- 标签合并 `text_extra[].hashtag_name`、`cha_list[].cha_name` 和正文 `#标签`，去重。
- 封面读取 `video.cover`、`video.origin_cover`、`video.dynamic_cover` 的首个 HTTP URL。
- 数据属性调用现有 `buildSocialMetrics(detail)`。
- 每个字段为空时才使用 `fallback` 对应字段。

- [ ] **Step 4: 把同一目标作品内容模型接入分享页与详情接口**

在抖音分享页和详情接口两条路径中维护一个 `douyinStructuredContent`。每次确认 `aweme_id` 匹配后，用该对象生成：

```js
socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
  title: douyinStructuredContent.title,
  description: douyinStructuredContent.description,
  tags: douyinStructuredContent.tags,
  imageUrls: [douyinStructuredContent.coverUrl],
});
douyinSocialMetrics = douyinStructuredContent.socialMetrics;
```

最终 `sourceTitle` 优先使用 `douyinStructuredContent.title`，不得扫描推荐流补字段。

- [ ] **Step 5: 运行抖音定向测试确认通过**

Run: 与 Step 2 相同。

Expected: PASS，且推荐作品字段未进入结果。

- [ ] **Step 6: 提交抖音结构化内容改动**

```powershell
git add -- obsidian-plugin/wechat-inbox-sync/src/main.js tests/plugin-social-media-transcript-context.test.js
git commit -m "fix: preserve structured douyin content"
```

### Task 2: 小红书视频评论后置

**Files:**
- Modify: `tests/plugin-social-media-transcript-context.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/record-body-markdown-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`

- [ ] **Step 1: 写评论顺序失败测试**

让小红书视频夹具返回正文、封面、视频和一条评论。用 `buildMarkdownForRecord` 生成完整笔记，断言：

```js
assert.ok(markdown.indexOf('小红书视频口播正文') < markdown.indexOf('## 评论区'));
assert.ok(markdown.indexOf('## 评论区') < markdown.indexOf('测试评论'));
```

- [ ] **Step 2: 运行测试并确认评论仍在转写前**

Run:

```powershell
$env:PLUGIN_MAIN_PATH = (Resolve-Path 'obsidian-plugin\wechat-inbox-sync\src\main.js')
node tests\plugin-social-media-transcript-context.test.js
```

Expected: FAIL，原因是评论区索引小于转写索引。

- [ ] **Step 3: 给转写元数据增加末尾 Markdown 边界**

在 `buildTranscriptOnlyMetadata` 参数中增加：

```js
trailingMarkdown = ''
```

清洗后写入 `metadata.trailingMarkdown`。在 `buildWebpageMarkdownBody` 的 `transcriptOnly` 分支把顺序调整为：

```js
[sourceMediaMarkdown, snapshot, transcriptMarkdown, trailingMarkdown, automaticShareTextMarkdown]
```

- [ ] **Step 4: 小红书视频只把评论传入末尾边界**

新增纯函数把 `## 评论区` 及其后内容从补充 Markdown 中拆出：

```js
function splitTrailingMarkdownSection(markdown = '', heading = '## 评论区') {
  return { markdown: '', trailingMarkdown: '' };
}
```

仅在小红书视频进入 `buildTranscriptRecordFromMedia` 前调用；图文路径不变。`buildTranscriptRecordFromMedia` 新增 `trailingMarkdown` 参数并传入所有成功、失败和无媒体分支的 `buildTranscriptOnlyMetadata`。

- [ ] **Step 5: 运行顺序测试确认通过**

Run: 与 Step 2 相同。

Expected: PASS，评论区只出现一次且位于转写后。

- [ ] **Step 6: 提交评论后置改动**

```powershell
git add -- obsidian-plugin/wechat-inbox-sync/src/main.js obsidian-plugin/wechat-inbox-sync/src/record-body-markdown-utils.js tests/plugin-social-media-transcript-context.test.js
git commit -m "fix: place xiaohongshu comments after transcript"
```

### Task 3: 小红书评论总上限 1000

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`

- [ ] **Step 1: 写 1000 条总预算失败测试**

把常量断言从 300 改为 1000，并构造 600 条主评论、每条 2 个回复的评论树，断言：

```js
assert.strictEqual(helpers.XIAOHONGSHU_TOTAL_COMMENT_LIMIT, 1000);
const total = limited.reduce((sum, comment) => (
  sum + 1 + (Array.isArray(comment.replies) ? comment.replies.length : 0)
), 0);
assert.strictEqual(total, 1000);
```

同时断言输入少于 1000 条时全部保留。

- [ ] **Step 2: 运行测试确认旧上限导致失败**

Run:

```powershell
$env:PLUGIN_MAIN_PATH = (Resolve-Path 'obsidian-plugin\wechat-inbox-sync\src\main.js')
node tests\plugin-main-ai.test.js
```

Expected: 在常量或评论树数量断言处 FAIL；若后续遇到仓库已知无关失败，记录其测试名，不修改本任务断言。

- [ ] **Step 3: 修改总上限并扩展分页预算**

将：

```js
const XIAOHONGSHU_TOTAL_COMMENT_LIMIT = 300;
```

改为 1000。根评论上限继续共享总上限，单楼层回复上限保留 100。根分页循环上限从固定 30 改为根据总上限计算且有硬上限的页预算；原有超时、请求预算、来源耗尽和停止原因逻辑不变。

- [ ] **Step 4: 运行评论定向测试确认通过**

Run: 与 Step 2 相同。

Expected: 新增的 1000 条断言通过；不得将仓库已知无关失败误归因于本改动。

- [ ] **Step 5: 提交评论上限改动**

```powershell
git add -- obsidian-plugin/wechat-inbox-sync/src/main.js tests/plugin-main-ai.test.js
git commit -m "feat: expand xiaohongshu comment budget"
```

### Task 4: 构建与扩大回归

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`（由构建生成）

- [ ] **Step 1: 语法检查**

```powershell
node --check obsidian-plugin\wechat-inbox-sync\src\main.js
node --check obsidian-plugin\wechat-inbox-sync\src\record-body-markdown-utils.js
```

Expected: 两条命令均退出 0。

- [ ] **Step 2: 运行定向回归**

```powershell
$env:PLUGIN_MAIN_PATH = (Resolve-Path 'obsidian-plugin\wechat-inbox-sync\src\main.js')
node tests\plugin-social-media-transcript-context.test.js
node tests\social-engagement-utils.test.js
node tests\plugin-audio-repeat-local-dedupe.test.js
```

Expected: 全部 PASS。

- [ ] **Step 3: 构建插件**

```powershell
npm run build --prefix obsidian-plugin\wechat-inbox-sync
```

Expected: `obsidian-plugin/wechat-inbox-sync/main.js` 更新且构建成功。

- [ ] **Step 4: 用构建产物重跑关键测试**

```powershell
Remove-Item Env:PLUGIN_MAIN_PATH -ErrorAction SilentlyContinue
node tests\plugin-social-media-transcript-context.test.js
node tests\plugin-marketplace-package.test.js
node --check obsidian-plugin\wechat-inbox-sync\main.js
```

Expected: 全部 PASS。

- [ ] **Step 5: 检查差异并提交构建产物**

```powershell
git diff --check
git status --short
git add -- obsidian-plugin/wechat-inbox-sync/main.js
git commit -m "build: refresh local social output candidate"
```

### Task 5: 安全替换用户本地测试插件

**Files:**
- Copy only: `obsidian-plugin/wechat-inbox-sync/main.js`
- Copy only: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Copy only: `obsidian-plugin/wechat-inbox-sync/styles.css`
- Copy only: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Never modify: `D:/内容创作系统/张张的内容创作知识库/.obsidian/plugins/wechat-inbox-sync/data.json`

- [ ] **Step 1: 确认 Obsidian 已关闭并记录配置身份**

记录 `data.json` 的 SHA-256、绑定数量和去标识化令牌指纹；若 Obsidian 仍运行则停止替换。

- [ ] **Step 2: 备份当前四项程序资产**

创建带时间戳的程序文件备份目录，只复制 `main.js`、`manifest.json`、`styles.css`、`versions.json`，不复制或覆盖 `data.json`。

- [ ] **Step 3: 替换四项程序资产**

从当前隔离工作树构建目录复制四项资产到用户插件目录。

- [ ] **Step 4: 回读配置身份与程序身份**

重新计算 `data.json` SHA-256、绑定数量和令牌指纹，必须与 Step 1 完全一致；同时核对安装目录 `main.js` 哈希与候选一致、manifest 仍为本地测试版本。

- [ ] **Step 5: 失败即恢复程序资产**

若配置身份有任何变化，立即恢复四项程序资产并停止；不得用旧备份中的 `data.json` 覆盖当前配置。

- [ ] **Step 6: 输出测试清单**

用户至少测试：一条抖音视频完整五段结构与数据属性、一条小红书视频评论在转写后、一条评论较多的小红书视频、一个非视频小红书图文、一个 B站或小宇宙回归样本。
