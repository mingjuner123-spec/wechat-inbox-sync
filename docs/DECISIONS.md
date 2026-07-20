# Engineering decisions

## 2026-07-20: PowerShell deployer behavior requires a Windows CI gate

Decision:

- Linux `guards` continues to run repository-wide, manifest, plugin, macOS shell, and cross-platform PowerShell-parser checks. Tests that invoke Windows PowerShell or `.cmd` fixtures must skip outside Windows.
- The `Main guards` workflow must also provide a `windows-deployer` job on `windows-latest`, with a full checkout and Node 24, that runs `node tests/release-governance.test.js`.
- Both `guards` and `windows-deployer` are release-governance contexts and must be required by main-branch protection. A Linux-only success is insufficient evidence for the controlled Windows component deployer.

Reason:

- PR #1 ran `guards` on Ubuntu, where the governance suite invoked `powershell.exe`; the job failed even though the same suite passed on Windows. Skipping those runtime probes on Linux without a Windows replacement would silently remove verification of the deployer, its strict CloudBase handling, and dry-run safety.

## 2026-07-19：插件与本地组件发布以当前主线提交和内容哈希为唯一身份

决策：

- `obsidian-plugin/wechat-inbox-sync/` 是插件唯一正式发布源；只有干净工作区中与当前 `origin/main` 完全相同的提交可以创建插件 tag、GitHub Release 或发布 ASR/OCR CDN 组件。本地分支名称不构成身份，Git commit identity 才构成身份。
- 每个受管本地组件必须登记在 `obsidian-plugin/wechat-inbox-sync/local-components-manifest.json`，以 canonical UTF-8/LF 字节的完整 SHA-256 作为版本身份，并发布到 `local-components/by-sha256/<SHA256>/<filename>`。已存在的不可变路径不得被不同字节覆盖。
- 旧插件依赖的 `local-asr/common/...` 与 `local-ocr/common/...` 继续作为兼容别名，但只能在不可变对象完成 CloudBase 对象回读和公网字节验证后更新；公开 manifest 最后发布。
- 本地组件只允许通过 `scripts/deploy-local-components.ps1 -Execute` 部署。直接对本地组件执行 `tcb hosting deploy` 属于不受支持的旁路操作；发布脚本默认 dry-run，并在上传前、切换别名前和完成后重复验证主线、manifest 与远端字节。
- 版本 tag 必须指向当时最新的 `origin/main`，且根目录与正式插件目录版本必须同时等于 tag。主线/PR、Release 和每日完整性工作流共同执行 manifest、发布源、插件回归、脚本语法和 CDN 一致性门禁。
- 紧急 CDN 热修只能作为短时恢复手段。精确的 canonical bytes 与 manifest 必须在下一次插件发布前回写 `main`；未完成主线闭环时，Release 门禁必须阻止继续发版。

原因：

- macOS ASR portable-Python 修复曾存在于分叉开发线，却不是正式 `1.3.48` 的祖先；旧发布工作区随后又能覆盖可变 CDN 别名，造成“已经修好、更新后退回旧实现”。
- 只比较文件名、版本字符串、工作区内容或可变公网 URL 都不能证明产物来自哪个 Git 提交；换行差异还会进一步掩盖 working tree 与 committed blob 的来源差异。
- 当前 CloudBase CLI 3.5.9 不提供 hosting 对象的原子 conditional-create。受控发布因此采用完整内容哈希路径、两次存在性检查、存在对象下载校验及发布后双通道字节验证；诚实并发发布相同内容不会冲突，不同内容会失败关闭。该平台限制不得通过放宽校验解决。

## 2026-07-15：OCR 安装器校验契约必须随安装策略同步演进

决策：

