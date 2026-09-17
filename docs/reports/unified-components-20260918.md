# 本地组件统一安装修复候选

日期：2026-09-18。任务：unified-components-20260918，L2 本地交付。

## 结果与范围

- ASR、OCR、抖音解析统一到「安装／更新本地组件」，删除单独的抖音安装按钮。
- 一次确认后补齐所有缺失项；健康组件复用。单项失败继续处理其他项，保留成功项，重试补齐未完成项。权限拒绝立即停止。
- 三项完整时，手动入口可检查抖音解析器更新；同哈希文件不重复下载。被动检查不下载。
- 抖音解析优先请求腾讯云 cloudbase-v1 授权清单，网络不可用时尝试官方 GitHub 清单及资源；应用内下载证书链出错可切换系统 HTTPS 下载。始终保留证书验证与 SHA-256 校验。
- 401/403/429、升级要求及文件完整性失败不切换来源；已就绪旧文件在更新失败时保留，失败本身仍如实报告。
- 安装诊断保存最近 30 条分阶段事件：版本、平台、来源、传输方式、主机名和错误码；不保存签名 URL、绑定令牌或私密内容。

不改变 ASR/OCR 安装器与运行时算法。Windows ASR 无可信腾讯清单时仍保留进度并停止，未新增未经哈希校验的官方二进制备用路径。统一入口不等于三种组件的下载器完全相同。

## 已核实原因

用户截图的 `unable to verify the first certificate` 来自抖音增强解析组件下载，不能据此归因为内存不足、Pro 到期或 ASR 转写本身失败。

历史代码显示：1.3.95—1.3.118 使用旧腾讯清单；1.3.119 改 GitHub 优先，旧腾讯备用；1.3.129 移除旧公开来源时抖音未接入 ASR/OCR 使用的授权分发，1.3.156 仍如此。当前证据不支持“最近小红书评论区诊断修改导致回退”的判断。

## 候选与权威基线

- 分支：codex/unified-components-20260918。
- 基线：公开仓库 main 的 d1d68ad20de20d4269a801e1244d0c824169d113 / 1.3.156。
- 工作树：.worktrees/unified-components-20260918。
- 插件源码：src/main.js、src/local-douyin-resolver-utils.js；main.js 由 build-plugin.js 生成，工作树根 main.js 与插件 bundle 字节一致。
- Bundle SHA-256：bc8612fcce607cf5a43ee6f9846527551a956c2e1326b6ccbb1ce784ea69a0a3。
- 尚未提升版本、提交公开仓库或发布。综合工程原脏镜像、用户已安装插件与 data.json 均未替换。

## 私有分发准备

综合工程 `.artifacts/unified-components-20260918/backend/` 保存精确候选与说明，不进入公开插件仓库：

- syncApi 三文件仅扩展 douyin/resolver 白名单，保留权益、cloudbase-only、旧协议拒绝及日限 4 次。基于 9 月 16 日部署后本地回读包，含 before/after 哈希。
- Windows x64、macOS x64/arm64 三份清单；两个 yt-dlp 2026.08.19 官方二进制已下载，与官方 SHA2-256SUMS 和发布大小匹配。
- 继续使用现有长环境私有 CloudBase 对象与短时签名，不恢复独立 COS 分发或公开 CDN。
- 资源上传、长环境 catalog 合并、短环境清单及 syncApi 部署均未执行。后续部署必须先对比最新线上状态，保留当时回退包，不能拿旧包覆盖后续其他修改。

## 验证

- `node obsidian-plugin/wechat-inbox-sync/build-plugin.js`、bundle 语法及 `git diff --check` 通过。
- 18 个相关回归文件全部通过，覆盖插件主流程、ASR/OCR 安装路由、实际 Windows curl 断点续传、Mac Bash 恢复参数、抖音媒体和浏览器安全等。
- `tests/plugin-unified-components.test.js`：43 项行为检查，包括三项可用性 8 种组合、逐项失败/重试、并发共享、授权与 HTTP 拒绝、系统 curl TLS 参数、缓存损坏、同哈希复用、新版替换、更新失败保留与提交回滚。
- 私有 `backend/test-candidate.cjs`：41 项断言通过，实际候选处理器的权限/限流/协议拒绝、三平台资产校验和 Ed25519 清单签名兼容性均以合成身份验证。
- 原 macOS Bash 测试在 Windows 沙箱内因临时目录权限失败；同一隔离测试在沙箱外通过。没有以跳过断言换取通过。
- 回归日志：`.artifacts/unified-components-20260918/tests/`，哈希：`candidate-hashes.json`。
- 独立审查结论：GO，仅限本地候选交付；P0=0、P1=0、P2=0，已核对上述源码与 bundle 哈希。

## 未完成的外部验收与下一步

当前未部署、未发布，也未在反馈用户的电脑重测。安装证书链问题有明确修复路径，但不能承诺它解决所有平台解析或转写失败。

下一步是按候选 backend/README.md 完成经授权的私有资源部署与新插件版本发布，再由故障设备统一安装后复测。发布前需重新核实公开 main，分配未使用版本、跑发布门禁并同步综合工程镜像。
