'use strict';
const assert=require('assert');
const {isWechatImagePostHtml,classifyWechatArticleHtml,diagnoseWechatArticleHtml}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const {detectWechatImagePostDocument}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-image-post-utils');
const {runWechatArticlePipeline}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const {createWechatArticleRequestGate}=require('../obsidian-plugin/wechat-inbox-sync/src/wechat-request-gate');
const text='这是一篇普通公众号正文，保留图文排版。'.repeat(1400);
const article=`<html><script>const shared={from_masonry:true,image_list:[],route:'pages/image_detail'}; /* ${'bundle '.repeat(600000)} */</script><style>.swiper{display:block}</style><div id="js_content"><p>${text}</p>${Array.from({length:19},(_,i)=>`<img data-src="https://mmbiz.qpic.cn/mmbiz_jpg/fixture${i}/0">`).join('')}<div class="swiper">正文里的轮播组件</div></div></html>`;
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
  assert.equal(isWechatImagePostHtml(article),false);assert.equal(classifyWechatArticleHtml(article),'article');const diag=diagnoseWechatArticleHtml(article);assert.equal(diag.imageCount,19);assert.ok(diag.bodyTextChars>20000);assert.equal(diag.markers.captcha,false);
  assert.equal(classifyWechatArticleHtml('<div id="js_content">本文解释环境异常、去验证、访问频繁等提示的含义。</div>'),'article');
  const proseGate=createWechatArticleRequestGate({gapMs:0});await proseGate.run(async()=>({bodyFound:true,markdown:'本文解释环境异常、去验证、访问频繁等提示的含义。'}));
  let calls=[];let result=await runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/fixture-long',fetchStatic:async()=>{calls.push('static');return article;},renderBrowser:async()=>{calls.push('browser');throw Error('unnecessary browser');}});assert.equal(result.kind,'article');assert.deepEqual(calls,['static']);
  for(const weak of ['from_masonry','"image_list":[]','pages/image_detail','<div class="swiper"></div>']){const html=`<div id="js_content">短文章正文</div><script>${weak}</script>`;assert.equal(isWechatImagePostHtml(html),false);}
  assert.equal(detectWechatImagePostDocument({url:'https://mp.weixin.qq.com/s?__biz=x&t=pages/image_detail',html:article,bodyText:text,hasBody:true}),true);
  assert.equal(isWechatImagePostHtml('<script>window.cgiData={article_type:"newspic"};</script><div id="js_content">短贴图文案</div>'),true);
  assert.equal(detectWechatImagePostDocument({structuredCount:3,bodyText:'图集说明',hasBody:true}),true);
  // Browser uses exactly the same serializable detector, with no module dependencies.
  const browserDetector=(0,eval)(`(${detectWechatImagePostDocument.toString()})`);assert.equal(browserDetector({html:article,hasBody:true,bodyText:text}),false);
  calls=[];result=await runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/fixture-risk',fetchStatic:async()=>{calls.push('static');return captcha;},renderBrowser:async()=>{calls.push('browser');return article;}});assert.equal(result.state,'access_paused');assert.deepEqual(calls,['static']);
  let now=0,active=0,maxActive=0;const starts=[];const gate=createWechatArticleRequestGate({now:()=>now,sleep:async ms=>{now+=ms;},gapMs:1500});
  await Promise.all([1,2,3].map(i=>gate.run(async()=>{starts.push(now);active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return 'ok';})));assert.deepEqual(starts,[0,1500,3000]);assert.equal(maxActive,1);
  for(const risk of [{status:429,text:'busy'},{url:'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?fixture=1',text:''},captcha,Object.assign(new Error('Request failed, status 429'),{}),Object.assign(new Error('render failure'),{wechatArticleDiagnostic:{verificationMarker:true}})]){
    let tick=0,count=0;const riskGate=createWechatArticleRequestGate({now:()=>tick,sleep:async ms=>{tick+=ms;},gapMs:0,cooldownMs:600000});
    const pending=[riskGate.run(async()=>{count++;if(risk instanceof Error)throw risk;return risk;}),riskGate.run(async()=>{count++;return article;})];const settled=await Promise.allSettled(pending);assert.equal(count,1);assert.ok(settled.every(x=>x.status==='rejected'&&x.reason.code==='WECHAT_ACCESS_PAUSED'));
    await assert.rejects(riskGate.run(async()=>{count++;return article;}),{code:'WECHAT_ACCESS_PAUSED'});assert.equal(count,1);tick=600001;await riskGate.run(async()=>{count++;return article;});assert.equal(count,2);
  }
  const cleanGate=createWechatArticleRequestGate({gapMs:0});await assert.rejects(cleanGate.run(async()=>{throw Error('network failure');}));assert.equal(await cleanGate.run(async()=> 'recovered'),'recovered');
  const stopped=new AbortController();stopped.abort();let ran=false;await assert.rejects(cleanGate.run(async()=>{ran=true;},{signal:stopped.signal}),{name:'AbortError'});assert.equal(ran,false);assert.equal(await cleanGate.run(async()=> 'released'),'released');
  calls=[];result=await runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s?__biz=fixture&mid=1&idx=1&sn=fixture&t=pages/image_detail',fetchStatic:async()=>{calls.push('static');return '<div id="js_content">贴图说明文字</div>';},renderBrowser:async()=>{calls.push('browser');return {bodyFound:true,markdown:'图集',assets:[{url:'fixture'}]};}});assert.equal(result.kind,'article');assert.deepEqual(calls,['static','browser']);
  calls=[];await assert.rejects(runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/fixture-abort',fetchStatic:async()=>{calls.push('static');throw Object.assign(Error('cancelled'),{name:'AbortError'});},renderBrowser:async()=>{calls.push('browser');}}),{name:'AbortError'});assert.deepEqual(calls,['static']);
  result=await runWechatArticlePipeline({url:'https://mp.weixin.qq.com/s/fixture-browser-prose',fetchStatic:async()=>'',renderBrowser:async()=>({bodyFound:true,markdown:'教程：如果提示请稍后再试，请检查页面的具体提示。'})});assert.equal(result.kind,'article');
  await runPluginIntegration();
  console.log('PASS: long article misclassification, true picture posts, one-request delivery, captcha stop, serial spacing, 429/captcha cooldown and queue release');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
