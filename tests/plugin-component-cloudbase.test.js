'use strict';
const assert=require('node:assert/strict'),Module=require('node:module'),cp=require('node:child_process'),path=require('node:path');
let response,calls=0,notices=0,lastUrl='';
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){if(name==='obsidian')return {Plugin:class{},Modal:class{},PluginSettingTab:class{},Setting:class{},Notice:class{constructor(){notices++;}},requestUrl:async options=>{calls++;lastUrl=options.url;return response;}};return originalLoad.call(this,name,parent,isMain);};
let NewPlugin,OldPlugin;
try{
  NewPlugin=require('../obsidian-plugin/wechat-inbox-sync/main');
  const oldSource=cp.execFileSync('git',['show','95fa3d16e1e702f160f9c41e78f67cd12d2b4ff5:obsidian-plugin/wechat-inbox-sync/main.js'],{maxBuffer:50*1024*1024,encoding:'utf8',windowsHide:true});
  const oldModule=new Module(path.join(__dirname,'published-1.3.146-fixture.js'),module);
  oldModule.filename=oldModule.id;oldModule.paths=module.paths;oldModule._compile(oldSource,oldModule.filename);OldPlugin=oldModule.exports;
}finally{Module._load=originalLoad;}
function plugin(Klass,platform='win32'){
  const p=new Klass();p.settings=Klass.__test.mergeSettings({token:'component-test-only',clientId:'test-device'});
  p.ensureProFeatureAccess=async()=>({hasAccess:true,bindingToken:'component-test-only'});
  p.getActiveBindings=()=>[{token:'component-test-only'}];p.getConfiguredLocalAsrPlatform=()=>platform;
  return p;
}
function payload(component,platform,arch){return {success:true,data:{schemaVersion:2,deliveryProtocol:'cloudbase-v1',component,platform,arch,version:'fixture-v1',expiresAt:new Date(Date.now()+3600000).toISOString(),assets:[{id:'python-runtime',fileName:'python.tar.gz',sha256:'a'.repeat(64),byteLength:1234,downloadUrl:`https://${NewPlugin.__test.LOCAL_COMPONENT_DOWNLOAD_HOST}/local-components/by-sha256/${'a'.repeat(64)}/python.tar.gz?sign=fixture&t=123`}]}};}
async function run(){
  const {assertNoPublicHost,checkAccessPolicy}=require('../scripts/check-local-component-access-policy');
  const declaration="const LOCAL_COMPONENT_DOWNLOAD_HOST = '6865-he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcb.qcloud.la';";
  assert.doesNotThrow(()=>assertNoPublicHost(declaration,true));
  assert.doesNotThrow(()=>assertNoPublicHost(declaration+'\r\n',true));
  assert.throws(()=>assertNoPublicHost(declaration,false));
  assert.throws(()=>assertNoPublicHost(declaration.replace('1357443479','1111111111'),true));
  assert.throws(()=>assertNoPublicHost(declaration+"\nconst publicUrl='https://6865-he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcb.qcloud.la/local-components/package.zip';",true));
  assert.throws(()=>assertNoPublicHost("https://old.tcloudbaseapp.com/local-asr/file.zip",true));
  checkAccessPolicy();
  for(const Klass of [OldPlugin,NewPlugin]){
    calls=0;notices=0;response={status:403,json:{success:false,errCode:'COMPONENT_CLIENT_UPGRADE_REQUIRED',errMsg:'组件下载服务已迁移，请先更新 WeChat Inbox Sync，再安装或修复组件。'}};
    await assert.rejects(plugin(Klass).getAuthorizedLocalComponentManifest('ocr'),e=>e.status===403&&e.code==='COMPONENT_CLIENT_UPGRADE_REQUIRED'&&e.message.includes('请先更新'));
    assert.equal(calls,1);assert.equal(notices,0,'upgrade error must not enter fallback or reinstall');
  }
  for(const component of ['asr','ocr'])for(const platform of ['win32','darwin']){
    calls=0;const arch=platform==='win32'?'x64':require('os').arch()==='arm64'?'arm64':'x64';response={status:200,json:payload(component,platform,arch)};
    const p=plugin(NewPlugin,platform),m=await p.getAuthorizedLocalComponentManifest(component);
    assert.equal(calls,1);assert.ok(lastUrl.includes('deliveryProtocol=cloudbase-v1'));
    assert.ok(m.assets[0].downloadUrl.includes('.tcb.qcloud.la/'));
    const env=NewPlugin.__test.buildAuthorizedLocalComponentProcessEnv({},m);
    assert.equal(env.WECHAT_INBOX_DISABLE_PUBLIC_CLOUDBASE_CDN,'1');
  }
  const helper=NewPlugin.__test,asset=payload('ocr','win32','x64').data.assets[0],url=asset.downloadUrl;
  for(const bad of [url.replace(helper.LOCAL_COMPONENT_DOWNLOAD_HOST,'wechat-inbox-components-1428610652.cos.ap-shanghai.myqcloud.com'),url.replace('https:','http:'),url+'&sign=again',url+'&other=1',url+'#fragment',url.replace('https://','https://user@')])
    assert.equal(helper.isAuthorizedLocalComponentDownloadUrl(bad,asset.sha256,asset.fileName),false);
  for(const platform of ['win32','darwin'])for(const arch of ['x64','arm64']){
    const d=payload('ocr',platform,arch).data;
    assert.equal(helper.normalizeAuthorizedLocalComponentManifest(d,{component:'ocr',platform,arch}).assets.length,1);
    delete d.deliveryProtocol;assert.throws(()=>helper.normalizeAuthorizedLocalComponentManifest(d,{component:'ocr',platform,arch}));
  }
  console.log('Component CloudBase protocol: platform URL validation and published 1.3.146 upgrade behavior passed');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
