const assert = require('assert');

const {
  getDateFolderName,
} = require('../obsidian-plugin/wechat-inbox-sync/sync-core');

assert.strictEqual(
  getDateFolderName('2026-05-08T16:34:00.000Z'),
  '2026-05-09',
  'Obsidian plugin sync-core should group records by China local date'
);
