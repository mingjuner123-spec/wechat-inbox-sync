'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const target='7685198123559390506',url='https://www.douyin.com/video/'+target,media='https://v3.douyinvod.com/target-fixture.mp4';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'douyin-network-only-'));let last,enabledResolve,attached=false,loaded=false;
const session={cookies:{get:async()=>[]},webRequest:{}};
for(const key of ['onBeforeRequest','onHeadersReceived','onBeforeRedirect','onCompleted','onBeforeSendHeaders','onErrorOccurred'])session.webRequest[key]=()=>{};
class Window extends EventEmitter{
 constructor(){super();last=this;this.webContents=Object.assign(new EventEmitter(),{id:1,session,setAudioMuted(){},setUserAgent(){},setWindowOpenHandler(){},getURL:()=>url,executeJavaScript:async script=>script.includes('const collect =')?{pageUrl:url,canonicalUrl:url,urls:[],domMediaCandidates:[],pageIdentityIds:[],douyinPaceState:''}:false});
 const debug=Object.assign(new EventEmitter(),{isAttached:()=>attached,attach:()=>{attached=true;},detach:()=>{attached=false;},sendCommand:command=>{
 if(command==='Network.enable')return new Promise(resolve=>{enabledResolve=resolve;});
 if(command==='Network.getResponseBody')return Promise.resolve({body:JSON.stringify({aweme_detail:{aweme_id:target,video:{play_addr:{url_list:[media]}}}})});
 throw Error('Unexpected command');}});this.webContents.debugger=debug;
 }
 hide(){} isDestroyed(){return Boolean(this.destroyed);} destroy(){this.destroyed=true;this.webContents.emit('destroyed');this.emit('closed');}
 async loadURL(){loaded=true;enabledResolve?.({});setImmediate(()=>{if(attached){this.webContents.debugger.emit('message',{},'Network.responseReceived',{requestId:'one',type:'XHR',response:{url:'https://www.douyin.com/aweme/v1/web/aweme/detail/',mimeType:'application/json'}});this.webContents.debugger.emit('message',{},'Network.loadingFinished',{requestId:'one',encodedDataLength:400});}this.webContents.emit('did-finish-load');});}
}
const original=Module._load,priorWindow=global.window;Module._load=function(id,parent,main){if(id==='obsidian')return{Plugin:class{},PluginSettingTab:class{},Modal:class{},Notice:class{}};if(id==='electron')return{remote:{BrowserWindow:Window,session:{fromPartition:()=>session}}};return original.call(this,id,parent,main);};global.window={setTimeout,clearTimeout};
(async()=>{let timer;try{const source=process.env.DOUYIN_REGRESSION_BASELINE||'../obsidian-plugin/wechat-inbox-sync/main';const Plugin=require(source);const p=new Plugin();p.settings={};p.getConfiguredLocalAsrInstallRoot=()=>root;const urls=await Promise.race([p.renderSocialMediaUrls(url,{strictDouyinTarget:true}),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('navigation blocked by capture setup')),3500))]);assert.equal(loaded,true);assert.deepEqual(urls,[media]);assert.equal(last.destroyed,true);console.log('PASS: native navigation ordering contract; network-only target media recovered');}catch(e){console.error(e.message);process.exitCode=1;}finally{clearTimeout(timer);last?.destroy();Module._load=original;if(priorWindow===undefined)delete global.window;else global.window=priorWindow;fs.rmSync(root,{recursive:true,force:true});}})();
