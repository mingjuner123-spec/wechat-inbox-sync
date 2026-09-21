'use strict';
const assert=require('node:assert/strict'),Module=require('module'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const old=Module._load;let Plugin;
try{Module._load=function(n,...args){if(n==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Modal:class{},Setting:class{},Notice:class{}};return old.call(this,n,...args)};Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js');}finally{Module._load=old;}
const url='https://mp.weixin.qq.com/s/fixture',id='source-id';
const recoveryId='local-recovery-'+crypto.createHash('sha256').update(id+'\n'+url).digest('hex');
const original='<!-- wechat-inbox-record-id: '+id+' -->\n\n## Markdown 内容\n\n微信公众号未返回正文，已保存原始链接和可用线索；可在微信内打开后重试。\n\n原始链接：'+url;
async function run(){
 const p=new Plugin(),notes=new Map([['Inbox/old.md',original],['Inbox/new.md','<!-- wechat-inbox-record-id: '+recoveryId+' -->\n'+ '完整正文内容。'.repeat(20)]]);
 let failures=[{recordId:id,bindingToken:'AAA-111'}],resolved=[];
 p.settings=Plugin.__test.mergeSettings({inboxDir:'Inbox',token:'AAA-111',bindings:[{token:'AAA-111',enabled:true,status:'bound'}]});
 p.app={vault:{getMarkdownFiles:()=>[...notes.keys()].map(path=>({path})),read:async file=>notes.get(file.path),cachedRead:async file=>notes.get(file.path),adapter:{read:async path=>notes.get(path)}}};
 p.getRecentSyncFailures=()=>failures;p.updateRecentSyncFailures=async value=>{resolved=value.resolved||[];failures=failures.filter(f=>!resolved.some(r=>r.recordId===f.recordId&&r.bindingToken===f.bindingToken));};
 p.deleteCloudRecord=async()=>{throw Error('cloud deletion forbidden')};
 assert.equal(await p.findRecoveredWechatArticleNotePath(id),'Inbox/new.md');
 assert.equal(await p.reconcileRecoveredWechatArticleFailure(id),true);assert.equal(failures.length,0);assert.equal(notes.get('Inbox/old.md'),original);
 failures=[{recordId:id,bindingToken:'AAA-111'},{recordId:id,bindingToken:'BBB-222'}];assert.equal(await p.reconcileRecoveredWechatArticleFailure(id),false);assert.equal(failures.length,2);
 failures=[{recordId:id,bindingToken:'AAA-111'}];notes.set('Inbox/new.md','<!-- wechat-inbox-record-id: '+recoveryId+' -->\n'+original.split('## Markdown 内容')[1]);assert.equal(await p.reconcileRecoveredWechatArticleFailure(id),false);assert.equal(failures.length,1);
 notes.set('Inbox/new.md','<!-- wechat-inbox-record-id: '+recoveryId+' -->\n'+'正文完整且可读。'.repeat(20));
 const save=p.updateRecentSyncFailures;p.updateRecentSyncFailures=async()=>{throw Error('disk full')};assert.equal(await p.reconcileRecoveredWechatArticleFailure(id),false);assert.equal(failures.length,1);p.updateRecentSyncFailures=save;
 const files=p.app.vault.getMarkdownFiles;p.app.vault.getMarkdownFiles=()=>[{path:'Inbox/old.md'}];
 assert.equal(await p.reconcileRecoveredWechatArticleFailure(id,{id:recoveryId,type:'webpage',content:url,metadata:{url}},{recordId:recoveryId,committed:true,filePath:'Inbox/new.md'}),true);assert.equal(failures.length,0);p.app.vault.getMarkdownFiles=files;
 failures=[{recordId:id,bindingToken:'AAA-111'}];
 p.syncBinding=async()=>({written:[],failed:[],skipped:[],conversionWarnings:[],completionWarnings:[]});p.getActiveBindings=()=>[{token:'AAA-111'}];p.showSyncProgress=()=>{};p.clearSyncProgressNotice=()=>{};p.getConfiguredLocalAsrInstallRoot=()=>'';p.getRecentXiaohongshuCommentResults=()=>[];p.getRecentXiaohongshuBrowserResults=()=>[];
 const outcome=await p.runSyncInboxOnce(false);assert.equal(failures.length,0,JSON.stringify({outcome,diagnostic:p.lastSyncDiagnostic,validation:Plugin.__test.validateSettings(p.settings)}));assert.equal(p.lastSyncDiagnostic.historicalFailureCount,0);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-finalization-test-'));
 try{
 p.getConfiguredLocalAsrInstallRoot=()=>tmp;p.getConfiguredLocalOcrInstallRoot=()=>tmp;p.getConfiguredLocalAsrPlatform=()=> 'win32';p.getLocalAsrInstallStatus=()=>({ready:true});p.getLocalOcrInstallStatus=()=>({ready:true});p.getLocalDouyinResolverInstallStatus=()=>({ready:true});
 fs.writeFileSync(path.join(tmp,'install.log'),'time=2026-09-21T00:00:00Z\nstatus=failed\n--- error ---\nffplay.exe PermissionDenied');
 assert.match(p.getSyncDiagnosticText(),/ASR 最近安装异常/);assert.match(p.getSyncDiagnosticText(),/2026-09-21T00:00:00Z/);
 fs.writeFileSync(path.join(tmp,'install.log'),'time=test\nstatus=success\n--- stdout ---\nINSTALLER_CLEANUP_WARNING stage=temporary-directory\n--- error ---\n');assert.match(p.getSyncDiagnosticText(),/INSTALLER_CLEANUP_WARNING/);
 fs.writeFileSync(path.join(tmp,'install.log'),'time=test\nstatus=success\n--- error ---\n');assert.doesNotMatch(p.getSyncDiagnosticText(),/ASR 最近安装异常/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
 const diskPlugin=new Plugin();diskPlugin.settings=Plugin.__test.mergeSettings({token:'AAA-111',bindings:[{token:'AAA-111'}],recentSyncFailures:[{recordId:id,bindingToken:'AAA-111',message:'failed',failedAt:new Date().toISOString()}]});
 const before=JSON.stringify(diskPlugin.settings.recentSyncFailures);diskPlugin.saveData=async()=>{throw Error('disk full')};
 await assert.rejects(diskPlugin.updateRecentSyncFailures({resolved:[{recordId:id,bindingToken:'AAA-111'}]}),/disk full/);assert.equal(JSON.stringify(diskPlugin.settings.recentSyncFailures),before);
 console.log('Recovery reconciliation, 161 migration, ambiguity, save failure and ready-component diagnostics passed');
}
run().catch(e=>{console.error(e);process.exitCode=1});