# Release Pipeline Root-Fix Design

## Problem

Production regressions have occurred after a fix was already verified because the repository, release worktrees, GitHub Release assets, and mutable CloudBase CDN aliases were not guaranteed to originate from the same Git commit.

The macOS ASR incident demonstrated all relevant failure modes:

- the portable-Python fix existed in a divergent branch but was not an ancestor of plugin `1.3.48`;
- a direct CDN hotfix temporarily corrected production while the official release source still contained the old installer;
- a later upload could overwrite the mutable `local-asr/common/...` alias with an older worktree copy;
- the hotfix worktree contained mixed line endings, so comparing the uploaded working file with the CDN did not prove that the committed Git blob matched production;
- release tests validated individual content markers but did not enforce release-source ancestry or immutable asset provenance.

## Goals

1. Make `origin/main` the only valid source for tags, GitHub Release packages, and local-component CDN deployments.
2. Reject releases from stale branches, dirty worktrees, or commits that differ from current `origin/main`.
3. Represent every local-component file with a committed canonical SHA-256 manifest.
4. Publish component files to immutable content-addressed CDN paths before updating legacy compatibility aliases.
5. Verify CloudBase objects and public CDN bytes after deployment.
6. Continuously detect out-of-band CDN overwrites.
7. Keep existing plugin versions working through the current `local-asr/common` and `local-ocr/common` URLs.

## Non-goals

- No Mini Program, cloud-function, binding, entitlement, payment, ASR inference, or OCR behavior changes.
- No new artifact registry service.
- No migration that breaks plugin `1.3.48` or older supported clients.
- No attempt to make shell installers depend on a shared runtime library; they remain self-contained.

## Chosen architecture

### Canonical component manifest

`obsidian-plugin/wechat-inbox-sync/local-components-manifest.json` records each deployed component:

- stable asset ID;
- source path inside the plugin release source;
- canonical SHA-256 over UTF-8 bytes with LF line endings for text files;
- immutable content-addressed CloudBase path;
- existing compatibility alias, when one exists.

Content-addressed paths use the full SHA-256:

`local-components/by-sha256/<SHA256>/<filename>`

The hash is the version. A path can never be reused for different bytes.

### Manifest tooling

`scripts/local-component-manifest-core.js` owns normalization, hashing, manifest construction, and validation.

`scripts/update-local-components-manifest.js` supports:

- `--check`: fail when the committed manifest does not match source files;
- `--write`: regenerate the manifest after an intentional component change.

The check mode is used by CI and Release. Developers cannot change a component silently without updating its manifest.

### Release-source guard

`scripts/release-source-guard.js` verifies:

- repository status is clean for deployment;
- local HEAD equals remote `origin/main`;
- a release tag commit equals remote `origin/main`;
- root and plugin manifests match the tag;
- the committed component manifest matches canonical source bytes.

Pure comparison and validation logic is exported for unit testing. Git commands are only used by the CLI entry point.

### CI and Release

A new main/PR workflow runs the two plugin regression suites, JavaScript and shell syntax checks, release-governance tests, and component-manifest consistency checks.

The tag Release workflow:

1. checks out full history;
2. fetches `origin/main`;
3. rejects a tag that is not exactly current `origin/main`;
4. runs the same local gates;
5. verifies current public CDN aliases and immutable assets;
6. creates the GitHub Release only after every gate passes.

Version tags are the only tags that trigger the Release workflow.

### Controlled CDN deployment

`scripts/deploy-local-components.ps1` is the only documented deployment entry point.

It defaults to dry-run. With `-Execute`, it:

1. requires a clean checkout whose HEAD exactly equals remote `origin/main` (the local branch label is irrelevant);
2. validates the committed manifest;
3. uploads each asset to its immutable content-addressed path;
4. refuses to replace an existing immutable path with different bytes;
5. updates compatibility aliases only after immutable assets are verified;
6. uploads the manifest;
7. downloads CloudBase objects and fetches public CDN URLs with cache busting;
8. fails unless every byte hash matches the committed manifest.

Direct `tcb hosting deploy` commands are documented as unsupported for local components.

### Continuous integrity monitoring

`scripts/check-local-components-cdn.js` validates the committed manifest, immutable paths, compatibility aliases, and public manifest.

A scheduled GitHub Actions workflow runs this check daily and supports manual dispatch. An out-of-band overwrite therefore becomes a visible failed check rather than remaining hidden until a user reports it.

## Error handling

- Dirty or stale source: fail before any upload.
- Manifest mismatch: fail and instruct the developer to intentionally regenerate it.
- Existing immutable path with different bytes: fail; never overwrite.
- Compatibility upload succeeds but public CDN is stale: retry with cache-busting, then fail without declaring success.
- Public CDN drift during Release: block the GitHub Release.
- Scheduled drift: fail the workflow and preserve the last known-good immutable asset.

## Testing

Tests must prove:

- manifest hashes are deterministic across CRLF/LF checkouts;
- source changes without manifest regeneration fail;
- stale branch/tag SHAs fail;
- current main/tag SHAs pass;
- immutable paths are derived from full content hashes;
- release workflow targets version tags, fetches full history, checks main ancestry/equality, and runs all gates;
- CI runs on `main` pushes and pull requests;
- deploy script requires a clean checkout at current remote main, is dry-run by default, refuses immutable replacement, and verifies object/public hashes;
- existing compatibility aliases remain in the manifest.

## Rollout

1. Commit and push governance code to `main`.
2. Upload current component files to their immutable paths.
3. Upload the canonical manifest and refresh compatibility aliases from the canonical Git source.
4. Verify CloudBase object and public CDN hashes.
5. Enable main branch protection requiring the new governance workflow when repository permissions allow it.
6. Do not create a new plugin version solely for this publishing-system change; the next functional release inherits the guarded workflow.
