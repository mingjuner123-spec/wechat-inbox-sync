# WeChat Inbox Sync 1.3.86 release task

- Task ID: `plugin-release-1-3-86-001`
- Created: 2026-08-14
- Status: in progress
- Risk: L3 (short-environment syncApi deployment and public GitHub release)
- Branch: `codex/fix-transcription-diagnostic-1.3.86`
- Worktree: `.worktrees/fix-transcription-diagnostic-1.3.86`
- Authoritative repository: `https://github.com/mingjuner123-spec/wechat-inbox-sync`
- Base version: `1.3.85`
- Target version: `1.3.86`

## User authorization

The user explicitly authorized the short-environment deployment and plugin publication on 2026-08-14.

## Release scope

- Preserve detailed transcription failures instead of collapsing them to a generic message.
- Recover target-bound Douyin media through the authenticated session and strict hidden-browser fallback.
- Harden interrupted/slow media downloads with bounded idle and total timeouts.
- Allow repeated transcription of legacy Douyin webpage records without bypassing ordinary webpage dedupe.
- Publish the already-reviewed social rendering modularization without changing its public output contract.
- Synchronize the authoritative plugin source and root loose mirrors in one immutable release identity.

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
- Do not modify any installed plugin `data.json`, binding token, CloudBase business record, payment, or entitlement.
- If a defect is found after publishing, fix it only in a later incremented version; never mutate the immutable 1.3.86 assets.

## Acceptance criteria

- Short-environment `syncApi` is Active/Available and deployed code contains the legacy Douyin repeat rule.
- Manifest, runtime identity, versions map, root mirrors, candidate receipt, tag, remote `main`, Release assets, and ZIP all identify 1.3.86.
- The four root loose assets match the authoritative plugin source by SHA-256.
- Full plugin, marketplace package, release governance, source guard, and candidate identity checks pass.
- Independent review reports no open P0/P1 issue; any bounded non-blocking P2 is documented before publication.
- GitHub Release contains exactly `main.js`, `manifest.json`, `styles.css`, `versions.json`, and `wechat-inbox-sync-1.3.86.zip`.

## Execution record

- Short-environment `syncApi` deployed and read back Active/Available; deployed code hash matched the reviewed source.
- Independent final review: P0=0, P1=0, P2=1 (bounded refresh Promise may outlive the caller timeout for at most its own 12/18-second limit; follow-up resource-reclamation improvement, non-blocking).
- Plugin publication pending PR, CI, tag, and Release verification.
