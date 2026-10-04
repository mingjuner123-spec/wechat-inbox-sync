'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const Module = require('module');
const helpers = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');
const pluginRoot = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
const installer = fs.readFileSync(path.join(pluginRoot, 'local-asr/install-local-asr-macos.sh'), 'utf8');
const marker = 'cat > "$INSTALL_ROOT/transcribe.sh" <<\'SCRIPT\'\n';
const start = installer.indexOf(marker) + marker.length;
const script = installer.slice(start, installer.indexOf('\nSCRIPT', start)) + '\n';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-recovery-test-'));
const crash = () => Object.assign(new Error('Segmentation fault: 11'), { exitCode: 139, signal: null });
async function matrix() {
  for (const [name, config, failures, expected] of [
    ['crash then success', {}, [crash()], [false, true]],
    ['both crash', {}, [crash(), crash()], [false, true]],
    ['non-native error', {}, [new Error('file missing')], [false]],
    ['timeout', {}, [Object.assign(new Error('timeout'), { signal: 'SIGTERM' })], [false]],
    ['custom command', { managed: false }, [crash()], [false]],
    ['Windows', { platform: 'win32' }, [crash()], [false]],
    ['already CPU', { cpuPreferred: true }, [crash()], [true]],
    ['ffmpeg crash', {}, [Object.assign(crash(), { asrStage: 'segmenting' })], [false]],
  ]) {
    const modes = [], events = []; let index = 0;
    let caught;
    try { await helpers.executeWithMacRecovery({ platform: 'darwin', managed: true, ...config,
      execute: async ({ cpu }) => { modes.push(cpu); const error=failures[index++]; if(error)throw error; return { stdout:'ok' }; },
      onAttempt: async e => { events.push(e); assert.equal(events.length, modes.length, 'evidence recorded before next attempt'); },
    }); } catch (e) { caught=e; }
    assert.deepEqual(modes, expected, name);
    if (failures.length >= expected.length) assert.ok(caught, name);
  }
  for (const failFirst of [true, false]) {
    let calls=0; const result=await helpers.executeWithMacRecovery({ platform:'darwin',managed:true,
      execute:async()=>{if(++calls===1 && failFirst)throw crash();return {stdout:'ok'};},
      onAttempt:async()=>{throw Error('diagnostic disk failure');},
    });assert.equal(result.stdout,'ok');assert.equal(calls,failFirst?2:1);
  }
  for (const phase of ['before', 'during', 'between']) {
    const controller = new AbortController(); const calls=[];
    if(phase==='before')controller.abort();
    await assert.rejects(helpers.executeWithMacRecovery({ platform:'darwin',managed:true,signal:controller.signal,
      execute: async () => { calls.push(1); if(phase==='during')controller.abort(); throw crash(); },
      onAttempt: () => { if(phase==='between')controller.abort(); },
    }), { name:'AbortError' });
    assert.equal(calls.length,phase==='before'?0:1);
  }
}
function shellFixture(cpu, nativeExit=0) {
  const root=path.join(scratch,`shell-${cpu}-${nativeExit}`);fs.mkdirSync(path.join(root,'bin'),{recursive:true});fs.mkdirSync(path.join(root,'models'));
  fs.writeFileSync(path.join(root,'transcribe.sh'),script);
  fs.writeFileSync(path.join(root,'models','ggml-small.bin'),'fixture');
  fs.writeFileSync(path.join(root,'input.mp4'),'fixture');
  fs.writeFileSync(path.join(root,'bin','ffmpeg'),`#!/bin/bash\nif [ "$#" = 3 ]; then echo 'Duration: 00:00:37.00' >&2; exit 0; fi\nlast="\${!#}"\ntouch "\${last//%03d/000}"\n`);
  fs.writeFileSync(path.join(root,'bin','whisper-cli'),`#!/bin/bash\nif [ "\${1:-}" = --help ]; then echo fixture-whisper; exit 0; fi\nprintf '%s\\n' "$@" > "$ASR_TEST_ARGS"\nbase=''\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -of ]; then shift; base="$1"; fi; shift; done\nif [ "${nativeExit}" != 0 ]; then exit ${nativeExit}; fi\nprintf '这是一段有效的中文转写测试内容。' > "$base.txt"\n`);
  for(const name of ['ffmpeg','whisper-cli'])fs.chmodSync(path.join(root,'bin',name),0o755);
  const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
  const slash=p=>p.replace(/\\/g,'/');
  const result=cp.spawnSync(bash,[slash(path.join(root,'transcribe.sh')),'--input',slash(path.join(root,'input.mp4')),'--output',slash(path.join(root,'output.txt'))],{env:{...process.env,WECHAT_INBOX_ASR_CPU_ONLY:cpu?'1':'0',ASR_TEST_ARGS:slash(path.join(root,'args'))},encoding:'utf8',timeout:15000});
  assert.equal(result.status,nativeExit, result.stderr || result.error?.message);
  const args=fs.readFileSync(path.join(root,'args'),'utf8').split('\n');
  assert.equal(args.includes('--no-gpu'),cpu);
  assert.ok(args.includes('-m') && args.includes('-l') && args.includes('zh'));
  const log=fs.readFileSync(path.join(root,'transcribe-last.log'),'utf8');
  assert.ok(log.includes(`nativeExit=${nativeExit}`));assert.ok(log.includes('progressPid='));assert.ok(log.includes('progressStage=transcribing')); if(nativeExit===0)assert.ok(log.includes('resourceSampleTime='));
}
async function pluginIntegration() {
  const originalLoad=Module._load;
  const originalExtensions={};
  for(const ext of ['.ps1','.sh','.py']){originalExtensions[ext]=Module._extensions[ext];Module._extensions[ext]=(mod,file)=>{mod.exports=fs.readFileSync(file,'utf8');};}
  Module._load=function(request,...args){ if(request==='obsidian')return {Plugin:class{},Modal:class{},Notice:class{},PluginSettingTab:class{},Setting:class{},requestUrl:async()=>({})};return originalLoad.call(this,request,...args); };
  let Plugin;try{Plugin=require(path.join(pluginRoot,'src/main'));}finally{Module._load=originalLoad;for(const ext of Object.keys(originalExtensions)){if(originalExtensions[ext])Module._extensions[ext]=originalExtensions[ext];else delete Module._extensions[ext];}}
  const root=path.join(scratch,'integration').replace(/\\/g,'/');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'transcribe.sh'),script);
  const plugin=new Plugin();plugin.settings={};plugin.ensureLocalComponentReadyForUse=async()=>{};plugin.recoverStaleLocalTranscriptionCommand=async()=>{};
  plugin.getConfiguredLocalAsrPlatform=()=> 'darwin';plugin.getConfiguredLocalAsrInstallRoot=()=>root;plugin.getLocalAsrInstallStatus=()=>({ready:true,scriptOutdated:false});
  plugin.getEffectiveLocalTranscriptionCommand=()=>`/bin/bash "${root}/transcribe.sh" --input {input} --output {output}`;
  plugin.setTranscriptionStopAvailable=()=>{};plugin.showSyncProgress=()=>{};
  plugin.downloadMediaToTempFile=async()=>{const file=path.join(root,'input.mp4');fs.writeFileSync(file,'fixture');return file;};
  const originalExec=cp.exec;const modes=[];
  cp.exec=(command,opts,callback)=>{modes.push(opts.env.WECHAT_INBOX_ASR_CPU_ONLY);setImmediate(()=>{
    const log=path.join(root,'transcribe-last.log');fs.writeFileSync(log,`progressStage=transcribing\nprogressCurrent=0\nprogressTotal=1\nprogressPercent=0\nprogressPid=${1234+modes.length}\nnativeRssKiB=123\nnativeExit=${modes.length===1?139:0}\n`);
    if(modes.length===1)callback(Object.assign(new Error('crash'),{code:139}),'','Segmentation fault: 11');
    else {fs.writeFileSync(path.join(root,'input.mp4.txt'),'这是一段完整有效的中文音频转写结果，用来验证兼容恢复。');callback(null,'','');}
  });return {pid:1234};};
  try {
    const text=await plugin.runLocalTranscription('https://example.invalid/test',{recordId:'fixture-record'});assert.ok(text.includes('兼容恢复'));assert.deepEqual(modes,['0','1']);
    const session=JSON.parse(fs.readFileSync(path.join(root,'asr-diagnostic-last.json'),'utf8'));
    assert.equal(session.recordId,'fixture-record');assert.equal(session.attempts.length,2);assert.equal(session.attempts[0].exitCode,139);assert.equal(session.attempts[0].peakRssKiB,123);assert.equal(session.status,'success');
    assert.ok(session.system.architecture);assert.ok(session.system.cpuModel);assert.equal(session.model.fileName,'ggml-small.bin');assert.equal(session.attempts[0].stage,'transcribing');assert.equal(session.attempts[0].cpu,false);assert.equal(session.attempts[0].requestedMode,'default');assert.equal(session.attempts[0].backendObserved,'unknown');assert.equal(session.attempts[0].nativeExitCode,139);assert.equal(session.attempts[0].nativePids[0],1235);assert.ok(session.attempts[0].logSnapshotAt);assert.ok(session.attempts[0].runLog.includes('nativeExit=139'));assert.equal(session.attempts[1].cpu,true);assert.equal(session.attempts[1].requestedMode,'cpu_compatibility');assert.equal(session.attempts[1].backendObserved,'unknown');assert.equal(session.attempts[1].nativeExitCode,0);assert.equal(session.attempts[1].nativePids[0],1236);assert.ok(session.attempts[1].runLog.includes('nativeExit=0'));assert.ok(!session.attempts[1].runLog.includes('nativeExit=139'));
    await plugin.runLocalTranscription('https://example.invalid/test',{recordId:'second'});assert.deepEqual(modes,['0','1','1']);
    assert.ok(fs.readFileSync(path.join(root,'transcribe-last.log'),'utf8').includes('nativeExit=0'));
    cp.exec=(command,opts,callback)=>{setImmediate(()=>callback(Object.assign(new Error('spawn failed'),{code:'ENOENT'}),'',''));return {pid:9876};};
    await assert.rejects(plugin.runLocalTranscription('fixture',{recordId:'spawn-failure'}),/spawn failed/);
    const spawnFailure=JSON.parse(fs.readFileSync(path.join(root,'asr-diagnostic-last.json'),'utf8')).attempts[0];assert.equal(spawnFailure.logFreshness,'stale');assert.equal(spawnFailure.stage,'unknown');assert.equal(spawnFailure.nativeExitCode,null);assert.deepEqual(spawnFailure.nativePids,[]);assert.ok(spawnFailure.runLog.includes('[stale: prior ASR log omitted]'));assert.ok(!spawnFailure.runLog.includes('nativeExit=0'));assert.ok(!spawnFailure.runLog.includes('1237'));
    fs.unlinkSync(path.join(root,'asr-cpu-mode.json'));
    const stopped=[];
    cp.exec=(command,opts,callback)=>{stopped.push(opts.env.WECHAT_INBOX_ASR_CPU_ONLY);setImmediate(()=>{plugin.currentTranscriptionAbortRequest?.('user_stop');callback(Object.assign(new Error('stopped'),{code:139}),'','Segmentation fault: 11');});return {pid:1234};};
    await assert.rejects(plugin.runLocalTranscription('fixture',{recordId:'cancelled'}), /用户已停止/);
    assert.deepEqual(stopped,['0']);
    const cancelledSession=JSON.parse(fs.readFileSync(path.join(root,'asr-diagnostic-last.json'),'utf8'));
    assert.equal(cancelledSession.status,'cancelled');
    assert.equal(cancelledSession.abort.source,'user_stop');
    assert.ok(cancelledSession.abort.requestedAt);
    assert.ok(cancelledSession.abort.observedAt);
    assert.equal(cancelledSession.abort.originalExitCode,139);
    assert.equal(cancelledSession.abort.originalSignal,'');
    assert.equal(cancelledSession.abort.nativeCrash,null);
    assert.equal(cancelledSession.abort.nativeCrashEvidence,'unknown_stale_or_unavailable_log');
    assert.equal(cancelledSession.attempts.length,1);
    assert.equal(cancelledSession.attempts[0].exitCode,139);
    assert.equal(cancelledSession.attempts[0].signal,'');
    assert.match(cancelledSession.attempts[0].error,/Segmentation fault/);
    assert.ok(cancelledSession.attempts[0].startedAt);
    assert.ok(cancelledSession.attempts[0].finishedAt);
    const unloaded=[];
    cp.exec=(command,opts,callback)=>{unloaded.push(opts.env.WECHAT_INBOX_ASR_CPU_ONLY);setImmediate(()=>{plugin.currentTranscriptionAbortRequest?.('plugin_unload');callback(Object.assign(new Error('unloaded'),{code:139}),'','Segmentation fault: 11');});return {pid:1234};};
    await assert.rejects(plugin.runLocalTranscription('fixture',{recordId:'unloaded'}), /当前转写已中止/);
    assert.deepEqual(unloaded,['0']);
    const unloadedSession=JSON.parse(fs.readFileSync(path.join(root,'asr-diagnostic-last.json'),'utf8'));
    assert.equal(unloadedSession.status,'cancelled');
    assert.equal(unloadedSession.abort.source,'plugin_unload');
    assert.equal(unloadedSession.abort.originalExitCode,139);
    assert.equal(unloadedSession.attempts.length,1);
    const failed=[];
    cp.exec=(command,opts,callback)=>{failed.push(opts.env.WECHAT_INBOX_ASR_CPU_ONLY);setImmediate(()=>{fs.writeFileSync(path.join(root,'transcribe-last.log'),'progressStage=transcribing\nprogressCurrent=0\nprogressTotal=1\nprogressPercent=0\nprogressPid=1234\n');callback(Object.assign(new Error('crash'),{code:139}),'','Segmentation fault: 11');});return {pid:1234};};
    await assert.rejects(plugin.runLocalTranscription('fixture',{recordId:'double-failure'}), /CPU 兼容重试仍失败/);
    assert.deepEqual(failed,['0','1']);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'asr-diagnostic-last.json'),'utf8')).attempts.length,2);
    assert.ok(!fs.existsSync(path.join(root,'asr-cpu-mode.json')));
    const home=path.join(scratch,'fake-home').replace(/\\/g,'/');
    const homeRoot=home+'/.wechat-inbox-local-asr';fs.mkdirSync(homeRoot,{recursive:true});fs.writeFileSync(path.join(homeRoot,'transcribe.sh'),script);
    const oldHomedir=os.homedir;os.homedir=()=>home;
    plugin.getConfiguredLocalAsrInstallRoot=()=>homeRoot;
    plugin.getEffectiveLocalTranscriptionCommand=()=>Plugin.__test.getDefaultLocalTranscriptionCommand('darwin');
    const defaults=[];
    cp.exec=(command,opts,callback)=>{defaults.push(opts.env.WECHAT_INBOX_ASR_CPU_ONLY);setImmediate(()=>{fs.writeFileSync(path.join(homeRoot,'transcribe-last.log'),'progressStage=transcribing\nprogressPercent=0\nprogressCurrent=0\nprogressTotal=1\n');callback(Object.assign(new Error('crash'),{code:139}),'','Segmentation fault: 11');});return {pid:1234};};
    try {await assert.rejects(plugin.runLocalTranscription('fixture',{recordId:'default-home'}),/CPU 兼容重试仍失败/);assert.deepEqual(defaults,['0','1']);} finally {os.homedir=oldHomedir;}


  } finally {cp.exec=originalExec;}
}
(async()=>{try {await matrix();shellFixture(false);shellFixture(true);shellFixture(true,139);await pluginIntegration();console.log('PASS: recovery matrix, actual Bash arguments/exit propagation, source-plugin retry and CPU preference');}finally{if(!scratch.startsWith(path.join(os.tmpdir(),'asr-recovery-test-')))throw Error('unsafe cleanup');fs.rmSync(scratch,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
