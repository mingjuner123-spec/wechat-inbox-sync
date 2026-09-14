'use strict';
const assert = require('assert');
const Module = require('module');
const { parseFeishuImageUrl, decodeDisplayImage, createFeishuImageDisplay } = require('../obsidian-plugin/wechat-inbox-sync/src/feishu-image-display');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const url = 'https://example.feishu.cn/space/api/box/stream/download/v2/cover/Token123?width=0&height=0';
class ImageNode {
  constructor(src=url) { this.attrs={src}; this.listeners={}; this.isConnected=true; this.tagName='IMG'; this.ownerDocument={createElement:()=>({remove(){this.removed=true;},setAttribute(){}})}; }
  getAttribute(k){ return Object.prototype.hasOwnProperty.call(this.attrs,k)?this.attrs[k]:null; }
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){(this.listeners[k] ||= new Set()).add(fn);}
  removeEventListener(k,fn){this.listeners[k]?.delete(fn);}
  fire(k){for(const fn of [...(this.listeners[k]||[])]) fn();}
  after(node){this.message=node;}
  querySelectorAll(){return [];}
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function run(){
  assert.strictEqual(parseFeishuImageUrl(url).token,'Token123');
  assert.strictEqual(parseFeishuImageUrl('https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/preview/Token123/?preview_type=16').token,'Token123');
  assert.strictEqual(parseFeishuImageUrl('https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/Token123/?fallback_source=1&height=1280&mount_node_token=Document123&mount_point=docx_image&policy=equal&width=1280').token,'Token123');
  for(const u of ['https://feishu.cn.evil.test/space/api/box/stream/download/preview/Token123','http://example.feishu.cn/space/api/box/stream/download/preview/Token123','https://user:password@example.feishu.cn/space/api/box/stream/download/preview/Token123','https://example.feishu.cn/other/Token123','https://example.feishu.cn/space/api/box/stream/download/preview/Token123?redirect=https://evil.test']) assert.strictEqual(parseFeishuImageUrl(u),null,u);
  assert.strictEqual(decodeDisplayImage(png).mime,'image/png');
  assert.throws(()=>decodeDisplayImage('data:image/png;base64,PGh0bWw+YmFkPC9odG1sPg=='));
  assert.throws(()=>decodeDisplayImage('data:image/svg+xml;base64,PHN2Zy8+'));
  const img=new ImageNode(); img.setAttribute('srcset','original-srcset');
  const root={querySelectorAll:()=>[img]}; let calls=0; const revoked=[]; let counter=0;
  const display=createFeishuImageDisplay({root,canDisplay:()=>true,loadImage:async()=>{calls++;return png;},createObjectURL:()=>`blob:test-${++counter}`,revokeObjectURL:u=>revoked.push(u)});
  display.scan();
  const loadingMessage = img.message;
  assert.strictEqual(loadingMessage.textContent,'飞书图片加载中…');
  await tick();
  assert.strictEqual(img.getAttribute('src'),'blob:test-1');
  assert.strictEqual(img.getAttribute('srcset'),null);
  img.fire('load'); display.scan(); await tick();
  assert.strictEqual(loadingMessage.removed,true);
  assert.strictEqual(calls,1); assert.deepStrictEqual(revoked,['blob:test-1']);
  assert.strictEqual(display.diagnostic().shown,1);
  display.stop(); assert.strictEqual(img.getAttribute('src'),url);assert.strictEqual(img.getAttribute('srcset'),'original-srcset');
  assert.strictEqual(revoked.length,1);
  const failed=new ImageNode(); let notices=0;
  const bad=createFeishuImageDisplay({root:{querySelectorAll:()=>[failed]},canDisplay:()=>true,loadImage:async()=>{throw new Error('HTTP 401 secret-token='+url);},notify:()=>notices++});
  bad.scan();await tick();bad.scan();await tick();
  assert.strictEqual(bad.diagnostic().failed,1);assert.strictEqual(notices,1);
  assert.strictEqual(JSON.stringify(bad.diagnostic()).includes('secret'),false);
  assert.ok(failed.message.textContent.includes('飞书'));
  assert.strictEqual(failed.message.className,'wechat-inbox-feishu-image-error');
  bad.stop();assert.ok(failed.message.removed);
  // Same protected source in two panes shares the request; unrelated images do not.
  const pair=[new ImageNode(),new ImageNode(),new ImageNode('https://example.test/public.png')];
  let resolvePair; let sharedCalls=0;
  const pairDisplay=createFeishuImageDisplay({root:{querySelectorAll:()=>pair},canDisplay:()=>true,loadImage:()=>{sharedCalls++;return new Promise(r=>{resolvePair=r;});},createObjectURL:()=>`blob:pair-${++counter}`,revokeObjectURL:()=>{}});
  pairDisplay.scan();await tick();assert.strictEqual(sharedCalls,1);
  resolvePair(png);await tick();assert.ok(pair[0].getAttribute('src').startsWith('blob:'));assert.ok(pair[1].getAttribute('src').startsWith('blob:'));
  assert.strictEqual(pair[2].getAttribute('src'),'https://example.test/public.png');pairDisplay.stop();
  // Limit real work to three concurrent jobs and cancel pending DOM updates on unload.
  const many=Array.from({length:8},(_,i)=>new ImageNode(url.replace('Token123','Token123'+i)));
  const pending=[];let signals=[];
  const manyDisplay=createFeishuImageDisplay({root:{querySelectorAll:()=>many},canDisplay:()=>true,loadImage:({signal})=>{signals.push(signal);return new Promise(r=>pending.push(r));},createObjectURL:()=>{throw Error('Must not render after unload');}});
  manyDisplay.scan();await tick();assert.strictEqual(pending.length,3);assert.strictEqual(manyDisplay.diagnostic().pending,5);
  assert.strictEqual(many[0].message.textContent,'飞书图片加载中…');
  assert.strictEqual(many[3].message.textContent,'等待加载飞书图片…');
  manyDisplay.stop();assert.ok(signals.every(s=>s.aborted));pending.forEach(r=>r(png));await tick();assert.ok(many.every(img=>img.getAttribute('src').startsWith('https:')));
  assert.ok(many.every(img=>img.message.removed));
  // Detached/recycled images cannot receive stale asynchronous results.
  let resolveRemoved;let objectCount=0;
  const removed=new ImageNode();
  const removedDisplay=createFeishuImageDisplay({root:{querySelectorAll:()=>[removed]},canDisplay:()=>true,loadImage:()=>new Promise(r=>{resolveRemoved=r;}),createObjectURL:()=>{objectCount++;return 'blob:removed';}});
  removedDisplay.scan();await tick();removed.isConnected=false;removedDisplay.scan();resolveRemoved(png);await tick();assert.strictEqual(objectCount,0);removedDisplay.stop();
  const hungImages=Array.from({length:5},(_,i)=>new ImageNode(url.replace('Token123','HungToken'+i)));
  let hungCalls=0;let recover=false;
  const hung=createFeishuImageDisplay({root:{querySelectorAll:()=>hungImages},canDisplay:()=>true,timeoutMs:10,loadImage:()=>{hungCalls++;return recover?Promise.resolve(png):new Promise(()=>{});},createObjectURL:()=>`blob:retry-${++counter}`,revokeObjectURL:()=>{}});
  hung.scan();await new Promise(resolve=>setTimeout(resolve,30));
  assert.strictEqual(hungCalls,3);assert.strictEqual(hung.diagnostic().paused,true);assert.strictEqual(hung.diagnostic().active,0);assert.strictEqual(hung.diagnostic().lastErrorCode,'timeout');
  assert.ok(hungImages[3].message.textContent.includes('已暂停'));
  recover=true;hung.retry();await tick();await tick();hungImages.forEach(img=>img.fire('load'));
  assert.strictEqual(hung.diagnostic().failed,0);assert.strictEqual(hung.diagnostic().shown,5);assert.strictEqual(hung.diagnostic().lastErrorCode,'');hung.stop();
  // Real plugin integration uses the read-only media request options, both view
  // contexts and the established Electron session; never a real user credential.
  const originalLoad=Module._load;
  let sessionFetch=null;
  Module._load=function(request,parent,isMain){
    if(request==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Modal:class{},Notice:class{},Setting:class{},requestUrl:async()=>{throw Error('Unexpected request');}};
    if(request==='electron')return {remote:{session:{fromPartition:()=>({fetch:(...args)=>sessionFetch(...args)})}}};
    return originalLoad.call(this,request,parent,isMain);
  };
  try {
    const Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js');
    const plugin=new Plugin();plugin.settings={feishuOAuthStatus:{connected:true}};
    let officialOptions;
    plugin.fetchFeishuCloudMediaDataUrl=async(token,binding,opts)=>{assert.strictEqual(token,'Token123');officialOptions=opts;return {dataUrl:png};};
    const controller=new AbortController();
    assert.strictEqual(await plugin.loadFeishuDisplayImage({...parseFeishuImageUrl(url),signal:controller.signal}),png);
    assert.strictEqual(officialOptions.preserveSettings,true);assert.strictEqual(officialOptions.signal,controller.signal);
    const bindings=[{token:'synthetic-first'},{token:'synthetic-second'}];const tried=[];
    plugin.getActiveBindings=()=>bindings;
    plugin.fetchFeishuCloudMediaDataUrl=async(_token,binding,opts)=>{tried.push(binding.token);assert.strictEqual(opts.preserveSettings,true);if(binding===bindings[0])throw Error('飞书未授权');return {dataUrl:png};};
    await plugin.loadFeishuDisplayImage({...parseFeishuImageUrl(url),signal:controller.signal});
    assert.deepStrictEqual(tried,['synthetic-first','synthetic-second']);tried.length=0;
    await plugin.loadFeishuDisplayImage({...parseFeishuImageUrl(url),signal:controller.signal});assert.deepStrictEqual(tried,['synthetic-second']);
    plugin.settings.feishuOAuthStatus.connected=false;
    sessionFetch=async(requestUrl,init)=>{assert.strictEqual(requestUrl,url);assert.strictEqual(init.redirect,'error');assert.strictEqual(init.credentials,'include');assert.strictEqual(init.signal,undefined);assert.strictEqual(init.headers,undefined);return {ok:true,headers:{get:()=>null},body:new ReadableStream({start(c){c.enqueue(decodeDisplayImage(png).bytes);c.close();}})};};
    assert.strictEqual(decodeDisplayImage(await plugin.loadFeishuDisplayImage({...parseFeishuImageUrl(url),signal:controller.signal})).mime,'image/png');
    sessionFetch=async()=>({ok:true,headers:{get:key=>key==='content-type'?'text/html':null}});
    await assert.rejects(()=>plugin.loadFeishuDisplayImage({...parseFeishuImageUrl(url),signal:controller.signal}),/登录权限/);
    const reading=new ImageNode();const live=new ImageNode();const unrelated=new ImageNode();
    const viewRoot={querySelectorAll:()=>[reading,live,unrelated]};let postprocessor;let stop;
    plugin.loadFeishuDisplayImage=async()=>png;
    plugin.app={workspace:{containerEl:viewRoot,getLeavesOfType:()=>[{view:{file:{path:'feishu.md'},containerEl:{contains:img=>img===reading||img===live}}},{view:{file:{path:'other.md'},containerEl:{contains:img=>img===unrelated}}}],on:()=>({}),onLayoutReady:fn=>fn()},metadataCache:{getCache:p=>({frontmatter:{url:p==='feishu.md'?'https://example.feishu.cn/docx/Document123':'https://example.test/'}}),on:()=>({})}};
    plugin.register=fn=>{stop=fn;};plugin.registerEvent=()=>{};plugin.registerMarkdownPostProcessor=fn=>{postprocessor=fn;};plugin.addCommand=()=>{};
    plugin.startFeishuImageDisplay();postprocessor({querySelectorAll:()=>[reading]},{sourcePath:'feishu.md'});await tick();
    assert.ok(reading.getAttribute('src').startsWith('blob:'));assert.ok(live.getAttribute('src').startsWith('blob:'));assert.strictEqual(unrelated.getAttribute('src'),url);stop();
  } finally {Module._load=originalLoad;}
  console.log('Feishu protected image display tests passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
