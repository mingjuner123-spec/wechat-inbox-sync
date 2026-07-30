# 插件发布与本地候选管线 V2 设计

## 背景

插件 `1.3.74` 已经成为当前可回退的稳定锚点，但近期本地测试与发布暴露了四类基础设施问题：

1. 权威插件源码、根目录市场镜像和实际安装目录可能漂移，人工很难确认哪一份才是刚刚测试过的版本。
2. 本地测试直接覆盖安装目录，没有不可变候选快照；另一个任务继续修改文件后，最终发布物可能不再是用户测试过的那一份。
3. 部分权益测试用固定日历日期表示“仍然有效”，日期经过后测试会无业务改动地失败。
4. GitHub Release 和五项资产已经创建成功、远端标签也确为 annotated tag 时，Runner 本地标签形态仍可能让最后一步误报失败。

这些问题与 `main.js` 体积过大有关联：大文件使合并、审查和定位更慢，但它不是版本回退的直接原因。本任务先固定“测试了什么、发布了什么”，随后再回到 `main.js` 模块化主线。

## 目标

- 让本地测试、候选确认、根镜像和正式发布共享同一个内容身份证。
- 任何测试后的源码覆盖、镜像漂移或安装漂移都必须失败关闭。
- 保持 `obsidian-plugin/wechat-inbox-sync/` 为唯一人工维护源码。
- 消除测试对真实日期的依赖。
- 保留严格 annotated tag 门禁，同时消除 GitHub Runner 的本地标签误报。
- 整个阶段不改变用户可见的插件行为。

## 非目标

- 不拆分或重写 `main.js`。
- 不修复任何同步、平台提取、OCR、ASR、Pro、飞书或界面功能。
- 不替换当前用户插件，不创建新插件版本。
- 不部署 CloudBase，不更改真实用户数据。
- 不重构整个仓库或迁移 GitHub 仓库。

## 方案比较

### 方案 A：候选快照 + 单向晋升（采用）

从权威源码生成不可变候选目录和身份证。本地安装、哈希验证、根镜像生成与发布前门禁都围绕同一身份证工作。

优点是能证明“用户测试的内容就是后续发布内容”，还能在任何中途覆盖时及时阻断。实现范围集中在脚本、测试和工作流，不碰业务代码。

### 方案 B：只增加几个哈希比较命令

实现快，但哈希没有被固定为候选对象，测试完成后到发布前仍可能被覆盖；也无法可靠管理本地安装目录与根镜像。

### 方案 C：立即重构仓库和完整构建系统

长期可能更整洁，但会同时触及仓库边界、发布结构和业务源码，风险与工作量过大，也违背本阶段“冻结业务功能”的要求。

## 核心架构

```text
obsidian-plugin/wechat-inbox-sync/   唯一人工维护源码
                 │
                 ▼
       prepare candidate
                 │
                 ▼
.artifacts/plugin/<candidate-id>/    不可变本地候选
├─ candidate.json                    内容身份证
└─ package/                          实际待测发布文件
                 │
          ┌──────┴──────┐
          ▼             ▼
 install candidate   sync root mirror
          │             │
          ▼             ▼
本地 Obsidian 插件   根目录市场兼容文件
          └──────┬──────┘
                 ▼
        verify candidate
                 │
                 ▼
 promote candidate → release-candidate.json
                 │
                 ▼
       PR / main / tag / Release
```

候选目录位于根 `/.artifacts/`，实施时先用 `.gitignore` 精确忽略该目录；候选不进入 Git。它是测试过程中的冻结物，不是长期发布仓库。正式历史由提交内的 `release-candidate.json`、Git commit、annotated tag 和 GitHub Release 共同证明。

## 内容身份证

本地 `candidate.json` 分为确定性身份和非身份元数据。确定性身份只记录：

- 格式版本；
- 插件 ID 和计划版本；
- 候选 ID；
- 权威源码相对路径；
- loose assets 与 ZIP 完整文件集的 SHA-256、字节数和相对路径；
- 整组内容的聚合 SHA-256。

