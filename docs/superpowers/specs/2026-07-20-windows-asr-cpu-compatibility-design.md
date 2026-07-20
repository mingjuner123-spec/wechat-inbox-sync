# Windows ASR CPU Compatibility and Failure History Design

## Goal

Allow a Windows computer whose default whisper.cpp binary terminates with `0xC000001D` to recover automatically with a CPU-baseline compatibility binary.

## Evidence and scope

The affected `1.3.48` diagnostic fails while running `whisper-cli.exe --help`, before ffmpeg, model loading, or a user audio file is used. `0xC000001D` is the Windows illegal-instruction status. The current installer reuses `cache\\whisper.zip`, so retrying fetches the same incompatible package.

This change covers the Windows ASR installer and plugin diagnostic output only. It does not change normal synchronization, the API, binding codes, entitlement checks, OCR behavior, models, or macOS installation.

## Binary selection and recovery

1. Install the existing optimized Windows x64 whisper.cpp package first.
2. Validate it with `--help`, as today.
3. If the process exits with `0xC000001D`, classify the package as CPU-incompatible, delete only the optimized cached ZIP, and download a separately named CPU-baseline package (`whisper-bin-x64-compat.zip`).
4. Install the compatibility package into the same `whisper` destination, rerun `--help`, and continue the existing ffmpeg/model/real-inference validation.
5. Do not use the compatibility package for ordinary failures such as missing DLLs, corrupt downloads, access errors, or inference failures. Those must retain the current failure behavior.
6. If both packages cannot start, fail once with the two exit results and a direct diagnostic that identifies CPU/virtual-machine instruction exposure as the probable cause.

The compatibility package must be built from the pinned whisper.cpp source with native CPU optimizations disabled (`GGML_NATIVE=OFF`, AVX/AVX2/FMA/F16C disabled), include the same executable/DLL layout expected by the installer, be hash-pinned, and be published through the controlled local-component deployment path before the installer references it.

## Deferred failure-history proposal

The plugin already writes a last-install snapshot (`install.log`) and a last-transcription snapshot (`transcribe-last.log`). A separate follow-up may add a bounded, redacted, append-only `component-failures.log` for support. It is intentionally excluded from this repair so users do not receive a diagnostic-format change while the binary compatibility path is being restored.

## Tests and release gates

- Add static installer assertions proving that `0xC000001D` has a dedicated compatibility path, uses a different cache filename, and does not apply to generic failures.
- Keep the existing ASR installer/currentness tests and marketplace package test green.
- Validate PowerShell syntax, plugin JavaScript syntax, focused regression tests, manifest checks, and `git diff --check`.
- Release requires the compatibility ZIP to be uploaded and byte/hash verified through `scripts/deploy-local-components.ps1 -Execute`; no installer release may reference an unpublished compatibility asset.
