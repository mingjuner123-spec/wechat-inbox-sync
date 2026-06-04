const http = require('http');
const https = require('https');

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

function formatDuration(duration) {
  const totalSeconds = Math.max(0, Math.round(Number(duration || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function omitTransientMetadata(metadata) {
  const { audioTempURL, ...safeMetadata } = metadata || {};
  return safeMetadata;
}

function summarizeText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 80)}...`;
}

function createDefaultVoiceProcessor() {
  return {
    async transcribeAndSummarize(metadata) {
      const durationText = formatDuration(metadata.duration);
      return {
        transcription: `这是一段从微信小程序上传的语音备忘录，录音时长约 ${durationText}。语音文件已保存到云端，并会同步到 Obsidian。`,
        summary: `微信语音备忘录，时长约 ${durationText}，已收集到 Obsidian。`,
      };
    },
  };
}

function requestBuffer(url, options = {}, redirectCount = 0) {
  if (typeof options === 'number') {
    redirectCount = options;
    options = {};
  }

  if (redirectCount > 3) {
    return Promise.reject(new Error('Too many redirects while downloading audio'));
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
    const req = transport.get(parsed, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, parsed).toString();
        requestBuffer(nextUrl, options, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Audio download failed: HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Audio download timed out'));
    });
  });
}

function encodeMultipartBody({ fields, files, boundary }) {
  const chunks = [];

  Object.entries(fields || {}).forEach(([name, value]) => {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  });

  (files || []).forEach((file) => {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  });

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function postJsonMultipart({ url, apiKey, fields, files }) {
  const boundary = `----wechat-obsidian-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = encodeMultipartBody({ fields, files, boundary });

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.request({
      method: 'POST',
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI transcription failed: HTTP ${res.statusCode} ${rawBody.slice(0, 300)}`));
          return;
        }

        try {
          resolve(JSON.parse(rawBody));
        } catch (error) {
          reject(new Error(`OpenAI transcription returned invalid JSON: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(DEFAULT_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('OpenAI transcription request timed out'));
    });
    req.end(body);
  });
}

function createOpenAIVoiceProcessor(options = {}) {
  const env = options.env || process.env || {};
  const apiKey = env.OPENAI_API_KEY;
  const endpoint = env.OPENAI_AUDIO_TRANSCRIPTIONS_URL || 'https://api.openai.com/v1/audio/transcriptions';
  const model = env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
  const language = env.VOICE_LANGUAGE || 'zh';
  const downloadFile = options.downloadFile || requestBuffer;
  const postMultipartJson = options.postMultipartJson || postJsonMultipart;

  return {
    async transcribeAndSummarize(metadata) {
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for real voice transcription');
      }
      if (!metadata.audioTempURL) {
        throw new Error('Audio temp URL is required for real voice transcription');
      }

      const audioBuffer = await downloadFile(metadata.audioTempURL);
      const response = await postMultipartJson({
        url: endpoint,
        apiKey,
        fields: {
          model,
          language,
          response_format: 'json',
        },
        files: [
          {
            name: 'file',
            filename: 'voice.mp3',
            contentType: 'audio/mpeg',
            buffer: audioBuffer,
          },
        ],
      });

      const transcription = String(response.text || '').trim();
      if (!transcription) {
        throw new Error('Voice transcription returned empty text');
      }

      return {
        transcription,
        summary: summarizeText(transcription),
      };
    },
  };
}

function createVoiceProcessor(options = {}) {
  const env = options.env || process.env || {};
  const provider = String(env.VOICE_AI_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : 'mock')).toLowerCase();

  if (provider === 'openai') {
    return createOpenAIVoiceProcessor(options);
  }

  return createDefaultVoiceProcessor();
}

async function processVoiceMetadata(metadata, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const processor = options.processor || createVoiceProcessor(options);
  const safeMetadata = omitTransientMetadata(metadata);

  try {
    const result = await processor.transcribeAndSummarize(metadata);
    return {
      ...safeMetadata,
      transcription: result.transcription || '',
      summary: result.summary || '',
      transcriptionStatus: 'success',
      summaryStatus: 'success',
      processedAt: now(),
    };
  } catch (error) {
    const message = error.message || String(error);
    return {
      ...safeMetadata,
      transcriptionStatus: 'failed',
      summaryStatus: 'failed',
      transcriptionError: message,
      summaryError: message,
      processedAt: now(),
    };
  }
}

module.exports = {
  createDefaultVoiceProcessor,
  createOpenAIVoiceProcessor,
  createVoiceProcessor,
  formatDuration,
  processVoiceMetadata,
  requestBuffer,
  summarizeText,
};