创建时间和创建时 Git HEAD 可以放在独立的 `provenance` 字段，不参与候选 ID、身份证摘要或复用判定。同一内容在不同时间或不同但内容等价的 HEAD 上生成时，确定性身份必须完全相同；只更新非身份元数据不得改写已存在候选。候选 ID、目录名和聚合哈希必须在读取时相互重算验证。

候选 ID 由插件版本和聚合哈希前缀组成，不用时间戳充当身份。文本文件在生成候选时统一为 LF；因此 Windows 与 Linux 对同一内容得到相同候选字节。候选生成后若目标目录已存在，受控包内容和确定性身份完全一致才允许复用，否则拒绝覆盖。

候选明确区分三组文件：

1. 市场 loose assets：`main.js`、`manifest.json`、`styles.css`、`versions.json`。
2. 本地实际安装集：Release ZIP 的全部文件。
3. Release ZIP 完整文件集：当前工作流定义的四个 loose assets、`README.md`、`LICENSE`、`local-asr/` 与 `local-ocr/` 下的全部文件。

ZIP 文件清单必须递归展开、排序并逐项身份化；工作流增加或删除 ZIP 文件时，候选检查必须要求同步更新清单。候选本地安装使用完整安装集，不能保留旧版 `local-asr/` 或 `local-ocr/` 目录冒充本次测试。

`data.json`、日志、缓存、本地组件安装目录和候选身份证本身都不得进入正式插件 ZIP。

## 组件职责

### `scripts/plugin-release-candidate-core.js`

纯函数层，负责：

- 路径白名单；
- LF 规范化；
- SHA-256 和聚合身份；
- 候选身份证构建与验证；
- 源码、候选包、根镜像、安装目标与晋升凭证的文件集合比较。

它不执行 Git、网络或文件写入，便于用真实临时目录做单元测试。

### `scripts/prepare-plugin-release-candidate.js`

从权威源码读取 loose assets 与 ZIP 完整文件集，验证 manifest/versions 版本一致后，在 `.artifacts/plugin/<candidate-id>/` 原子生成候选。

生成采用临时目录后重命名；失败时不得留下一个看似完整的候选。脚本不修改根镜像，也不安装插件。

### `scripts/install-plugin-release-candidate.ps1`

显式接收：

- 候选目录；
- 本地 Obsidian 插件目标目录。

安装前必须：

- 解析绝对规范路径，并要求路径尾部精确为 `.obsidian/plugins/wechat-inbox-sync`；
- 显式拒绝仓库根、权威源码、根镜像、`.artifacts/` 和候选目录内部的目标；
- 要求 Obsidian 进程已关闭；
- 验证候选身份有效。

安装完整受控文件集采用事务：先在目标同盘准备完整 staging，再备份目标中的受控文件和目录，替换全部受控集合并回读哈希；任何一步失败都恢复全部受控集合，禁止留下新旧混合版本。`data.json` 和其他非受控用户文件始终不读取、不移动、不删除、不纳入哈希比较。

脚本不得猜测知识库路径，不得扫描用户目录。

### `scripts/sync-plugin-release-mirror.js`

根目录镜像只允许从权威源码单向生成：

- `--check`：只读比较，漂移即失败；
- `--write`：把权威源码的四个文件写入根目录。

CI 和发布使用 `--check`。日常开发不再手工编辑根镜像。

### `scripts/promote-plugin-release-candidate.js`

只在用户完成本地测试后运行。它先验证本地候选、权威源码、根镜像和指定安装目标仍一致，然后写入确定性的根 `release-candidate.json`。该晋升凭证记录插件版本、候选 ID、完整文件清单和聚合哈希，不记录本机路径、时间或用户数据。

`release-candidate.json` 进入 Git，成为候选跨越提交、PR、合并和 tag 的凭证。main guard、prepublish 和 postpublish 都必须从当前受信 commit 重新计算完整包身份并与它比较；任何后续源码改动若没有经过新候选测试和重新晋升都会被阻断。

### `scripts/verify-plugin-release-candidate.js`

读取候选身份证并按参数验证：

- 权威源码；
- 候选包；
- 根镜像；
- 可选的本地安装目录。
- 可选的提交内晋升凭证。

