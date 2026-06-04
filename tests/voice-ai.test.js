const assert = require('assert');
const http = require('http');

const {
  createVoiceProcessor,
  formatDuration,
  processVoiceMetadata,
  requestBuffer,
} = require('../cloudfunctions/quickstartFunctions/voice-ai');

(async () => {
  assert.strictEqual(formatDuration(15200), '00:15');
  assert.strictEqual(formatDuration(61000), '01:01');

  const processed = await processVoiceMetadata({
    audioFileID: 'cloud://voices/001.mp3',
    duration: 15200,
    transcriptionStatus: 'pending',
    summaryStatus: 'pending',
  }, {
    now: () => '2026-05-13T08:00:00.000Z',
  });

  assert.strictEqual(processed.transcriptionStatus, 'success');
  assert.strictEqual(processed.summaryStatus, 'success');
  assert.ok(processed.transcription.includes('00:15'));
  assert.ok(processed.summary.includes('00:15'));
  assert.strictEqual(processed.audioTempURL, undefined);
  assert.strictEqual(processed.processedAt, '2026-05-13T08:00:00.000Z');

  const openaiProcessor = createVoiceProcessor({
    env: {
      OPENAI_API_KEY: 'test-key',
      OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe',
      VOICE_LANGUAGE: 'zh',
    },
    downloadFile: async (url) => {
      assert.strictEqual(url, 'https://temp.example.com/voice.mp3');
      return Buffer.from('fake audio');
    },
    postMultipartJson: async (request) => {
      assert.strictEqual(request.url, 'https://api.openai.com/v1/audio/transcriptions');
      assert.strictEqual(request.apiKey, 'test-key');
      assert.strictEqual(request.fields.model, 'gpt-4o-mini-transcribe');
      assert.strictEqual(request.fields.language, 'zh');
      assert.strictEqual(request.files[0].filename, 'voice.mp3');
      return {
        text: '今天测试真机语音，确认声音可以进入 Obsidian，并且需要生成摘要。',
      };
    },
  });

  const realProcessed = await processVoiceMetadata({
    audioFileID: 'cloud://voices/003.mp3',
    audioTempURL: 'https://temp.example.com/voice.mp3',
    duration: 3200,
    transcriptionStatus: 'pending',
    summaryStatus: 'pending',
  }, {
    processor: openaiProcessor,
    now: () => '2026-05-13T08:10:00.000Z',
  });

  assert.strictEqual(realProcessed.transcriptionStatus, 'success');
  assert.strictEqual(realProcessed.summaryStatus, 'success');
  assert.strictEqual(realProcessed.transcription, '今天测试真机语音，确认声音可以进入 Obsidian，并且需要生成摘要。');
  assert.ok(realProcessed.summary.includes('今天测试真机语音'));
  assert.strictEqual(realProcessed.audioTempURL, undefined);

  const failed = await processVoiceMetadata({
    audioFileID: 'cloud://voices/002.mp3',
    duration: 5000,
    transcriptionStatus: 'pending',
    summaryStatus: 'pending',
  }, {
    processor: {
      async transcribeAndSummarize() {
        throw new Error('service offline');
      },
    },
  });

  assert.strictEqual(failed.transcriptionStatus, 'failed');
  assert.strictEqual(failed.summaryStatus, 'failed');
  assert.match(failed.transcriptionError, /service offline/);
  assert.match(failed.summaryError, /service offline/);

  assert.strictEqual(typeof requestBuffer, 'function');
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(
      () => requestBuffer(`http://127.0.0.1:${port}/slow.mp3`, { timeoutMs: 20 }),
      /timed out/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})();
