# PDF OCR Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove automatic PDF OCR and its heavy dependencies while preserving PDF text extraction and Xiaohongshu image OCR.

**Architecture:** Keep the existing JavaScript PDF text-layer extractor and attachment-preserving error path. Remove only the PDF-to-local-OCR bridge and restore the local OCR runtime/installers to the image-only contract used before the PDF feature.

**Tech Stack:** Obsidian/Electron Node.js plugin, PowerShell, Bash, Python/RapidOCR, Node assertion tests.

---

### Task 1: Lock the rollback behavior with failing tests

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `tests/plugin-marketplace-package.test.js`

- [x] Replace the corrupted-PDF fallback test with a test that makes `runLocalPdfOcr` throw if called, then asserts `conversionStatus === 'attachment_saved'`, the original `filePath` remains present, and `conversionError` is populated.
- [x] Replace PDF capability/dependency assertions with negative assertions for `PDF_OCR_REQUIRED`, `runLocalPdfOcr`, `PyMuPDF`, `fitz`, and OpenCC while retaining positive assertions for RapidOCR and Xiaohongshu image OCR.
- [x] Run `node tests/plugin-main-ai.test.js` and `node tests/plugin-marketplace-package.test.js`; expect failures because production code still advertises and invokes PDF OCR.

### Task 2: Remove the PDF OCR bridge from the plugin

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [x] Remove `LOCAL_PDF_OCR_RUN_TIMEOUT_MS`, `localOcrScriptSupportsPdf`, `createPdfOcrRequiredError`, and `runLocalPdfOcr`.
- [x] Restore `extractPdfMarkdown` failures to ordinary `Error` objects with no OCR routing code.
- [x] Simplify the PDF branch of `writeFileAttachment` to call `extractPdfMarkdown` once; its existing outer catch must preserve the attachment and set `conversionStatus` to `attachment_saved` on failure.
- [x] Remove `PyMuPDF` and `opencc-python-reimplemented` from downloaded-installer freshness validation while retaining the existing portable-Python and CDN checks.
- [x] Run `node tests/plugin-main-ai.test.js`; expect the rollback behavior test to pass.

### Task 3: Restore the image-only OCR component on Windows and macOS

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/local-ocr/ocr_image.py`
- Modify: `obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`
- Modify: `obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh`
- Modify: `obsidian-plugin/wechat-inbox-sync/local-ocr/README.md`
- Modify: `obsidian-plugin/wechat-inbox-sync/README.md`

- [x] Restore `ocr_image.py` to one-image input using RapidOCR, keeping `--input`, `--output`, and `--json` interfaces.
- [x] Set both installers' package list to `rapidocr-onnxruntime==1.4.4` and `pillow==12.3.0`; validate only the image OCR imports.
- [x] Change PDF-specific install errors/log messages back to image OCR wording without changing the existing Python/uv/CDN repair chain.
- [x] Update README text to say PDF uses text-layer extraction when possible and local OCR handles images only.
- [x] Run `python -m py_compile obsidian-plugin/wechat-inbox-sync/local-ocr/ocr_image.py` and `node tests/plugin-marketplace-package.test.js`; expect PASS.

### Task 4: Verify and record the release impact

**Files:**
- Modify: `docs/WORKLOG.md`
- Modify: `docs/DECISIONS.md`

- [x] Run `node --check obsidian-plugin/wechat-inbox-sync/main.js`, `node tests/plugin-main-ai.test.js`, and `node tests/plugin-marketplace-package.test.js`.
- [x] Confirm with `rg` that production plugin/local-OCR files contain no PDF OCR capability marker or heavy PDF OCR dependencies, while Xiaohongshu OCR symbols remain.
- [x] Record that the plugin must be released and that CDN Windows/macOS image-only installers/runtime must be updated together before users retry installation.
- [x] Review `git status --short` and stage only the rollback files, preserving unrelated user changes.