候选包、权威源码 ZIP 文件集和晋升凭证采用精确集合校验；根镜像采用精确四文件集合校验；安装目录只校验完整受控安装集，允许并忽略 `data.json` 与其他非受控用户文件，但绝不读取它们。任一受控对象有新增、缺失、哈希或版本漂移即失败。脚本不自动修复、不自动复制，也不发布。

## 本地测试与晋升流程

1. 开发完成后，从权威源码准备候选。
2. 用安装脚本把该候选装入明确的本地 Obsidian 插件目录。
3. 用户进行真实功能测试。
4. 用户确认通过后，再次运行候选验证。
5. 运行晋升命令，只有源码、候选、根镜像和安装目标仍一致时才生成 `release-candidate.json`。
6. 提交、PR 与 main guard 从仓库内容重算身份并校验晋升凭证。
7. prepublish 从 tag commit 重算身份并校验晋升凭证；Release ZIP 只从该已验证 commit 构建。
8. 任一其他任务改写受控源码后，晋升凭证校验失败；必须重新生成候选并重新测试，不能把旧测试结论沿用到新内容。

本任务不自动执行提交之后的外部动作，只建立可供后续发布任务调用的失败关闭门禁。

## 根镜像规则

根目录四个文件继续保留，因为公开 Obsidian 插件仓库和 GitHub Release 仍依赖它们。它们不再是第二套源码：

- 人只改插件子目录；
- 脚本从插件子目录生成根镜像；
- CI 拒绝任何未同步的根镜像；
- 发布工作流只在镜像与权威源码逐字节一致时继续。

因此本阶段不删除根文件，也不会让插件市场失去读取入口。

## 时间稳定测试

生产代码不改。测试层增加固定时钟辅助函数：

- 需要“有效权益”的用例固定 `Date.now()`，并用相对该时钟的未来时间；
- 需要“已过期”的用例使用相对该时钟的过去时间；
- 测试结束必须在 `finally` 中恢复原始 `Date.now`；
- 只用于展示固定历史字符串、与有效性无关的日期可以保留，但要在用例名称或注释中说明用途。

禁止再用“写测试当天看起来在未来”的固定日期表达有效状态。

## 发布后 annotated tag 校验

门禁分成两个阶段：

### prepublish

发布前仍必须严格检查本地标签：

- 标签存在；
- 本地对象类型为 `tag`，拒绝 lightweight tag；
- peeled commit 等于当前受信默认分支提交；
- 从该 tag commit 读取并重算完整候选身份，与提交内 `release-candidate.json` 一致；
- 远端同名标签与 Release 尚不存在。

### postpublish

发布后以远端 GitHub 身份为权威：

- GitHub Git Ref API 返回远端 tag-object SHA；
- GitHub Git Tag API 用同一 tag-object SHA 证明对象为 annotated tag，并指向受信 commit；
- `git ls-remote` 的未剥离 tag-object SHA 与剥离 commit SHA 分别和 API 结果一致；
- Release target、五项资产和 ZIP 内容一致。
- 所有资产与 ZIP 期望字节都从已验证的受信 commit SHA 读取，不从本地 `refs/tags/<version>` 读取。
- 标签、默认分支与 Release 身份在发布后多次采样间保持稳定；采样间移动即失败。

postpublish 不再要求 Runner 本地 `refs/tags/<version>` 必须是 annotated 对象。Runner 可以处于 detached checkout，或本地只存在工作流生成的轻量引用；只有远端三方绑定、受信 commit、晋升凭证、Release 与资产全部一致才通过。它仍检查本地 HEAD 与发布资产内容，不能用此变化绕过版本身份校验。

## 工作流调整

`main-guards.yml` 增加：

- 根镜像 `--check`；
- 晋升凭证与完整 ZIP 文件集 `--check`；
- 候选核心与脚本语法检查；
- 候选管线测试；
- 时间稳定回归测试。

新增 PowerShell 安装脚本必须加入 Linux 与 Windows 的 PowerShell parser 清单。`windows-deployer` 在 `windows-latest` 上实际执行候选安装、完整回滚、错误目标拒绝和 `data.json` 原样保留测试；Linux job 只做跨平台静态/纯 Node 验证，不能代替 Windows 行为证据。