- Windows 与 macOS OCR 安装器的新鲜度校验必须描述当前安装策略；安装器从 uv 切换到固定便携 Python 时，校验规则必须在同一提交中切换，不能继续要求已经退役的 uv 标记。
- 回归测试必须把仓库内当前 Windows/macOS 安装器原文交给插件实际使用的校验函数并断言通过，同时对关键当前标记做负例；不得只搜索插件源码中的字符串。
- Release 工作流在公网 OCR SHA-256 门禁前必须执行插件回归测试。当前安装器通过插件校验、且公网文件与当前安装器逐字节一致，二者共同证明用户下载到的 CDN 安装器不会被插件误拒绝。

原因：

- `1.3.38` 已将 OCR Python 主安装路径从 uv 改为固定 CPython `3.12.13+20260623`，但 `1.3.41`/`1.3.42` 的插件下载校验仍要求 `Install-Uv`、`UV_PYTHON_DOWNLOADS` 等旧标记。
- 腾讯云 Windows/macOS 安装器和随包安装器本身均正确，插件却在执行安装器前返回 `outdated or invalid content`，因此没有生成 `install.log`，诊断表面表现为 Python 环境和 OCR 脚本缺失。
- 单独的 CDN 哈希一致性只能证明“线上等于仓库”，不能证明“插件接受仓库里的当前安装器”；必须把内容一致性与运行时校验契约同时纳入发布门禁。

## 2026-07-15：小红书评论只允许一个最终评论树和一次 Markdown 渲染

决策：

- 浏览器真实签名响应与浏览器阶段已经合成的评论树是最终主数据；回到同步主流程后不得再把它与初始静态 HTML 做第二次通用合并。
- 最终评论区必须先移除正文中已有的旧/局部 `## 评论区`，再从最终评论树完整渲染一次；不得使用“已有评论区就跳过追加”的通用网页保护逻辑。
- 带深度参数的递归标准化函数不得直接作为 `Array.map` 回调，因为 `map` 的索引参数会被误当成递归深度；必须用单参数包装函数调用。
- 主评论采集进展与回复展开进展分别统计。回复或子回复请求增长不能重置主评论空闲计数；停止时若仍无法证明主评论已耗尽，诊断必须标记 `partial=1`。
- 网络 ID 始终优先；无 ID 跨来源去重使用 NFKC 作者与正文，并忽略 `[doge]` 等展示型 emoji 标记和时间格式差异。不同网络 ID 的相同正文不得误删。
- 用户真实复测通过的实现固定为不可移动标签 `xhs-comments-stable-1.3.42`，指向正式 `1.3.42`。后续稳定版本只允许新增 `xhs-comments-stable-<version>`，不得移动、删除或复用旧标签。
- 后续修改评论链路前必须对照 `docs/XHS_COMMENT_VERSION_BASELINE.md`，保留 74 根/19 回复、emoji 去重、不同 ID 同文案保留和 `lost_root=0` / `lost_replies=0` 回归；恢复时从最新主线建立修复分支，不得整体硬回退主线或覆盖用户 `data.json`。

原因：

- 2026-07-15 三篇真实笔记合计在网络阶段捕获 64 条回复，最终 Markdown 只保留 30 条；其中 `merged_replies=19` 的样本最终仅有 `final_replies=3`。
- 根因测试证明 `buildSocialCommentsMarkdown` 直接使用 `.map(normalizeSocialComment)`，根评论下标被当成递归深度，导致只有前 4 个根评论会输出回复；同时旧的最终流程会在已有局部评论区时跳过权威评论树。
- 单一最终树和守恒诊断能让“平台没有返回”和“插件内部丢失”成为两个可区分的问题，避免继续依赖局部补丁。

## 2026-07-15：本地 OCR 与插件必须作为一个发布单元

决策：

- 任何 `local-ocr/` 变更必须先上传腾讯云并通过公网逐字节 SHA-256 校验，之后才允许推送插件 tag。
- GitHub Release 工作流必须执行 `scripts/check-local-ocr-cdn.js`；Windows 安装器、macOS 安装器或 OCR 运行脚本任一与 tag 内发布源不一致时，发布失败。
- 在不可变版本路径完成前，禁止把“稍后补传 CDN”作为可接受发布状态。
- 后续把共享可覆盖路径迁移到 `local-ocr/releases/<componentVersion>/`，由含 SHA-256 的 manifest 选择版本，历史版本不覆盖。

