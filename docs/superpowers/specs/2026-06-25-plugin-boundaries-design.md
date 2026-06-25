# Plugin Boundaries Design

**Goal:** Stop Xiaohongshu, WeChat article, Feishu, AI metadata, and frontmatter fixes from accidentally changing each other.

**Problem:** The plugin currently keeps most behavior in `main.js`. A single edit can touch extraction, comments, settings, frontmatter, AI metadata, Electron sessions, and UI at once. Regression tests reduce damage, but they do not fix the structural coupling.

**Decision:** Keep `main.js` as the Obsidian plugin entry file, but create explicit domain modules for pure behavior and put tests beside those boundaries. Do not add a build step for this cleanup, because Obsidian community plugins read `main.js` directly from the market source.

## Boundaries

### Shared Comment Model

File: `src/comments/model.js`

Owns only normalized comment shapes and Markdown rendering:

- `normalizeSocialComment`
- `pushSocialComment`
- `threadSocialComments`
- `buildSocialCommentsMarkdown`

It must not know about Xiaohongshu, WeChat, Feishu, AI, settings, Electron, or Obsidian UI.

### Xiaohongshu

Files under `src/xiaohongshu/`

Owns Xiaohongshu note parsing, image filtering, login/session helpers, comment API parsing, in-page collection scripts, and threaded comment merge behavior.

It may depend on `src/comments/model.js`.

It must not import Feishu, WeChat article, AI metadata, or frontmatter code.

### WeChat Article

Files under `src/wechat/`

Owns WeChat article comment extraction and WeChat article markdown comment append behavior.

It may depend on `src/comments/model.js`.

It must not import Xiaohongshu or Feishu extraction code.

### Feishu

Files under `src/feishu/`

Owns Feishu document markdown extraction, title normalization, table preservation, image filtering, and heading conversion.

It must not import Xiaohongshu or WeChat comment code.

### AI Metadata

File: `src/ai/metadata.js`

Owns AI metadata eligibility, response parsing, generated description validation, keyword normalization, and no-fallback behavior for invalid AI results.

It must not parse platform HTML.

### Frontmatter

File: `src/frontmatter.js`

Owns Obsidian property formatting and record marker detection.

It may consume metadata objects from platform extractors, but it must not call platform extraction or AI generation.

### Settings

File: `src/settings.js`

Owns defaults, migration, binding normalization, and validation.

It must preserve explicit user choices such as `xiaohongshuCommentsEnabled: false`.

## Regression Guard

Add a boundary guard script that scans changed files and fails when a domain-specific change edits unrelated domains without either:

- a matching test file for that domain, or
- an explicit allowlist label in the commit message or release checklist.

For this repository, the first useful guard is file-level:

- Xiaohongshu changes should stay in `src/xiaohongshu/**`, `src/comments/**`, `tests/xiaohongshu-*.test.js`, or plugin entry wiring.
- Feishu changes should stay in `src/feishu/**`, `tests/feishu-*.test.js`, or plugin entry wiring.
- WeChat comment changes should stay in `src/wechat/**`, `src/comments/**`, `tests/wechat-*.test.js`, or plugin entry wiring.
- AI metadata changes should stay in `src/ai/**`, `tests/ai-*.test.js`, or plugin entry wiring.
- Frontmatter changes should stay in `src/frontmatter.js`, `tests/frontmatter.test.js`, or plugin entry wiring.

## Implementation Strategy

Use behavior-preserving extraction first. Each moved behavior keeps the existing exported helper name through `WechatObsidianInboxPlugin.__test` so existing tests keep working while new focused tests are added.

Do not bump the plugin version for a refactor-only boundary commit. Version bumps happen only when a user-facing fix is shipped.

## Success Criteria

- Existing tests still pass.
- New focused tests can run per domain.
- A Xiaohongshu comment change no longer requires editing Feishu, AI, or frontmatter tests.
- The release smoke test remains small and only verifies cross-domain contracts, not every domain detail.
- `main.js` remains the Obsidian entry point and plugin marketplace compatibility is preserved.
