# Local OCR Component

This component installs RapidOCR into a local Python virtual environment. It supports:

- Image OCR.
- PDF page OCR rendered at 300 DPI with PyMuPDF.
- Reading-order sorting based on OCR coordinates.
- Traditional-to-Simplified Chinese conversion with OpenCC.

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