原因：

- `1.3.31` 的插件能力先于 CDN 组件升级，形成跨组件版本漂移；固定 Python 修复仍在，但插件因新增 PDF 依赖拒绝执行旧组件。
- 人工清单已记录风险却没有阻止 tag，必须把公网一致性从提醒升级为自动门禁。
- 不可变版本与 manifest 能把回滚从“覆盖文件”变成“切换明确版本”，同时保留审计和快速恢复能力。

## 2026-07-15：可选的 Electron 网络调试不得阻塞同步主链路

决策：

- 通过 `webContents.debugger` 捕获抖音/小红书接口响应只是一条增强取数通道，`Network.enable` 必须以 best-effort 方式启动，不得被同步主链路 `await`。
- 调试协议不可用、命令抛错或 Promise 长时间不返回时，页面加载、DOM/资源捕获和后续失败兜底仍必须继续执行；响应体收尾任务只能在明确的短时间预算内等待。
- `BrowserWindow.loadURL()` 的 Promise 不作为加载完成条件；主链路只等待带明确上限的 `did-finish-load` / `did-fail-load` 事件计时器。任何放在用户可见“正在处理”阶段中的 Electron Promise 都必须证明存在退出路径。
- `session.fetch()` 等 Electron 远端对象调用必须由主进程侧 `Promise.race` 提供真实墙钟超时；`AbortSignal` 只作尽力取消，不能单独承担退出保证。超时后继续原有隐藏浏览器解析链路，不减少媒体候选来源。

原因：

- `1.3.32` 为抖音新增网络响应体捕获时同步等待 `Network.enable`；现场记录已成功从云端取得 1 条内容，但超过三分钟仍停留在 `processing`，且 ASR 未启动。抖音作品页和接口本机网络探针均在约一秒内返回，说明卡点位于隐藏浏览器前置调试命令。
- 同项目稳定的小红书实现已经使用非阻塞 `.catch(() => {})` 启动同一命令；可选观测能力不应拥有阻断核心解析的控制权。
- `1.3.33` 去掉第一处等待后仍可复现，复查发现同一函数还先等待没有上限的 `loadURL()`，并在末尾无限等待可选的 `Network.getResponseBody` 任务；必须对整条隐藏浏览器链路建立时间边界，而不是逐个修补表面卡点。
- `1.3.34` 现场再次停在 `processing`，目标作品页普通请求已完成，但 ASR 未启动；最小回归证明当 Electron Session 忽略跨上下文取消信号时，原实现仍会永久等待。对请求 Promise 本身建立墙钟竞争后，相同样本会按时返回并进入后续解析路径。

## 2026-07-15：Windows / macOS ASR 安装器新鲜度是发布契约

决策：

- Windows 与 macOS ASR 动态安装器不得只按通用函数或下载能力标记判断新鲜度；必须同时校验最低安装器版本、当前转写质量门标记，并拒绝已经退役的内容提示词参数。
- Windows 当前最低可接受版本为 `1.2.22`，macOS 为 `1.3.5`；两端都必须包含 `repeat-guard-v2`，且不得包含 `$SimplifiedPrompt`、`SIMPLIFIED_PROMPT` 或 `--prompt`。
- 发布源安装器变更后必须同步更新腾讯云静态托管 `local-asr/common/install-local-asr.ps1` 和对应的 `install-local-asr-macos.sh`，并分别通过 `tcb hosting download` 与带缓存绕过参数的公网 URL 回读，确认两份 SHA-256 都与发布源一致。
- 远端安装器不满足契约时，新插件必须拒绝执行并回退到满足同一契约的随包文件；不得先安装旧脚本、再依赖安装后检查报错。

原因：

