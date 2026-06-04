const fs = require('fs');
const { syncRecordsToVault } = require('./sync-core');
const { createCloudClient } = require('./cloud-client');

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for option: ${arg}`);
    }
    options[key] = value;
    i += 1;
  }

  if (!options.vault) {
    throw new Error('Missing required option: --vault');
  }
  if (!options.records && (!options['api-base'] || !options.token)) {
    throw new Error('Missing required option: --records or --api-base with --token');
  }

  const parsed = {
    vault: options.vault,
    inbox: options.inbox || '临时收集',
  };

  if (options.records) {
    parsed.records = options.records;
  }
  if (options['api-base']) {
    parsed.apiBase = options['api-base'];
  }
  if (options.token) {
    parsed.token = options.token;
  }

  return parsed;
}

function loadRecordsFromFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.records)) return parsed.records;
  throw new Error('Records file must contain an array, data array, or records array');
}

function runSyncFromOptions(options) {
  const records = loadRecordsFromFile(options.records);
  return syncRecordsToVault({
    records,
    vaultPath: options.vault,
    inboxDir: options.inbox || '临时收集',
    syncedAt: options.syncedAt || new Date().toISOString(),
  });
}

async function runRemoteSyncFromOptions(options) {
  const client = options.client || createCloudClient({
    baseUrl: options.apiBase,
    token: options.token,
  });
  const records = await client.listPendingRecords();
  const result = syncRecordsToVault({
    records,
    vaultPath: options.vault,
    inboxDir: options.inbox || '临时收集',
    syncedAt: options.syncedAt || new Date().toISOString(),
  });

  for (const item of result.written) {
    await client.markRecordSynced(item.recordId);
  }

  return result;
}

function printUsage() {
  console.log('Usage:');
  console.log('  node desktop-sync/sync-cli.js --vault <ObsidianVaultPath> --records <records.json> [--inbox 临时收集]');
  console.log('  node desktop-sync/sync-cli.js --vault <ObsidianVaultPath> --api-base <url> --token <token> [--inbox 临时收集]');
}

if (require.main === module) {
  (async () => {
    try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.records
      ? runSyncFromOptions(options)
      : await runRemoteSyncFromOptions(options);
    console.log(`Synced ${result.written.length} record(s).`);
    result.written.forEach((item) => {
      console.log(`- ${item.filePath}`);
    });
    } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    }
  })();
}

module.exports = {
  loadRecordsFromFile,
  parseArgs,
  runRemoteSyncFromOptions,
  runSyncFromOptions,
};
