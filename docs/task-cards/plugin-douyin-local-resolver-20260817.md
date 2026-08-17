# 抖音本地解析组件与受控 CDN 镜像

- Task ID: `plugin-douyin-local-resolver-20260817`
- Status: in progress
- Risk: L3 (the implementation is local; publishing the plugin and immutable CDN assets is separately authorized external work)
- Branch: `codex/douyin-cold-start-1.3.94`
- Base: `1.3.93@ff4871c5`

## Goal

When the existing anonymous/browser pathways cannot obtain Douyin media, run a SHA-256 verified local yt-dlp binary with only the plugin's persisted Douyin session. Older users keep their existing anonymous path; a login is requested only when Douyin explicitly requires fresh cookies.

## Allowed paths

- `obsidian-plugin/wechat-inbox-sync/src/main.js`
- `obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils.js`
- `obsidian-plugin/wechat-inbox-sync/main.js`
- `obsidian-plugin/wechat-inbox-sync/manifest.json`
- `obsidian-plugin/wechat-inbox-sync/versions.json`
- `tests/local-douyin-resolver-utils.test.js`
- `tests/plugin-douyin-media.test.js`
- `scripts/sync-douyin-resolver-mirror.js`
- `.github/workflows/mirror-douyin-resolver.yml`
- `docs/superpowers/specs/2026-08-17-douyin-local-resolver-design.md`
- `docs/superpowers/plans/2026-08-17-douyin-local-resolver.md`
- this task card

## External authorization and safeguards

- The owner authorized deployment and plugin publication after implementation on 2026-08-17.
- Only the long CloudBase static-hosting environment is in scope: `he02-d8gebzv050ed6c4ef-d350b93bf`.
- Never upload user media, source URLs, Cookie files, or cookies. CDN objects are official yt-dlp binaries plus hash manifest only.
- Immutable binaries are uploaded and publicly hash-verified before `yt-dlp/latest.json` changes.
- The plugin release remains a separate immutable tag/release action after full build and regression checks.

## Acceptance

1. Client checks resolver updates at most once per 48 hours except an extractor-specific stale failure.
2. Cookie export uses only the plugin session, is temporary, and is deleted in `finally`.
3. Existing extraction succeeds without invoking yt-dlp; yt-dlp runs only after current stages fail.
4. Diagnostics include stage/rejection category without Cookie, headers, or media URL.
5. CDN binary and manifest SHA-256 checks pass before client replacement.