- Windows CDN 上的 `1.2.21` 和 macOS CDN 上的 `1.3.4` 都曾在项目发布源升级后继续存在；插件的宽松检查接受旧文件，导致每次“修复”都重新覆盖回过期转写脚本。
- 安装前拒绝旧资产可以保护用户现有可用组件；云端对象与公网 CDN 双回读可以同时发现上传目标错误和缓存未刷新。

## 2026-07-15: Xiaohongshu comments use browser-network data as the canonical source

- Signed comment responses captured from the logged-in browser are authoritative. Responses are replayed in request order before cursor/stop-state aggregation.
- DOM and static HTML comments are fallback sources only. Cross-source duplicates are identified by normalized author and content even when displayed times differ.
- Replies must stay under their root comment. API replies require a matching root ID; DOM `回复 用户` rows attach only when the parent author resolves uniquely. Unmatched replies are counted in diagnostics instead of being promoted to main comments.
- Pagination scrolls the real comment-list container, waits for network/DOM progress, and stops on API exhaustion, repeated idle rounds, or the bounded safety limit.
- Final diagnostics retain root/reply/page, fallback, duplicate, unmatched, invalid-payload, scrolling, and stop-reason counters so future platform changes can be diagnosed from a user report.

Reason:

- Xiaohongshu loads main comments and folded replies asynchronously. Treating whichever source arrives first as final caused ten-comment truncation, duplicated comments, and replies flattened into roots.
- DOM text alone does not carry stable root IDs, so ambiguous folded replies cannot be assigned safely without inventing hierarchy.
- The authorization must be tied to a clear user action and the server remains responsible for timing and deduplication.
- A paid upgrade should never receive a "trial expiring" message after the user has already converted.

## 2026-07-14: Trial-expiry return offer is durable and one-time

- A user who previously held a trial or an expired historical Pro entitlement receives one 48-hour return offer when they next request their entitlement status after expiry.
- The offer is stored server-side in `trial_expiry_recovery_offers`; it does not depend on the mini-program clock or a transient page session.
- The return offer maps annual/two-year purchases to the existing 68/108 virtual-payment items. It is unavailable after one successful return-price payment, after its 48-hour expiry, or after a refunded payment record.
- A pending discounted order retains its server-selected price for 30 minutes. The client continues to submit only its plan ID; the server recomputes eligibility and ignores client prices.

Reason:

- A literal “48 hours after trial expiry” would exclude historical users who return later and would create an avoidable loss-aversion drop at checkout.
- Durable, server-owned timestamps prevent client clock manipulation and keep the offer consistent across devices and retries.

## 2026-07-14: Pro renewal pricing stays automatic and coupon-free

- Monthly Pro remains 19.9 yuan. The regular annual/two-year prices are 78/118 yuan.
- Any currently active Pro entitlement, including the active 7-day trial and paid Pro, automatically receives the existing 68/108 annual/two-year products.
- No coupon collection, coupon claim UI, coupon storage, or coupon settlement path is introduced.
- Historical expired users retain the one-time 48-hour return offer. Its fixed server-side window starts when the first post-expiry entitlement query creates `trial_expiry_recovery_offers/<openid>`; reopening or refreshing does not extend it, and a successful return-price payment marks it used.
- The Mini Program displays 78/118 as struck-through reference prices for active Pro and labels 68/108 as `Pro 有效期内专享`. Expired/free users see only 78/118 unless the stored 48-hour return offer is active.

Reason:

- This keeps the purchase decision simple while preserving a concrete incentive to renew before expiry.
- Server-selected product IDs remain authoritative, so the client cannot forge a discounted price.

## 2026-07-13: Active-Pro renewal pricing is server-selected

