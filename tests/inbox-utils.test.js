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
  getFileExt,
  isAudioVideoWebpageUrl,
} = require('../miniprogram/pages/index/inbox-utils');

assert.strictEqual(classifyContent('https://developers.weixin.qq.com/miniprogram'), 'LINK');
assert.strictEqual(classifyContent('https://mp.weixin.qq.com/s/example'), 'WEBPAGE');
assert.strictEqual(classifyContent('http://xhslink.com/o/5xRiTruK9EQ'), 'WEBPAGE');
assert.strictEqual(classifyContent('https://weixin.qq.com/sph/A7ULN6a876'), 'WEBPAGE');
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
assert.strictEqual(isAudioVideoWebpageUrl('https://www.douyin.com/video/123'), true);
assert.strictEqual(isAudioVideoWebpageUrl('https://www.bilibili.com/video/BV123'), true);
assert.strictEqual(isAudioVideoWebpageUrl('https://www.xiaoyuzhoufm.com/episode/1'), true);
assert.strictEqual(isAudioVideoWebpageUrl('https://weixin.qq.com/sph/A7ULN6a876'), false);
assert.strictEqual(isAudioVideoWebpageUrl('https://mp.weixin.qq.com/s/example'), false);
assert.strictEqual(isAudioVideoWebpageUrl('https://www.xiaohongshu.com/explore/abc?type=video'), true);
assert.strictEqual(isAudioVideoWebpageUrl('http://xhslink.com/o/5xRiTruK9EQ', '小红书视频分享'), false);
assert.strictEqual(isAudioVideoWebpageUrl('http://xhslink.com/video/demo'), true);
assert.strictEqual(isAudioVideoWebpageUrl('http://xhslink.com/a/abc123'), true);
assert.strictEqual(isAudioVideoWebpageUrl('https://www.xiaohongshu.com/explore/abc?xsec_token=note'), false);

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

assert.deepStrictEqual(buildTextOrLinkPayload('https://mp.weixin.qq.com/s/example'), {
  contentType: 'webpage',
  content: 'https://mp.weixin.qq.com/s/example',
  url: 'https://mp.weixin.qq.com/s/example',
});

assert.deepStrictEqual(buildTextOrLinkPayload('https://weixin.qq.com/sph/A7ULN6a876'), {
  contentType: 'webpage',
  content: 'https://weixin.qq.com/sph/A7ULN6a876',
  url: 'https://weixin.qq.com/sph/A7ULN6a876',
});

assert.deepStrictEqual(buildTextOrLinkPayload('share text https://mp.weixin.qq.com/s/example'), {
  contentType: 'webpage',
  content: 'https://mp.weixin.qq.com/s/example',
  url: 'https://mp.weixin.qq.com/s/example',
  shareText: 'share text https://mp.weixin.qq.com/s/example',
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

assert.deepStrictEqual(buildWebpagePayload('https://www.douyin.com/video/123', '', {
  webpageMediaType: 'audio_video',
  cloudPreTranscription: {
    enabled: true,
    mode: 'cloud',
    reason: 'remembered',
  },
}), {
  contentType: 'webpage',
  content: 'https://www.douyin.com/video/123',
  url: 'https://www.douyin.com/video/123',
  webpageMediaType: 'audio_video',
  cloudPreTranscription: {
    enabled: true,
    mode: 'cloud',
    reason: 'remembered',
  },
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

assert.deepStrictEqual(buildFilePayload({
  fileID: 'cloud://files/album-image',
  name: 'album-photo',
  size: 2048,
}), {
  contentType: 'file',
  content: 'album-photo',
  fileID: 'cloud://files/album-image',
  fileName: 'album-photo',
  fileExt: '',
  fileSize: 2048,
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

const cloudVoicePayload = buildVoicePayload('cloud://voice/interview.mp3', 300000, 'interview.mp3', {
  cloudPreTranscription: {
    enabled: true,
    mode: 'cloud',
    reason: 'manual',
    speakerDiarization: true,
  },
});
assert.strictEqual(cloudVoicePayload.contentType, 'voice');
assert.strictEqual(cloudVoicePayload.audioFileID, 'cloud://voice/interview.mp3');
assert.strictEqual(cloudVoicePayload.duration, 300000);
assert.strictEqual(cloudVoicePayload.audioFileName, 'interview.mp3');
assert.deepStrictEqual(cloudVoicePayload.cloudPreTranscription, {
  enabled: true,
  mode: 'cloud',
  reason: 'manual',
  speakerDiarization: true,
});

assert.strictEqual(formatDuration(0), '00:00');
assert.strictEqual(formatDuration(15200), '00:15');
assert.strictEqual(formatDuration(61500), '01:02');
assert.strictEqual(getFileExt('album-video.MP4'), 'mp4');
assert.strictEqual(getFileExt('wxfile://tmp/no-ext'), '');
