'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
const originalLoad=Module._load;
let response={status:200,text:''};
let responseProvider=null;
let electronRemote=null;
Module._load=function(name,...args){
  if(name==='obsidian') return {Plugin:class{},PluginSettingTab:class{},Modal:class{},Setting:class{},Notice:class{},requestUrl:async options=>responseProvider?responseProvider(options):response};
  if(name==='electron' && electronRemote) return {remote:electronRemote};
  if(name==='electron'||name==='@electron/remote') throw new Error('unavailable in test');
  return originalLoad.call(this,name,...args);
};
const Plugin=require('../obsidian-plugin/wechat-inbox-sync/main');
const lifecycle=require('../obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'article-diagnostics-test-'));
const originalDOMParser=global.DOMParser;
global.DOMParser=class {
  parseFromString(html){
    const match=String(html||'').match(/<div class="RichText">([\s\S]*?)<\/div>/i);
    const innerHTML=match?match[1]:'';
    const body={innerHTML,innerText:innerHTML.replace(/<[^>]+>/g,' '),textContent:innerHTML.replace(/<[^>]+>/g,' ')};
    const answer={getAttribute:()=>'',querySelector:selector=>selector.includes('RichText')?body:null,querySelectorAll:()=>[]};
    return {querySelectorAll:selector=>selector==='.AnswerItem'?[answer]:[],querySelector:()=>null};
  }
};
async function run(){
  const plugin=Object.create(Plugin.prototype);
  plugin.manifest={version:'1.3.214'};
  plugin.settings=Plugin.__test.mergeSettings({token:'SYNTHETIC-SECRET'});
  plugin.saveSettings=async settings=>{plugin.settings=settings;};
  plugin.getConfiguredLocalAsrInstallRoot=()=>root;
  plugin.getRecentXiaohongshuBrowserResults=()=>[{recordRef:'unrelated-xhs',outcome:'success',error:'unrelated-xhs-detail'}];
  plugin.getRecentXiaohongshuCommentResults=()=>[];
  const operatorKeys=['WECHAT_INBOX_OPERATOR_NODE_ENABLED','WECHAT_INBOX_OPERATOR_NODE_ID','WECHAT_INBOX_OPERATOR_NODE_TOKEN'];
  const previousOperatorEnv=operatorKeys.map(key=>process.env[key]);
  try {
    operatorKeys.forEach(key=>delete process.env[key]);
    assert.equal(await plugin.loginZhihuArticle(),false,'ordinary users cannot open an operator login');
    assert.equal(Plugin.__test.isOperatorArticleSessionEnabled(),false);
    const anonymous=Plugin.__test.getPlatformArticleBrowserPreferences('zhihu');
    assert.equal(anonymous.partition,'wechat-inbox-zhihu-public');
    assert.equal(anonymous.session,undefined,'anonymous attempts never inherit persistent login cookies');
    assert.throws(()=>Plugin.__test.getPlatformArticleBrowserPreferences('zhihu',{operatorSession:true}),{code:'OPERATOR_NODE_DISABLED'});
    process.env[operatorKeys[0]]='1'; process.env[operatorKeys[1]]='fixture-owner'; process.env[operatorKeys[2]]='fixture-worker-token';
    const ownerSession={fixture:true};let partition='';
    electronRemote={session:{fromPartition:value=>{partition=value;return ownerSession;}}};
    assert.equal(Plugin.__test.getPlatformArticleBrowserPreferences('zhihu',{operatorSession:true}).session,ownerSession);
    assert.match(partition,/^persist:/,'operator login survives restarts on that machine');
    assert.equal(Plugin.__test.getPlatformArticleBrowserPreferences('zhihu').session,undefined,'even an owner first attempts anonymous extraction');
  } finally {
    operatorKeys.forEach((key,index)=>{if(previousOperatorEnv[index]===undefined)delete process.env[key];else process.env[key]=previousOperatorEnv[index];});
    electronRemote=null;
  }
  plugin.lastSyncDiagnostic={status:'success'};
  const url='https://www.zhihu.com/question/321759446/answer/2047272282221961889';
  await plugin.updateRecentSyncFailures({failed:[{recordId:'target',bindingToken:'SYNTHETIC-SECRET',message:'failure SYNTHETIC-SECRET',sourceUrl:url,stage:'parse',code:'EXTRACTION_FAILED',diagnostic:{source:'platform-article',platform:'zhihu',http:{status:403,transport:'obsidian-requestUrl'}}}]});
  const diagnostic=plugin.getSyncDiagnosticText({detailed:true});
  assert.match(diagnostic,/target/);assert.match(diagnostic,/403/);assert.match(diagnostic,/parse/);
  assert.doesNotMatch(diagnostic,/SYNTHETIC-SECRET|unrelated-xhs|抖音|ASR 尝试|模型|磁盘/);
  assert.ok(Buffer.byteLength(diagnostic)<4000);
  assert.doesNotMatch(JSON.stringify(plugin.settings.recentSyncFailures), /zhihu\.com|2047272282221961889/,
    'persistent failure context must not retain source links');
  // Settings reload retains safe article failure facts, despite a successful empty poll.
  plugin.settings=Plugin.__test.mergeSettings(JSON.parse(JSON.stringify(plugin.settings)));
  assert.match(plugin.getSyncDiagnosticText({detailed:true}),/403/);
  await plugin.updateRecentSyncFailures({resolved:[{recordId:'target',bindingToken:'SYNTHETIC-SECRET'}]});
  assert.match(plugin.getSyncDiagnosticText({detailed:true}),/当前没有失败中的同步记录/);
  plugin.saveMarkdownRemoteImageAssets=async md=>md;
  plugin.downloadWebpageHtmlViaNode=async()=>'';
  const content='知乎目标回答的正文内容，需要完整保留，不能被推荐回答和页面导航替代。'.repeat(3);
  response={status:200,text:`<script id="js-initialData">${JSON.stringify({initialState:{entities:{answers:{111:{content:'错误推荐'.repeat(200)},'2047272282221961889':{content,question:{title:'正确文章'}}}}}})}</script>`};
  const record={_id:'target',type:'webpage',content:url,metadata:{}};
  const success=await plugin.hydrateWebpageMarkdown(record,root,'2026-11-01','test');
  assert.equal(success.metadata.conversionStatus,'success');
  assert.equal(success.metadata.markdown,content);
  assert.equal(lifecycle.getSyncLifecycleOutcomeError(success),null);
  const originalAssetSaver=plugin.saveMarkdownRemoteImageAssets;
  plugin.saveMarkdownRemoteImageAssets=async md=>md;
  const lazyContent=content+'<img src="data:image/svg+xml;utf8," data-actualsrc="https://picx.zhimg.com/v2-fixture.jpg">';
  response={status:200,text:`<script id="js-initialData">${JSON.stringify({initialState:{entities:{answers:{'2047272282221961889':{content:lazyContent,question:{title:'正确文章'}}}}}})}</script>`};
  const lazyCustomer=await plugin.hydrateWebpageMarkdown(record,root,'2026-11-01','test');
  const lazyOperator=await plugin.acquireOperatorZhihuArticleContent(url);
  for(const md of [lazyCustomer.metadata.markdown,lazyOperator.content.markdown]){
    assert.match(md,/https:\/\/picx.zhimg.com\/v2-fixture.jpg/);
    assert.doesNotMatch(md,/data:image/,'public and operator HTTP fallbacks preserve real lazy images');
  }
  plugin.saveMarkdownRemoteImageAssets=originalAssetSaver;
  response={status:200,text:`<script id="js-initialData">${JSON.stringify({initialState:{entities:{answers:{'2047272282221961889':{content,question:{title:'正确文章'}}}}}})}</script>`};
  const oldShell={...record,metadata:{markdown:'# 标题长到足够通过旧检查\n原始链接：'+url,conversionStatus:'success'}};
  assert.equal((await plugin.hydrateWebpageMarkdown(oldShell,root,'2026-11-01','test')).metadata.markdown,content,'old shells must be re-extracted');
  response={status:403,text:'<html><nav>首页 热点 登录 关于我们</nav></html>'};
  const originalFallback = plugin.maybeSubmitPlatformArticleCloudFallback;
  let authFallbackCalls = 0;
  let persistentSessionReads = 0;
  electronRemote = {session:{fromPartition:()=>{persistentSessionReads++;return {fetch:async()=>{throw Error('must not use persistent customer cookies');}};}}};
  plugin.maybeSubmitPlatformArticleCloudFallback = async () => { authFallbackCalls++; return null; };
  const failure=await plugin.hydrateWebpageMarkdown(record,root,'2026-11-01','test');
  electronRemote = null;
  assert.equal(persistentSessionReads,0,'anonymous 403 fallback never opens a persistent session');
  assert.equal(authFallbackCalls, 1, '403 proceeds to the article extraction queue instead of asking the customer to log in');
  assert.doesNotMatch(failure.metadata.conversionError, /登录|插件设置/);
  plugin.maybeSubmitPlatformArticleCloudFallback = originalFallback;
  assert.equal(failure.metadata.conversionStatus,'link_saved');
  const failureError=lifecycle.getSyncLifecycleOutcomeError(failure);
  assert.equal(failureError.code,'EXTRACTION_FAILED');
  assert.equal(failureError.diagnostic.http.status,403);
  assert.equal(failureError.diagnostic.failureCode,'ACCESS_BLOCKED');
  const originalGate=plugin.evaluateCloudFallbackUserGate;
  const originalSubmit=plugin.submitCloudFallbackJob;
  let articleSubmission=null;
  plugin.evaluateCloudFallbackUserGate=async options=>{
    assert.equal(options.requireTranscriptionComponent,false,'article extraction never requires local ASR');
    return {allowed:true};
  };
  const binding={token:'fixture-customer-binding'};
  plugin.submitCloudFallbackJob=async options=>{articleSubmission=options;return {jobId:'fixture-article-job',status:'queued'};};
  await assert.rejects(plugin.maybeSubmitPlatformArticleCloudFallback(record,{url,binding}),{code:'CLOUD_FALLBACK_QUEUED'});
  assert.equal(articleSubmission.sourceType,'zhihu_article');
  assert.equal(articleSubmission.binding,binding,'result ownership remains the submitting user, not the operator');
  assert.equal(articleSubmission.recordId,'target');
  plugin.submitCloudFallbackJob=async()=>({jobId:'fixture-article-job',status:'succeeded',content:{title:'运营节点文章',markdown:content}});
  const recovered=await plugin.maybeSubmitPlatformArticleCloudFallback(record,{url,binding});
  assert.equal(recovered.record._id,'target');
  assert.equal(recovered.record.metadata.markdown,content);
  assert.equal(recovered.record.metadata.cloudFallbackResultKind,'content');
  plugin.evaluateCloudFallbackUserGate=originalGate;
  plugin.submitCloudFallbackJob=originalSubmit;
  const tardisBody='知乎通过公开 SSR 阅读入口返回的目标回答正文。'.repeat(10);
  responseProvider=async options=>{
    if(options.url==='https://www.zhihu.com/tardis/zm/ans/2047272282221961889'){
      return {status:200,text:`<script>window.g_initialProps = ${JSON.stringify({renderHtml:`<div class="AnswerItem"><div class="RichText"><p>${tardisBody}</p></div></div>`})};</script>`};
    }
    const error=new Error('HTTP 403');error.status=403;throw error;
  };
  const tardisSuccess=await plugin.hydrateWebpageMarkdown(record,root,'2026-11-01','test');
  assert.equal(tardisSuccess.metadata.conversionStatus,'success');
  assert.equal(tardisSuccess.metadata.conversionDiagnostic.stage,'tardis-ssr');
  assert.ok(tardisSuccess.metadata.markdown.includes(tardisBody));
  const toutiaoUrl='https://www.toutiao.com/article/7652651188260700699/';
  const toutiaoBody='头条移动端 info/v2 接口返回的目标文章内容。'.repeat(10);
  responseProvider=async options=>{
    if(options.url==='https://m.toutiao.com/i7652651188260700699/info/v2/'){
      return {status:200,text:JSON.stringify({data:{group_id:'7652651188260700699',title:'移动端标题',content:`<p>${toutiaoBody}</p>`,media_user:{screen_name:'头条作者'}}})};
    }
    return {status:200,text:'<html><body><div id="app">导航 热点 登录</div></body></html>'};
  };
  const toutiaoSuccess=await plugin.hydrateWebpageMarkdown({...record,content:toutiaoUrl,metadata:{}},root,'2026-11-01','test');
  assert.equal(toutiaoSuccess.metadata.conversionStatus,'success');
  assert.equal(toutiaoSuccess.metadata.conversionDiagnostic.stage,'mobile-info-v2');
  assert.equal(toutiaoSuccess.metadata.title,'移动端标题');
  assert.ok(toutiaoSuccess.metadata.markdown.includes(toutiaoBody));
  responseProvider=null;
  const operatorContent='运营节点必须确认回答 ID 后才回传正文。'.repeat(8);
  response={status:200,text:`<script id="js-initialData">${JSON.stringify({initialState:{entities:{answers:{'2047272282221961889':{content:operatorContent,question:{title:'目标知乎回答'},author:{name:'作者'}}}}}})}</script>`};
  const operatorSuccess=await plugin.acquireOperatorZhihuArticleContent(url);
  assert.equal(operatorSuccess.kind,'content');
  assert.equal(operatorSuccess.content.title,'目标知乎回答');
  assert.equal(operatorSuccess.content.markdown,operatorContent);
  response={status:200,text:`<script id="js-initialData">${JSON.stringify({initialState:{entities:{answers:{'111':{content:'错误回答'.repeat(100)}}}}})}</script>`};
  await assert.rejects(plugin.acquireOperatorZhihuArticleContent(url),error=>error&&error.code==='OPERATOR_ZHIHU_ARTICLE_EMPTY',
    'operator capture never substitutes another answer for the requested answer');
  console.log('plugin article and failed-only diagnostic integration tests passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{Module._load=originalLoad;if(originalDOMParser===undefined)delete global.DOMParser;else global.DOMParser=originalDOMParser;fs.rmSync(root,{recursive:true,force:true});});
