# WeChat Inbox Sync 1.3.80 release task

- Task ID: `plugin-release-1-3-80-001`
- Created: 2026-08-11
- Status: in progress
- Risk: L3 (public GitHub release and marketplace update)
- Branch: `codex/plugin-release-1.3.80`
- Worktree: `.worktrees/plugin-release-1.3.80`
- Authoritative repository: `https://github.com/mingjuner123-spec/wechat-inbox-sync`
- Base version: `1.3.79`
- Target version: `1.3.80`

## User authorization

The user explicitly authorized publishing this tested local candidate on 2026-08-11.

## Release scope

- Publish the locally tested plugin architecture split without changing user-visible behavior.
- Localize WeChat public-account article images and filter duplicate/decorative image variants.
- Prevent false successful sync outcomes and preserve retryable failure evidence.
- Add explicit WeChat public-account security-verification and extraction-failure diagnostics.
- Reconcile interrupted/completed sync outcomes without changing CloudBase data or deploying cloud functions.
- Synchronize the authoritative plugin assets and root loose mirrors in one commit.

## Allowed paths

- `.github/workflows/`
- `docs/`
- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/`
- `scripts/`
- `tests/`

## Stop and rollback conditions

- Stop before publishing if any targeted regression, full plugin regression, marketplace package, release governance, candidate identity, or independent review gate fails.
- Do not overwrite, move, delete, or recreate an existing tag or GitHub Release.
- Do not deploy CloudBase/CDN or read/modify real user data in this release.
- Do not replace or modify any installed plugin `data.json`.
- If a defect is found after publishing, fix it only in a later incremented version; never mutate the immutable 1.3.80 assets.

## Acceptance criteria

- Manifest, runtime identity, versions map, root mirrors, candidate receipt, tag, remote `main`, Release assets, and ZIP all identify 1.3.80.
- The four root loose assets match the authoritative plugin source by SHA-256.
- Architecture, WeChat article image, sync-history, plugin core, marketplace package, and release governance regressions pass.
- Independent review reports no open P0/P1/P2 issue.
- GitHub Release contains exactly `main.js`, `manifest.json`, `styles.css`, `versions.json`, and `wechat-inbox-sync-1.3.80.zip`.

## Execution record

- Pending.