- Active Pro users, including active trial users, keep the monthly plan at 19.9 yuan and receive 68 yuan/year plus 108 yuan/two-year renewal prices.
- Expired and free users keep the monthly plan at 19.9 yuan and see 78 yuan/year plus 118 yuan/two-year prices.
- The mini program sends only a plan ID. `quickstartFunctions` recomputes entitlement and selects the permitted product and price; the client cannot submit its own price or product ID.
- The existing virtual-payment items are the source of truth: `pro_year` is the 78-yuan annual item, `Pro_2years` is the 118-yuan two-year item, `Pro_year_group` is the 68-yuan annual renewal item, and `Pro_2years_group` is the 108-yuan two-year renewal item. The renewal IDs default to those values and may only be overridden by `VIRTUAL_PAY_ACTIVE_PRO_YEAR_PRODUCT_ID` and `VIRTUAL_PAY_ACTIVE_PRO_TWO_YEAR_PRODUCT_ID`.
- For active Pro, the page displays 78/118 as struck-through reference prices before 68/108 and explains that prices return to 78/118 after Pro expires. Expired/free users see only their actual 78/118 prices.

Reason:

- Product selection and price must stay server-authoritative so a stale or modified mini program cannot buy an unauthorized price.
- All four payment items already exist. The server maps them by entitlement state so no client-side item selection is trusted.

## 2026-07-13: AI metadata uses CloudBase Hunyuan only

- AI descriptions and keywords are generated only by the CloudBase Hunyuan route in `syncApi`.
- The Obsidian plugin never reads, stores, or sends a DeepSeek API key for metadata generation. Legacy local DeepSeek settings are removed when plugin settings are loaded.
- Metadata input must include, in priority order where available: transcript text for audio/video, and otherwise record text, converted document Markdown, webpage Markdown, snapshots, and extracted summaries.
- If metadata generation fails after a record can otherwise be saved, the note contains a short redacted HTML comment beginning `wechat-inbox-ai-metadata-error`; required transcript metadata still fails the sync with the same short reason.

Reason:

- The mini-program Hunyuan allocation is the intended shared quota. A local or external DeepSeek key creates inconsistent user behavior, key-exposure risk, and an avoidable paid fallback.
- Text and converted documents previously had no AI input source, which silently skipped metadata generation even for active Pro users.

## 2026-07-13: Refund eligibility follows the original 7-day trial, not the payment date

- The Mini Program's normal purchase path starts only after the user claims the 7-day trial. Refund eligibility is therefore anchored to the first trial start time, not to `paidAt`.
- A paid order is eligible only when it was purchased during that original trial and the administrator confirms the refund before the same trial window ends. A purchase after the trial window, or a refund request after it, is rejected.
- Historical users resolve their trial start from the trial redemption-code record; newly activated trials also persist `trialStartedAt` on the entitlement for direct lookup.
- The current admin action is a business-side confirmation: it marks the order refunded and rolls back the linked entitlement/code only after the administrator confirms that the original payment has been refunded in the WeChat virtual-payment backend. It does not initiate a second automatic payment-provider refund.

Reason:

- A "paid within seven days" rule would allow refunds long after the free trial had finished, which conflicts with the product policy.
- Keeping money movement separate from entitlement rollback avoids duplicate refunds while the provider-refund integration and its asynchronous status reconciliation are not yet implemented.

## 2026-07-11: Test group-buy eligibility is code-owned and non-commissionable

- A test exception is not an OpenID-only bypass. It requires a currently active whitelist record whose redemption code is already owned by the requesting account's entitlement.
- The server, not the mini-program UI, marks a successful exception as `groupBuy.testMode`.
- Test-mode orders may validate payment and entitlement delivery, but are excluded from promotion attribution, commission settlement, and the 100-customer partner threshold. Administrators should set an expiry or disable the record immediately after testing.

## 2026-07-11：团购价仅由服务端码校验解锁

- 正价会员页继续展示月卡 19.9 元、年卡 68 元、两年卡 118 元；团购入口仅在限时活动内显示。
- 团购码不限人数，但一人一码绑定推广员；仅首次成功 Pro 付费用户可使用，支付成功后归因不可更换。
- 年卡团购价/首单佣金为 59 元/10 元，两年卡为 108 元/16 元；支付满 7 天且未退款才可结算。
- 满 100 位有效新付费用户后，该推广员名下用户后续 Pro 消费按实付金额 15% 计佣。禁止多级分销和下级业绩返佣。
- 活动价必须使用微信后台单独发布的固定价活动道具，不能修改正价道具的签名价格。

