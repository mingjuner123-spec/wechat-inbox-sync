'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      Notice: class {},
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: async () => ({ text: '' }),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js';
const PluginClass = require(pluginMainPath);

const noteDir = '临时收集/2026-08-23';
const sourceTitle = '飞书-LPYgwpZiWiJ8bPkAwX9cE56Enuh';
const targetTitle = '飞书-播放量20w成功起号';
const imageFolder = '文章图片';
const sourceFolder = `${noteDir}/${sourceTitle}`;
const targetFolder = `${noteDir}/${targetTitle}`;
const sourceImageFolder = `${sourceFolder}/${imageFolder}`;
const targetImageFolder = `${targetFolder}/${imageFolder}`;
const feishuUrl = 'https://example.feishu.cn/wiki/LPYgwpZiWiJ8bPkAwX9cE56Enuh';

function createPlugin(adapter, mode = 'local') {
  const plugin = new PluginClass();
  plugin.settings = { socialArticleImageStorageMode: mode };
  plugin.app = { vault: { adapter } };
  return plugin;
}

function createRecord(imageRoot = sourceImageFolder) {
  return {
    metadata: {
      markdown: `正文\n![[${imageRoot}/image-01.png]]`,
      snapshot: `![[${imageRoot}/image-02.png]]`,
      contentSnapshot: `![[${imageRoot}/image-03.png]]`,
    },
  };
}

async function align(plugin, record = createRecord()) {
  return plugin.alignSocialArticleImageFolder(record, {
    sourceUrl: feishuUrl,
    noteDir,
    assetFolderTitle: sourceTitle,
    fileTitle: targetTitle,
  });
}

