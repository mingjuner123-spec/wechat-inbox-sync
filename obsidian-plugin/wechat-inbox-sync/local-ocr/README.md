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

On Windows, repair builds and validates a fresh environment in a temporary
`venv-staging` directory before replacing the single active `venv`. A
short-lived `venv-backup` is used only for rollback and is removed after a
successful switch. If Windows temporarily locks the active Python executable,
the validated repair is activated automatically the next time Obsidian starts.
Users do not need to end Python processes or rename component directories.
