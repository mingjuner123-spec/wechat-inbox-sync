# Plugin 1.3.70 Xiaohongshu OCR Batch Design

## Status

Approved by the product owner on 2026-07-27 with the instruction:

> 按建议执行，然后和上一步的一起合并发布插件

This design extends the already verified local 1.3.70 candidate. The original candidate remains recoverable at commit `9c88f4787a0307f5f22afc5d9292646a97378548`.

## Problem

The current Xiaohongshu image OCR path has three coupled defects:

1. Every Pro, non-video Xiaohongshu note enters OCR, even when its images are ordinary photos.
2. Every image starts a separate Python process and initializes RapidOCR again. One 10-image note therefore starts the OCR runtime 10 times.
3. Any image with at least 15 readable characters is rendered under a separate `### 图片 N` heading. Photo watermarks and short captions are included, while multi-page text is fragmented.

The existing `isLikelyImageTextNote()` decision happens after all OCR calls and only writes metadata. It does not control process count or output eligibility.

## Product Behavior

### Text-dominant image

An image qualifies when text is the main information carried by the image.

- Allowed: a text card or long-text screenshot with a background, small avatar, logo, or small illustration.
- Rejected: a normal photo containing only a title, watermark, subtitle, product label, or a few short lines.

The first conservative policy is:

- ignore OCR boxes below confidence `0.55` or below two readable characters;
- require average confidence of at least `0.65`;
- accept a long-text layout when it has at least 80 readable characters, at least 5 trusted lines, vertical text span at least 35%, and covered row ratio at least 12%;
- accept a large-type text card when it has at least 35 readable characters, at least 3 trusted lines, text-box area ratio at least 12%, and vertical text span at least 25%;
- when geometry is unavailable, use a strict fallback of at least 160 readable characters and 6 lines.

Thresholds are named constants and covered by fixtures so later calibration is deliberate rather than an untracked production tweak.

### Runtime frequency

- One Xiaohongshu note starts at most one OCR Python process.
- RapidOCR initializes once in that process and processes the note's candidate images in source order.
- A broken image returns an item-level error and does not terminate the remaining images.
- An engine-level or process-level failure remains best-effort and must not block the normal title, body, tags, or images from being saved.

It is impossible to know that an image contains mostly text without inspecting its pixels. This design therefore guarantees one model start per note and no OCR output for ordinary photos; it does not claim zero inference on rejected photos.

### Output

- Only qualifying text-dominant images contribute OCR text.
- Original images and their order remain unchanged above the OCR section.
- Qualifying text is merged in image order under one `## 图片文字` heading.
- `### 图片 1`, `### 图片 2`, and other per-image headings are removed.
- Only the longest exact normalized overlap between the end of one image and the beginning of the next is removed, with an eight-line maximum.
- Repeated text inside a page is not globally deleted because legitimate prose may repeat words or sentences.
- Chinese line boundaries concatenate without an artificial space; Latin word boundaries receive one space when needed.

## Architecture

### Batch runner

The plugin writes a short, versioned Python batch runner to its temporary OCR directory and runs it with the already installed OCR Python environment.

Input manifest:

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "id": "image-1",
      "index": 1,
      "input": "C:\\temporary\\image-1.jpg"
    }
  ]
}
```

Output:

```json
{
  "schemaVersion": 1,
  "processed": 1,
  "items": [
    {
      "id": "image-1",
      "index": 1,
      "status": "ok",
      "width": 1080,
      "height": 1440,
      "text": "识别后的完整文字",
      "lines": [
        {
          "text": "识别后的完整文字",
          "score": 0.98,
          "box": [[10, 20], [900, 20], [900, 80], [10, 80]]
        }
      ],
      "metrics": {
        "readableChars": 120,
        "lineCount": 8,
        "averageConfidence": 0.96,
        "textBoxAreaRatio": 0.18,
        "coveredRowRatio": 0.24,
        "verticalSpanRatio": 0.68
      }
    }
  ]
}
```

The runner supports `rapidocr-onnxruntime 1.4.4` tuple results and the newer object-style result. It uses dependencies already present in the local OCR environment and adds no model or large download.

The installed legacy `ocr_image.py` remains valid. The new batch path does not require users to reinstall ASR or OCR and does not deploy or change CloudBase/CDN assets.

### JavaScript policy layer

JavaScript owns the product policy:

- normalize batch output defensively;
- determine text dominance from named thresholds;
- preserve original image index and URL;
- merge only qualifying items;
- append one continuous Markdown section;
- expose safe aggregate diagnostics without image text or local paths.

This keeps threshold changes testable without invoking Python.

## Permission and Platform Boundaries

- Free users continue receiving public Xiaohongshu title, body, tags, cover, and inner images without OCR.
- Image OCR remains Pro-only.
- Xiaohongshu comments remain Pro plus a valid Xiaohongshu login session.
- Video notes continue skipping image OCR.
- Windows and macOS use the same batch contract.
- No CloudBase function, binding, entitlement, payment, user data, or environment mapping changes.

## Compatibility

- Existing installed OCR environments are reused.
- The batch runner is supplied by plugin 1.3.70 at runtime, so an old installed single-image script cannot cause an unsupported-argument failure.
- If the new batch path cannot run, ordinary Xiaohongshu extraction succeeds without an OCR section and records a non-sensitive diagnostic.
- The previous single-image method remains available only as a compatibility helper; Xiaohongshu note processing must not call it in a loop.

## Required Regression Tests

1. A text card with a small avatar/background qualifies.
2. A photo with a watermark or three caption lines does not qualify.
3. A mixed note retains only qualifying images.
4. Ten images call the batch process once, not ten times.
5. One corrupt image does not prevent later images from being considered.
6. Multi-page text preserves image order and contains no `### 图片 N`.
7. Adjacent page-boundary duplicates are removed, while internal repeated prose remains.
8. OCR failure does not block normal Xiaohongshu Markdown.
9. Free users do not invoke OCR; Pro non-video notes may invoke it; video notes do not.
10. The existing Xiaohongshu target-identity and AI 429 non-blocking regressions from the original 1.3.70 candidate remain green.

## Release

The expanded 1.3.70 candidate must repeat all independent specification, quality, security, test, packaging, and final release verification. The earlier final verification does not cover this OCR change.

No public push, tag, or Release may overwrite an existing remote object. The public target remains `mingjuner123-spec/wechat-inbox-sync`.
