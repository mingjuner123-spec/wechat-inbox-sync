'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {EventEmitter}=require('events');
const source=fs.readFileSync(path.join(__dirname,'../obsidian-plugin/wechat-inbox-sync/src/main.js'),'utf8');
const part=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const context={URL};
vm.createContext(context);
vm.runInContext(part('function shouldBlockExternalAppUrl(', 'const DOUYIN_EXTERNAL_PROTOCOLS')
  +part('function installExternalAppNavigationGuards(', 'function createXiaohongshuBrowserDiagnostic('),context);
const createWindow=()=>{const wc=new EventEmitter();wc.setWindowOpenHandler=f=>{wc.openHandler=f};return wc};
const target=createWindow(),unrelated=createWindow();let externalOpens=0,unrelatedOpens=0;
const inherited=event=>{event.preventDefault();externalOpens++};
target.on('will-navigate',inherited);unrelated.on('will-navigate',()=>unrelatedOpens++);
// Electron remote returns function proxies, not removable original listeners.
const originalListeners=target.listeners.bind(target);
target.listeners=(name)=>originalListeners(name).map(fn=>(...args)=>fn(...args));
context.installWechatArticleNavigationGuards(target);
const navigate=(name,url)=>{const event={url,blocked:false,preventDefault(){this.blocked=true}};target.emit(name,event,url);return event.blocked};
for(const event of ['will-navigate','will-frame-navigate','will-redirect']){
  assert.equal(navigate(event,'https://mp.weixin.qq.com/s/test?scene=1'),false);
  for(const url of ['weixin://test','file:///secret','http://mp.weixin.qq.com/s/test','https://mp.weixin.qq.com.evil.test/s/test','https://user:pass@mp.weixin.qq.com/s/test','https://mp.weixin.qq.com:444/s/test','https://example.com/','invalid']){
    assert.equal(navigate(event,url),true,event+' must block '+url);
  }
}
assert.equal(externalOpens,0);
assert.equal(target.openHandler({url:'https://mp.weixin.qq.com/s/test'}).action,'deny');
unrelated.emit('will-navigate',{});assert.equal(unrelatedOpens,1);
assert.throws(()=>context.installWechatArticleNavigationGuards({}),/无法隔离/);
const renderer=part('async function renderWechatArticleToMarkdownWithElectron(', 'async function renderUrlToMarkdownWithElectron(');
assert(renderer.indexOf('installWechatArticleNavigationGuards(win.webContents)')<renderer.indexOf('await win.loadURL'));
assert(renderer.includes('cleanupHiddenWindow = installHiddenBrowserWindowGuards(win)'));
assert(renderer.includes('cleanupHiddenWindow();'));
console.log('PASS: article redirects stay hidden, unsafe destinations blocked, unrelated windows preserved, cleanup wired.');
