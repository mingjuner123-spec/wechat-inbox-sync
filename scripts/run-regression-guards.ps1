$ErrorActionPreference = 'Stop'

node --check obsidian-plugin/wechat-inbox-sync/main.js
node --check obsidian-plugin/wechat-inbox-sync/plugin-core.js
node --check cloudfunctions/syncApi/index.js
node --check cloudfunctions/quickstartFunctions/index.js

node tests/regression-contracts.test.js
node tests/plugin-core.test.js
node tests/plugin-main-ai.test.js
node tests/plugin-upload-sync.test.js
node tests/plugin-marketplace-package.test.js
node tests/sync-api-core.test.js
