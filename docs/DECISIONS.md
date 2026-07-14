# Engineering decisions

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
- 单个媒体地址产生异常转写时，插件继续尝试同一记录中已解析到的下一个媒体地址；所有候选均失败时只记录失败原因，不生成转写正文。
- 该兜底链路保持纯本地，不因质量失败自动上传媒体或文本到云端转写服务。

原因：

- Whisper 在低信噪比、静音、音乐或错误媒体流上可能把提示词当作目标内容继续生成，并出现整句循环；仅判断“文本非空”会把幻觉误记为成功。
- 同一抖音页面经常能解析到多个音频/视频地址，先拒绝异常候选再换地址，比保存伪造文案或直接宣告整条失败更符合“解析成功优先”。
- 用户当前转写方案没有云端能力，质量兜底必须在本地闭环，不能把云端当作隐式依赖。