async function run() {
  const renames = [];
  const plugin = createPlugin({
    async exists(path) { return path === sourceImageFolder; },
    async rename(from, to) { renames.push({ from, to }); },
  });
  const result = await align(plugin);
  assert.strictEqual(result.folderName, targetTitle);
  assert.deepStrictEqual(renames, [{ from: sourceFolder, to: targetFolder }]);
  assert.ok(result.record.metadata.markdown.includes(`${targetImageFolder}/image-01.png`));
  assert.ok(result.record.metadata.snapshot.includes(`${targetImageFolder}/image-02.png`));
  assert.ok(result.record.metadata.contentSnapshot.includes(`${targetImageFolder}/image-03.png`));
  assert.strictEqual(result.record.metadata.markdown.includes(sourceImageFolder), false);
  assert.strictEqual(result.sourceImagePath, `${sourceImageFolder}/`);
  assert.strictEqual(result.targetImagePath, `${targetImageFolder}/`);

  const collisionRenames = [];
  const collisionPlugin = createPlugin({
    async exists(path) { return path === sourceImageFolder || path === targetFolder; },
    async rename(from, to) { collisionRenames.push({ from, to }); },
  });
  const collision = await align(collisionPlugin);
  assert.strictEqual(collision.folderName, sourceTitle);
  assert.deepStrictEqual(collisionRenames, []);
  assert.ok(collision.record.metadata.markdown.includes(sourceImageFolder));

  const failurePlugin = createPlugin({
    async exists(path) { return path === sourceImageFolder; },
    async rename() { throw new Error('rename failed'); },
  });
  const failed = await align(failurePlugin);
  assert.strictEqual(failed.folderName, sourceTitle);
  assert.ok(failed.record.metadata.markdown.includes(sourceImageFolder));

  const existsFailureRenames = [];
  const existsFailurePlugin = createPlugin({
    async exists() { throw new Error('exists failed'); },
    async rename(from, to) { existsFailureRenames.push({ from, to }); },
  });
  const existsFailed = await align(existsFailurePlugin);
  assert.strictEqual(existsFailed.folderName, sourceTitle);
  assert.ok(existsFailed.record.metadata.markdown.includes(sourceImageFolder));
  assert.deepStrictEqual(existsFailureRenames, []);

  const targetReadyRenames = [];
  const targetReadyPlugin = createPlugin({
    async exists(path) { return path === targetImageFolder; },
    async rename(from, to) { targetReadyRenames.push({ from, to }); },
  });
  const targetReady = await align(targetReadyPlugin, createRecord(targetImageFolder));
  assert.strictEqual(targetReady.folderName, targetTitle);
  assert.deepStrictEqual(targetReadyRenames, []);
  const targetReadyWithSourceReferences = await align(targetReadyPlugin);
  assert.strictEqual(targetReadyWithSourceReferences.folderName, targetTitle);
  assert.ok(targetReadyWithSourceReferences.record.metadata.markdown.includes(targetImageFolder));
  assert.strictEqual(
    targetReadyWithSourceReferences.record.metadata.markdown.includes(sourceImageFolder),
    false,
  );
  assert.deepStrictEqual(targetReadyRenames, []);

  const missingSourcePlugin = createPlugin({
    async exists() { return false; },
    async rename() { throw new Error('rename must not run without source assets'); },
  });
  const missingSource = await align(missingSourcePlugin);
  assert.strictEqual(missingSource.folderName, sourceTitle);
  assert.ok(missingSource.record.metadata.markdown.includes(sourceImageFolder));

  const missingSourceWithoutReferences = await align(missingSourcePlugin, {
    metadata: {
      markdown: '正文（无本地图片）',
      snapshot: '正文快照',
      contentSnapshot: 'https://example.com/remote-image.png',
    },
  });
  assert.strictEqual(missingSourceWithoutReferences.folderName, targetTitle);
  assert.strictEqual(missingSourceWithoutReferences.record.metadata.markdown, '正文（无本地图片）');

  const remoteRenames = [];
  const remotePlugin = createPlugin({
    async exists() { return true; },
    async rename(from, to) { remoteRenames.push({ from, to }); },
  }, 'remote');
  const remote = await align(remotePlugin);
  assert.strictEqual(remote.folderName, targetTitle);
  assert.deepStrictEqual(remoteRenames, []);

  const missingAdapter = createPlugin({});
  const adapterFallback = await align(missingAdapter);
  assert.strictEqual(adapterFallback.folderName, sourceTitle);
  assert.ok(adapterFallback.record.metadata.markdown.includes(sourceImageFolder));

  const writeRenames = [];
  const ensuredFolders = [];
  const createdNotes = [];
  const writePlugin = createPlugin({
    async exists(path) { return path === sourceImageFolder; },
    async rename(from, to) { writeRenames.push({ from, to }); },
    async write() {},
    async remove() {},
  });
  writePlugin.settings = {
    inboxDir: noteDir.split('/')[0],
    noteSaveMode: 'date',
    notePropertyFields: [],
    socialArticleImageStorageMode: 'local',
  };
  writePlugin.showSyncProgress = () => {};
  writePlugin.ensureFolder = async (path) => { ensuredFolders.push(path); };
  let titleCall = 0;
  writePlugin.nextRecordTitle = async () => (
    titleCall++ === 0 ? sourceTitle : targetTitle
  );
  writePlugin.hydrateWebpageMarkdown = async (record) => ({
    ...record,
    metadata: {
      ...record.metadata,
      title: targetTitle,
      markdown: `\u6b63\u6587\n![[${sourceImageFolder}/image-01.png]]`,
      snapshot: `![[${sourceImageFolder}/image-02.png]]`,
    },
  });
  writePlugin.saveSourceMediaAttachment = async (record) => record;
  writePlugin.enrichRecordMetadataWithAi = async (record) => record;
  writePlugin.app.vault.create = async (path, markdown) => { createdNotes.push({ path, markdown }); };
  const writeResult = await writePlugin.writeRecord({
    id: 'feishu-folder-cohesion-write-record',
    type: 'webpage',
    content: feishuUrl,
    createdAt: '2026-08-23T10:00:00.000Z',
    metadata: { url: feishuUrl },
  }, '2026-08-23T10:01:00.000Z');
  const expectedNotePath = `${targetFolder}/${targetTitle}.md`;
  assert.strictEqual(writeResult.filePath, expectedNotePath);
  assert.deepStrictEqual(writeRenames, [{ from: sourceFolder, to: targetFolder }]);
  assert.ok(ensuredFolders.includes(targetFolder));
  assert.strictEqual(createdNotes.length, 1);
  assert.strictEqual(createdNotes[0].path, expectedNotePath);
  assert.ok(createdNotes[0].markdown.includes(targetImageFolder));
  assert.strictEqual(createdNotes[0].markdown.includes(sourceImageFolder), false);

  const noAssetRenames = [];
  const noAssetCreatedNotes = [];
  const noAssetWritePlugin = createPlugin({
    async exists() { return false; },
    async rename(from, to) { noAssetRenames.push({ from, to }); },
    async write() {},
    async remove() {},
  });
  noAssetWritePlugin.settings = {
    inboxDir: noteDir.split('/')[0],
    noteSaveMode: 'date',
    notePropertyFields: [],
    socialArticleImageStorageMode: 'local',
  };
  noAssetWritePlugin.showSyncProgress = () => {};
  noAssetWritePlugin.ensureFolder = async () => {};
  let noAssetTitleCall = 0;
  noAssetWritePlugin.nextRecordTitle = async () => (
    noAssetTitleCall++ === 0 ? sourceTitle : targetTitle
  );
  noAssetWritePlugin.hydrateWebpageMarkdown = async (record) => ({
    ...record,
    metadata: {
      ...record.metadata,
      title: targetTitle,
      markdown: '正文（无本地图片）',
      snapshot: '正文快照',
      contentSnapshot: 'https://example.com/remote-image.png',
    },
  });
  noAssetWritePlugin.saveSourceMediaAttachment = async (record) => record;
  noAssetWritePlugin.enrichRecordMetadataWithAi = async (record) => record;
  noAssetWritePlugin.app.vault.create = async (path, markdown) => {
    noAssetCreatedNotes.push({ path, markdown });
  };
  const noAssetWriteResult = await noAssetWritePlugin.writeRecord({
    id: 'feishu-folder-cohesion-no-assets',
    type: 'webpage',
    content: feishuUrl,
    createdAt: '2026-08-23T10:02:00.000Z',
    metadata: { url: feishuUrl },
  }, '2026-08-23T10:03:00.000Z');
  assert.strictEqual(noAssetWriteResult.filePath, expectedNotePath);
  assert.deepStrictEqual(noAssetRenames, []);
  assert.strictEqual(noAssetCreatedNotes.length, 1);
  assert.strictEqual(noAssetCreatedNotes[0].path, expectedNotePath);
  assert.ok(noAssetCreatedNotes[0].markdown.includes('正文（无本地图片）'));

  console.log('plugin social article folder cohesion tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
