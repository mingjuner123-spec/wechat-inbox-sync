const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadRecordsFromFile,
  parseArgs,
  runSyncFromOptions,
  runRemoteSyncFromOptions,
} = require('../desktop-sync/sync-cli');

assert.deepStrictEqual(
  parseArgs(['--vault', 'D:\\Vault', '--records', 'records.json', '--inbox', '临时收集']),
  {
    vault: 'D:\\Vault',
    records: 'records.json',
    inbox: '临时收集',
  }
);

assert.throws(() => parseArgs(['--vault', 'D:\\Vault']), /Missing required option/);
assert.deepStrictEqual(
  parseArgs(['--vault', 'D:\\Vault', '--api-base', 'https://api.example.com/sync', '--token', 'abc']),
  {
    vault: 'D:\\Vault',
    apiBase: 'https://api.example.com/sync',
    token: 'abc',
    inbox: '临时收集',
  }
);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-cli-'));
const recordsPath = path.join(tmpRoot, 'records.json');
const vaultPath = path.join(tmpRoot, 'vault');

fs.writeFileSync(
  recordsPath,
  JSON.stringify({
    data: [
      {
        _id: 'record-text-1',
        type: 'text',
        content: 'CLI 同步测试',
        source: 'wechat-miniprogram',
        createdAt: '2026-05-08T12:34:00.000Z',
        status: 'pending',
        metadata: {},
      },
    ],
  }),
  'utf8'
);

assert.strictEqual(loadRecordsFromFile(recordsPath).length, 1);

const result = runSyncFromOptions({
  vault: vaultPath,
  records: recordsPath,
  inbox: '临时收集',
  syncedAt: '2026-05-08T13:00:00.000Z',
});

assert.strictEqual(result.written.length, 1);
assert.strictEqual(
  fs.existsSync(path.join(vaultPath, '临时收集', '2026-05-08', '文本-CLI 同步测试.md')),
  true
);

(async () => {
  const remoteVault = path.join(tmpRoot, 'remote-vault');
  const marked = [];
  const client = {
    async listPendingRecords() {
      return [
        {
          _id: 'remote-text-1',
          type: 'text',
          content: '远程同步记录',
          source: 'wechat-miniprogram',
          createdAt: '2026-05-08T12:34:00.000Z',
          status: 'pending',
          metadata: {},
        },
      ];
    },
    async markRecordSynced(recordId) {
      marked.push(recordId);
    },
  };

  const remoteResult = await runRemoteSyncFromOptions({
    vault: remoteVault,
    inbox: '临时收集',
    syncedAt: '2026-05-08T13:00:00.000Z',
    client,
  });

  assert.strictEqual(remoteResult.written.length, 1);
  assert.deepStrictEqual(marked, ['remote-text-1']);
  assert.strictEqual(
    fs.existsSync(path.join(remoteVault, '临时收集', '2026-05-08', '文本-远程同步记录.md')),
    true
  );
})();