本文件记录已经做出的产品/工程决策，避免后续反复推翻或走回旧方案。

## 2026-07-10：本地客户端不作为安全边界，Pro 价值由服务端权益保护

决策：

- Obsidian 插件、安装脚本、Python、模型和本地 ASR/OCR 组件都视为用户可修改、可复制的客户端资产，不把本地按钮或本地缓存当作最终鉴权。
- 基础同步继续只校验绑定、设备和记录/文件归属，不统一改成 Pro 功能。
- 云端转写、云端 OCR、AI 元数据、云端媒体准备和官方组件 manifest 必须在服务端确认有效 Pro 后才能调用。
- 飞书 OAuth、连接状态和官方文档提取属于免费能力，只校验绑定凭证与设备，不查询或要求 Pro 权益。
- 官方插件在安装、修复和使用本地组件前检查 Pro 到期时间；无到期时间、非法到期时间或已经到期的缓存不能放行。纯本地组件仍接受“可被高级用户复用”的现实，竞争壁垒放在完整收集/同步链路、持续更新和服务上。
- 生产内置兑换码退役必须先审计并归档：`user_entitlements` 和 `payment_orders` 原样保留，内置码在 `redeem_codes` 中落成 `disabled` 档案后，才移除代码兜底。禁止通过删除历史权益完成退役。
- 组件下载的目标形态是 Pro 鉴权后的临时 manifest + 私有对象 + SHA-256。旧公网 CDN 资产只有在兼容插件发布且私有对象准备完成后才能退役。
- 当前不拍脑袋设置低频率限流；先记录付费接口调用和失败情况，出现真实异常基线后再加网关级限流。DeepSeek 密钥等供应商密钥只能保存在云函数环境变量中。

原因：

- 用户可用本地 coding agent 修改客户端判断，但不能因此获得服务端数据、云端付费能力和未来的私有组件下载地址。
- 强做本地 DRM 会增加正常 Pro 用户故障率，仍无法阻止有能力的用户复制本地文件。
- 历史内置码已有用户权益，直接删除或改写权益会误伤正常用户；先归档再禁用可以同时保留审计链路和现有到期时间。
- 当前最现实的白嫖入口是代码内置码、公网组件和服务端付费接口，而不是绑定码本身。

## 2026-07-10：短/长 CloudBase 环境暂时双轨，迁移必须无感

决策：

- 业务数据继续以短环境 `he02-d8gebzv050ed6c4ef` 为唯一数据源。
- 云函数部署在长环境 `he02-d8gebzv050ed6c4ef-d350b93bf` 时，必须显式读取短业务数据环境。
- 普通插件同步暂时保留短域名；飞书 OAuth、后台和迁移验证可使用长域名。
- 不再通过全量替换域名或强制用户重新绑定完成迁移。
- 后续迁移采用“同一数据源 + 双入口兼容 + 静默探测 + 失败回退 + 自有域名前门”。

原因：

- 历史绑定码和 Pro 权益都存在短业务数据环境。
- 上次直接统一时，长环境函数读错数据库，导致所有用户绑定码被误判失效。
- 绑定码是业务凭证，只要新旧 API 读取相同数据并保持鉴权契约，就可以沿用，不需要重新绑定。

详细结构和迁移阶段见 `docs/ARCHITECTURE.md`。

## 2026-07-11：本地 ASR/OCR Python 运行时直接使用固定 CDN 包

决策：

- OCR 安装器以及 macOS ASR 安装器不再把 `uv python install` 作为 Python 主安装路径。
- Windows、macOS 优先直接下载并验证腾讯云静态托管的固定 CPython `3.12.13+20260623` 安装包，再用该运行时创建 venv。
- OCR 依赖继续优先使用腾讯云 wheelhouse 离线安装；ASR 继续用 uv 安装 Python 包，但 uv 不再负责下载 Python。
- 已存在的系统 Python 只有版本不低于 3.10 时才会复用，避免 Pillow 12 在 Python 3.9 上失败。

