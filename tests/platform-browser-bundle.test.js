'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
let currentUrl, evaluated = 0, destroyed = 0;
const text = '这是需要保留的目标文章正文。'.repeat(20);
const body = {innerText:text,textContent:text,outerHTML:`<article>${text}</article>`,querySelectorAll:()=>[],cloneNode(){return this;}};
const answer = {getAttribute:()=>JSON.stringify({itemId:'12345'}),querySelector:()=>body,querySelectorAll:()=>[]};
const imageUrl='https://picx.zhimg.com/v2-example_r.jpg';
const embeddedHtml=`<p>${text}</p><img src="data:image/svg+xml;utf8," data-actualsrc="${imageUrl}">`;
const embeddedScript={outerHTML:`<script id="js-initialData">${JSON.stringify({initialState:{entities:{answers:{12345:{content:embeddedHtml,question:{title:'目标文章'}}}}}})}</script>`};
const doc = {title:'目标文章',body,documentElement:{scrollHeight:100},
 querySelector:()=>body,querySelectorAll:s=>s==='.AnswerItem'?[answer]:s.includes('script#')&&currentUrl.includes('zhihu')?[embeddedScript]:[]};
class BrowserWindow {
 constructor(){this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.getURL=()=>currentUrl;
  this.webContents.executeJavaScript=async script=>{
   evaluated++;assert.ok(script.includes('__name'),'built browser script includes serialized naming helpers');
   // A new page realm has no helper from the outer esbuild bundle.
   const context={document:doc,location:{href:currentUrl},URL,window:{scrollTo(){}},setTimeout:cb=>{cb();return 1;}};
   assert.equal(context.__name,undefined);
   return await vm.runInNewContext(script,context);
  };
 }
 async loadURL(url){currentUrl=url;this.webContents.emit('did-finish-load');}
 destroy(){destroyed++;}
}
const source=fs.readFileSync(require.resolve('../obsidian-plugin/wechat-inbox-sync/main'),'utf8')
 .replace('WechatObsidianInboxPlugin.__test = {','WechatObsidianInboxPlugin.__test = {renderPlatformArticleWithElectron,');
const moduleObject={exports:{}};
const stub={Plugin:class{},PluginSettingTab:class{},Modal:class{},Notice:class{},Setting:class{}};
const loader=name=>name==='obsidian'?stub:name==='electron'?{remote:{BrowserWindow,session:{fromPartition:()=>({})}}}:require(name);
const oldWindow=global.window;
const oldDOMParser=global.DOMParser;
global.DOMParser=class{parseFromString(html){
 const attrs={src:'data:image/svg+xml;utf8,','data-actualsrc':imageUrl};
 const image={currentSrc:'',getAttribute:k=>attrs[k]||'',setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],remove:()=>{}};
 return {body:{querySelectorAll:s=>s==='img'?[image]:[],get innerHTML(){return `<p>${text}</p><img src="${attrs.src}" alt="图片">`;}}};
}};
global.window={setTimeout:cb=>setTimeout(cb,0),clearTimeout};
new Function('require','module','exports',source)(loader,moduleObject,moduleObject.exports);
(async()=>{
 for(const url of ['https://www.zhihu.com/question/1/answer/12345','https://www.toutiao.com/article/12345/']){
  const result=await moduleObject.exports.__test.renderPlatformArticleWithElectron(url);
  assert.equal(result.bodyTextChars,text.length);
  assert.equal(result.identityMatched,true);
  assert.equal(result.needsLogin,false);
  if(url.includes('zhihu')){
   assert.equal(result.assets[0].src,imageUrl);
   assert.match(result.markdown,/https:\/\/picx.zhimg.com\/v2-example_r.jpg/);
   assert.doesNotMatch(result.markdown,/data:image/,'embedded state cannot replace cleaned image URLs with placeholders');
  }
 }
 assert.equal(evaluated,2);assert.equal(destroyed,2);
 console.log('platform-browser-bundle: isolated built selectors execute for Zhihu and Toutiao');
})().finally(()=>{global.window=oldWindow;global.DOMParser=oldDOMParser;}).catch(e=>{console.error(e);process.exitCode=1;});
