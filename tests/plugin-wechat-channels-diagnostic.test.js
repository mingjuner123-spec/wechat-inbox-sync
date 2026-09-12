'use strict';
const assert=require('node:assert'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const load=Module._load;
try{Module._load=function(id,parent,main){if(id==='obsidian')return {Plugin:class{},Modal:class{},Notice:class{},Setting:class{},PluginSettingTab:class{}};return load.call(this,id,parent,main);};var Plugin=require('../obsidian-plugin/wechat-inbox-sync/main');}finally{Module._load=load;}
const h=Plugin.__test,life=require('../obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils'),diag=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-channels-diagnostic-utils'),asr=require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');
const url='https://weixin.qq.com/sph/fixture';
const record=()=>({_id:'fixture-record',type:'webpage',content:url,metadata:{url,transcriptionStatus:'failed',conversionStatus:'link_saved',conversionError:'暂不支持此平台',markdown:'原始链接已保留；上轮没有提取成功'}});
const make=()=>{const p=new Plugin();p.settings=h.mergeSettings({apiBase:'https://example.test/sync',token:'fixture-binding',bindings:[{token:'fixture-binding',label:'fixture',enabled:true,status:'bound'}]});return p;};
const media=n=>({data:{mediaUrl:'https://storage.example.test/private-media/opaque-'+n+'?signature=secret',source:'prepared'}});
const success=()=>({source:'local',transcription:'这是一段用于验证视频号转写链路的合成测试文字，内容足够完整。'});
async function testLocalParentCancellation(scratch){
 const cp=require('node:child_process'),oldExec=cp.exec,oldSpawnSync=cp.spawnSync;
 try{
  for(const phase of ['download','child']){
   const p=make(),parent=new AbortController();let entered,downloadSignal,kills=0,executions=0;
   const started=new Promise(resolve=>entered=resolve);
   p.ensureLocalComponentReadyForUse=async()=>{};p.recoverStaleLocalTranscriptionCommand=async()=>{};
   p.getConfiguredLocalAsrPlatform=()=> 'win32';p.getConfiguredLocalAsrInstallRoot=()=>scratch;
   p.getLocalAsrInstallStatus=()=>({ready:true,scriptOutdated:false});p.getEffectiveLocalTranscriptionCommand=()=> 'fixture --input {input} --output {output}';
   p.setTranscriptionStopAvailable=()=>{};p.showSyncProgress=()=>{};
   p.downloadMediaToTempFile=async(_url,options)=>{
    downloadSignal=options.signal;
    if(phase==='child'){const input=path.join(scratch,'parent-cancel.mp4');fs.writeFileSync(input,'fixture');return input;}
    return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled download'),{name:'AbortError'})),{once:true});entered();});
   };
   cp.spawnSync=()=>{throw Error('test must not kill a real process');};
   cp.exec=(_command,_options,callback)=>{executions++;const child={pid:0,killed:false,kill(){kills++;this.killed=true;setImmediate(()=>callback(Object.assign(Error('stopped'),{code:1,signal:'SIGTERM'}),'',''));return true;}};setImmediate(entered);return child;};
   const task=p.runLocalTranscription('https://example.test/media.mp4',{signal:parent.signal,recordId:'parent-cancel-fixture'});
   await started;parent.abort();
   let timer;try{await assert.rejects(Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('parent cancellation did not reach local operation')),2000);})]),{name:'AbortError'});}finally{clearTimeout(timer);}
   assert.equal(downloadSignal.aborted,true,phase+' receives parent cancellation');
   assert.equal(executions,phase==='child'?1:0);assert.equal(kills,phase==='child'?1:0);
   assert.equal(p.currentTranscriptionAbortController,null);assert.equal(p.currentTranscriptionProcess,null);
  }
 }finally{cp.exec=oldExec;cp.spawnSync=oldSpawnSync;}
}
async function testActualSyncFailurePropagation(scratch){
 const p=make();p.saveSettings=async s=>{p.settings=s;};p.showSyncProgress=()=>{};p.clearSyncProgressNotice=()=>{};p.setTranscriptionStopAvailable=()=>{};
 p.getConfiguredLocalAsrInstallRoot=()=>scratch;p.findExistingRecordNotePath=async()=>'';p.replayPendingSyncLifecycleAttempts=async()=>{};p.claimSyncRecordProcessing=async()=>({enabled:false});p.consumePendingStoppedTranscriptionDelete=async()=>null;
 p.getActiveBindings=()=>[{token:'fixture-binding',label:'fixture',enabled:true,status:'bound'}];
 let pending=true;
 p.requestJson=async(requestPath)=>{assert.equal(requestPath,'/records?status=pending');return {data:pending?[record()]:[]};};
 p.writeRecord=async()=>{const trace=diag.create(url,'win32','x64');diag.noteFailure(trace,Object.assign(Error('native process failed'),{code:'ASR_NATIVE_EXIT',exitCode:-1073741515}),'transcribe');const failure=diag.outcome(trace);throw Object.assign(Error(failure.message),failure);};
 await p.runSyncInboxOnce(false);
 assert.equal(p.lastSyncDiagnostic.status,'failed');
 assert.equal(p.lastSyncDiagnostic.diagnostic.failure.code,'ASR_NATIVE_EXIT');
 assert.equal(p.lastSyncDiagnostic.diagnostic.failure.exitCode,-1073741515);
 pending=false;await p.runSyncInboxOnce(false);
 assert.equal(p.lastSyncDiagnostic.historicalFailures[0].diagnostic.failure.code,'ASR_NATIVE_EXIT');
 assert.equal(p.lastSyncDiagnostic.historicalFailures[0].diagnostic.failure.exitCode,-1073741515);
}
async function run(){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'channels-diagnostic-'));let cases=0;
 try{
  let p=make(),calls=0;p.requestJson=async()=>media(1);p.runConfiguredTranscription=async()=>{calls++;return success();};
  const ok=await p.hydrateWebpageMarkdown(record(),'','','',null);assert.equal(calls,1,'stale placeholder must not bypass a fresh attempt');assert.equal(ok.metadata.transcriptionStatus,'success');assert.ok(!ok.metadata.conversionError);cases++;
  calls=0;const untrusted=await p.buildTranscriptRecordFromMedia(record(),{url,platform:'视频号',mediaUrl:media(1).data.mediaUrl});assert.equal(untrusted.metadata.transcriptionStatus,'failed');assert.equal(calls,0,'only explicit prepared candidates bypass filename heuristics');cases++;
  p=make();p.requestJson=async()=>{throw Object.assign(new Error('prepare timed out https://host.test/?token=secret'),{code:'MEDIA_RESOLVE_TIMEOUT',status:504,requestId:'trace-fixture'});};p.runConfiguredTranscription=async()=>{throw Error('must not transcribe');};
  const resolved=await p.hydrateWechatChannelsTranscript(record(),url);let outcome=life.getSyncLifecycleOutcomeError(resolved);assert.equal(outcome.code,'EXTRACTION_FAILED');assert.equal(outcome.diagnostic.failure.status,504);assert.equal(outcome.diagnostic.failure.code,'MEDIA_RESOLVE_TIMEOUT');assert.equal(outcome.diagnostic.failure.stage,'prepare');assert.ok(!JSON.stringify(outcome.diagnostic).includes('secret'));const evidence=outcome.diagnostic;cases++;
  p=make();p.requestJson=async()=>media(1);p.runConfiguredTranscription=async()=>{throw Object.assign(new Error('native engine failed'),{exitCode:1,channelsStage:'transcribe'});};
  const failed=await p.hydrateWechatChannelsTranscript(record(),url);outcome=life.getSyncLifecycleOutcomeError(failed);assert.equal(outcome.code,'TRANSCRIPTION_FAILED');assert.equal(life.categorizeSyncFailure(outcome),'TRANSCRIPTION_FAILED');assert.ok(!outcome.message.includes('不支持'));assert.equal(outcome.diagnostic.failure.exitCode,1);assert.ok(!failed.metadata.conversionError);cases++;
  assert.equal(life.categorizeSyncFailure({code:'TRANSCRIPTION_FAILED',message:'旧暂不支持此平台'}),'TRANSCRIPTION_FAILED');assert.equal(life.categorizeSyncFailure({code:'UNSUPPORTED_PLATFORM',message:'unsupported'}),'UNSUPPORTED_PLATFORM');cases++;
  for(const recover of [true,false]){p=make();let prepares=0,runs=0;p.requestJson=async()=>media(++prepares);p.runConfiguredTranscription=async()=>{runs++;if(runs===1||!recover)throw Object.assign(new Error('HTTP 403'),{status:403,channelsStage:'download'});return success();};const r=await p.hydrateWechatChannelsTranscript(record(),url);assert.equal(prepares,2);assert.equal(runs,2);assert.equal(r.metadata.transcriptionStatus,recover?'success':'failed');assert.equal(r.metadata.mediaResolutionDiagnostic.refreshCount,1);if(!recover)assert.equal(life.getSyncLifecycleOutcomeError(r).diagnostic.failure.stage,'download');else{assert.equal(r.metadata.mediaResolutionDiagnostic.stage,'finished');assert.ok(!r.metadata.mediaResolutionDiagnostic.failure);assert.equal(r.metadata.mediaResolutionDiagnostic.attempts[0].status,403);}cases++;}
  for(const fields of [{channelsStage:'transcribe'},{code:'LOCAL_COMPONENT_UNAVAILABLE'}]){p=make();let prepares=0,runs=0;p.requestJson=async()=>media(++prepares);p.runConfiguredTranscription=async()=>{runs++;throw Object.assign(Error('HTTP 403'),{status:403,...fields});};const r=await p.hydrateWechatChannelsTranscript(record(),url);assert.equal(prepares,1,'non-download 403 must not re-prepare');assert.equal(runs,1);assert.equal(r.metadata.transcriptionStatus,'failed');cases++;}
  const downloads=diag.sanitize({...evidence,downloadAttempts:[{transport:'node-http',ok:false,code:'ECONNRESET',status:0,refreshed:false,durationMs:345},{transport:'node-http',ok:true,status:200,bytes:1024,refreshed:true,durationMs:678}]});
  assert.equal(downloads.downloadAttempts[0].code,'ECONNRESET');assert.equal(downloads.downloadAttempts[0].ok,false);assert.equal(downloads.downloadAttempts[0].elapsedMs,345);assert.equal(downloads.downloadAttempts[1].refreshed,true);assert.equal(downloads.downloadAttempts[1].elapsedMs,678);cases++;
  for(const phase of ['before','prepare','transcribe']){p=make();const c=new AbortController();let prepares=0,runs=0;p.requestJson=async(_a,_b,_c,_d,options)=>{prepares++;assert.equal(options.signal,c.signal);if(phase==='prepare')c.abort();return media(1);};p.runConfiguredTranscription=async()=>{runs++;c.abort();throw Object.assign(new Error('cancelled'),{name:'AbortError'});};if(phase==='before')c.abort();await assert.rejects(p.hydrateWechatChannelsTranscript(record(),url,null,'',{signal:c.signal}),{name:'AbortError'});assert.equal(prepares,phase==='before'?0:1);assert.equal(runs,phase==='transcribe'?1:0);cases++;}
  p=make();p.saveSettings=async s=>{p.settings=s;};p.getActiveBindings=()=>[{token:'fixture-binding',label:'fixture',enabled:true,status:'bound'}];p.showSyncProgress=()=>{};p.clearSyncProgressNotice=()=>{};p.findExistingRecordNotePath=async()=>'';p.getConfiguredLocalAsrInstallRoot=()=>scratch;p.syncBinding=async()=>({written:[],failed:[],skipped:[],conversionWarnings:[],completionWarnings:[]});
  await p.updateRecentSyncFailures({failed:[{recordId:'fixture-record',bindingToken:'fixture-binding',message:'媒体解析失败',diagnostic:evidence}]});
  const before=p.getRecentSyncFailures()[0];assert.equal(before.diagnostic.failure.code,'MEDIA_RESOLVE_TIMEOUT');await p.runSyncInboxOnce(false);assert.equal(p.lastSyncDiagnostic.historicalFailures[0].diagnostic.failure.status,504);assert.equal(p.lastSyncDiagnostic.historicalFailures[0].failedAt,before.failedAt);cases++;
  await p.updateRecentSyncFailures({resolved:[{recordId:'fixture-record',bindingToken:'fixture-binding'}]});assert.equal(p.getRecentSyncFailures().length,0);cases++;
  const hostile=diag.sanitize({...evidence,token:'SECRET',body:'PRIVATE TEXT',attempts:[{stage:'prepare',message:'{"token":"SECRET"}',body:'PRIVATE TEXT'}]});assert.ok(!JSON.stringify(hostile).includes('SECRET'));assert.ok(!JSON.stringify(hostile).includes('PRIVATE TEXT'));cases++;
  const credentials=diag.sanitize({...evidence,failure:{stage:'prepare',message:'apiKey=API_SECRET api_key="QUOTED_SECRET" cookie=COOKIE_SECRET unrelated CONFIGURED_SECRET',code:'PREPARE_FAILED'}},{aliyunApiKey:'CONFIGURED_SECRET'});for(const secret of ['API_SECRET','QUOTED_SECRET','COOKIE_SECRET','CONFIGURED_SECRET'])assert.ok(!JSON.stringify(credentials).includes(secret),secret+' must be removed before persistence');cases++;
  await testLocalParentCancellation(scratch);cases+=2;
  await testActualSyncFailurePropagation(scratch);cases++;
  fs.mkdirSync(path.join(scratch,'bin'));fs.writeFileSync(path.join(scratch,'bin/main.exe'),'native-fixture');fs.writeFileSync(path.join(scratch,'transcribe.ps1'),'ps1-fixture');const identity=asr.runtimeIdentity(scratch,'win32');assert.equal(identity.scriptSha256,crypto.createHash('sha256').update('ps1-fixture').digest('hex'));assert.equal(identity.binarySha256,crypto.createHash('sha256').update('native-fixture').digest('hex'));assert.ok(identity.binary.endsWith('main.exe'));cases++;
  console.log('Channels diagnostics and recovery: '+cases+' cases passed');
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
