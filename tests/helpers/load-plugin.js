const Module = require('module');
const path = require('path');

function createObsidianMock(requestUrlMock) {
  class Plugin {
    addCommand() {}
    addRibbonIcon() {}
    addSettingTab() {}
    addStatusBarItem() { return { setText() {} }; }
    async loadData() { return null; }
    async saveData() {}
  }
  return {
    Notice: class Notice {},
    Plugin,
    PluginSettingTab: class PluginSettingTab {},
    Setting: class Setting {},
    requestUrl: (...args) => requestUrlMock(...args),
    Platform: { isMobile: false, isDesktop: true, isWin: true },
  };
}

function loadPlugin(options = {}) {
  const pluginPath = path.resolve(__dirname, '..', '..', 'main.js');
  delete require.cache[pluginPath];
  const requestUrlMock = options.requestUrl || (async () => ({}));
  const originalLoad = Module._load;
  Module._load = function mockObsidian(request, parent, isMain) {
    if (request === 'obsidian') return createObsidianMock(requestUrlMock);
    if (options.modules && Object.prototype.hasOwnProperty.call(options.modules, request)) {
      return options.modules[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(pluginPath);
  } finally {
    Module._load = originalLoad;
  }
}

module.exports = {
  loadPlugin,
};
