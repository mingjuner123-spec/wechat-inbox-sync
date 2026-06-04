const assert = require('assert');

const {
  classifyContent,
  extractHttpUrl,
  generateBindCode,
  createRecentItem,
  buildFilePayload,
  buildTextOrLinkPayload,
  buildWebpagePayload,
  buildVoicePayload,
  formatDuration,
} = require('../miniprogram/pages/index/inbox-utils');

assert.strictEqual(classifyContent('https://developers.weixin.qq.com/miniprogram'), 'LINK');
assert.strictEqual(classifyContent('http://example.com'), 'LINK');
assert.strictEqual(classifyContent('关于这款产品的初步想法'), 'TEXT');
assert.strictEqual(classifyContent(''), 'TEXT');

assert.strictEqual(
  extractHttpUrl('听播客3年，我感受到了信息茧房的恐怖 刚开始听播客的... http://xhslink.com/o/5xRiTruK9EQ  \n把文字复制好，然后去【小红书】查看详情。'),
  'http://xhslink.com/o/5xRiTruK9EQ',
);
assert.strictEqual(
  extractHttpUrl('复制链接：https://www.xiaohongshu.com/explore/123?xsec_token=abc&xsec_source=pc_note.'),
  'https://www.xiaohongshu.com/explore/123?xsec_token=abc&xsec_source=pc_note',
);
assert.strictEqual(extractHttpUrl('没有链接的一段文字'), '');

const bindCode = generateBindCode();
assert.match(bindCode, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);

const recentText = createRecentItem('TEXT', '先收集，后整理');
assert.strictEqual(recentText.type, 'TEXT');
assert.strictEqual(recentText.labelClass, 'label-text');
assert.strictEqual(recentText.content, '先收集，后整理');
assert.strictEqual(recentText.time, '刚刚');

const recentVoice = createRecentItem('VOICE', '现场语音备忘录 - 00:15');
assert.strictEqual(recentVoice.labelClass, 'label-voice');

const recentFile = createRecentItem('FILE', 'example.pdf');
assert.strictEqual(recentFile.labelClass, 'label-file');

assert.deepStrictEqual(buildTextOrLinkPayload('https://example.com/a'), {
  contentType: 'link',
  content: 'https://example.com/a',
  url: 'https://example.com/a',
});

assert.deepStrictEqual(buildTextOrLinkPayload('一段临时想法'), {
  contentType: 'text',
  content: '一段临时想法',
});

assert.deepStrictEqual(buildWebpagePayload('https://mp.weixin.qq.com/s/example'), {
  contentType: 'webpage',
  content: 'https://mp.weixin.qq.com/s/example',
  url: 'https://mp.weixin.qq.com/s/example',
});

assert.deepStrictEqual(buildWebpagePayload(
  'http://xhslink.com/o/5xRiTruK9EQ',
  '听播客3年，我感受到了信息茧房的恐怖 刚开始听播客的... http://xhslink.com/o/5xRiTruK9EQ  \n把文字复制好，然后去【小红书】查看详情。',
), {
  contentType: 'webpage',
  content: 'http://xhslink.com/o/5xRiTruK9EQ',
  url: 'http://xhslink.com/o/5xRiTruK9EQ',
  shareText: '听播客3年，我感受到了信息茧房的恐怖 刚开始听播客的... http://xhslink.com/o/5xRiTruK9EQ  \n把文字复制好，然后去【小红书】查看详情。',
});

assert.deepStrictEqual(buildFilePayload({
  fileID: 'cloud://files/example.pdf',
  name: 'example.pdf',
  size: 1234,
}), {
  contentType: 'file',
  content: 'example.pdf',
  fileID: 'cloud://files/example.pdf',
  fileName: 'example.pdf',
  fileExt: 'pdf',
  fileSize: 1234,
});

assert.deepStrictEqual(buildVoicePayload('cloud://voice/001.mp3', 15200), {
  contentType: 'voice',
  content: '现场语音备忘录 - 00:15',
  audioFileID: 'cloud://voice/001.mp3',
  duration: 15200,
});

assert.deepStrictEqual(buildVoicePayload('cloud://voice/meeting.m4a', 0, 'meeting.m4a'), {
  contentType: 'voice',
  content: '现场语音备忘录 - 00:00',
  audioFileID: 'cloud://voice/meeting.m4a',
  duration: 0,
  audioFileName: 'meeting.m4a',
});

assert.strictEqual(formatDuration(0), '00:00');
assert.strictEqual(formatDuration(15200), '00:15');
assert.strictEqual(formatDuration(61500), '01:02');
