'use strict';
const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),Module=require('node:module');
const originalLoad=Module._load;
try {
  Module._load=function(request,parent,isMain){if(request==='obsidian')return {Plugin:class{},Modal:class{},Notice:class{},PluginSettingTab:class{},Setting:class{}};return originalLoad.call(this,request,parent,isMain);};
  var PluginClass=require('../obsidian-plugin/wechat-inbox-sync/main');
} finally {Module._load=originalLoad;}
async function run(){
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ocr-install-route-'));
  const originalExec=cp.exec;
  try {
    for(const platform of ['win32','darwin'])for(const authorized of [true,false]){
      const installRoot=path.join(scratch,platform+'-'+authorized);fs.mkdirSync(installRoot);
      const installer=path.join(scratch,platform==='win32'?'installer.ps1':'installer.sh');fs.writeFileSync(installer,'fixture');
      const plugin=new PluginClass();
      plugin.settings=PluginClass.__test.mergeSettings({});
      plugin.ensureProFeatureAccess=async()=>({hasAccess:true});
      plugin.getConfiguredLocalAsrPlatform=()=>platform;
      plugin.getConfiguredLocalOcrInstallRoot=()=>installRoot;
      plugin.getLocalOcrInstallStatus=()=>({ready:false});
      plugin.getAvailableLocalOcrInstallerPath=async()=>installer;
      const privateUrl='https://fixture.invalid/package.zip?q-signature=DO-NOT-LOG&x-cos-security-token=DO-NOT-LOG';
      plugin.getAuthorizedLocalComponentManifest=async()=>authorized?{component:'ocr',assets:[{id:'wheelhouse',downloadUrl:privateUrl},{id:'python-runtime',downloadUrl:privateUrl}]}:null;
      let calls=0;
      cp.exec=(command,options,callback)=>{
        calls++;assert.equal(options.timeout,30*60*1000);assert.equal(options.windowsHide,true);
        assert.equal(options.env.WECHAT_INBOX_DISABLE_PUBLIC_CLOUDBASE_CDN,'1');
        if(authorized)assert.equal(options.env.WECHAT_INBOX_OCR_WHEELHOUSE_URL,privateUrl);
        queueMicrotask(()=>callback(Object.assign(new Error('fixture timeout'),{killed:true}),'fixture dependency download stalled',''));
        return {pid:1234};
      };
      await assert.rejects(plugin.doInstallLocalOcr(),/安装超过 30 分钟/);
      assert.equal(calls,1,'failed attempt must not automatically start another installation');
      const log=fs.readFileSync(path.join(installRoot,'install.log'),'utf8');
      assert.ok(log.includes('ocrDownloadPolicy=tencent-authorized-first-v1'));
      assert.ok(log.includes('ocrAuthorizedManifest='+authorized));
      assert.ok(log.includes('ocrAuthorizedWheelhouse='+authorized));
      assert.ok(log.includes('ocrAuthorizedPython='+authorized));
      assert.ok(log.includes('ocrInstallTimeoutMinutes=30'));
      assert.ok(!log.includes('DO-NOT-LOG'));
    }
    console.log('OCR install route: Windows/macOS authorized and fallback timeout diagnostics passed');
  } finally {cp.exec=originalExec;fs.rmSync(scratch,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
