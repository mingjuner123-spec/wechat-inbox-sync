'use strict';
const assert = require('node:assert/strict');
const Module = require('module');
const { isWechatArticleFailurePlaceholder, getWechatPlaceholderRecoveryUrl } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-placeholder-utils');
const { getSyncLifecycleOutcomeError, isExistingLocalNoteDeliverable } = require('../obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils');
const { buildWechatArticleFallbackMarkdown } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const url = 'https://mp.weixin.qq.com/s/example';
const record = { id: 'original-id', type: 'webpage', content: url, metadata: { url } };
const placeholder = buildWechatArticleFallbackMarkdown({url, state:'guide', title:'测试文章', description:'可预约测试', coverUrl:'https://mmbiz.qpic.cn/cover.jpg'});
const original = '---\ntitle: 测试\n---\n<!-- wechat-inbox-record-id: original-id -->\n\n## Markdown 内容\n\n' + placeholder + '\n\n用户补写的内容必须保留。';
for (const state of ['guide','captcha','unavailable']) {
  const markdown = buildWechatArticleFallbackMarkdown({url,state,title:'长标题'.repeat(100),description:'长简介'.repeat(100),coverUrl:'https://mmbiz.qpic.cn/a.jpg'});
  for(const conversionStatus of ['partial','success','']) {
    const item={...record,metadata:{url,markdown,conversionStatus}};
    assert.equal(getSyncLifecycleOutcomeError(item).code,'EXTRACTION_FAILED');
    assert.equal(isExistingLocalNoteDeliverable(item,markdown),false);
  }
  assert.equal(getWechatPlaceholderRecoveryUrl(markdown),url);
}
assert.equal(isWechatArticleFailurePlaceholder(original),true);
for(const markdown of ['这是正常文章。\n\n'+placeholder, '> '+placeholder, '正常正文 '.repeat(100), '![贴图](https://mmbiz.qpic.cn/a.jpg)', placeholder.split('\n')[0]+'\n这是引用提示的说明文档']) {
  assert.equal(isWechatArticleFailurePlaceholder(markdown),false);
  assert.equal(isExistingLocalNoteDeliverable(record,markdown),true);
}
assert.equal(getWechatPlaceholderRecoveryUrl(placeholder+'\n原始链接：https://mp.weixin.qq.com/s/other'),'');
assert.equal(getWechatPlaceholderRecoveryUrl(placeholder.replaceAll(url,'https://evil.example/s/example')),'');
assert.equal(getWechatPlaceholderRecoveryUrl(placeholder.replaceAll(url,'https://user:pass@mp.weixin.qq.com/s/example')),'');
const previous=Module._load;
let Plugin;
try { Module._load=function(name,...args){if(name==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Modal:class{},Setting:class{},Notice:class{}};return previous.call(this,name,...args)};Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js'); }
finally {Module._load=previous;}
async function run(){
 const p=new Plugin();let body=original,writes=0,savedId='',signal,fail='',completed='';
 p.settings={};p.app={workspace:{getActiveFile:()=>({extension:'md',basename:'旧笔记'})},vault:{read:async()=>body}};
 p.setTranscriptionStopAvailable=()=>{};p.clearSyncProgressNotice=()=>{};
 p.getConfiguredLocalAsrInstallRoot=()=>'';
 p.findExistingRecordNotePath=async r=>r.id===completed?'recovered.md':'';
 p.writeRecord=async(r,now,binding,prefix,options)=>{
   assert.equal(binding,null);assert.equal(r.metadata.markdown,undefined);assert.equal(r.metadata.recoveredFromRecordId,'original-id');
   assert.equal(options.skipAi,true);signal=options.signal;savedId=r.id;
   if(fail)throw Object.assign(new Error(fail),{name:fail==='cancel'?'AbortError':'Error',diagnostic:{reason:'test-extraction-failure'}});
   writes++;completed=r.id;return {filePath:'recovered.md',committed:true};
 };
 const result=await p.recoverCurrentWechatArticlePlaceholder();assert.equal(result.committed,true);assert.equal(writes,1);assert.equal(body,original);assert.ok(savedId.startsWith('local-recovery-'));assert.equal(signal.aborted,false);
 assert.equal((await p.recoverCurrentWechatArticlePlaceholder()).reused,true);assert.equal(writes,1);
 completed='';fail='failed';assert.equal(await p.recoverCurrentWechatArticlePlaceholder(),null);assert.equal(writes,1);assert.equal(p.lastSyncDiagnostic.status,'failed');assert.equal(p.lastSyncDiagnostic.diagnostic.reason,'test-extraction-failure');
 fail='cancel';await p.recoverCurrentWechatArticlePlaceholder();assert.equal(p.lastSyncDiagnostic.status,'cancelled');assert.equal(writes,1);assert.equal(body,original);
 body=placeholder;await p.recoverCurrentWechatArticlePlaceholder();assert.equal(writes,1,'no identity must not fetch');
 body='正常笔记';await p.recoverCurrentWechatArticlePlaceholder();assert.equal(writes,1);
 p.syncInboxPromise=Promise.resolve();await p.recoverCurrentWechatArticlePlaceholder();assert.equal(writes,1);
 assert.equal(p.currentProcessingAbortController,null);
 console.log('WeChat placeholder recognition and safe local recovery passed');
}
run().catch(error=>{console.error(error);process.exitCode=1});
