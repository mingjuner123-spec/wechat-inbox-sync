'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const api=require('../obsidian-plugin/wechat-inbox-sync/src/operator-linux-asr');
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operator-linux-'));
 try{
  const files={};for(const name of ['adapter.js','media-security.js','whisper','model.bin','ffmpeg','audio.mp3']){files[name]=path.join(dir,name);fs.writeFileSync(files[name],'synthetic fixture');}
  const env={WECHAT_INBOX_OPERATOR_NODE_ENABLED:'1',WECHAT_INBOX_OPERATOR_ASR_MODULE:files['adapter.js'],WECHAT_INBOX_OPERATOR_ASR_MODULE_SHA256:crypto.createHash('sha256').update(fs.readFileSync(files['adapter.js'])).digest('hex'),CLOUD_TRANSCRIPTION_LOCAL_ASR_EXECUTABLE:files.whisper,CLOUD_TRANSCRIPTION_LOCAL_ASR_MODEL:files['model.bin'],FFMPEG_PATH:files.ffmpeg};
  env.WECHAT_INBOX_OPERATOR_ASR_DEPENDENCY_SHA256=crypto.createHash('sha256').update(fs.readFileSync(files['media-security.js'])).digest('hex');
  assert.equal(api.status(env,'linux').ready,true);
  for(const platform of ['win32','darwin'])assert.equal(api.status(env,platform).ready,false);
  assert.equal(api.status({...env,WECHAT_INBOX_OPERATOR_NODE_ENABLED:'0'},'linux').ready,false);
  assert.equal(api.status({...env,WECHAT_INBOX_OPERATOR_ASR_MODULE_SHA256:'f'.repeat(64)},'linux').ready,false);
  assert.equal(api.status({...env,CLOUD_TRANSCRIPTION_LOCAL_ASR_MODEL:path.join(dir,'missing')},'linux').ready,false);
  let calls=0;
  const loadModule=p=>{assert.equal(p,files['adapter.js']);return {createWhisperCppLocalAsrAdapter:opts=>{
   assert.equal(opts.modelPath,files['model.bin']);assert.equal(opts.maxConcurrent,1);assert.equal(opts.language,'auto');
   return {transcribe:async input=>{calls++;assert.equal(input.buffer.toString(),'synthetic fixture');assert.equal(input.artifactSize,input.buffer.length);assert.equal(input.artifactSha256,crypto.createHash('sha256').update(input.buffer).digest('hex'));return {transcription:'synthetic words'};}};
  }}};
  assert.deepEqual(await api.transcribe(files['audio.mp3'],{env,platform:'linux',loadModule}),{transcription:'synthetic words'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.transcribe(files['audio.mp3'],{env,platform:'linux',loadModule,signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls,1);
  fs.writeFileSync(files['media-security.js'],'dependency changed');
  assert.equal(api.status(env,'linux').ready,false);
  await assert.rejects(api.transcribe(files['audio.mp3'],{env,platform:'linux',loadModule:()=>{throw Error('must not load');}}),{code:'OPERATOR_ASR_CONFIG_INVALID'});
  fs.writeFileSync(files['media-security.js'],'synthetic fixture');
  fs.writeFileSync(files['adapter.js'],'changed code');
  await assert.rejects(api.transcribe(files['audio.mp3'],{env,platform:'linux',loadModule}),{code:'OPERATOR_ASR_CONFIG_INVALID'});
  assert.equal(calls,1,'unpinned runtime is never executed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 console.log('operator Linux ASR: existing pinned install, local buffer integrity, no network and cancellation passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
