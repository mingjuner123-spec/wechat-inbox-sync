'use strict';
const assert=require('node:assert/strict');
const {classifyWechatArticleHtml}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const {runWechatArticlePipeline}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const {createWechatArticleRequestGate}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-request-gate');
const article='<div id="js_content"><p>'+('这是一篇普通公众号正文，保留图文排版。'.repeat(30))+'</p></div>';
const captcha='<html><body>环境异常，完成验证后即可继续访问。去验证</body></html>';
async function runPluginIntegration(){
  const Module=require('module');const {EventEmitter}=require('events');const originalLoad=Module._load;
  let request=async()=>({text:''}),sessionFetch=async()=>({status:200,text:async()=>''}),browserLoads=0,scriptCalls=0,browserStatus=429;
  let lastWindow=null;
  class FakeWindow extends EventEmitter{
    constructor(){super();lastWindow=this;this.webContents=new EventEmitter();this.webContents.setUserAgent=()=>{};this.webContents.setWindowOpenHandler=()=>{};this.webContents.executeJavaScript=async()=>{scriptCalls++;return scriptCalls%2===1?true:{markdown:'一篇正常文章正文',assets:[],diagnostic:{}};};}
    async loadURL(url){browserLoads++;this.webContents.emit('did-frame-navigate',{},url,429,'busy',false);this.webContents.emit('did-navigate',{},url,browserStatus,'');this.webContents.emit('did-finish-load');}
    isDestroyed(){return this.destroyed||false;}destroy(){this.destroyed=true;this.emit('closed');}hide(){}
  }
  const session={fetch:(...args)=>sessionFetch(...args)};
  Module._load=function(name,...args){if(name==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},TFile:class{},normalizePath:x=>x,requestUrl:(...args)=>request(...args)};if(name==='electron')return {remote:{BrowserWindow:FakeWindow,session:{fromPartition:()=>session}}};return originalLoad.call(this,name,...args);};
  const previousWindow=global.window;global.window={setTimeout:(fn)=>setTimeout(fn,0),clearTimeout};
  try{
    const Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js');const url='https://mp.weixin.qq.com/s/fixture-integration';
    const fresh=()=>{const p=new Plugin();p.settings={};p.wechatArticleRequestGate=createWechatArticleRequestGate({gapMs:0});p.downloadWebpageHtmlViaNode=async()=>'';return p;};
    const hydrate=(p,signal)=>p.hydrateWebpageMarkdown({type:'webpage',content:url,metadata:{url}},'inbox','fixture','fixture',null,{signal});
    let p=fresh(),staticCount=0;const stopped=new AbortController();stopped.abort();request=async()=>{staticCount++;return {text:article};};
    await assert.rejects(hydrate(p,stopped.signal),{name:'AbortError'});assert.equal(staticCount,0);
    p=fresh();const controller=new AbortController();request=async()=>{staticCount++;controller.abort();return {text:''};};let nodeCalls=0;p.downloadWebpageHtmlViaNode=async()=>{nodeCalls++;return '';};await assert.rejects(hydrate(p,controller.signal),{name:'AbortError'});assert.equal(nodeCalls,0);
    // Cancellation must not release the gate while an already-started request is unsettled.
    p=fresh();const activeController=new AbortController();let release,entered;const started=new Promise(r=>entered=r);request=async()=>{entered();return await new Promise(r=>release=r);};const active=hydrate(p,activeController.signal);await started;activeController.abort();let nextRan=false;const next=p.wechatArticleRequestGate.run(async()=>{nextRan=true;return 'ok';});await Promise.resolve();assert.equal(nextRan,false);release({text:''});await assert.rejects(active,{name:'AbortError'});await next;assert.equal(nextRan,true);
    for (const phase of ['fetch','body']) {
      p=fresh();const stopSession=new AbortController();let resolveTransport,transportEntered;const transportStarted=new Promise(r=>transportEntered=r);const pendingTransport=new Promise(r=>resolveTransport=r);
      request=async()=>({text:''});sessionFetch=async()=>{transportEntered();return phase==='fetch'?await pendingTransport:{status:200,text:async()=>await pendingTransport};};
      const syncing=hydrate(p,stopSession.signal);await transportStarted;stopSession.abort();await assert.rejects(syncing,{name:'AbortError'});
      let queuedRan=false;const queued=p.wechatArticleRequestGate.run(async()=>{queuedRan=true;return 'done';});await new Promise(r=>setImmediate(r));assert.equal(queuedRan,false,phase+' remains in flight after caller abort');
      resolveTransport(phase==='fetch'?{status:200,text:async()=>''}:'');await queued;assert.equal(queuedRan,true);
    }
    // Caller timeout is also distinct from the raw transport finishing.
    const pendingGate=createWechatArticleRequestGate({gapMs:0});let settleLate;
    await assert.rejects(pendingGate.run(async({holdUntil})=>{holdUntil(new Promise(r=>settleLate=r));throw Error('timeout');}));
    let afterTimeout=false;const after=pendingGate.run(async()=>{afterTimeout=true;return '';});await new Promise(r=>setImmediate(r));assert.equal(afterTimeout,false);settleLate({status:429});await assert.rejects(after,{code:'WECHAT_ACCESS_PAUSED'});assert.equal(afterTimeout,false);
    for(const response of [{status:429,text:async()=> 'busy'},{status:429,text:async()=>{throw Error('response body stream failed');}},{status:200,url:'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha',text:async()=>''}]){
      p=fresh();staticCount=0;let sessionCount=0;request=async()=>{staticCount++;return {text:''};};sessionFetch=async()=>{sessionCount++;return response;};const loadsBefore=browserLoads;
      await assert.rejects(hydrate(p),e=>e.wechatArticleDiagnostic?.reason==='wechat-access-paused'||e.diagnostic?.reason==='wechat-access-paused'||/已暂停公众号抓取/.test(e.message));assert.equal(staticCount,1);assert.equal(sessionCount,1);assert.equal(browserLoads,loadsBefore);assert.ok(p.wechatArticleRequestGate.snapshot().remainingCooldownMs>0);
    }
    p=fresh();sessionFetch=async()=>({status:200,text:async()=>''});request=async()=>({text:''});const loadsBefore=browserLoads;await assert.rejects(hydrate(p),e=>/已暂停公众号抓取/.test(e.message));assert.equal(browserLoads-loadsBefore,1);assert.equal(scriptCalls,0);assert.equal(lastWindow.isDestroyed(),true);assert.equal(lastWindow.webContents.listenerCount('did-navigate'),0);
    // A subframe's 429 must not classify a successful main document as blocked.
    browserStatus=200;p=fresh();const rendered=await p.renderWechatArticleWithElectron(url);assert.equal(rendered.bodyFound,true);assert.equal(scriptCalls,2);
  }finally{Module._load=originalLoad;global.window=previousWindow;}
}
async function main(){
 assert.equal(classifyWechatArticleHtml('<div id="js_content">本文解释环境异常、去验证、访问频繁等提示的含义，属于文章正文。</div>'),'article');
 assert.equal(classifyWechatArticleHtml('<div>访问频繁，请稍后再试</div>'),'captcha');
 let now=0;const gate=createWechatArticleRequestGate({now:()=>now,sleep:async ms=>{now+=ms;},gapMs:1000,cooldownMs:600000});const starts=[];
 await Promise.all([1,2,3].map(async()=>gate.run(async()=>{starts.push(now);return 'ok';})));assert.deepEqual(starts,[0,1000,2000]);
 let count=0;const pausedGate=createWechatArticleRequestGate({now:()=>now,sleep:async ms=>{now+=ms;},gapMs:0,cooldownMs:600000});const blocked=Object.assign(new Error('429 busy'),{status:429});
 await assert.rejects(pausedGate.run(async()=>{count++;throw blocked;}));await assert.rejects(pausedGate.run(async()=>{count++;return article;}),{code:'WECHAT_ACCESS_PAUSED'});assert.equal(count,1);
 const verificationCalls=[];const verification=await runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/browser-verification-fixture',fetchStatic:async()=>{verificationCalls.push('static');return '<html><body>WeChat guide shell</body></html>';},renderBrowser:async()=>{verificationCalls.push('browser');throw Object.assign(Error('verification page has no article body'),{wechatArticleDiagnostic:{verificationMarker:true,hasJsContent:false,visibleTextChars:320}});}});assert.equal(verification.state,'access_paused');assert.deepEqual(verificationCalls,['static','static','browser']);
 const calls=[];const result=await runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/captcha-fixture',fetchStatic:async()=>{calls.push('static');return captcha;},renderBrowser:async()=>{calls.push('browser');return article;}});assert.equal(result.state,'access_paused');assert.deepEqual(calls,['static']);
 calls.length=0;await assert.rejects(runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/cancel-fixture',fetchStatic:async()=>{calls.push('static');throw Object.assign(Error('cancelled'),{name:'AbortError'});},renderBrowser:async()=>{calls.push('browser');}}),{name:'AbortError'});assert.deepEqual(calls,['static']);
 await runPluginIntegration();
 console.log('PASS: WeChat article throttle spacing, cooldown, captcha stop, cancellation and browser transport guards');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