原因：

- `UV_PYTHON_INSTALL_MIRROR` 使用的下载协议与上传的 python-build-standalone 文件命名不兼容；uv 0.9.14 会请求 `cpython-3.12-windows-x86_64-none`，而 CDN 只有可用的 `cpython-3.12.13+20260623-...-install_only.tar.gz`。
- 这会造成“文件已上传但 uv 找不到”的假镜像，Windows 和 macOS 都受影响。

## 2026-07-10：本地 Python/OCR 依赖优先走自有 CDN 镜像与离线 wheelhouse

决策：

- 本地转写安装器继续优先从腾讯云静态托管下载安装脚本和运行资产。
- uv 管理的 Python 运行时固定使用 python-build-standalone `20260623`，即 CPython `3.12.13+20260623`，并通过 `UV_PYTHON_INSTALL_MIRROR` 指向自有 CDN 镜像。
- 安装器显式设置 `UV_PYTHON_CPYTHON_BUILD=20260623`，避免 uv 选择随时间变化的 Python build。
- OCR Python 依赖固定为 `rapidocr-onnxruntime==1.4.4` 和 `pillow==12.3.0`，优先通过 CDN wheelhouse 使用 `--no-index --find-links` 离线安装。
- 已维护的 OCR wheelhouse 平台为 `win_amd64`、`macosx_11_0_arm64`、`macosx_11_0_x86_64`。macOS x64 以 macOS 11+ 为目标；低于该版本的极老 Intel macOS 可回退包索引安装。
- wheelhouse 不可用时，安装器再回退腾讯 PyPI 镜像，最后回退官方 PyPI。

原因：

- 用户安装失败集中在 uv 下载 Python、访问 GitHub 或访问 PyPI/rapidocr 依赖时。
- 只修安装调度不能解决网络不可达；必须把关键运行时和依赖包放到国内 CDN。
- 固定 Python build 与 wheel 版本可以让安装结果可复现，便于诊断和回滚。

## 2026-07-08：建立项目协作记忆文件

决策：

- 新增 `AGENTS.md` 作为项目上下文入口。
- 新增 `docs/WORKLOG.md` 记录当前稳定状态和最近改动。
- 新增 `docs/RUNBOOK.md` 记录运维和发布操作。
- 新增 `docs/RELEASE_CHECKLIST.md` 作为统一发布检查入口。

原因：

- 项目已经包含小程序、云函数、Obsidian 插件、管理后台、本地组件等多端。
- 新对话/新窗口容易忘记上下文，导致走旧路径或误改正常功能。

## 2026-07-08：广告全部走代码自主控制

决策：

- 微信后台智能接入广告关闭。
- 广告位可以在微信后台创建，但是否展示由小程序代码控制。
- Pro 用户不展示广告，Pro 状态未确认前默认不展示广告。

原因：

- Pro 权益包含免广告。
- 平台自动广告难以按 Pro 状态精准关闭。

## 2026-07-08：看广告加次数为 5 次

决策：

- 激励广告看完后增加 5 次同步次数。
- 分享解锁仍可到 10 次。

原因：

- 看广告加 10 次过高，影响 Pro 转化和免费额度边界。

## 2026-07-05：飞书文档优先走官方 API

决策：

- 已配置并授权飞书官方 API 的用户，飞书文档同步优先走官方 API。
- 未连接官方 API 时保留旧解析方式，但提示可能不完整。

原因：

- 旧解析方式对长文、图片、目录、动态加载内容不稳定。
- 官方 API 更适合完整获取标题、正文、图片和文档结构。

## 2026-07：插件发布源只认插件目录

决策：

- Obsidian 插件源码和发布资产以 `obsidian-plugin/wechat-inbox-sync/` 为准。
- 根目录 `main.js`、`manifest.json`、`versions.json` 不应作为人工修改的唯一依据。

原因：

- 历史上多次出现本地能用、上传后走旧逻辑、插件市场看不到版本的问题。
- 重复发布文件会增加误发布概率。

