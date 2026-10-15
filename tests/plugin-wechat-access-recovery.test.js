'use strict';
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createWechatArticleRequestGate,wechatAccessPauseMessage}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-request-gate');
const {articleIdentity,createVerifiedArticleCache,openWechatArticleVerification}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-access-recovery');
const {buildFailureTechnicalReport}=require('../obsidian-plugin/wechat-inbox-sync/src/failure-technical-report');
const {runWechatArticlePipeline}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const {sanitizeSourceLink}=require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');
const url='https://mp.weixin.qq.com/s?__biz=fixture&mid=42&idx=1&sn=signature', other='https://mp.weixin.qq.com/s/other';
const article={bodyFound:true,markdown:'真实文章正文'.repeat(30),html:'<div id="js_content">'+'真实文章正文'.repeat(30)+'</div>',assets:[]};
async function main(){
 assert.equal(articleIdentity(url+'&pass_ticket=private&scene=1'),articleIdentity(url));
 const uploadedLink=sanitizeSourceLink(url+'&exportkey='+('private'.repeat(500))+'&pass_ticket=secret&sessionid=private');
 assert.equal(uploadedLink,url);assert.equal(sanitizeSourceLink('https://example.com/?q='+('a'.repeat(3000))),'');
 for(const u of ['http://mp.weixin.qq.com/s/a','https://mp.weixin.qq.com.evil.test/s/a','https://user:pw@mp.weixin.qq.com/s/a','https://mp.weixin.qq.com:444/s/a','https://mp.weixin.qq.com/s?mid=1','https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha']) assert.equal(articleIdentity(u),'');
 let now=100,trigger;const gate=createWechatArticleRequestGate({now:()=>now,gapMs:0,cooldownMs:600000});
 await assert.rejects(gate.run(async()=>({status:429,url:'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?private=hidden'}),{context:{stage:'hidden-browser',sourceFingerprint:'a'.repeat(24)}}),e=>{trigger=e;return e.accessPause.pauseOrigin==='trigger'});
 const epoch=trigger.accessPause.incidentId;let calls=0,cooldown;
 await assert.rejects(gate.run(async()=>{calls++;}),e=>{cooldown=e;return e.accessPause.pauseOrigin==='cooldown'});assert.equal(calls,0);assert.equal(cooldown.accessPause.requestStarted,false);assert.equal(cooldown.accessPause.incidentId,epoch);
 assert.match(wechatAccessPauseMessage({accessPause:cooldown.accessPause}),/本条尚未重新请求/);
 assert.match(wechatAccessPauseMessage({accessPause:trigger.accessPause,failureCategory:'wechat-rate-limited'}),/429/);
 const diagnostic={source:'wechat-article',reason:'wechat-access-paused',failureCategory:'wechat-verification-required',finalKind:'retryable',finalState:'access_paused',finalSource:'request-guard',accessPause:trigger.accessPause,requestPolicy:{...gate.snapshot(),cookie:'secret-cookie'},retryAfterMs:600000,stages:[{stage:'hidden-browser',outcome:'error',error:'ERR_CONNECTION_RESET Cookie: token=secret-cookie',diagnostic:{verificationMarker:true}},{stage:'request-guard',outcome:'access_paused',accessPause:cooldown.accessPause}]};
 const report=JSON.parse(buildFailureTechnicalReport({error:Object.assign(Error('paused'),{diagnostic}),settings:{token:'secret-cookie'}}).text);
 const x=report.failure.extractionDiagnostic;
 assert.equal(x.reasonCode,'wechat-access-paused');assert.equal(x.finalState,'access_paused');assert.equal(x.accessPause.triggerKind,'http-429');assert.equal(x.accessPause.triggerStage,'hidden-browser');assert.equal(x.requestPolicy.incidentId,epoch);assert.equal(x.stages[1].accessPause.pauseOrigin,'cooldown');assert.match(x.stages[0].error,/ERR_CONNECTION_RESET/);assert.equal(x.stages[0].evidence.verificationMarker,true);
 assert.equal(report.failure.mediaResolutionDiagnostic,undefined);assert.ok(!JSON.stringify(report).includes('secret-cookie'));assert.ok(!JSON.stringify(report).includes('private=hidden'));
 for (const error of ['HTTP 403: PRIVATE_RESPONSE_MUST_NOT_LEAK','HTTP 500 body=PRIVATE_RESPONSE_MUST_NOT_LEAK','HTTP 502: {"body":"PRIVATE_RESPONSE_MUST_NOT_LEAK"}']) {
  const text=buildFailureTechnicalReport({error:Object.assign(Error('test'),{diagnostic:{source:'wechat-article',stages:[{stage:'node-fallback',outcome:'error',error}]}})}).text;
  assert.ok(text.includes('RESPONSE_BODY_OMITTED'));assert.ok(!text.includes('PRIVATE_RESPONSE_MUST_NOT_LEAK'));
 }
 now+=600001;await assert.rejects(gate.run(async()=>({status:429})));assert.notEqual(gate.snapshot().incidentId,epoch);assert.equal(gate.confirmRecovery(epoch),false);assert.ok(gate.snapshot().remainingCooldownMs>0);
 const cache=createVerifiedArticleCache({now:()=>now,ttlMs:300000});assert.equal(cache.put(url,article),true);assert.equal(cache.take(other),null);assert.equal(cache.take(url+'&scene=2'),article);assert.equal(cache.take(url),null);cache.put(url,article);now+=300000;assert.equal(cache.take(url),null);cache.clear();
 let staticCalls=0;const result=await runWechatArticlePipeline({url,preferVerifiedBrowser:true,fetchStatic:async()=>{staticCalls++;throw Error('must not run')},renderBrowser:async()=>article,isUsableBrowserArticle:r=>r.bodyFound&&r.markdown});assert.equal(result.kind,'article');assert.equal(staticCalls,0);
 let lastWindow,ready=true,extracts=0,inheritedCalls=0;const session={};
 class Window extends EventEmitter {
  constructor(options){super();lastWindow=this;this.options=options;this.webContents=new EventEmitter();for(const e of ['will-navigate','will-frame-navigate','will-redirect'])this.webContents.on(e,()=>{inheritedCalls++});this.webContents.setWindowOpenHandler=fn=>this.popup=fn;this.webContents.getURL=()=>this.url;this.webContents.executeJavaScript=async()=>ready;}
  async loadURL(u){this.url=u;}isDestroyed(){return !!this.destroyed}destroy(){this.destroyed=true;this.emit('closed')}
 }
 function open(render=async()=>{extracts++;return article},extra={}){return openWechatArticleVerification({url,BrowserWindow:Window,session,gate,renderArticle:render,pollMs:100000,timeoutMs:1000,...extra});}
 let promise=open();assert.equal(lastWindow.options.webPreferences.session,session);assert.equal(lastWindow.options.webPreferences.nodeIntegration,false);assert.equal(lastWindow.popup().action,'deny');let blocked=false;lastWindow.webContents.emit('will-navigate',{preventDefault(){blocked=true}},'https://evil.test/');assert.ok(blocked);
 for(const e of ['will-navigate','will-frame-navigate','will-redirect']){let prevented=false;lastWindow.webContents.emit(e,{preventDefault(){prevented=true}},{url});assert.equal(prevented,false);lastWindow.webContents.emit(e,{preventDefault(){prevented=true}},{url:'https://evil.test/'});assert.equal(prevented,true);}assert.equal(inheritedCalls,0);
 lastWindow.destroy();assert.equal((await promise).verified,false);assert.equal(extracts,0);assert.ok(gate.snapshot().remainingCooldownMs>0);
 promise=open();lastWindow.url=other;lastWindow.webContents.emit('did-finish-load');await new Promise(r=>setImmediate(r));assert.equal(extracts,0);lastWindow.destroy();await promise;
 ready=false;promise=open();lastWindow.webContents.emit('did-finish-load');await new Promise(r=>setImmediate(r));assert.equal(extracts,0);lastWindow.destroy();await promise;
 ready=true;let release;promise=open(()=>new Promise(r=>release=r));lastWindow.webContents.emit('did-finish-load');await new Promise(r=>setImmediate(r));const oldEpoch=gate.snapshot().incidentId;now+=600001;await assert.rejects(gate.run(async()=>({status:429})));release(article);let verified=await promise;assert.equal(verified.verified,true);assert.equal(verified.cooldownCleared,false);assert.notEqual(gate.snapshot().incidentId,oldEpoch);
 promise=open();lastWindow.webContents.emit('did-finish-load');verified=await promise;assert.equal(verified.verified,true);assert.equal(verified.cooldownCleared,false);assert.ok(gate.snapshot().remainingCooldownMs>0);
 ready=false;await assert.rejects(open(undefined,{timeoutMs:5}),/超时/);
 // Exercise the built plugin: one verified article is saved while an unrelated gate stays closed.
 const Module=require('node:module'),load=Module._load;let networkCalls=0;
 Module._load=function(name,...args){if(name==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},TFile:class{},normalizePath:x=>x,requestUrl:async()=>{networkCalls++;throw Error('unexpected network')}};return load.call(this,name,...args)};
 try {
  const Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js'),plugin=new Plugin();plugin.settings={socialArticleImageStorageMode:'remote'};
  plugin.wechatArticleRequestGate=createWechatArticleRequestGate({gapMs:0});await assert.rejects(plugin.wechatArticleRequestGate.run(async()=>({status:429})));
  plugin.wechatVerifiedArticleCache=createVerifiedArticleCache();plugin.wechatVerifiedArticleCache.put(url,article);
  const hydrate=(signal)=>plugin.hydrateWebpageMarkdown({type:'webpage',content:url,metadata:{url}},'inbox','fixture','fixture',null,{signal});
  const abort=new AbortController(),interrupted=hydrate(abort.signal);abort.abort();await assert.rejects(interrupted,{name:'AbortError'});assert.equal(plugin.wechatVerifiedArticleCache.peek(url),article);assert.equal(networkCalls,0);
  const saved=await hydrate();assert.equal(saved.metadata.conversionStatus,'success');assert.ok(saved.metadata.markdown.includes('真实文章正文'));assert.equal(networkCalls,0);
  assert.equal(plugin.wechatVerifiedArticleCache.peek(url),article); // hydration is not a disk commit
  plugin.wechatVerifiedArticleCache.take(url,article);
  await assert.rejects(hydrate(),e=>e.diagnostic?.accessPause?.pauseOrigin==='cooldown' && e.diagnostic.stages.some(s=>s.stage==='request-guard'&&s.accessPause.requestStarted===false));
  assert.equal(networkCalls,0);plugin.wechatVerifiedArticleCache.clear();
 } finally {Module._load=load;}
 console.log('PASS: WeChat trigger/cooldown evidence, redaction, CAS recovery, bounded one-use cache and human verification safety');
}
main().catch(e=>{console.error(e);process.exitCode=1});
