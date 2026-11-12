'use strict';
// Reuse the operator's existing, explicitly pinned Linux ASR installation.
// This is private node configuration, never a consumer installer or setting.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX_BYTES = 100 * 1024 * 1024;
function configuration(env = process.env, platform = process.platform) {
  if (platform !== 'linux' || env.WECHAT_INBOX_OPERATOR_NODE_ENABLED !== '1') return null;
  const cfg = {
    modulePath: env.WECHAT_INBOX_OPERATOR_ASR_MODULE || '',
    moduleHash: env.WECHAT_INBOX_OPERATOR_ASR_MODULE_SHA256 || '',
    dependencyHash: env.WECHAT_INBOX_OPERATOR_ASR_DEPENDENCY_SHA256 || '',
    executablePath: env.CLOUD_TRANSCRIPTION_LOCAL_ASR_EXECUTABLE || '',
    modelPath: env.CLOUD_TRANSCRIPTION_LOCAL_ASR_MODEL || '',
    ffmpegPath: env.FFMPEG_PATH || '',
  };
  if (!/^[a-f0-9]{64}$/.test(cfg.moduleHash) || !/^[a-f0-9]{64}$/.test(cfg.dependencyHash)) return null;
  cfg.dependencyPath = path.join(path.dirname(cfg.modulePath), 'media-security.js');
  try {
    for (const p of [cfg.modulePath, cfg.executablePath, cfg.modelPath, cfg.ffmpegPath]) {
      if (!path.isAbsolute(p) || !fs.statSync(p).isFile()) return null;
    }
    if (crypto.createHash('sha256').update(fs.readFileSync(cfg.modulePath)).digest('hex') !== cfg.moduleHash) return null;
    if (crypto.createHash('sha256').update(fs.readFileSync(cfg.dependencyPath)).digest('hex') !== cfg.dependencyHash) return null;
  } catch (_) { return null; }
  return cfg;
}
function status(env = process.env, platform = process.platform) {
  const cfg = configuration(env, platform);
  return { ready: Boolean(cfg), ffmpegPath: cfg ? cfg.ffmpegPath : '' };
}
async function transcribe(inputPath, { signal = null, env = process.env, platform = process.platform, loadModule = require } = {}) {
  const cfg = configuration(env, platform);
  if (!cfg) throw Object.assign(Error('运营节点已有 Linux 转写配置未通过校验'), { code:'OPERATOR_ASR_CONFIG_INVALID' });
  if (signal && signal.aborted) throw Object.assign(Error('Cancelled'), { name:'AbortError' });
  const stat = await fs.promises.stat(inputPath);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw Object.assign(Error('运营节点音频大小无效'), { code:'OPERATOR_MEDIA_SIZE_INVALID' });
  const buffer = await fs.promises.readFile(inputPath);
  if (buffer.length > MAX_BYTES) throw Object.assign(Error('运营节点音频超过限制'), { code:'OPERATOR_MEDIA_SIZE_INVALID' });
  const adapterModule = loadModule(cfg.modulePath);
  if (typeof adapterModule.createWhisperCppLocalAsrAdapter !== 'function') throw Object.assign(Error('运营节点转写接口不匹配'), { code:'OPERATOR_ASR_CONFIG_INVALID' });
  const adapter = adapterModule.createWhisperCppLocalAsrAdapter({
    executablePath:cfg.executablePath, modelPath:cfg.modelPath, ffmpegPath:cfg.ffmpegPath,
    threads:1, maxConcurrent:1, language:'auto', maxMediaBytes:MAX_BYTES,
  });
  // Existing adapter accepts a verified local buffer. The placeholder is never
  // fetched: no upload/download is needed for audio already on this computer.
  return await adapter.transcribe({ buffer, controlledMediaUrl:'https://local-audio.invalid/retained.mp3',
    artifactSize:buffer.length, artifactSha256:crypto.createHash('sha256').update(buffer).digest('hex'), signal });
}
module.exports = { configuration, status, transcribe };