## 2026-07：本地转写组件走腾讯云 CDN

决策：

- 本地 ASR/OCR 安装脚本和必要安装资产优先放到腾讯云 CDN。
- GitHub 只保留插件源码和发布资产，不作为国内用户安装组件的主下载源。

原因：

- 国内用户访问 GitHub 不稳定。
- 本地组件安装失败会直接影响 Pro 用户体验。
## 2026-07-11: macOS ASR package source is pinned to Tencent CDN

- macOS ASR uses the fixed Tencent CDN Python runtime first, then installs the tested `whisper.cpp-cli==0.0.3` and `imageio-ffmpeg==0.6.0` wheels from the Tencent CDN wheelhouse for the detected CPU architecture.
- Public package indexes remain a final fallback only. This keeps first-time installation online, but removes PyPI/GitHub availability from the normal path.
- The CDN wheelhouse must keep both Apple Silicon (`macosx_11_0_arm64`) and Intel (`macosx_10_12_x86_64`) wheel sets in sync with the script pins.

## 2026-07-15：PDF 优先文本层，异常时自动本地 OCR

决策：

- PDF 先使用内置文本层提取，保证普通 PDF 快速且保留原始文字。
- 空文本、扫描版、特殊编码或疑似乱码文本层自动切换到本地 PDF OCR，不把连续乱码写入正式笔记。
- PDF OCR 使用 300 DPI 逐页渲染，按识别框位置恢复阅读顺序，并通过 OpenCC `t2s` 统一输出简体中文。
- PDF OCR 复用 Pro 本地组件权限；非 Pro 不因附件导入而获得本地 OCR 权限。
- 已安装的旧 OCR 组件在首次需要 PDF OCR 时自动升级；安装器和运行脚本必须同时具备 `PyMuPDF`、`opencc-python-reimplemented` 与 `pdf-page-ocr-v1` 能力标记。

原因：

- PDF 内嵌文字层可能存在自定义字形映射，表面上是汉字但语义完全错误，单纯“提取到中文”不能证明结果可读。
- 全部 PDF 都做 OCR 会显著变慢并降低数字、英文和排版准确率，因此 OCR 只作为质量检测后的自动回退。
- 在本地逐页 OCR 可避免把用户文件上传到额外云端，并与现有 Pro 本地组件模型保持一致。

## 2026-07-15：本地 ASR 不注入内容提示词，异常结果不得按成功保存

决策：

- Windows 与 macOS 本地 Whisper 只固定语言为中文，不再注入“请输出简体中文”等内容提示词；简体输出继续由转写后的繁转简处理保证。
- 本地转写完成后必须经过统一质量门：识别内部提示词泄漏、连续整句循环和高密度重复句。
- 对片尾音乐或静音产生的少量字幕语料幻觉，只能在转写末尾窗口命中高度特异的已知指纹时截断；不得用宽泛关键词或语义猜测清洗正文，也不得删除指纹之前的真实结束语。
- 单个媒体地址产生异常转写时，插件继续尝试同一记录中已解析到的下一个媒体地址；所有候选均失败时只记录失败原因，不生成转写正文。
- 该兜底链路保持纯本地，不因质量失败自动上传媒体或文本到云端转写服务。

原因：

- Whisper 在低信噪比、静音、音乐或错误媒体流上可能把提示词当作目标内容继续生成，并出现整句循环；仅判断“文本非空”会把幻觉误记为成功。
- 少量片尾幻觉可能不满足重复质量门，却会出现与正文无关的字幕制作、媒体署名或训练语料话术；使用终端窗口和组合指纹约束，能清除确定性污染而不牺牲正常口播召回率。
- 同一抖音页面经常能解析到多个音频/视频地址，先拒绝异常候选再换地址，比保存伪造文案或直接宣告整条失败更符合“解析成功优先”。
- 用户当前转写方案没有云端能力，质量兜底必须在本地闭环，不能把云端当作隐式依赖。
