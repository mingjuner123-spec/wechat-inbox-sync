'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

module.exports = async function testToutiaoOperatorContent() {
  const id = '7123456789012345678';
  const otherId = '7123456789012345679';
  const url = 'https://www.toutiao.com/article/' + id + '/';
  const shortUrl = 'https://m.toutiao.com/is/testcase/';
  const text = '稻谷收获以后要尽快测量含水率，再按品种安排烘干、通风和入库，才能减少霉变造成的损失。'.repeat(2);
  const renderData = (content, group_id = id) => '<script id="RENDER_DATA">' +
    JSON.stringify({ articleInfo: { group_id, title: '收储方法', content } }) + '</script>';
  let httpResponse;
  let browserResult;
  let browserUrl;
  class BrowserWindow {
    constructor() {
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getURL = () => browserUrl;
      this.webContents.executeJavaScript = async () => ({ ...browserResult });
    }
    async loadURL() { this.webContents.emit('did-finish-load'); }
    destroy() {}
  }
  const originalLoad = Module._load;
  const originalWindow = global.window;
  const extensions = ['.ps1', '.sh', '.py'];
  const previous = extensions.map(ext => require.extensions[ext]);
  try {
    for (const ext of extensions) require.extensions[ext] = module => { module.exports = ''; };
    global.window = { setTimeout: fn => setImmediate(fn), clearTimeout: clearImmediate };
    Module._load = function (name, ...args) {
      if (name === 'electron') return { BrowserWindow };
      if (name === 'obsidian') return {
        Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, Setting: class {},
        requestUrl: async () => httpResponse,
      };
      return originalLoad.call(this, name, ...args);
    };
    const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
    const plugin = Object.create(Plugin.prototype);
    const capture = (source, content, opts = {}) => {
      httpResponse = { status: 200, text: renderData(content, opts.articleId), url: opts.httpUrl };
      browserUrl = opts.browserUrl || source;
      browserResult = opts.browserResult || {};
      return plugin.acquireOperatorToutiaoArticleContent(source);
    };
    assert.equal((await capture(url, text)).content.markdown, text);
    assert.equal((await capture(url, text + '\n打开今日头条APP')).content.markdown, text);
    assert.equal((await capture(url, text + '\n[下载今日头条 App](https://www.toutiao.com/)')).content.markdown, text);
    assert.equal((await capture(url, '', { browserResult: { initialDataHtml: renderData(text + '\n打开今日头条APP') } })).content.markdown, text);
    await assert.rejects(capture(url, '打开今日头条APP'), { code: 'OPERATOR_TOUTIAO_ARTICLE_EMPTY' });
    await assert.rejects(capture(url, text.repeat(3) + '\n打开今日头条APP查看剩余全文', { browserResult: { appWall: true } }), { code: 'OPERATOR_TOUTIAO_APP_WALL' });
    await assert.rejects(capture(url, text.repeat(3) + '\n登录后查看全文', { browserResult: { needsLogin: true } }), { code: 'OPERATOR_TOUTIAO_LOGIN_REQUIRED' });
    await assert.rejects(capture(url, text, { articleId: otherId }));
    assert.equal((await capture(shortUrl, text, { browserUrl: url })).content.markdown, text);
    await assert.rejects(capture(shortUrl, text, { browserUrl: url, articleId: otherId }));
    await assert.rejects(capture(shortUrl, text, { browserUrl: url, httpUrl: url.replace(id, otherId), articleId: otherId }));
    await assert.rejects(capture(shortUrl, text, { browserUrl: url, browserResult: { appWall: true } }), { code: 'OPERATOR_TOUTIAO_APP_WALL' });
    await assert.rejects(capture(shortUrl, text));
  } finally {
    Module._load = originalLoad;
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    extensions.forEach((ext, index) => {
      if (previous[index]) require.extensions[ext] = previous[index];
      else delete require.extensions[ext];
    });
  }
};
