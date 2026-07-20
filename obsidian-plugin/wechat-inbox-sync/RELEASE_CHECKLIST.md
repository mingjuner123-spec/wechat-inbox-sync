# Obsidian Community Plugin Release Checklist

## Before Publishing

- [ ] 发布只能来自干净工作区，且 `HEAD` 必须逐字等于当前 `origin/main`；旧分支、分叉 worktree、未提交文件和不在当前主线上的 tag 一律禁止发布。
- [ ] 推送版本 tag 前执行 `node scripts/release-source-guard.js --tag <version>`，确认根目录与正式插件目录版本均等于 tag，tag 提交也等于当前远端主线。
- [ ] 执行 `node scripts/update-local-components-manifest.js --check`；ASR/OCR 发布源有意变更时，必须先重新生成并审查正式插件目录中的 canonical manifest。
- [ ] 本地组件只允许通过 `powershell -ExecutionPolicy Bypass -File scripts/deploy-local-components.ps1 -Execute` 发布；禁止直接运行本地组件的 `tcb hosting deploy`。
- [ ] 部署顺序固定为：不可变 SHA-256 路径上传并双回读验证 → 再次确认主线提交未变化 → 更新兼容别名 → 上传 committed manifest → 通用公网完整性校验。
- [ ] 紧急 CDN 热修只有在完全相同的 canonical bytes 和 manifest 回写 `main` 后才算闭环；闭环前禁止发布下一插件版本。
- [ ] 版本号必须同时检查远端标签、默认分支、本机已安装插件和现存发布工作区；本机已安装或已打包的候选版本也视为已占用，即使它从未创建远端标签或 Release，也必须顺延新版本，禁止复用。
- [ ] 运行 `node scripts/check-local-components-cdn.js`，确认 ASR/OCR 的不可变路径、兼容别名、公开 manifest 和固定 Python 运行时均与 committed manifest/固定哈希一致；任一失败禁止推送 tag。
- [ ] CDN 与插件发布顺序固定为：主线提交与 CI 门禁 → 受控 CDN 部署 → 公网完整性回读 → tag/Release；禁止先发布插件、后补 CDN。
- [ ] Create a public GitHub repository for `wechat-inbox-sync`.
- [ ] Put `main.js`, `manifest.json`, `styles.css`, `versions.json`, `README.md`, and `LICENSE` in the repository.
- [ ] Confirm `manifest.json` uses the final plugin id: `wechat-inbox-sync`.
- [ ] Confirm the release tag is exactly `1.0.0`.
- [ ] Confirm the GitHub release uploads these assets:
  - `main.js`
  - `manifest.json`
  - `styles.css`
- [ ] Install the release through BRAT and test in a clean vault.
- [ ] Verify settings, binding, sync, file upload, webpage extraction, and audio transcription.
- [ ] Remove test keys or personal tokens before publishing.

## Community Plugins PR

Submit a pull request to `obsidianmd/obsidian-releases` and add this entry to
`community-plugins.json` after the GitHub repository is live:

```json
{
  "id": "wechat-inbox-sync",
  "name": "WeChat Inbox Sync",
  "author": "Zhang Zhang",
  "description": "Sync text, webpages, audio, and files from a WeChat mini program inbox into your vault.",
  "repo": "YOUR_GITHUB_USERNAME/wechat-inbox-sync"
}
```

Replace `YOUR_GITHUB_USERNAME/wechat-inbox-sync` with the real repository path.
