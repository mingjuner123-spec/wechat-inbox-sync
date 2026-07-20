# Xiaohongshu structured images and anonymous-first extraction

## Goal

Prevent one Xiaohongshu graphic note from saving both DOM thumbnail images and structured high-quality images, while allowing public share links to extract their core note content without a Xiaohongshu login.

## Root cause

The extractor currently appends `og:image`, every matching DOM `<img>`, and every URL found in structured `imageList` blocks before URL-based variant deduplication. Xiaohongshu can assign different asset paths to a thumbnail and its high-quality original, so URL normalization cannot recognize that they represent the same slide. The observed eight-slide note therefore produced sixteen valid local JPEG files.

## Design

1. Parse structured image arrays first.
2. When a structured image array contains valid note images, use only that ordered set. Do not mix DOM `<img>` candidates into it.
3. Use `og:image` and filtered DOM images only when structured note images are unavailable.
4. Preserve existing URL-variant deduplication inside the selected source and prefer default/high-quality variants.
5. Keep public page extraction independent from stored Xiaohongshu cookies. A public share page that exposes title, body, and `imageList` must produce the note without login.
6. Continue using the authenticated browser session as an enhancement for comments, restricted pages, and anti-bot fallbacks. Do not claim anonymous access for private, deleted, expired-token, or risk-controlled content.

## Data flow

Public share URL → anonymous HTML fetch/render → structured note JSON → title/body/ordered image list → local image download.

If structured note JSON is absent, the extractor falls back to sanitized meta/DOM image candidates. Comment extraction may separately reuse the persistent Xiaohongshu session.

## Tests

- Reproduce a page containing eight DOM thumbnails plus eight differently addressed structured originals and assert exactly eight structured images remain.
- Assert the structured image order is preserved and thumbnail URLs are absent.
- Assert a page with no structured image array still falls back to meta/DOM images.
- Preserve existing extraction, image localization, comment, and marketplace regressions.

## Scope

This change affects only the Obsidian plugin’s Xiaohongshu extraction logic, tests, version metadata, and release documentation. It does not change the Mini Program, cloud functions, binding, Pro entitlements, OCR installer, ASR installer, or user vault files.
