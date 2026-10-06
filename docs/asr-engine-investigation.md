# Native Mac ASR engine investigation

A branch-only macOS matrix compares the released `whisper.cpp-cli==0.0.3` wheel against a rebuild of the same upstream whisper.cpp v1.5.5 source. It runs on `macos-15-intel` and `macos-14` (Apple silicon), with the public `samples/jfk.wav` copied from the checked-out v1.5.5 source and `ggml-small.bin` fetched from pinned Hugging Face revision `90a64d80ea254cf67575b41a5971f972c79f7b45` (SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`). PyPI wheel hashes are checked per architecture before installation.

The candidate build sets macOS deployment minimum 12.0, disables shared libraries, Metal, CoreML, Accelerate and AVX-512. It retains the candidate executable and license as CI artifacts, records binary SHA-256, undefined symbols, linked libraries and Mach-O deployment commands, and rejects the known `NEWLAPACK`/ILP64 import or a non-system absolute linked library. Each executable is tested with default and `--no-gpu`; the wheel is run at runner-default threads and one thread. A case passes only on exit code 0 plus nonempty output containing the expected JFK phrase. Timeouts, signals, nonzero exit and inaccurate/empty output fail. The old wheel is diagnostic baseline and may fail independently; it does not prevent collecting the candidate result.

Per case, artifacts include stdout/stderr/transcript, fixture/model/executable hashes, OS and architecture, PID, duration, exit code and signal. On macOS, symbol inventory (`dwarfdump --uuid`, `nm -n`, `otool -tvV`) is retained. A failure triggers an LLDB rerun with the same variant and thread count. Delayed `.ips` collection is limited to a report whose PID, capture time and executable identity match the process launched by that exact case; no general system diagnostic is collected.

The workflow runs only on pushes to `codex/asr-engine-investigation-20261006`, has `contents: read`, uses no secrets, and uploads only evidence produced from the public fixture. It does not run on release events or modify the default branch. CI on macOS 15 Intel validates an engine on that runner; it is not a reproduction of the affected MacBookPro13,2 on macOS 12. A successful CI result does not prove the user's machine or original audio is fixed.

## Local use

The stdlib runner does not download or upload anything. Use explicit local paths; evidence is written only to the explicit local output directory:

```sh
python scripts/asr-engine-investigation.py \
  --audio /path/to/audio.wav --model /path/to/ggml-small.bin \
  --engine /path/to/whisper-cli --output-dir /path/to/local-evidence \
  --label local-engine --timeout 240 --language zh \
  --expected-text '音频中已知短句'
```

The default `en` language and JFK expected phrase apply to the public CI fixture; for known Chinese speech use `--language zh --expected-text '音频中已知短句'`. The executable receives native whisper.cpp `-m/-f/-l/-otxt/-of` arguments. Use `--threads 1` for a single-thread comparison, or repeat `--engine-arg VALUE` for additional native options. Local audio, model and evidence are never uploaded. On macOS, `--symbol-report` collects Mach-O symbols and `.ips` matching is limited to a crash from the child launched by that case.

## Offline tests

Run `python tests/asr-engine-investigation.test.py`. These tests mock the child process and use only temporary synthetic files; they cover expected output, empty output, nonzero exit and timeout handling.
