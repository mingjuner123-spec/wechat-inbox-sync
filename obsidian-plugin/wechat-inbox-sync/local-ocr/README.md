# Local OCR Component

This component installs RapidOCR into a local Python virtual environment for image OCR, including text-heavy Xiaohongshu images.

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-local-ocr.ps1
```

macOS:

```bash
/bin/bash ./install-local-ocr-macos.sh
```

Runtime files are installed under:

```text
~/.wechat-inbox-local-ocr
```
