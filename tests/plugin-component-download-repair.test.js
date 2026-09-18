'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'obsidian') return { Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, requestUrl: async () => { throw Error('Unexpected network'); } };
  return original.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = original;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-diagnostic-test-'));
async function run() {
  const p = new Plugin();
  p.settings = Plugin.__test.mergeSettings({});
  p.manifest = require('../obsidian-plugin/wechat-inbox-sync/manifest.json');
  p.ensureProFeatureAccess = async () => ({ hasAccess: true });
  p.getActiveBindings = () => [{ token: 'fixture-token', label: 'fixture' }];
  p.getConfiguredLocalAsrPlatform = () => 'win32';
  let calls = 0;
  const data = { schemaVersion: 1, metadataOnly: true, component: 'douyin', platform: 'win32', arch: 'x64', version: 'fixture', assets: [{ id: 'resolver', sha256: 'a'.repeat(64), byteLength: 123, downloadUrl: 'https://example.invalid/?sign=private' }] };
  p.requestJson = async (route, method, body, binding) => {
    calls++; assert.ok(route.startsWith('/local-components/version?'));
    assert.equal(method, 'GET'); assert.equal(binding.token, 'fixture-token');
    return { success: true, data };
  };
  for (let i = 0; i < 12; i++) {
    const result = await p.getAuthorizedLocalComponentManifest('douyin', { metadataOnly: true });
    assert.deepEqual(Object.keys(result.assets[0]).sort(), ['byteLength', 'id', 'sha256']);
    assert.equal(result.expiresAt, undefined);
  }
  assert.equal(calls, 12);
  assert.equal(p.lastLocalComponentManifestStatus, undefined);
  const normalize = Plugin.__test.normalizeLocalComponentVersionResponse;
  for (const bad of [{ ...data, platform: 'darwin' }, { ...data, metadataOnly: false }, { ...data, assets: [] }]) {
    assert.throws(() => normalize({ success: true, data: bad }, data), { code: 'INVALID_MANIFEST' });
  }
  p.requestJson = async () => { throw Object.assign(Error('forbidden'), { status: 403 }); };
  await assert.rejects(p.getAuthorizedLocalComponentManifest('douyin', { metadataOnly: true }), e => e.status === 403);
  p.getConfiguredLocalAsrInstallRoot = p.getConfiguredLocalOcrInstallRoot = () => root;
  p.getLocalAsrInstallStatus = p.getLocalOcrInstallStatus = p.getLocalDouyinResolverInstallStatus = () => ({ ready: true });
  p.getRecentXiaohongshuBrowserResults = p.getRecentXiaohongshuCommentResults = p.getRecentSyncFailureCleanupErrors = () => [];
  p.feishuImageDisplay = { diagnostic: () => ({ attempts: 99, detected: 0, shown: 0, failed: 0, pending: 0, active: 0 }) };
  p.getLocalDouyinResolverInstallDiagnostic = () => [
    { attemptId: 'old', time: '2026-09-18T01:00:00Z', source: 'cloudbase', transport: 'system', stage: 'download', status: 'failed', code: 'DOWNLOAD_TIMEOUT', receivedBytes: 8192, elapsedMs: 600000, curlExitCode: 28 },
    { attemptId: 'new', time: '2026-09-18T02:00:00Z', source: 'cloudbase', stage: 'manifest', status: 'failed', code: 'COMPONENT_DOWNLOAD_RATE_LIMITED' },
  ];
  const brief = p.getSyncDiagnosticText(), detailed = p.getSyncDiagnosticText({ detailed: true });
  for (const text of [brief, detailed]) {
    assert.ok(!text.includes('小红书')); assert.ok(!text.includes('飞书图片显示'));
    assert.ok(!text.includes('fixture-token'));
  }
  assert.ok(brief.includes('之前下载失败（非本次）'));
  assert.ok(brief.includes('8192 字节')); assert.ok(brief.includes('curl=28'));
  assert.ok(detailed.length > brief.length);
  p.feishuImageDisplay.diagnostic = () => ({ detected: 1, failed: 1 });
  assert.ok(p.getSyncDiagnosticText().includes('飞书图片显示'));
  // Exercise curl progress and safe errors without network or a real process.
  const modulePath = require.resolve('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');
  delete require.cache[modulePath];
  Module._load = function(name, ...args) {
    if (name === 'child_process') return { execFile(command, args, options, done) {
      assert.equal(args[args.indexOf('--max-time') + 1], '600');
      assert.equal(args[args.indexOf('--speed-time') + 1], '60');
      assert.ok(!args.includes('--insecure')); assert.equal(options.windowsHide, true);
      fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.alloc(321));
      done(Object.assign(Error('private signed URL'), { code: 28 }), '200', 'secret');
    } };
    return original.call(this, name, ...args);
  };
  const utils = require(modulePath); Module._load = original;
  await assert.rejects(utils.downloadResolverViaSystem('https://example.invalid/file?sign=private'), e =>
    e.code === 'DOWNLOAD_TIMEOUT' && e.curlExitCode === 28 && e.receivedBytes === 321 && e.httpStatus === 200 && !e.message.includes('private'));
  console.log('Component metadata, concise diagnostics and downloader regression checks passed');
}
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  Module._load = original;
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw Error('Unsafe cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
