# Plugin Pro Gate And Xiaohongshu OCR Design

## Goal

Add a Pro section inside the Obsidian plugin so advanced features only work when the active mini-program binding has valid Pro access, and add a Xiaohongshu image OCR test path that appends recognized text without changing the existing graphic-note extraction flow.

## Pro Access Rules

- The plugin must have at least one bound mini-program bind code before redeeming a Pro code.
- Redeeming from the plugin calls the existing sync API with the active binding token and the plugin `clientId`, so the server resolves the same WeChat `openid` that owns the bind code.
- New redeem-code entitlements store the plugin `clientId`. A redeem-code entitlement is only valid for that same plugin instance.
- Paid Pro entitlements are not locked to one plugin instance, so users who paid in the mini program are not affected.
- Free users can keep one binding. Attempts to add more bindings are still checked by the server.

## Plugin UI

The settings page is organized as:

- Usage tutorial
- Mini-program binding
- Binding settings: Feishu login, save directory, sync now, diagnostics
- Pro advanced options: permission status, redeem code input, AI metadata, Xiaohongshu comments, Xiaohongshu OCR test, local audio/video transcription component

## Feature Gates

The following features require valid Pro access from the current plugin instance:

- More than one mini-program binding
- AI description and keywords generation
- Audio/video transcription and local ASR installation
- Xiaohongshu comment extraction
- Xiaohongshu image OCR test

The plugin refreshes Pro status before using these features, not only when the settings page is opened.

## Xiaohongshu OCR Test

Existing Xiaohongshu extraction remains unchanged: title, body, tags, images, video source, and comments are still generated the same way. OCR is an optional extra section:

```markdown
## 图片文字 OCR（测试版）

### 图片 1
...
```

The plugin downloads candidate Xiaohongshu images with current request headers/cookies, sends a small batch to the sync API as base64, and the cloud side runs OCR. The first cloud provider is Tencent Cloud OCR using `GeneralBasicOCR`, which supports `ImageBase64` input and returns `TextDetections`.

## Image-Text Heuristic

OCR text is considered substantial when normalized readable characters exceed 80 in one image, or at least two images each exceed 40 readable characters. This marks the note metadata as image-text-heavy, but does not replace the original images.

## Error Handling

- If Pro status is missing or expired, advanced features are skipped or blocked with a clear notice.
- If OCR fails, the normal Xiaohongshu note still saves.
- If OCR returns too little text, the section is omitted by default.
