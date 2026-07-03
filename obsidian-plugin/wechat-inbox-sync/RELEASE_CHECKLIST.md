# Obsidian Community Plugin Release Checklist

## Before Publishing

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
