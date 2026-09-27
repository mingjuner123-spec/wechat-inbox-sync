'use strict';
const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [root, remoteModule, bundle] = process.argv.slice(2);
const remote = require(path.join(remoteModule, 'main'));
app.setPath('userData', path.join(root, 'profile'));
remote.initialize();
let fixture = 'network-only', mainResponses = 0, done = false;
function finish(data) {
  if (done) return;
  done = true;
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ mainResponses,
    remainingWindows: BrowserWindow.getAllWindows().length, ...data }));
  app.quit();
}
app.on('web-contents-created', (_event, contents) => {
  contents.debugger.on('message', (_event, method) => {
    if (method === 'Network.responseReceived') mainResponses++;
  });
});
ipcMain.handle('fixture-mode', (_event, mode) => { fixture = mode; });
ipcMain.on('fixture-result', (_event, result) => finish(result));
app.whenReady().then(async () => {
  app.on('window-all-closed', () => {});
  const partition = session.fromPartition('persist:wechat-inbox-wechat');
  // Intercept every HTTPS request in the disposable partition; never use live Douyin.
  partition.protocol.handle('https', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'www.douyin.com') return new Response('', { status: 404 });
    if (url.pathname === '/aweme/v1/web/aweme/detail/') {
      return new Response(JSON.stringify({ aweme_detail: {
        aweme_id: fixture === 'wrong-target' ? '9999999999999999999' : '7685198123559390506',
        video: { play_addr: { url_list: ['https://v3.douyinvod.com/test-target.mp4'] } },
      } }), { headers: { 'content-type': 'application/json' } });
    }
    const script = fixture === 'empty' ? '' : '<script>'
      + (fixture === 'timer-gated' ? '(async()=>{for(let i=0;i<40;i++)await new Promise(r=>setTimeout(r,100));' : '')
      + 'fetch("/aweme/v1/web/aweme/detail/").then(r=>r.json());'
      + (fixture === 'timer-gated' ? '})();' : '') + '</script>';
    return new Response('<!doctype html><title>Fixture</title><body>Fixture page</body>' + script,
      { headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
  });
  const host = new BrowserWindow({ show: false, webPreferences: {
    nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false,
  } });
  remote.enable(host.webContents);
  await host.loadFile(path.join(__dirname, 'host.html'));
  await host.webContents.executeJavaScript(`(${renderer.toString()})(${JSON.stringify(remoteModule)},${JSON.stringify(bundle)},${JSON.stringify(root)})`);
}).catch(error => finish({ error: String(error.message) }));
setTimeout(() => finish({ error: 'integration deadline exceeded' }), 140000);

async function renderer(remoteModule, bundle, root) {
  const electron = require('electron'), bridge = require(remoteModule), Module = require('module');
  const original = Module._load;
  Module._load = function (id, parent, main) {
    if (id === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {} };
    if (id === 'electron') return { ...electron, remote: bridge };
    return original.call(this, id, parent, main);
  };
  const cases = [];
  try {
    const Plugin = require(bundle), plugin = new Plugin();
    plugin.settings = {};
    plugin.getConfiguredLocalAsrInstallRoot = () => root;
    for (const name of ['timer-gated', 'network-only', 'empty', 'wrong-target']) {
      await electron.ipcRenderer.invoke('fixture-mode', name);
      const row = { name, responseReads: 0 };
      try {
        row.urls = await plugin.renderSocialMediaUrls('https://www.douyin.com/video/7685198123559390506', {
          strictDouyinTarget: true,
          onDouyinBrowserDiagnostic(event) { if (event.responseReads !== undefined) row.responseReads = event.responseReads; },
        });
      } catch (error) { row.code = error.code; }
      cases.push(row);
    }
    electron.ipcRenderer.send('fixture-result', { cases });
  } catch (error) { electron.ipcRenderer.send('fixture-result', { error: String(error.message), cases }); }
  finally { Module._load = original; }
}
