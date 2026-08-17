# Douyin Local Resolver Implementation Plan

> **Superseded on 2026-08-17:** Do not auto-install, periodically check, or schedule CDN mirroring for yt-dlp. The component is optional, installed/updated only by an explicit settings action after plugin-session login has still failed. Keep the mirror script only for deliberate manual updates.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locally installed yt-dlp resolver for Douyin while only asking users to log in after a confirmed Douyin challenge.

**Architecture:** A small utility module owns the 48-hour update decision, CDN manifest validation and hash checks. The plugin keeps the binary under the existing ASR root, exports only its own Electron Douyin session to a temporary Cookie file, invokes yt-dlp after existing resolution fails, then preserves the current fallback note. A scheduled GitHub workflow mirrors official releases to CDN; no user media or Cookie enters cloud services.

**Tech Stack:** Node.js, Electron session cookies, child_process.execFile, crypto SHA-256, GitHub Actions, CloudBase static hosting.

---

### Task 1: Resolver policy utility

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils.js`
- Create: `tests/local-douyin-resolver-utils.test.js`

- [ ] Write a failing test for the 48-hour cache and forced extractor-only check:

```js
assert.equal(shouldCheckLocalDouyinResolver({ now: 1720000000000, lastCheckedAt: 0 }), true);
assert.equal(shouldCheckLocalDouyinResolver({ now: 1720000000000, lastCheckedAt: 1719900000000 }), false);
assert.equal(shouldCheckLocalDouyinResolver({ now: 1720000000000, lastCheckedAt: 1719900000000, force: true }), true);
assert.equal(shouldForceLocalDouyinResolverCheck(new Error('yt-dlp extractor is outdated')), true);
assert.equal(shouldForceLocalDouyinResolverCheck(new Error('fresh cookies are needed')), false);
```

- [ ] Run `node tests/local-douyin-resolver-utils.test.js`; expect `MODULE_NOT_FOUND`.
- [ ] Implement and export:
  `LOCAL_DOUYIN_RESOLVER_CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000`,
  `shouldCheckLocalDouyinResolver({ now, lastCheckedAt, force })`, and
  `shouldForceLocalDouyinResolverCheck(error)`.
- [ ] Re-run the focused test; expect exit code 0.
- [ ] Commit: `feat: add Douyin local resolver update policy`.

### Task 2: Trusted CDN manifest selection

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils.js`
- Modify: `tests/local-douyin-resolver-utils.test.js`

- [ ] Write a failing test that accepts only schema version 1 assets keyed by `win32-x64`, `darwin-arm64`, or `darwin-x64`, with HTTPS URL and 64-character SHA-256.
- [ ] Run the focused test; expect missing `selectLocalDouyinResolverAsset`.
- [ ] Implement `isValidSha256(value)` and `selectLocalDouyinResolverAsset(manifest, platform, arch)`; return `null` on untrusted or unsupported assets.
- [ ] Re-run the focused test; expect exit code 0.
- [ ] Commit: `feat: validate Douyin resolver manifests`.

### Task 3: Local binary, temporary Cookie file, and yt-dlp runner

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-douyin-media.test.js`

- [ ] Write failing tests for:
  - `getLocalDouyinResolverRoot(home, platform)` returning `<existing-asr-root>/tools/yt-dlp`;
  - Netscape Cookie file conversion;
  - temporary Cookie file removal after runner success and failure;
  - SHA mismatch never replacing an existing binary.
- [ ] Run `node tests/plugin-douyin-media.test.js`; confirm these helper assertions fail.
- [ ] Implement download to a temporary file, SHA-256 validation, atomic rename, and `execFile(binary, ['--cookies', tempCookiePath, '--dump-single-json', '--no-playlist', pageUrl])`. Export only Cookie data from `getDouyinSession()`; remove the temporary file in `finally`.
- [ ] Re-run the focused test; expect exit code 0.
- [ ] Commit: `feat: run Douyin resolver locally`.

### Task 4: Failure-only resolver fallback and login prompt

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/social-media-diagnostic-utils.js`
- Modify: `tests/plugin-douyin-media.test.js`
- Modify: `tests/social-media-diagnostic-utils.test.js`

- [ ] Write failing integration tests proving:
  - existing page media skips yt-dlp;
  - no media then yt-dlp media selects stage `local-yt-dlp`;
  - only `DOUYIN_CHALLENGE` / fresh-Cookie error prompts plugin login;
  - extractor outdated records update diagnostics but does not prompt login.
- [ ] Run both focused test files and confirm the new assertions fail.
- [ ] Invoke the local resolver only after existing media stages exhaust. Record only resolver version, manifest version, last check time, source and bounded error class. Never log Cookie value, request headers or media URL.
- [ ] Keep `buildDouyinFallbackMarkdown` for all unresolved media so title/link/text still synchronize.
- [ ] Re-run both focused test files; expect exit code 0.
- [ ] Commit: `fix: fall back to local Douyin resolver`.

### Task 5: Automatic official-release to CDN mirror

**Files:**
- Create: `.github/workflows/mirror-ytdlp-cdn.yml`
- Create: `scripts/mirror-ytdlp-cdn.mjs`
- Create: `tests/ytdlp-cdn-manifest.test.js`

- [ ] Write a failing test for `buildYtDlpCdnManifest`: it emits schema version 1, immutable versioned asset paths, and a complete platform/hash map.
- [ ] Run `node tests/ytdlp-cdn-manifest.test.js`; expect `MODULE_NOT_FOUND`.
- [ ] Implement a script which downloads only declared official yt-dlp release assets, verifies official checksums, uploads immutable assets first via `tcb hosting deploy -e $TCB_ENV_ID`, then publishes `yt-dlp/latest.json` last.
- [ ] Add a GitHub Actions scheduled workflow (every 12 hours) and manual dispatch. It uses only repository Secrets for CDN credentials and `TCB_ENV_ID=he02-d8gebzv050ed6c4ef-d350b93bf`.
- [ ] Re-run manifest test and `node --check scripts/mirror-ytdlp-cdn.mjs`; expect exit code 0.
- [ ] Commit: `build: mirror official yt-dlp releases to CDN`.

### Task 6: Package and publish

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Generated/synced: root `main.js`, `manifest.json`, `styles.css`, `versions.json`

- [ ] Fetch official `origin/main` and tags; choose the next unused patch version without overwriting an existing tag.
- [ ] Run: `npm run build`, `npm run check`, the three new/focused tests, `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, and `node --check obsidian-plugin/wechat-inbox-sync/main.js`.
- [ ] Run `node scripts/sync-plugin-release-mirror.js --write --source obsidian-plugin/wechat-inbox-sync --root .` and verify four loose mirror asset hashes.
- [ ] As a separately authorized L3 action, verify the official source is a clean fast-forward, validate static CDN access only in the long deployment environment, publish a new immutable tag/Release, then read back release and mirror identity. Never read or modify short business data.
