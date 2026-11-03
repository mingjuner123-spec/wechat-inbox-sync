'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
let requestMock;
const controls = [];
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.options = options; this.children = []; this.attributes = options.attr || {}; }
  createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const modals = [], notices = [];
class Modal {
  constructor() { this.contentEl = new Element(); modals.push(this); }
  open() { this.opened = true; }
}
class Setting {
  constructor() { this.entry = { controls: [] }; controls.push(this.entry); }
  setName(name) { this.entry.name = name; return this; }
  setDesc(value) { this.entry.description = value; return this; }
  control(callback) { const c = { inputEl: new Element('input'), setPlaceholder() { return c; }, setValue(v) { c.value = v; return c; }, onChange(fn) { c.change = fn; return c; }, onClick(fn) { c.click = fn; return c; }, setButtonText(v) { c.label = v; return c; }, setDisabled(v) { c.disabled = v; return c; } }; this.entry.control = c; this.entry.controls.push(c); callback(c); return this; }
  addText(cb) { return this.control(cb); } addToggle(cb) { return this.control(cb); } addButton(cb) { return this.control(cb); }
  addDropdown(cb) { return this.control(c => { c.selectEl = new Element('select'); c.options = {}; c.addOption = (value, label) => { c.options[value] = label; return c; }; cb(c); }); }
}
const load = Module._load;
Module._load = function (name, ...rest) { if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal, Notice: class { constructor(message) { notices.push(message); } }, Setting, requestUrl: (...args) => requestMock(...args) }; return load.call(this, name, ...rest); };
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = load;
const x = require('../obsidian-plugin/wechat-inbox-sync/src/x-article');
const tweet = { __typename: 'Tweet', id_str: '123456', text: 'Hello world. Another sentence.', user: { name: 'Example' }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }, { url: 'https://pbs.twimg.com/media/b.jpg' }] };
async function main() {
  const plugin = new Plugin(); plugin.settings = Plugin.__test.mergeSettings({ deepseekApiKey: 'legacy-placeholder', xTranslationEnabled: 'true', xSummaryEnabled: 1 });
  assert.equal(plugin.settings.xTranslationEnabled, false); assert.equal(plugin.settings.xSummaryEnabled, false); assert.equal(plugin.settings.xAiApiKey, '');
  assert.equal(Plugin.__test.mergeSettings({}).xAiModel, 'deepseek-flash');
  for (const model of ['deepseek-chat', 'custom-model']) assert.equal(Plugin.__test.mergeSettings({ xAiModel: model }).xAiModel, model);
  let requests = [];
  requestMock = async opts => { requests.push(opts); return { status: 200, json: tweet }; };
  plugin.saveMarkdownRemoteImageAssets = async md => md;
  const record = { type: 'webpage', content: 'https://x.com/example/status/123456', metadata: { transcriptOnly: true, webpageMediaType: 'audio_video', transcriptionStatus: 'failed' } };
  const original = JSON.stringify(record);
  let result = await plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-02', 'title');
  assert.equal(JSON.stringify(record), original); assert.equal(requests.length, 1);
  assert.equal(result.metadata.conversionStatus, 'success'); assert.equal(result.metadata.transcriptOnly, false); assert.equal(result.metadata.transcriptionStatus, undefined); assert.equal(result.metadata.xImageCount, 2);
  assert.equal(await plugin.enrichRecordMetadataWithAi(result), result);
  assert.ok(!Plugin.__test.getSyncLifecycleOutcomeError(result));
  assert.match(Plugin.__test.buildWebpageMarkdownBody(result, 'title'), /Hello world/);
  // Exercise real ingestion routes and the atomic note writer, not just hydration.
  const files = new Map();
  plugin.settings = { ...plugin.settings, inboxDir: 'Inbox', noteSaveMode: 'root', socialArticleImageStorageMode: 'remote' };
  plugin.app = { vault: { create: async (p, value) => { assert.equal(files.has(p), false); files.set(p, value); }, adapter: {
    exists: async p => files.has(p), write: async (p, value) => { files.set(p, value); },
    read: async p => files.get(p), rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    remove: async p => { files.delete(p); },
  } } };
  plugin.ensureFolder = async () => {}; plugin.showSyncProgress = () => {};
  plugin.saveSourceMediaAttachment = async r => r;
  for (const type of ['link', 'text', 'webpage']) {
    plugin.nextRecordTitle = async () => `X-${type}`;
    const written = await plugin.writeRecord({ _id: `x-${type}`, type, content: type === 'text' ? 'Read this: https://x.com/example/status/123456' : record.content, createdAt: '2026-11-02T00:00:00Z', metadata: {} }, '2026-11-02T00:01:00Z');
    assert.equal(written.committed, true); assert.match(files.get(written.filePath), /Hello world/); assert.match(files.get(written.filePath), /pbs.twimg.com\/media\/b.jpg/);
  }
  plugin.settings = { ...plugin.settings, xSummaryEnabled: true, xAiApiKey: 'test-placeholder' };
  requestMock = async opts => opts.method === 'GET' ? { status: 200, json: tweet } : { status: 429, json: { error: { message: 'provider-secret' } } };
  result = await plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-02', 'title');
  assert.equal(result.metadata.conversionStatus, 'success');
  const failedAi = await plugin.appendAdvancedAi(result.metadata.markdown, result);
  assert.match(failedAi, /X_AI_RATE_LIMITED/); assert.match(failedAi, /pbs.twimg.com/); assert.ok(!failedAi.includes('provider-secret'));
  requestMock = async () => ({ status: 200, json: {} });
  result = await plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-02', 'title');
  assert.equal(result.metadata.conversionStatus, 'link_saved'); assert.ok(Plugin.__test.getSyncLifecycleOutcomeError(result));
  let limitedCalls = 0; requestMock = async () => { limitedCalls++; return { status: 429 }; };
  await plugin.hydrateWebpageMarkdown(record, 'Inbox', 'date', 'title');
  await plugin.hydrateWebpageMarkdown(record, 'Inbox', 'date', 'title');
  assert.equal(limitedCalls, 1, '429 must pause further X access in this plugin session');
  requestMock = async () => { throw Error('non-X should use cached markdown'); };
  const other = await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: 'https://example.com/page', metadata: { markdown: 'Existing article' } }, 'Inbox', 'date', 'title');
  assert.equal(other.metadata.markdown, 'Existing article');
  // The shared writer appends AI output after extraction, for every platform/type.
  const hydrateOriginal = plugin.hydrateWebpageMarkdown;
  const enrichOriginal = plugin.enrichRecordMetadataWithAi;
  plugin.hydrateWebpageMarkdown = async r => r;
  plugin.enrichRecordMetadataWithAi = async r => r;
  plugin.writeFileAttachment = async r => r;
  plugin.writeVoiceAttachment = async r => r;
  plugin.nextTitle = async (_, title) => title;
  let summaryCalls = 0;
  requestMock = async options => {
    summaryCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.model, plugin.settings.xAiModel);
    assert.ok(JSON.parse(body.messages[1].content).text.includes('实际正文'));
    return { status: 200, json: { choices: [{ message: { content: '{"summary":"全平台总结成功"}' } }] } };
  };
  const cases = [
    ...['微信', '飞书', '小红书', '普通网页', 'X'].map(platform => ({ type: 'webpage', content: 'https://example.com/' + encodeURIComponent(platform), metadata: { markdown: '实际正文 ![图片](https://pbs.twimg.com/media/a.jpg)', platform } })),
    { type: 'text', content: '实际正文，来自纯文字收集。', metadata: {} },
    { type: 'file', content: 'document.pdf', metadata: { convertedMarkdown: '实际正文，来自文档。' } },
    { type: 'file', content: 'image.png', metadata: { convertedMarkdown: '实际正文，来自图片OCR。' } },
    { type: 'voice', content: 'audio.mp3', metadata: { transcription: '实际正文，来自语音。', transcriptionStatus: 'success' } },
    { type: 'webpage', content: 'https://example.com/video', metadata: { transcriptOnly: true, transcription: '实际正文，来自视频。', transcriptionStatus: 'success' } },
  ];
  for (const [index, source] of cases.entries()) {
    const r = { ...source, _id: 'all-platform-' + index, createdAt: '2026-11-02', metadata: { ...source.metadata, sourceMetadataComplete: true, ...(source.type === 'text' ? {} : { conversionStatus: 'success' }) } };
    plugin.nextRecordTitle = async () => 'all-platform-' + index;
    const written = await plugin.writeRecord(r, '2026-11-02');
    assert.equal(written.committed, true); assert.match(files.get(written.filePath), /实际正文/); assert.match(files.get(written.filePath), /## AI 总结\n\n全平台总结成功/);
  }
  assert.equal(summaryCalls, cases.length);
  plugin.nextRecordTitle = async () => 'wechat-reextract';
  const recovered = await plugin.writeRecord({ type: 'webpage', content: 'https://mp.weixin.qq.com/s/reextract-fixture', createdAt: '2026-11-02', metadata: { markdown: '实际正文，来自重新提取的公众号。', conversionStatus: 'success' } }, '2026-11-02', null, false, { skipAi: true });
  assert.match(files.get(recovered.filePath), /全平台总结成功/);
  const captured = { _id: 'captured', type: 'webpage', content: 'https://example.com/captured', createdAt: '2026-11-02', metadata: { transcriptOnly: true, transcription: '实际正文，来自捕获通道。', transcriptionStatus: 'success', conversionStatus: 'success', sourceMetadataComplete: true } };
  plugin.nextRecordTitle = async () => 'captured-content';
  const capturedNote = await plugin.writeCapturedWechatChannelsRecord(captured, '2026-11-02');
  assert.match(files.get(capturedNote.filePath), /全平台总结成功/); assert.equal(summaryCalls, cases.length + 2);
  const unavailable = { type: 'webpage', content: 'https://www.douyin.com/note/123', metadata: { conversionStatus: 'success', conversionNote: '抖音图文笔记已保存链接（正文未获取）', markdown: '抖音图文笔记：页面未返回可读正文，已保存链接。\n\n> 失败原因' } };
  assert.equal(await plugin.appendAdvancedAi(unavailable.metadata.markdown, unavailable), unavailable.metadata.markdown);
  assert.equal(summaryCalls, cases.length + 2, 'no-body success records must not call AI');
  plugin.settings.xSummaryEnabled = false; plugin.settings.xTranslationEnabled = true;
  const chineseOnly = await plugin.appendAdvancedAi('原文与图片', { type: 'text', content: '这是一段中文，不需要翻译。' });
  assert.equal(chineseOnly, '原文与图片'); assert.equal(summaryCalls, cases.length + 2);
  plugin.settings.xSummaryEnabled = true; plugin.settings.xTranslationEnabled = false;
  requestMock = async () => ({ status: 500, json: { message: 'private-server-response' } });
  plugin.nextRecordTitle = async () => 'ai-failure-preserves-note';
  const failureNote = await plugin.writeRecord({ type: 'text', content: '实际正文不能丢失。', createdAt: '2026-11-02', metadata: {} }, '2026-11-02');
  assert.equal(failureNote.committed, true); assert.match(files.get(failureNote.filePath), /实际正文不能丢失/); assert.match(files.get(failureNote.filePath), /X_AI_REQUEST_FAILED/);
  assert.ok(!files.get(failureNote.filePath).includes('private-server-response'));
  plugin.hydrateWebpageMarkdown = hydrateOriginal; plugin.enrichRecordMetadataWithAi = enrichOriginal;
  const tab = Object.create(Plugin.__test.WechatInboxSettingTab.prototype); tab.plugin = plugin; plugin.settings = { ...x.DEFAULTS }; let saves = 0; plugin.saveSettings = async () => { saves++; };
  const container = new Element();
  tab.renderXArticleSettings(container);
  assert.deepEqual(controls.map(c => c.name), ['API 模型', 'API Key', 'API 地址', '连接', '多语言翻译', 'AI 总结']);
  assert.ok(controls.every(c => !c.description || c.description === '默认统一翻译为中文，中文内容不翻译。'));
  assert.ok(container.children.some(child => child.tag === 'details'), 'AI settings stay collapsed within the accepted single-page design');
  const translation = controls.find(c => c.name === '多语言翻译').control;
  const summary = controls.find(c => c.name === 'AI 总结').control;
  assert.equal(translation.value, false); assert.equal(summary.value, false);
  await summary.change(true); assert.equal(plugin.settings.xSummaryEnabled, true); assert.equal(plugin.settings.xTranslationEnabled, false);
  await translation.change(true); assert.equal(plugin.settings.xTranslationEnabled, true); assert.equal(saves, 2);
  assert.equal(controls.find(c => c.name === 'API Key').control.inputEl.type, 'password');
  const modelControl = controls.find(c => c.name === 'API 模型').control;
  const addressControl = controls.find(c => c.name === 'API 地址').control;
  assert.equal(modelControl.value, 'DeepSeek · V4.1 Flash'); assert.equal(modelControl.inputEl.readOnly, true);
  assert.equal(addressControl.value, 'https://api.deepseek.com'); assert.equal(addressControl.inputEl.readOnly, true);
  assert.ok(!controls.some(c => c.controls.some(item => item.selectEl)), 'Demo has no provider dropdown');
  await controls.find(c => c.name === 'API Key').control.change(' test-placeholder ');
  const buttons = controls.find(c => c.name === '连接').controls;
  assert.deepEqual(buttons.map(c => c.label), ['测试', '教程']);
  let tested = 0;
  requestMock = async opts => {
    tested++; assert.equal(opts.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(opts.body).model, 'deepseek-flash');
    assert.equal(opts.headers.Authorization, 'Bearer test-placeholder');
    return { status: 200, json: { choices: [{ message: { content: '{"ok":true}' } }] } };
  };
  await buttons[0].click(); assert.equal(tested, 1); assert.equal(notices.at(-1), '连接成功');
  requestMock = async () => { throw new Error('private-provider-message'); };
  await buttons[0].click(); assert.equal(buttons[0].disabled, false); assert.ok(!notices.at(-1).includes('private-provider-message'));
  await buttons[1].click(); assert.equal(modals.at(-1).opened, true);
  const tutorialText = JSON.stringify(modals.at(-1).contentEl);
  assert.ok(!/Kimi|MiniMax|moonshot|minimax/.test(tutorialText));
  const mismatchSettings = { ...x.DEFAULTS, xSummaryEnabled: true, xAiModel: 'kimi-k3.1-pro', xAiBaseUrl: 'https://api.deepseek.com/v1', xAiApiKey: 'synthetic-old-key' };
  plugin.settings = { ...mismatchSettings };
  const controlOffset = controls.length; const savesBeforeRender = saves;
  tab.renderXArticleSettings(new Element());
  assert.deepEqual(plugin.settings, mismatchSettings); assert.equal(saves, savesBeforeRender);
  const mismatchControls = controls.slice(controlOffset);
  assert.equal(mismatchControls.find(c => c.name === 'API Key').control.value, '');
  let wrongProviderCalls = 0;
  requestMock = async () => { wrongProviderCalls++; throw Error('must not send old key'); };
  await mismatchControls.find(c => c.name === '连接').controls[0].click();
  const blockedNote = await plugin.appendAdvancedAi('原文', {type:'text',content:'实际正文'});
  assert.match(blockedNote, /X_AI_CONFIG_REQUIRED/); assert.equal(wrongProviderCalls, 0);
  await mismatchControls.find(c => c.name === 'API Key').control.change('new-deepseek-placeholder');
  assert.equal(plugin.settings.xAiModel, 'deepseek-flash'); assert.equal(plugin.settings.xAiBaseUrl, 'https://api.deepseek.com');
  requestMock = async opts => {
    assert.equal(opts.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(opts.body).model, 'deepseek-flash');
    assert.equal(opts.headers.Authorization, 'Bearer new-deepseek-placeholder');
    return {status:200,json:{choices:[{message:{content:'{"summary":"DeepSeek summary"}'}}]}};
  };
  assert.match(await plugin.appendAdvancedAi('原文', {type:'text',content:'实际正文'}), /DeepSeek summary/);
  let diagnosticCalls = 0;
  plugin.copySupportDiagnosticText = async () => { diagnosticCalls++; return true; };
  tab.renderDiagnosticSetting(container);
  const diagnostic = controls.find(c => c.name === '诊断信息');
  assert.equal(diagnostic.controls.length, 1); assert.equal(diagnostic.control.label, '复制诊断');
  await diagnostic.control.click(); assert.equal(diagnosticCalls, 1); assert.equal(notices.at(-1), '诊断已复制');
  plugin.copySupportDiagnosticText = async () => { throw new Error('clipboard unavailable'); };
  await diagnostic.control.click(); assert.match(notices.at(-1), /复制失败/);
  assert.equal(plugin.startTranscriptMediaPlayer, undefined);
  const fs = require('node:fs');
  const path = require('node:path');
  const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'x-diagnostic-test-'));
  fs.writeFileSync(path.join(fixture, 'install.log'), 'Install failed: missing ffmpeg; api_key=synthetic-test-secret\n');
  fs.writeFileSync(path.join(fixture, 'transcribe-last.log'), 'unrelated-successful-transcript');
  fs.writeFileSync(path.join(fixture, 'sync-last.log'), 'unrelated-successful-note');
  const diagPlugin = new Plugin();
  diagPlugin.settings = Plugin.__test.mergeSettings({ xAiApiKey: 'synthetic-test-secret' });
  diagPlugin.lastSyncDiagnostic = { status: 'success', message: 'unrelated-current-success' };
  diagPlugin.getConfiguredLocalAsrInstallRoot = () => fixture;
  diagPlugin.getConfiguredLocalOcrInstallRoot = () => fixture;
  diagPlugin.getConfiguredLocalAsrPlatform = () => 'win32';
  diagPlugin.getRecentSyncFailures = () => [];
  diagPlugin.getActiveBindings = () => [];
  let diagnosticText;
  diagPlugin.copyDiagnosticText = async text => { diagnosticText = text; return true; };
  await diagPlugin.copySupportDiagnosticText();
  assert.match(diagnosticText, /未恢复失败记录：0/);
  assert.match(diagnosticText, /组件可用：否/);
  assert.match(diagnosticText, /Install failed: missing ffmpeg/);
  for (const excluded of ['synthetic-test-secret', 'unrelated-successful-transcript', 'unrelated-successful-note', 'unrelated-current-success']) assert.ok(!diagnosticText.includes(excluded));
  diagPlugin.getLocalAsrInstallStatus = () => ({ ready: true, missingReasons: [], installRoot: fixture });
  diagPlugin.getLocalOcrInstallStatus = () => ({ ready: false, hasPython: false, hasScript: true, missingReasons: ['OCR 环境缺失测试'] });
  await diagPlugin.copySupportDiagnosticText();
  assert.match(diagnosticText, /组件可用：是/); assert.match(diagnosticText, /OCR 可用：否/); assert.match(diagnosticText, /OCR 环境缺失测试/);
  diagPlugin.getSyncDiagnosticText = () => '同步'.repeat(40000);
  diagPlugin.getLocalAsrDiagnosticText = options => { assert.equal(options.installationOnly, true); return '安装'.repeat(40000); };
  await diagPlugin.copySupportDiagnosticText();
  assert.ok(Buffer.byteLength(diagnosticText, 'utf8') <= 32768 + 16384 + 2);
  const bundle = fs.readFileSync(require.resolve('../obsidian-plugin/wechat-inbox-sync/main'), 'utf8');
  for (const removed of ['分段转写时间戳', '播放器截图按钮', '复制本次失败', '复制完整诊断', 'wb-transcript-screenshot', 'wb-transcript-seek']) assert.ok(!bundle.includes(removed), `removed feature remains: ${removed}`);
  console.log('x-article-integration: all behavior tests passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
