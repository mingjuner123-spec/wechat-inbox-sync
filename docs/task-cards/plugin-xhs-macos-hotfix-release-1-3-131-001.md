# WeChat Inbox Sync 1.3.131 Xiaohongshu macOS hotfix release

- Status: release candidate
- Base: public `main@fa50d324fd7aea812396d42fec0eca29979f6ad7` / 1.3.130
- Target: 1.3.131
- Authorization: the product owner explicitly requested publication after a real macOS user reported the regression.
- Scope: Xiaohongshu hidden BrowserWindow throttling, terminal browser diagnostics, clipboard-link diagnostic propagation, generated bundle, release metadata, and focused tests.
- Excluded: CloudBase, bindings, entitlements, payments, user data, installed plugin replacement, and `data.json`.

## Evidence and cause

The 1.3.130 diagnostic stopped after `ready_to_show_hidden` and `media_extraction: started`. The same release introduced explicit hidden-window guards. On macOS, hiding the BrowserWindow changes page visibility and default background throttling can suspend the page scripts used for public Xiaohongshu content and media extraction. Cookie state is not a prerequisite for public content: `includeComments:false` enters content extraction before the Cookie/comment check.

## Candidate behavior

- Keep Xiaohongshu extraction windows physically hidden while setting `backgroundThrottling:false`; preserve default throttling for other platforms.
- Add bounded media extraction and terminal `failureKind` diagnostics without retaining raw errors, URL query tokens, Cookies, or page content.
- Preserve the latest redacted browser diagnostic through Xiaohongshu and automatic webpage/clipboard-link error wrappers.
- Keep Cookie requirements limited to comment extraction.

## Release gates

Before any remote write, run the full plugin release matrix, build/source consistency, local-component manifest/CDN checks, license and contributor audit, independent review, immutable candidate verification, and target-version occupancy checks. Publish only through protected-main PR, existing CI, an annotated 1.3.131 tag, and the existing Release workflow. Never overwrite or move 1.3.130.

## Rollback and remaining risk

The immutable rollback reference is 1.3.130. Any correction after publication must use a higher version. Windows automation cannot replace a real macOS Obsidian/Electron validation; after marketplace publication, validate one `xhslink.cn` graphic note and one video note on the affected Mac.