`release.yml` 保持“先完整门禁、后创建 Release、最后回读”的顺序。打包文件集直接来自已验证 tag commit 并与晋升凭证一致；最后一步调用远端权威 postpublish 模式，不再依赖 Runner 本地标签对象类型。

本任务不会触发工作流，也不会创建新 Release。

## 错误处理

- 候选目录已存在但内容不同：拒绝覆盖。
- ZIP 文件集与工作流声明不一致：候选生成或发布失败。
- manifest/versions 版本不一致：候选生成失败。
- 安装目标不符合 `.obsidian/plugins/wechat-inbox-sync` 或落入仓库/候选目录：安装失败。
- 安装中断：恢复全部受控文件，`data.json` 和非受控文件保持原样；回滚失败时明确报告且不宣称成功。
- 测试后源码、根镜像或晋升凭证改变：验证失败并要求重新生成、重新测试。
- GitHub API 无法证明远端 annotated tag：postpublish 失败关闭。
- 只有本地标签形态异常而远端权威证据完整：postpublish 不误报。

## 测试设计

### 候选管线

- 相同内容在 CRLF/LF 输入下产生相同候选字节与身份。
- 候选完整覆盖 loose assets 和 Release ZIP 文件集。
- 候选目录不可用不同内容覆盖。
- 候选 ID、目录名和聚合哈希互相不匹配时失败。
- 同内容、不同 provenance 仍得到同一确定性身份。
- 源码、根镜像、候选包、安装目标和晋升凭证一致时通过。
- 修改、删除或新增受控文件后失败。
- 安装完整替换本地组件目录，不保留旧 ASR/OCR 文件。
- 安装成功保留 `data.json` 原始字节；中途失败回滚全部受控文件并保留 `data.json`。
- 源码目录、候选目录、普通同名目录和正在运行 Obsidian 时均拒绝安装。
- 上述 PowerShell 行为在 `windows-latest` 实跑。

### 时间稳定

- 固定时钟下有效权益始终有效。
- 固定时钟下过期权益始终过期。
- 用例结束后真实 `Date.now` 被恢复。
- 测试文件不再用临近日期表达“有效”。

### 发布身份

- prepublish 继续拒绝 lightweight tag。
- postpublish 在本地标签缺失或为轻量引用、远端为正确 annotated tag 时通过。
- postpublish 的期望资产从已验证 trusted commit SHA 读取。
- 远端 lightweight tag、API/`ls-remote` tag-object 不一致、tag 对象指向错误 commit、跨采样 tag 移动、Release target 漂移或资产漂移仍失败。

### 回归

- `node tests/plugin-release-candidate.test.js`
- `node tests/plugin-release-identity.test.js`
- `node tests/release-governance.test.js`
- `node tests/plugin-main-ai.test.js`
- `node tests/plugin-marketplace-package.test.js`
- 相关脚本 `node --check`

## 验收标准

1. 不存在插件业务文件的行为差异。
2. 可以从权威源码生成覆盖实际 ZIP 全集的不可变候选并安装到指定测试目录。
3. 用户设置文件不被候选安装覆盖；安装失败不会留下新旧混合受控文件。
4. 测试完成后任意受控内容被改动，晋升凭证、CI 或发布门禁立即失败。
5. 根镜像只能由权威源码生成，CI 能阻断漂移。
6. 权益测试不随日历推进而失效。
7. GitHub Runner 的本地标签形态不再导致有效 Release 末尾误报，远端标签安全性没有放宽。

## 推进顺序

1. 先按 TDD 完成候选核心、候选生成、安装与验证。
2. 再实现候选晋升凭证、根镜像单向同步和 CI 门禁。
3. 再修复时间依赖测试。
4. 最后修复 postpublish 远端权威校验并跑完整定向回归。
5. 本地验收通过后交给用户测试，不发布。
6. 用户确认基础设施可用后，才另立外部发布/合并任务。
7. 随后回到 `main.js` 的系统阅读、项目地图和模块化主线。
