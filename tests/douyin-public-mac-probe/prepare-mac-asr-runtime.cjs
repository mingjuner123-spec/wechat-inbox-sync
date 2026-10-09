'use strict';

const fs = require('node:fs');
const path = require('node:path');

function extractTranscribeScript(installerSource) {
  const text = String(installerSource || '').replace(/\r\n?/g, '\n');
  const marker = 'cat > "$INSTALL_ROOT/transcribe.sh" <<\'SCRIPT\'\n';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('TRANSCRIBE_SCRIPT_MARKER_MISSING');
  const bodyStart = start + marker.length;
  const end = text.indexOf('\nSCRIPT\n', bodyStart);
  if (end < 0) throw new Error('TRANSCRIBE_SCRIPT_END_MISSING');
  const script = text.slice(bodyStart, end) + '\n';
  if (!script.startsWith('#!/usr/bin/env bash\n')) throw new Error('TRANSCRIBE_SCRIPT_SHEBANG_MISSING');
  if (!script.includes('WHISPER="$ROOT/bin/whisper-cli"')) throw new Error('TRANSCRIBE_SCRIPT_RUNTIME_LAYOUT_MISSING');
  return script;
}

function linkFile(source, target) {
  try { fs.unlinkSync(target); } catch (_) {}
  fs.symlinkSync(path.resolve(source), target, 'file');
}

function prepare({ installerPath, asrRoot, modelPath, ffmpegPath }) {
  const installer = path.resolve(installerPath);
  const root = path.resolve(asrRoot);
  const model = path.resolve(modelPath);
  const ffmpeg = path.resolve(ffmpegPath);
  if (!fs.statSync(installer).isFile()) throw new Error('INSTALLER_SOURCE_MISSING');
  if (!fs.statSync(model).isFile()) throw new Error('MODEL_SOURCE_MISSING');
  if (!fs.statSync(ffmpeg).isFile()) throw new Error('FFMPEG_SOURCE_MISSING');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'transcribe.sh'), extractTranscribeScript(fs.readFileSync(installer, 'utf8')), { mode: 0o700 });
  fs.chmodSync(path.join(root, 'transcribe.sh'), 0o700);
  linkFile(model, path.join(root, 'models', 'ggml-small.bin'));
  linkFile(ffmpeg, path.join(root, 'bin', 'ffmpeg'));
  return { schemaVersion: 1, prepared: true, script: 'production-transcribe.sh', modelLinked: true, ffmpegLinked: true };
}

if (require.main === module) {
  const [installerPath, asrRoot, modelPath, ffmpegPath] = process.argv.slice(2);
  try {
    prepare({ installerPath, asrRoot, modelPath, ffmpegPath });
  } catch (_) {
    process.stderr.write('ASR_RUNTIME_PREPARE_FAILED\n');
    process.exitCode = 1;
  }
}

module.exports = { extractTranscribeScript, prepare };
