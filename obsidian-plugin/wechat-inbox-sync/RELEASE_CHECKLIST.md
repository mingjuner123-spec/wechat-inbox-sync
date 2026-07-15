# Obsidian Community Plugin Release Checklist

## Before Publishing

- [ ] 版本号必须同时检查远端标签、默认分支、本机已安装插件和现存发布工作区；本机已安装或已打包的候选版本也视为已占用，即使它从未创建远端标签或 Release，也必须顺延新版本，禁止复用。
- [ ] 如果 `local-ocr/` 有变化，必须先上传 `install-local-ocr.ps1`、`install-local-ocr-macos.sh` 和 `ocr_image.py` 到腾讯云，再运行 `node scripts/check-local-ocr-cdn.js`；公网文件与发布源任一 SHA-256 不一致时禁止推送 tag。
- [ ] CDN 与插件发布顺序固定为：本地测试 → CDN 上传 → 公网回读 → main 版本更新 → tag/Release；禁止先发布插件、后补 CDN。
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
