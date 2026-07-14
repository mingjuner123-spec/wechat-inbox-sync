# 抖音 Session 优先解析与外部协议隔离设计

## 背景与根因

插件原有抖音链路先请求静态页面和作品详情接口；只有没有拿到可信媒体地址时，才启动隐藏 Electron `BrowserWindow`，通过页面网络请求和媒体元素捕获真实音视频。

近期实测三条新旧抖音分享链接均出现相同变化：

- 分享链接仍能解析到对应的 HTTPS 作品页；
- 静态作品页只返回统一网页壳，当前提取器得到 0 个媒体地址；
- `aid=6383` 和 `aid=1128` 两个作品详情接口均返回 HTTP 200，但正文为空；
- 因此原本偶发使用的隐藏浏览器兜底变成常规路径；
- 抖音页面脚本会发起 `bytedance://` 或 `snssdk1128://` 原生应用跳转，Windows 因没有对应处理程序而弹出 Microsoft Store。

版本历史表明，`1.3.15` 至 `1.3.19` 的隐藏抖音渲染函数逐字相同；`1.3.18` 新增的原始音视频保存发生在媒体解析和转写之后，没有增加页面加载次数。当前问题主要由抖音接口/风控返回变化暴露，而不是 MP4 保存功能直接引入。

## 目标

1. 解析成功率优先，保留隐藏浏览器作为最终兜底。
2. 尽量在不执行抖音页面脚本的情况下取得准确媒体地址。
3. 任何进入隐藏浏览器的 `bytedance://`、`snssdk1128://` 请求都不得交给 Windows。
4. 全程本地运行，不新增云端解析服务，不要求用户重新绑定或登录。
5. 不改变现有本地转写、原始音视频保存、笔记生成和 Pro 权限链路。

## 非目标

- 不重写小红书、B 站、飞书、微信视频号或普通网页解析。
- 不新增 Playwright、Chromium、yt-dlp 等大型插件依赖。
- 不删除现有导航、重定向、新窗口和网络请求守卫。
- 不把用户链接、Cookie 或媒体临时地址写入普通日志和笔记。

## 总体方案

抖音解析改为三层顺序：

1. **安全静态解析**：沿用短链解析、静态 HTML 和现有详情数据提取。
2. **Session HTTP 解析**：使用插件现有的持久化 Electron Session 发起 HTTP(S) 请求，获得同一 Session 下的 Cookie，再请求作品详情接口；整个过程不创建页面、不执行抖音 JavaScript。
3. **隔离浏览器兜底**：前两层仍失败时，保留现有隐藏浏览器捕获媒体；在加载作品页之前，先在该专用 Session 的协议层接管已知抖音外部协议，使请求在 Electron 内返回空响应，不进入 Windows。

## 组件设计

### 1. 抖音地址标准化

新增纯函数处理以下输入：

- `https://v.douyin.com/...` 短链；
- `https://www.iesdouyin.com/share/video/<awemeId>/...`；
- `https://www.douyin.com/video/<awemeId>`；
- 重定向目标为 `bytedance://aweme/detail/<awemeId>` 或等价的 `snssdk1128://` 地址。

只要能够取得 `awemeId`，就生成规范地址 `https://www.douyin.com/video/<awemeId>`。自定义协议仅作为作品 ID 的数据来源，永远不直接请求或打开。

如果无法得到作品 ID，则保留原 HTTPS 链接继续后续解析；非 HTTP(S) 且无法标准化的地址直接判为不安全，不进入下载器或浏览器。

### 2. Session HTTP 解析器

使用 `getWechatSession()` 返回的 `persist:wechat-inbox-wechat` Session。该分区已经被插件隐藏页面使用，能够持久化抖音响应设置的 Cookie，同时与 Obsidian 主界面 Session 隔离。

执行顺序：

1. 用 Session 的 `fetch` 请求规范作品页，限制为 HTTP(S)，设置 `credentials: 'include'`，并带上现有浏览器 User-Agent、Referer 和中文语言头。
2. 请求结果用于更新 Session Cookie；不执行返回页面中的脚本。
3. 依次请求现有两个作品详情接口。
4. 只接受与目标 `awemeId` 一致的详情对象，并沿用 `extractDouyinMediaUrlsFromDetailPayload` 提取媒体地址。
5. 媒体候选必须为 HTTP(S)，并继续经过现有抖音媒体 URL 识别和排序逻辑。

兼容性处理：若当前 Electron 没有 `session.fetch`，或 Session 请求失败/超时，则静默返回空候选并进入现有浏览器兜底，不降低旧环境成功率。

