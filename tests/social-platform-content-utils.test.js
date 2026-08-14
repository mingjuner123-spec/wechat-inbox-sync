'use strict';

const assert = require('assert');
const {
  createDouyinStructuredContentBuilder,
} = require('../obsidian-plugin/wechat-inbox-sync/src/social-platform-content-utils');

const buildDouyinStructuredContent = createDouyinStructuredContentBuilder({
  cleanDescription: (value) => String(value || '').trim(),
  extractTags: (value) => String(value || '').match(/#[\w-]+/g) || [],
  buildMetrics: (source) => source.metrics || {},
  hasMetrics: (metrics) => Object.keys(metrics || {}).length > 0,
  isGenericTitle: (value) => String(value || '').toLowerCase() === 'douyin',
  deriveTitle: (value) => String(value || '').split(/\r?\n/)[0].replace(/\s+#[\w-].*$/, '').trim(),
});

function run() {
  const structured = buildDouyinStructuredContent({
    title: 'A useful creator workflow',
    desc: 'A useful creator workflow\n#Obsidian #Workflow',
    text_extra: [{ hashtag_name: 'Obsidian' }],
    video: { cover: { url_list: ['https://img.example.com/cover.jpg'] } },
    metrics: { likes: 120 },
  });
  assert.strictEqual(structured.title, 'A useful creator workflow');
  assert.strictEqual(structured.description, 'A useful creator workflow\n#Obsidian #Workflow');
  assert.deepStrictEqual(structured.tags, ['Obsidian', 'Workflow']);
  assert.strictEqual(structured.coverUrl, 'https://img.example.com/cover.jpg');
  assert.deepStrictEqual(structured.socialMetrics, { likes: 120 });

  const previewWins = buildDouyinStructuredContent({
    title: 'Douyin',
    preview_title: 'Original platform title',
    desc: 'Original platform title\nFull original description',
  });
  assert.strictEqual(previewWins.title, 'Original platform title');

  const derived = buildDouyinStructuredContent({
    desc: 'A detailed original description that becomes the fallback title.\n#Topic',
  });
  assert.strictEqual(derived.title, 'A detailed original description that becomes the fallback title.');
  assert.match(derived.description, /#Topic/);

  console.log('social-platform-content-utils tests passed');
}

run();
