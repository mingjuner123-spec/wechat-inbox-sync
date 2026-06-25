const assert = require('assert');
const { loadPlugin } = require('./helpers/load-plugin');

const Plugin = loadPlugin();
const helpers = Plugin.__test;

const record = {
  _id: 'ai-boundary-record',
  type: 'webpage',
  content: 'https://www.xiaohongshu.com/explore/ai-boundary',
  metadata: {
    platform: 'Xiaohongshu',
    title: 'AI content workflow',
    markdown: '## Body\n\nThis is the body content and must not become fallback AI metadata.',
  },
};

async function run() {
  const inactiveProPlugin = new Plugin();
  inactiveProPlugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    bindings: [{ token: 'free-token', label: 'free', status: 'bound', enabled: true }],
    clientId: 'free-client',
  });
  let metadataGenerateCalled = false;
  inactiveProPlugin.requestJson = async (url) => {
    if (String(url).includes('/entitlements/status')) {
      return { data: { hasAccess: false, plan: 'pro', status: 'inactive' } };
    }
    if (url === '/metadata/generate') {
      metadataGenerateCalled = true;
      return { data: { description: 'should not be generated', keywords: ['should-not-generate'] } };
    }
    return { data: {} };
  };

  const inactiveResult = await inactiveProPlugin.enrichRecordMetadataWithAi(record);
  assert.strictEqual(metadataGenerateCalled, false);
  assert.strictEqual(inactiveResult.metadata.description || '', '');
  assert.deepStrictEqual(inactiveResult.metadata.keywords || [], []);
  assert.strictEqual(inactiveProPlugin.settings.aiMetadataEnabled, false);

  const invalidBindingPlugin = new Plugin();
  invalidBindingPlugin.settings = helpers.mergeSettings({
    aiMetadataEnabled: true,
    bindings: [{ token: 'invalid-token', label: 'invalid', status: 'bound', enabled: true }],
    clientId: 'invalid-client',
  });
  invalidBindingPlugin.generateAiMetadataWithCloud = async () => {
    throw new Error('Invalid bind code');
  };

  const invalidResult = await invalidBindingPlugin.enrichRecordMetadataWithAi(record);
  assert.strictEqual(invalidResult.metadata.description || '', '');
  assert.deepStrictEqual(invalidResult.metadata.keywords || [], []);
  assert.strictEqual(invalidBindingPlugin.settings.aiMetadataEnabled, false);
}

run()
  .then(() => console.log('ai metadata boundary checks passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