### 3. Session 协议层隔离

隐藏浏览器创建前，对它实际使用的 Session 安装幂等协议处理器：

- `bytedance`
- `snssdk1128`

优先使用 `session.protocol.handle`，返回 `Response(null, { status: 204 })`；旧 Electron 若只提供旧协议注册 API，则使用 `registerStringProtocol` 返回空正文。安装前分别使用对应 API 的 `isProtocolHandled` 或 `isProtocolRegistered` 做幂等检查，避免重复注册。

协议处理器安装在 `persist:wechat-inbox-wechat` 专用 Session，而不是 Obsidian 默认 Session，因此不会改变用户在普通笔记中点击 HTTP(S) 链接的行为。现有 `onBeforeRequest`、`will-navigate`、`will-frame-navigate`、`will-redirect` 和 `setWindowOpenHandler` 继续保留为防御层。

如果协议处理 API 不可用，解析仍可继续，但必须保留现有事件守卫；诊断结果只记录能力状态，不记录用户 URL。

### 4. 解析数据流

```text
分享链接
  → Node HTTP 短链解析
  → 提取 awemeId / 生成规范 HTTPS 作品页
  → 静态 HTML 提取
  → Session HTTP 预热 Cookie + 详情接口
  → 命中准确媒体：进入现有转写、附件保存、笔记生成
  → 仍未命中：先安装 Session 协议处理器
  → 隐藏浏览器捕获媒体
  → 进入现有转写、附件保存、笔记生成
```

## 错误处理

- Session 页面请求、详情接口请求和 JSON 解析分别设置超时；任何单次失败不阻断下一层。
- 详情响应为空、作品 ID 不一致或没有 HTTP(S) 媒体地址，视为未命中，不写失败正文。
- 浏览器兜底仍未找到媒体时，沿用现有可重试转写错误。
- 外部协议处理器注册失败不得导致插件加载失败；事件守卫继续工作。
- 原始音视频保存失败仍只记录附件保存失败，不丢弃已经完成的转写。

## 测试设计

### 单元与回归测试

1. `bytedance://aweme/detail/<id>` 和 `snssdk1128://...` 能转换为规范 HTTPS 作品页。
2. Session HTTP 详情接口返回目标作品媒体后，不调用隐藏浏览器。
3. Session HTTP 返回空正文时，继续调用隐藏浏览器，不直接判定整条同步失败。
4. 详情作品 ID 与目标不一致时拒绝媒体候选，避免抓到推荐视频。
5. 协议处理器在 `BrowserWindow.loadURL` 之前安装。
6. 相同 Session 重复解析时不重复注册协议。
7. 已知外部协议返回空响应；HTTP(S)、blob、data 和 about 行为不变。
8. 小红书及其他平台不调用新的抖音 Session HTTP 解析器。
9. Session 解析得到的媒体继续进入本地转写和 Pro 原始附件保存路径。

### 实机验收

在 Windows Obsidian 中重载本地候选版本，用本次实际链接以及仓库中的两条旧抖音测试链接分别验证：

- 三条链接都能取得正确作品的媒体并完成转写；
- 全程不出现 Microsoft Store 或“获取打开 bytedance 链接的应用”弹窗；
- 开启与关闭“保存原始音视频”各测试一次；
- 保存开启时 MP4 仍能落入原有附件目录；
- 连续批量处理至少 10 条抖音链接，确认无推荐视频串单和弹窗。

## 发布策略

1. 基于实施时最新正式 `origin/main@1.3.28` 实现，保留已经发布的 PDF OCR 与 ASR 质量控制改动。
2. 先只安装到本机知识库，重载插件并完成上述实机验收。
3. 验收通过后再升级为 `1.3.29`，运行完整插件与市场包回归。
4. 发布 GitHub Release 后检查默认分支、Tag、Release 资产、ZIP 内 manifest 和插件市场抓取状态。

## 风险与回退

- 抖音可能继续调整详情接口；Session HTTP 解析失败时仍有原浏览器兜底，不因新层失败而降低成功率。
- 协议处理 API 在不同 Electron 版本存在差异，因此保留旧 API 兼容和现有事件守卫。
- 如果实机确认协议处理器影响媒体捕获，只回退协议处理器注册，不回退 Session HTTP 解析和现有媒体处理功能。
- 不采用整版回退到 1.3.17/1.3.18，因为这些版本在当前抖音空接口条件下仍会进入同一隐藏浏览器路径。
