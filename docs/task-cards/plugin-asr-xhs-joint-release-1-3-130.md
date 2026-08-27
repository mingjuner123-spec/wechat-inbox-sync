# Task card: plugin-asr-xhs-joint-release-1-3-130

- Risk level: L3
- Status: candidate verified; independent review and publication pending
- Release authority: latest clean public `mingjuner123-spec/wechat-inbox-sync` `main`
- Target version: `1.3.130`, subject to a final remote vacancy check immediately before publication

## User authorization

The user explicitly authorized combining the ASR installer-process automatic recovery update with the Xiaohongshu hidden-window, Cookie-gate, and safe-diagnostic update, then completing the existing protected-main PR/merge, numeric annotated tag, GitHub Release, five formal assets, and post-release readback flow without asking again.

## Allowed changes

- ASR installer recovery logic and its regression tests.
- Xiaohongshu automatic-browser hiding, no-Cookie early return, redacted diagnostics, and their regression tests.
- Generated plugin bundle built once from `src` after the combined source merge.
- Atomic plugin version files, release-candidate receipt, release notes/worklog, and controlled public/root loose-asset mirrors.
- Git branch push, protected-main PR/merge, annotated numeric tag, GitHub Release, five formal assets, and read-only post-release verification.

## Explicit exclusions

- No CloudBase asset or configuration change.
- No mini-program or cloud-function deployment.
- No user data, `data.json`, binding, Pro entitlement, payment, API, or account mutation.
- No deletion, movement, replacement, or recreation of any existing tag or Release.
- No weakening or bypassing of protected-main or release gates.

## Required gates

- Latest remote authority/default branch/version vacancy rechecked before publication.
- License ownership, repository license/disclosure, and dependency-license audit pass closed.
- Combined source is built once; generated bundle is never hand-merged.
- Full release tests, source guard, release identity prepublish and postpublish, package/ZIP hashes, and five-asset API readback pass.
- An independent agent reviews the combined diff and failure paths before external publication.
- Community Directory source, client mirror, real-client acceptance, and comprehensive-workspace mirror status are reported independently; no layer is inferred from another.

## Rollback boundary

Before tagging, the PR branch and merge are recoverable through a normal follow-up commit. After a public tag/Release exists, it is immutable; any corrective change must use a new version. Existing releases are never overwritten.
