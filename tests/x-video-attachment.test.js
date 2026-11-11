'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, Setting: class {} };
  return load.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = load;
Plugin.prototype.writeSettingsGuard = () => {};
const url = 'https://x.com/i/web/status/123456';
const mediaUrl = 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/video.mp4';
const record = { _id: 'x-video-attachment', type: 'webpage', content: url, createdAt: '2026-11-12T00:00:00Z', metadata: {} };
const video = Buffer.alloc(640); video.write('ftyp', 4); video.write('vide', 48);
const audio = Buffer.alloc(640); audio.write('ftyp', 4); audio.write('soun', 48);
function setup(enabled = true) {
  const plugin = new Plugin(), files = new Map(), folders = new Set(), downloads = [];
  plugin.settings = Plugin.__test.mergeSettings({ inboxDir: 'Inbox', noteSaveMode: 'root', socialArticleImageStorageMode: 'remote', saveOriginalMediaEnabled: enabled });
  plugin.ensureProFeatureAccess = async () => ({ hasAccess: true });
  plugin.ensureFolder = async p => folders.add(p);
  plugin.showSyncProgress = () => {};
  plugin.app = { vault: { create: async (p, text) => files.set(p, text), adapter: {
    exists: async p => files.has(p) || folders.has(p),
    write: async (p, text) => files.set(p, text), read: async p => files.get(p),
    writeBinary: async (p, bytes) => files.set(p, Buffer.from(bytes)),
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    remove: async p => files.delete(p),
  } } };
  plugin.requestXArticleJson = async () => ({ __typename: 'Tweet', id_str: '123456', lang: 'zh', text: '视频标题。', user: { name: '作者' }, mediaDetails: [{ type: 'video', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 256000, url: mediaUrl }] } }] });
  plugin.requestJson = async () => { throw Error('Chinese content needs no translation request'); };
  plugin.saveMarkdownRemoteImageAssets = async md => md;
  plugin.buildTranscriptRecordFromMedia = async r => ({ ...r, metadata: { ...r.metadata, transcription: '实际视频文案。', transcriptionStatus: 'success', transcriptionSegments: [{ startMs: 1000, endMs: 2000, text: '实际视频文案。' }] } });
  plugin.downloadArrayBuffer = async target => { downloads.push(target); return video; };
  return { plugin, files, downloads };
}
async function main() {
  const on = setup();
  const hydrated = await on.plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-12', '视频标题');
  assert.equal(hydrated.metadata.transcriptOnly, false, 'X keeps its bilingual article layout');
  assert.equal(hydrated.metadata.mediaUrl, mediaUrl, 'the extracted video URL must reach attachment saving');
  const saved = await on.plugin.saveSourceMediaAttachment(hydrated, 'Inbox', '2026-11-12', '视频标题');
  assert.equal(on.downloads.length, 1);
  const attachment = saved.metadata.sourceMediaAttachmentPath;
  assert.match(attachment, /^Inbox\/音视频附件\/2026-11-12\/.+\.mp4$/);
  assert.deepEqual(on.files.get(attachment), video);
  const body = Plugin.__test.buildWebpageMarkdownBody(saved, '视频标题');
  assert.match(body, /^# \*\*/); assert.match(body, /\*\*\[00:01\]\*\*/);
  assert.ok(body.includes(`![[${attachment}]]`));
  assert.equal((body.match(/实际视频文案。/g) || []).length, 1, 'adding a video must not duplicate transcription');

  const committed = setup();
  const written = await committed.plugin.writeRecord(record, '2026-11-12T00:01:00Z', null, false, { skipAi: true });
  assert.equal(written.committed, true);
  const binaryPaths = [...committed.files.keys()].filter(p => p.endsWith('.mp4'));
  assert.equal(binaryPaths.length, 1, 'the real note writer must archive the original video');
  assert.ok(committed.files.get(written.filePath).includes(`![[${binaryPaths[0]}]]`));

  const off = setup(false);
  assert.equal(await off.plugin.saveSourceMediaAttachment(hydrated, 'Inbox', 'date', 'title'), hydrated);
  assert.equal(off.downloads.length, 0);
  const denied = setup(); denied.plugin.ensureProFeatureAccess = async () => { throw Error('需要有效 Pro'); };
  const deniedRecord = await denied.plugin.saveSourceMediaAttachment(hydrated, 'Inbox', 'date', 'title');
  assert.equal(denied.downloads.length, 0);
  assert.match(Plugin.__test.buildWebpageMarkdownBody(deniedRecord, 'title'), /需要有效 Pro/);

  for (const mode of ['network', 'audio', 'disk']) {
    const bad = setup();
    if (mode === 'network') bad.plugin.downloadArrayBuffer = async () => { throw Error('network unavailable'); };
    if (mode === 'audio') bad.plugin.downloadArrayBuffer = async () => audio;
    if (mode === 'disk') bad.plugin.app.vault.adapter.writeBinary = async () => { throw Error('disk full'); };
    const failed = await bad.plugin.saveSourceMediaAttachment(hydrated, 'Inbox', 'date', 'title');
    assert.equal(failed.metadata.sourceMediaAttachmentPath, '');
    assert.equal(failed.metadata.markdown, hydrated.metadata.markdown);
    const text = Plugin.__test.buildWebpageMarkdownBody(failed, 'title');
    assert.match(text, /无法保存到本地/); assert.match(text, /实际视频文案/);
    assert.equal(bad.files.size, 0);
  }
  const fallback = setup();
  fallback.plugin.downloadArrayBuffer = async target => { fallback.downloads.push(target); if (target === 'https://video.twimg.com/expired.mp4') throw Error('403'); return video; };
  const recovered = await fallback.plugin.saveSourceMediaAttachment({ ...hydrated, metadata: { ...hydrated.metadata, mediaUrls: ['https://video.twimg.com/expired.mp4', mediaUrl] } }, 'Inbox', 'date', 'title');
  assert.equal(fallback.downloads.length, 2); assert.ok(recovered.metadata.sourceMediaAttachmentPath);
  const listOnly = await setup().plugin.saveSourceMediaAttachment({ ...hydrated, metadata: { ...hydrated.metadata, mediaUrl: '' } }, 'Inbox', 'date', 'title');
  assert.ok(listOnly.metadata.sourceMediaAttachmentPath, 'existing X metadata with only mediaUrls remains supported');
  const missing = await setup().plugin.saveSourceMediaAttachment({ ...hydrated, metadata: { ...hydrated.metadata, mediaUrl: '', mediaUrls: [] } }, 'Inbox', 'date', 'title');
  assert.match(missing.metadata.sourceMediaAttachmentError, /未取得原视频/);
  const article = setup();
  const imageOnly = { ...hydrated, metadata: { ...hydrated.metadata, xVideoDiagnostic: undefined, mediaUrl: '', mediaUrls: [] } };
  assert.equal(await article.plugin.saveSourceMediaAttachment(imageOnly, 'Inbox', 'date', 'title'), imageOnly);
  assert.equal(article.downloads.length, 0);
  console.log('X video original attachment: real writer, setting, Pro, video track, failure preservation and fallback passed.');
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
