'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const notices = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return {
    Modal: class {}, Notice: class { constructor(message) { notices.push(message); } },
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
    requestUrl: async () => { throw Error('Unexpected network'); },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync/main.js'));
Module._load = originalLoad;
function fixture({ access = 'active', ready = false, provider = 'off', platform = 'win32', accept = true } = {}) {
  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({ aiProvider: provider });
  plugin.saveData = async () => {};
  const calls = { prompt: 0, install: 0, transcribe: 0, cloud: 0 };
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: access === 'active', status: access,
    expiresAt: new Date(Date.now() + (access === 'expired' ? -1 : 1) * 86400000).toISOString() });
  plugin.getConfiguredLocalAsrPlatform = () => platform;
  plugin.canRunLocalTranscription = () => ready;
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready, platformName: platform, missingComponents: ready ? [] : ['音视频转写'],
    asrStatus: { ready }, ocrStatus: { ready: true }, resolverStatus: { ready: true },
  });
  plugin.confirmLocalComponentInstall = async () => { calls.prompt++; return accept; };
  plugin.installLocalTranscriptionComponents = async () => { calls.install++; ready = true; };
  // Exercise the real permission/component gate without downloading or spawning ASR.
  plugin.runLocalTranscription = async () => {
    try {
      await plugin.ensureLocalComponentReadyForUse('音视频转写', { requireAsr: true, reason: 'first-use' });
    } catch (error) { error.transcriptionSetupRequired = true; throw error; }
    calls.transcribe++;
    return '正常文案';
  };
  plugin.runCloudFallbackTranscription = async () => { calls.cloud++; throw Error('Unexpected cloud fallback'); };
  return { plugin, calls };
}
async function main() {
  for (const platform of ['win32', 'darwin']) {
    const { plugin, calls } = fixture({ platform });
    const result = await plugin.runConfiguredTranscription('https://example.test/video.mp4');
    assert.equal(result.transcription, '正常文案');
    assert.deepEqual(calls, { prompt: 1, install: 1, transcribe: 1, cloud: 0 });
  }
  for (const access of ['inactive', 'missing_redeem_code', 'expired', 'unbound']) {
    for (const provider of ['off', 'local']) {
      const { plugin, calls } = fixture({ access, provider });
      plugin.runLocalTranscription = Plugin.prototype.runLocalTranscription;
      await assert.rejects(plugin.runConfiguredTranscription('https://example.test/audio.mp3', { allowCloudUrlFallback: true }), error => {
        if (access !== 'unbound') { assert.match(error.message, /领取.*开通/); assert.match(error.message, /安装／更新本地组件/); }
        if (access === 'expired') assert.match(error.message, /过期/);
        if (access === 'unbound') assert.match(error.message, /绑定/);
        assert.equal(error.code, access === 'unbound' ? 'LOCAL_TRANSCRIPTION_BINDING_REQUIRED' : 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED');
        return true;
      });
      assert.deepEqual(calls, { prompt: 0, install: 0, transcribe: 0, cloud: 0 });
    }
  }
  const healthy = fixture({ ready: true });
  await healthy.plugin.runConfiguredTranscription('https://example.test/video.mp4');
  assert.deepEqual(healthy.calls, { prompt: 0, install: 0, transcribe: 1, cloud: 0 });
  const declined = fixture({ accept: false });
  await assert.rejects(declined.plugin.runConfiguredTranscription('https://example.test/video.mp4'), /需要先安装/);
  await assert.rejects(declined.plugin.runConfiguredTranscription('https://example.test/video.mp4'), /稍后再试/);
  assert.deepEqual(declined.calls, { prompt: 1, install: 0, transcribe: 0, cloud: 0 });
  const unavailable = fixture();
  unavailable.plugin.getProFeatureAccessStatus = async () => { throw Error('权限服务网络异常'); };
  const noticeCount = notices.length;
  await assert.rejects(unavailable.plugin.runConfiguredTranscription('https://example.test/video.mp4'), /权限服务网络异常/);
  assert.equal(notices.length, noticeCount, 'query failure must not become a membership upsell');
  assert.deepEqual(unavailable.calls, { prompt: 0, install: 0, transcribe: 0, cloud: 0 });
  const legacy = fixture({ provider: 'aliyun' });
  legacy.plugin.runAliyunTranscription = async () => '已有服务文案';
  assert.equal((await legacy.plugin.runConfiguredTranscription('https://example.test/audio.mp3')).transcription, '已有服务文案');
  assert.deepEqual(legacy.calls, { prompt: 0, install: 0, transcribe: 0, cloud: 0 });
  for (const access of ['active', 'inactive']) {
    const { plugin, calls } = fixture({ access });
    plugin.app = { vault: { adapter: { writeBinary: async () => {} } } };
    plugin.ensureFolder = async () => {};
    plugin.requestFileDownloadUrl = async () => 'https://example.test/audio.mp3';
    plugin.downloadArrayBuffer = async () => Buffer.from('audio');
    plugin.showSyncProgress = () => {};
    const record = { id: 'voice-fixture', type: 'voice', metadata: { audioFileID: 'fixture-audio', audioFileName: 'voice.mp3' } };
    if (access === 'inactive') await assert.rejects(plugin.writeVoiceAttachment(record, 'inbox', '2026-10-14', 'voice'), e => e.setupRequired && e.code === 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED');
    else assert.equal((await plugin.writeVoiceAttachment(record, 'inbox', '2026-10-14', 'voice')).metadata.transcriptionStatus, 'success');
    assert.equal(calls.transcribe, access === 'active' ? 1 : 0);
    const count = { ...calls };
    const completed = await plugin.writeVoiceAttachment({ ...record, metadata: { ...record.metadata,
      transcription: '已有文案', transcriptionStatus: 'success' } }, 'inbox', '2026-10-14', 'voice');
    assert.equal(completed.metadata.transcription, '已有文案');
    assert.deepEqual(calls, count, 'existing transcript must not prompt or transcribe again');
  }
  const media = fixture({ access: 'inactive' });
  media.plugin.runLocalTranscription = Plugin.prototype.runLocalTranscription;
  media.plugin.showSyncProgress = () => {};
  const beforeMediaNotices = notices.length;
  await assert.rejects(media.plugin.buildTranscriptRecordFromMedia({ id: 'media-fixture', metadata: {} }, {
    url: 'https://www.douyin.com/video/123', platform: '抖音',
    mediaUrls: ['https://example.test/a.mp4', 'https://example.test/b.mp4'],
  }), e => e.setupRequired && e.code === 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED');
  assert.equal(notices.length - beforeMediaNotices, 1, 'alternate media must not repeat a setup prompt');
  const subtitleNotices = notices.length;
  const subtitled = await media.plugin.buildTranscriptRecordFromMedia({ id: 'subtitle-fixture', metadata: {} }, {
    url: 'https://example.test/video', platform: '视频号', subtitleText: '已有字幕',
  });
  assert.equal(subtitled.metadata.transcription, '已有字幕');
  assert.equal(notices.length, subtitleNotices, 'subtitles do not need ASR installation');
  assert.ok(notices.some(message => /领取.*开通/.test(message)));
  const setup = require('../obsidian-plugin/wechat-inbox-sync/src/transcription-setup-utils');
  const noticeUtils = require('../obsidian-plugin/wechat-inbox-sync/src/progress-notice-utils');
  for (const bound of [false, true]) for (const installed of [false, true]) for (const pro of [false, true]) {
    const status = {hasAccess: pro, status: pro ? 'active' : 'inactive', expiresAt: new Date(Date.now()+86400000).toISOString()};
    const readiness = {asrStatus:{ready:installed},ocrStatus:{ready:installed},resolverStatus:{ready:installed}};
    const view = setup.setupSummary(bound,status,readiness);
    assert.match(view.message, !bound ? /待绑定/ : !pro ? /待开通会员/ : !installed ? /待安装组件/ : /准备已完成/);
    assert.equal(view.components.length,3);
  }
  assert.match(setup.setupSummary(true,null).message,/待确认/);
  assert.match(setup.setupSummary(true,{hasAccess:false,status:'expired'}).message,/过期/);
  assert.match(noticeUtils.buildSyncResultNotice([],[],[],[{setupRequired:true,message:'待安装组件'}]),/待准备/);
  assert.doesNotMatch(noticeUtils.buildSyncResultNotice([],[],[],[{setupRequired:true,message:'待安装组件'}]),/同步失败|已同步/);
  assert.match(noticeUtils.buildSyncResultNotice([],[],[],[{message:'引擎崩溃'},{setupRequired:true,message:'待安装组件'}]),/1 条内容未同步/);
  assert.equal(Plugin.__test.categorizeSyncFailure(setup.setupError('LOCAL_COMPONENT_SETUP_REQUIRED','待安装')), 'LOCAL_COMPONENT_UNAVAILABLE');
  const isolated=fixture(); isolated.plugin.runLocalTranscription = Plugin.prototype.runLocalTranscription;
  const calls=[]; isolated.plugin.getLocalTranscriptionComponentReadiness=()=>({asrStatus:{ready:false},ocrStatus:{ready:false},resolverStatus:{ready:false}});
  isolated.plugin.installLocalAsr=async()=>calls.push('asr'); isolated.plugin.installLocalOcr=async()=>{throw Error('OCR must not run');}; isolated.plugin.ensureLocalDouyinResolver=async()=>{throw Error('resolver must not run');};
  await Plugin.prototype.doInstallLocalTranscriptionComponents.call(isolated.plugin,{requireAsr:true});
  assert.deepEqual(calls,['asr']);
  const settingCalls=[]; isolated.plugin.app={setting:{open:()=>settingCalls.push('open'),openTabById:id=>settingCalls.push(id)}};
  assert.equal(isolated.plugin.openTranscriptionSetupSettings(),true); assert.deepEqual(settingCalls,['open','wechat-inbox-sync']);
  const broken=fixture(); broken.plugin.runLocalTranscription=Plugin.prototype.runLocalTranscription;
  broken.plugin.installLocalTranscriptionComponents=async()=>{throw Error('OCR/ASR 安装下载失败');};
  await assert.rejects(broken.plugin.runConfiguredTranscription('https://example.test/a.mp3'), e=>e.code==='LOCAL_COMPONENT_INSTALL_FAILED' && Plugin.__test.categorizeSyncFailure(e)==='LOCAL_COMPONENT_UNAVAILABLE');
  const quiet=fixture({accept:false}); const beforeQuiet=notices.length;
  await assert.rejects(quiet.plugin.runConfiguredTranscription('https://example.test/a.mp3'));
  quiet.plugin.lastSetupNoticeAt=0;
  await assert.rejects(quiet.plugin.runConfiguredTranscription('https://example.test/a.mp3'));
  assert.equal(notices.length,beforeQuiet,'snooze suppresses repeated setup notices as well as modals');
  const concurrent=fixture(); const c=concurrent.plugin; let ocrReady=false;
  c.installLocalTranscriptionComponents=Plugin.prototype.installLocalTranscriptionComponents;
  c.showLocalComponentInstallFailure=async()=>{};
  c.doInstallLocalTranscriptionComponents=async options=>{await Promise.resolve();if(options.requireAsr)throw Error('ASR install failed');ocrReady=true;return {installed:true};};
  const results=await Promise.allSettled([c.installLocalTranscriptionComponents({requireAsr:true}),c.installLocalTranscriptionComponents({requireOcr:true})]);
  assert.equal(results[0].status,'rejected'); assert.equal(results[1].status,'fulfilled'); assert.equal(ocrReady,true);
  const serialized=fixture();const reasons=[];
  serialized.plugin.doRefreshProAndMaybePromptLocalComponentInstall=async opts=>{reasons.push(opts.reason);await Promise.resolve();return opts;};
  await Promise.all([serialized.plugin.refreshProAndMaybePromptLocalComponentInstall({reason:'settings-open'}),serialized.plugin.refreshProAndMaybePromptLocalComponentInstall({reason:'manual-refresh',force:true})]);
  assert.deepEqual(reasons,['settings-open','manual-refresh']);
  let duplicateInstalls=0;
  c.doInstallLocalTranscriptionComponents=async()=>{duplicateInstalls++;await Promise.resolve();throw Error('one installation failure');};
  await Promise.allSettled([c.installLocalTranscriptionComponents({requireAsr:true}),c.installLocalTranscriptionComponents({requireAsr:true})]);
  assert.equal(duplicateInstalls,1,'identical simultaneous requests must not repeat a failed download');
  for (const pendingRestart of [false,true]) {
    const pending=fixture(); pending.plugin.localComponentRestartRequired=pendingRestart;
    pending.plugin.installLocalTranscriptionComponents=async()=>({pendingRestart});
    await assert.rejects(pending.plugin.runConfiguredTranscription('https://example.test/a.mp3'), error=>error.setupRequired && error.code==='LOCAL_COMPONENT_SETUP_REQUIRED' && (pendingRestart ? /完全退出/.test(error.message) : /尚未就绪/.test(error.message)));
    assert.equal(pending.calls.transcribe,0);
  }
  const pendingInstaller=fixture();pendingInstaller.plugin.installLocalAsr=async()=>({pendingRestart:true});
  const pendingResult=await Plugin.prototype.doInstallLocalTranscriptionComponents.call(pendingInstaller.plugin,{requireAsr:true});
  assert.equal(pendingResult.pendingRestart,true);assert.equal(pendingInstaller.plugin.localComponentRestartRequired,true);
  const overlap=fixture(); const op=overlap.plugin;let asrReady=false,asrInstalls=0;
  op.installLocalTranscriptionComponents=Plugin.prototype.installLocalTranscriptionComponents;
  op.getLocalTranscriptionComponentReadiness=()=>({asrStatus:{ready:asrReady},ocrStatus:{ready:false},resolverStatus:{ready:true}});
  op.installLocalAsr=async()=>{asrInstalls++;asrReady=true;};op.installLocalOcr=async()=>{throw Error('unrelated OCR failure');};op.showLocalComponentInstallFailure=async()=>{};
  const overlapResults=await Promise.allSettled([op.installLocalTranscriptionComponents({allComponents:true}),op.installLocalTranscriptionComponents({requireAsr:true})]);
  assert.equal(overlapResults[0].status,'rejected');assert.equal(overlapResults[1].status,'fulfilled');assert.equal(asrInstalls,1);
  console.log('transcription first-use tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
