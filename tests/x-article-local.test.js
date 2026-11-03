'use strict';
const assert = require('node:assert/strict');
const x = require('../obsidian-plugin/wechat-inbox-sync/src/x-article');
const tweet = { __typename: 'Tweet', id_str: '123456', text: 'First sentence. Second sentence!', user: { name: 'Example' }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }], mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' }] };
const settings = { ...x.DEFAULTS, xAiApiKey: 'test-placeholder' };
const response = data => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
async function main() {
  const legacyDeepSeek = { ...settings, xAiModel: 'deepseek-chat', xAiBaseUrl: 'https://api.deepseek.com/v1' };
  assert.equal(x.demoSettings(legacyDeepSeek).xAiApiKey, 'test-placeholder');
  assert.equal(x.demoSettings(legacyDeepSeek).xAiModel, 'deepseek-flash');
  assert.equal(x.demoSettings(legacyDeepSeek).xAiBaseUrl, 'https://api.deepseek.com');
  assert.equal(legacyDeepSeek.xAiModel, 'deepseek-chat');
  for (const extra of [{ xAiModel: 'kimi-k3.1-pro' }, { xAiBaseUrl: 'https://api.moonshot.ai/v1' }, { xAiBaseUrl: 'https://proxy.example/v1' }]) {
    assert.equal(x.demoSettings({ ...settings, ...extra }).xAiApiKey, '');
  }
  for (const url of ['https://x.com/a/status/123456', 'https://twitter.com/a/status/123456/photo/1', 'https://mobile.x.com/i/web/status/123456']) assert.equal(x.postId(url), '123456');
  for (const url of ['https://x.com.evil.test/a/status/123456', 'https://evil.test/x.com/a/status/123456', 'https://a@x.com/a/status/123456', 'https://x.com/home', 'https://x.com/a/status/123456/evil']) assert.equal(x.postId(url), '');
  const post = x.normalizeTweet(tweet, '123456');
  assert.equal(post.images.length, 1);
  assert.throws(() => x.normalizeTweet(tweet, '999'), /目标推文/);
  assert.throws(() => x.normalizeTweet({}, '123456'), /目标推文/);
  assert.throws(() => x.normalizeTweet({ ...tweet, truncated: true }, '123456'), /完整正文/);
  assert.throws(() => x.normalizeTweet({ ...tweet, photos: [{ url: 'http://localhost/a.jpg' }] }, '123456'), /图片地址/);
  assert.throws(() => x.normalizeTweet({ ...tweet, text: '', photos: [], mediaDetails: [] }, '123456'), /图文内容/);
  const quoted = x.normalizeTweet({ ...tweet, quoted_tweet: { ...tweet, id_str: '987', text: 'Quoted.' } }, '123456');
  assert.match(x.renderPost(quoted), /引用推文/);
  assert.match(x.renderPost(quoted), /status\/987/);
  for (const translate of [false, true]) for (const summarize of [false, true]) {
    const calls = [];
    const ai = await x.processAi(post, { ...settings, xTranslationEnabled: translate, xSummaryEnabled: summarize }, async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      const data = JSON.parse(JSON.parse(options.body).messages[1].content); calls.push(data);
      return response(Array.isArray(data) ? { translations: data.map(r => ({ id: r.id, text: '对应译文' })) } : { summary: '总结' });
    });
    assert.equal(calls.length, Number(translate) + Number(summarize));
    assert.equal(ai.pairs.length, translate ? 2 : 0);
    assert.equal(Boolean(ai.summary), summarize);
    assert.deepEqual(ai.warnings, []);
    if (translate) assert.equal(ai.pairs.map(p => p.original).join(' '), post.text);
    assert.match(x.renderPost(post, ai), /First sentence/);
    assert.match(x.renderPost(post, ai), /pbs.twimg.com\/media\/a.jpg/);
  }
  let calls = 0;
  const missing = await x.processAi(post, { ...x.DEFAULTS, xTranslationEnabled: true }, async () => { calls++; });
  assert.equal(calls, 0); assert.deepEqual(missing.warnings, ['X_AI_CONFIG_REQUIRED']);
  for (const status of [401, 403, 429, 500]) {
    const ai = await x.processAi(post, { ...settings, xSummaryEnabled: true }, async () => { throw Object.assign(new Error('provider-private-response'), { status }); });
    assert.equal(ai.summary, ''); assert.equal(ai.warnings.length, 1); assert.ok(!JSON.stringify(ai).includes('provider-private'));
    assert.match(x.renderPost(post, ai), /原文与图片已保留/);
  }
  const mismatch = await x.processAi(post, { ...settings, xTranslationEnabled: true, xSummaryEnabled: true }, async (_, config) => {
    const data = JSON.parse(JSON.parse(config.body).messages[1].content);
    return response(Array.isArray(data) ? { translations: [{ id: 77, text: 'wrong' }] } : { summary: '总结依然成功' });
  });
  assert.equal(mismatch.pairs.length, 0); assert.equal(mismatch.summary, '总结依然成功'); assert.ok(mismatch.warnings.includes('X_AI_ALIGNMENT_FAILED'));
  const incomplete = await x.processAi(post, { ...settings, xSummaryEnabled: true }, async () => ({ choices: [{ finish_reason: 'length', message: { content: '{"summary":"partial"}' } }] }));
  assert.equal(incomplete.summary, '');
  const oversized = await x.processAi({ ...post, text: 'a'.repeat(120001) }, { ...settings, xSummaryEnabled: true }, async () => { throw Error('must not call'); });
  assert.deepEqual(oversized.warnings, ['X_AI_INPUT_TOO_LARGE']);
  for (const text of ['这是一段中文原文，不需要再次翻译。', '使用 API 设置同步中文内容。', '繁體中文原文也不用翻譯。', '123456']) {
    const skipped = await x.processAi({ text }, { ...settings, xTranslationEnabled: true }, async () => { throw Error('Chinese must not call translation'); });
    assert.deepEqual(skipped, { pairs: [], summary: '', warnings: [] });
  }
  for (const text of ['Hello world.', 'これは日本語です。', '안녕하세요.', 'Bonjour tout le monde.', 'مرحبا بالعالم']) assert.equal(x.needsTranslation(text), true);
  const mixedInputs = [];
  const mixed = await x.processAi({ text: '这是中文内容。 Hello world.' }, { ...settings, xTranslationEnabled: true, xSummaryEnabled: true }, async (_, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content); mixedInputs.push(input);
    return response(Array.isArray(input) ? { translations: input.map(row => ({ id: row.id, text: '你好世界。' })) } : { summary: '中文总结。' });
  });
  assert.equal(mixed.pairs.length, 1); assert.equal(mixed.pairs[0].original, 'Hello world.'); assert.match(mixedInputs[1].text, /这是中文/);
  let longCalls = 0;
  const longText = '这是一篇长文章的正文。'.repeat(1800) + '最后的重要结论。';
  let covered = '';
  const longAi = await x.processAi({ text: longText }, { ...settings, xSummaryEnabled: true }, async (_, options) => {
    const text = JSON.parse(JSON.parse(options.body).messages[1].content).text;
    longCalls++; covered += text; return response({ summary: '摘要片段' });
  });
  assert.ok(longCalls >= 3); assert.ok(covered.includes('最后的重要结论。')); assert.equal(longAi.summary, '摘要片段');
  assert.equal(x.recordText({ type: 'file', content: 'private-file.pdf' }), '');
  assert.equal(x.recordText({ type: 'webpage', content: 'https://example.com', metadata: { conversionStatus: 'failed', markdown: 'failure diagnostic' } }), '');
  assert.equal(x.recordText({ type: 'webpage', content: 'https://example.com', metadata: { conversionStatus: 'success', conversionNote: '抖音图文笔记已保存链接（正文未获取）', markdown: '抖音图文笔记：页面未返回可读正文，已保存链接。\n\n> 失败原因' } }), '');
  assert.equal(x.recordText({ type: 'webpage', metadata: { conversionStatus: 'success', conversionNote: 'Obsidian requestUrl 与 Node.js 均失败，已使用隐藏浏览器通道恢复正文', markdown: '恢复的实际正文' } }), '恢复的实际正文');
  assert.equal(x.recordText({ type: 'text', content: 'https://example.com' }), '');
  assert.equal(x.recordText({ type: 'file', metadata: { convertedMarkdown: '正文 ![[private.png]] ![image](https://private.test)\n[链接文字](https://private.test)' } }), '正文  \n链接文字');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(x.fetchPost(post.url, async () => tweet, controller.signal), { name: 'AbortError' });
  await assert.rejects(x.boundedRequest(() => new Promise(() => {}), 'https://example.test', {}, null, 5), { code: 'X_REQUEST_TIMEOUT' });
  await assert.rejects(x.fetchPost(post.url, async () => { throw Object.assign(Error(), { status: 429 }); }), { code: 'X_RATE_LIMITED' });
  const fetched = await x.fetchPost(post.url, async (url, opts) => { assert.match(url, /^https:\/\/cdn.syndication.twimg.com/); assert.equal(opts.headers.Authorization, undefined); return tweet; });
  assert.equal(fetched.id, '123456');
  assert.throws(() => x.aiConfig({ ...settings, xAiBaseUrl: 'http://example.com/v1' }), /HTTPS/);
  assert.throws(() => x.aiConfig({ ...settings, xAiBaseUrl: 'https://example.com/v1?key=a' }), /HTTPS/);
  assert.equal(x.aiConfig({ ...settings, xAiBaseUrl: 'https://example.com/v1/chat/completions/' }).url, 'https://example.com/v1/chat/completions');
  assert.equal(await x.testConnection(settings, async () => response({ ok: true })), true);
  for (const preset of x.MODEL_PRESETS) {
    assert.equal(await x.testConnection({ ...settings, xAiBaseUrl: preset.baseUrl, xAiModel: preset.model }, async (url, options) => {
      assert.equal(url, preset.baseUrl + '/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, preset.model); assert.equal(body.temperature, undefined);
      if (preset.model === 'deepseek-flash') assert.equal(body.thinking.type, 'disabled');
      else { assert.equal(body.reasoning_effort, 'low'); assert.equal(body.thinking, undefined); }
      if (preset.model === 'MiniMax-M3.1-Flash') assert.equal(body.reasoning_split, true);
      return { choices: [{ message: { content: '<think>internal reasoning</think>\n```json\n{"ok":true}\n```' } }] };
    }), true);
  }
  await x.testConnection({ ...settings, xAiBaseUrl: 'https://example.com/v1', xAiModel: 'deepseek-flash' }, async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.thinking, undefined); assert.equal(body.reasoning_effort, undefined);
    return response({ ok: true });
  });
  const unsafe = x.renderPost({ ...post, text: '<script>evil</script> ![track](https://evil.test)' });
  assert.ok(!unsafe.includes('<script>')); assert.ok(!unsafe.includes('![track]('));
  console.log('x-article-local: all behavior tests passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
