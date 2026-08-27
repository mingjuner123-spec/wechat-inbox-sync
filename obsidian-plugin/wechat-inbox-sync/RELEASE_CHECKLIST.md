# WeChat Inbox Sync 发布清单

本清单与仓库内发布治理脚本、GitHub Actions 共同构成插件公开仓库的发布门禁。

## 已测试候选包晋升

- [ ] 在仓库根目录运行 `npm ci --prefix obsidian-plugin/wechat-inbox-sync`，使用 lockfile 固定的构建工具链。
- [ ] 运行 `node tests/plugin-build-foundation.test.js`，确认 `src/*` 与正式单文件 `main.js` 没有构建漂移。
- [ ] 从唯一发布源执行 `node scripts/prepare-plugin-release-candidate.js --source obsidian-plugin/wechat-inbox-sync --artifacts-root .artifacts/plugin --json-out .artifacts/candidate-result.json`。
- [ ] 使用 `scripts/install-plugin-release-candidate.ps1` 将完整候选包事务式安装到本地测试库；不得只替换 `main.js`，不得覆盖用户的 `data.json`。
- [ ] 用户本地验收后，运行 `node scripts/verify-plugin-release-candidate.js`，同时核对候选包、权威源码、已安装插件和根目录镜像。
- [ ] 运行 `node scripts/sync-plugin-release-mirror.js --write --source obsidian-plugin/wechat-inbox-sync --root .`；根目录四文件只是自动生成镜像，不允许手改。
- [ ] 运行 `node scripts/promote-plugin-release-candidate.js` 生成 `release-candidate.json`。只有这个已测试身份允许进入提交、PR、tag 和 Release。
- [ ] CI 必须重新准备候选包并用 `--verify-promotion release-candidate.json` 验证；任何字节漂移都停止发布。

## 发布源与版本身份

- [ ] 正式仓库固定为 `mingjuner123-spec/wechat-inbox-sync`，插件发布源固定为 `obsidian-plugin/wechat-inbox-sync/`。
- [ ] 只允许从干净发布工作区执行发布，且 `HEAD` 必须逐字节等于当前 `origin/main`。
- [ ] 根目录和插件目录的 `manifest.json`、`versions.json` 必须一致，目标版本不得与远端标签、Release、本机已安装或已打包候选版本重名。
- [ ] 当前发布目标使用动态版本号（本次为 `1.3.129`）；禁止复用、覆盖或重建已有 tag/Release。
- [ ] 在确认合并后的 `main` 和发布工作区完全一致后，先创建本地 annotated tag（暂不推送），再依次运行：
  - `node scripts/release-source-guard.js --tag <version>`
  - `node scripts/check-plugin-release-identity.js --prepublish --tag <version>`
- [ ] 上述两项通过后才允许推送 tag；Release 工作流结束后运行：
  - `node scripts/check-plugin-release-identity.js --postpublish --tag <version>`
- [ ] GitHub Release 必须精确包含五项资产：
  - `main.js`
  - `manifest.json`
  - `styles.css`
  - `versions.json`
  - `wechat-inbox-sync-<version>.zip`

## 本地组件与向后兼容

- [ ] 运行 `node scripts/update-local-components-manifest.js --check`；ASR/OCR 发布源有意变化时，先重新生成并审查 canonical manifest。
- [ ] 本地组件禁止再发布到 CloudBase 静态网站托管；插件源码、生成包和安装脚本不得包含 `tcloudbaseapp.com` 或其他公开 CloudBase 组件直链。
- [ ] 组件对象只能上传到已回读确认为“私有读”的云存储；ACL 为公有读、未知或无法回读时立即停止，不上传对象、不发布插件。
- [ ] 私有对象、数据库 manifest 与插件内置标准的 `fileName`、`byteLength`、SHA-256 必须逐项一致；API 只在服务端复核 Pro 与绑定后签发 3–15 分钟授权地址。
- [ ] 运行 `node scripts/check-local-component-access-policy.js`；发布工作流不得执行已退役的 `check-local-components-cdn.js` 或公开 CDN 部署器。
- [ ] 插件提高本地组件推荐版本或能力标记时，不得仅因版本较旧就停用已安装组件。必须区分“当前”“已知兼容、建议升级”“明确不兼容”；只有缺失、损坏或有测试证据的明确不兼容才允许阻断。
- [ ] 上一受支持 Windows ASR 正式脚本在安装器请求成功、HTTP 418、超时和随包安装器缺失时，都必须保持原有 `ready` 状态；网络失败不得触发大型组件删除或重装。
- [ ] 正式历史脚本必须以规范化 SHA-256 身份识别，不能只依赖能力字符串；保留标记但内容损坏、语法残缺或来源未知的脚本必须失败关闭。
- [ ] Windows ASR 脚本更新必须使用候选文件和短期备份；最终验证通过前可回退，完成状态写入后清理失败只能告警，不得删除已验证的新脚本或重新触发回退。

## 私有组件源回退

- [ ] 部署前记录上一正式版本的私有对象 fileID、SHA-256、大小、数据库 manifest 和 ACL 回读结果。
- [ ] 如果私有对象上传、哈希回读、临时 URL 过期验证或 Pro 鉴权任一失败，立即停止，不启用 manifest、不推送 tag 或 Release。
- [ ] 新 manifest 必须先以非 active 状态写入并逐项回读；只有端到端授权下载验证通过后才允许原子切换 active 版本。
- [ ] 如果 tag/Release 已发布，禁止覆盖原发布；组件源如需回切，只切回上一份已验证的私有 manifest，插件修复必须递增到更高版本。

## 回归与安全

- [ ] 运行插件核心、市场包、发布治理、发布身份、语法、组件访问策略和私有 manifest 契约校验。
- [ ] 第三方平台提取不得仅因“可能误抓推荐内容”新增失败关闭。新增阻断必须附真实事故、脱敏复现样本、历史可用对照和用户影响；身份不完整、候选较多或诊断标签只能用于排序、诊断或备用路径。
- [ ] Windows 与 macOS 分别验证安装、检测、失败恢复和已有用户升级路径。
- [ ] 验证设置、绑定、同步、文件上传、网页提取和音视频转写。
- [ ] 确认仓库与发布资产不包含测试密钥、个人 token、缓存、备份或临时文件。

## Obsidian 社区插件登记

Obsidian `community-plugins.json` 登记已经指向正式仓库，仓库迁移前不得自行修改：

```json
{
  "id": "wechat-inbox-sync",
  "name": "WeChat Inbox Sync",
  "author": "Zhang Zhang",
  "description": "Sync text, webpages, audio, and files from a WeChat mini program inbox into your vault.",
  "repo": "mingjuner123-spec/wechat-inbox-sync"
}
```
