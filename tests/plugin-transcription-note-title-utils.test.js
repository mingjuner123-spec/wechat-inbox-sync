'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(
  repoRoot,
  'obsidian-plugin',
  'wechat-inbox-sync',
  'src',
  'transcription-note-title-utils.js',
);

assert.ok(fs.existsSync(modulePath), 'transcription note title utils module must exist');

const {
  applyTranscriptionNoteIdentity,
  buildSemanticTranscriptionTitle,
  buildTranscriptionNoteIdentity,
  getTranscriptionSourcePrefix,
  isSuccessfulTranscriptionRecord,
} = require(modulePath);

for (const [name, value] of Object.entries({
  applyTranscriptionNoteIdentity,
  buildSemanticTranscriptionTitle,
  buildTranscriptionNoteIdentity,
  getTranscriptionSourcePrefix,
  isSuccessfulTranscriptionRecord,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be exported`);
}

const douyinRecord = {
  type: 'webpage',
  content: 'https://v.douyin.com/example',
  createdAt: '2026-08-03T10:00:00.000Z',
  metadata: {
    platform: '抖音',
    title: '抖音口播文案',
    description: '为什么越努力的人越容易焦虑。本文解释三个常见原因。',
    aiMetadataSource: 'cloud',
    transcriptOnly: true,
    transcriptionStatus: 'success',
    transcription: '为什么越努力的人越容易焦虑？今天我们讲清楚三个原因。',
  },
};

const reportStyleDescriptionRecord = {
  type: 'webpage',
  content: 'https://v.douyin.com/example-report-style',
  metadata: {
    platform: '抖音',
    title: '抖音口播文案',
    description: '这是一份抖音口播文案，详细介绍了通过精听提升英语听力的五步方法，称严格执行三个月听力会有质的飞跃。',
    aiMetadataSource: 'cloud',
    transcriptionStatus: 'success',
    transcription: '第一步是选择适合自己的听力材料，后面还有完整方法。',
  },
};
assert.strictEqual(
  buildSemanticTranscriptionTitle(reportStyleDescriptionRecord, '抖音口播文案'),
  '第一步是选择适合自己的听力材料，后面还有完整方法',
  '简介只能写入属性，不能再参与标题选择',
);

const independentAiTitleRecord = {
  ...reportStyleDescriptionRecord,
  metadata: {
    ...reportStyleDescriptionRecord.metadata,
    semanticTitle: '五步精听法提升英语听力',
  },
};
assert.strictEqual(
  buildSemanticTranscriptionTitle(independentAiTitleRecord, '抖音口播文案'),
  '五步精听法提升英语听力',
  '同一次 AI 元数据请求返回的独立标题必须优先于简介',
);

assert.strictEqual(isSuccessfulTranscriptionRecord(douyinRecord), true);
assert.strictEqual(getTranscriptionSourcePrefix(douyinRecord), '抖音');
assert.strictEqual(
  buildSemanticTranscriptionTitle(douyinRecord, '抖音口播文案'),
  '为什么越努力的人越容易焦虑',
);
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(douyinRecord, {
    fallbackTitle: '抖音口播文案',
  }),
  {
    displayTitle: '为什么越努力的人越容易焦虑',
    fileTitle: '抖音-为什么越努力的人越容易焦虑',
    source: '抖音',
    titleSource: 'transcription',
  },
);

assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(douyinRecord, {
    fallbackTitle: '抖音口播文案',
    bindingLabel: '微信 1',
  }),
  {
    displayTitle: '为什么越努力的人越容易焦虑',
    fileTitle: '微信 1-抖音-为什么越努力的人越容易焦虑',
    source: '抖音',
    titleSource: 'transcription',
  },
  'multiple bindings must preserve the existing binding label prefix',
);

const transcriptFallbackRecord = {
  type: 'webpage',
  metadata: {
    platform: 'B站',
    title: 'B站口播文案',
    transcriptOnly: true,
    transcriptionStatus: 'success',
    transcription: '大家好。今天聊聊普通人如何建立稳定的知识管理系统！后面还有详细步骤。',
  },
};
assert.strictEqual(
  buildSemanticTranscriptionTitle(transcriptFallbackRecord, 'B站口播文案'),
  '今天聊聊普通人如何建立稳定的知识管理系统',
  'short greeting sentences must be skipped when a meaningful sentence follows',
);
assert.strictEqual(getTranscriptionSourcePrefix(transcriptFallbackRecord), 'B站');

const fileFallbackRecord = {
  type: 'file',
  metadata: {
    fileName: '我的复盘：如何做好周计划.mp3',
    fileExt: 'mp3',
    contentCategory: '音频',
    transcriptionStatus: 'success',
    transcription: '嗯。啊。',
  },
};
assert.strictEqual(getTranscriptionSourcePrefix(fileFallbackRecord), '音频');
assert.strictEqual(
  buildSemanticTranscriptionTitle(fileFallbackRecord, '文件-20260803-1000'),
  '我的复盘：如何做好周计划',
);

const voiceRecord = {
  type: 'voice',
  metadata: {
    transcriptionStatus: 'success',
    transcription: '这是一次关于产品迭代节奏的录音复盘。',
  },
};
assert.strictEqual(getTranscriptionSourcePrefix(voiceRecord), '录音');
assert.strictEqual(
  buildTranscriptionNoteIdentity(voiceRecord, { fallbackTitle: '语音-20260803-1000' }).fileTitle,
  '录音-这是一次关于产品迭代节奏的录音复盘',
);

const uploadedVideoRecord = {
  type: 'file',
  metadata: {
    fileName: '产品演示.mov',
    fileExt: 'mov',
    transcriptionStatus: 'success',
    transcription: '这段视频演示了如何完成产品的首次配置。',
  },
};
assert.strictEqual(getTranscriptionSourcePrefix(uploadedVideoRecord), '视频');
assert.strictEqual(
  buildTranscriptionNoteIdentity(uploadedVideoRecord, { fallbackTitle: '文件-20260803-1001' }).fileTitle,
  '视频-这段视频演示了如何完成产品的首次配置',
);

const xiaoyuzhouRecord = {
  type: 'webpage',
  content: 'https://www.xiaoyuzhoufm.com/episode/example',
  metadata: {
    transcriptionStatus: 'success',
    transcription: '为什么播客适合承载复杂观点？这一期节目给出了完整答案。',
  },
};
assert.strictEqual(getTranscriptionSourcePrefix(xiaoyuzhouRecord), '小宇宙');
assert.strictEqual(
  buildTranscriptionNoteIdentity(xiaoyuzhouRecord, { fallbackTitle: '网页-20260803-1002' }).fileTitle,
  '小宇宙-为什么播客适合承载复杂观点',
);

const canonicalSocialTitleRecord = {
  ...xiaoyuzhouRecord,
  metadata: {
    ...xiaoyuzhouRecord.metadata,
    sourceTitle: 'Vol.41 那些年，我做过的独立开发产品',
    semanticTitle: '独立开发产品复盘',
    description: '这是一档播客节目，介绍了多个独立开发项目。',
    aiMetadataSource: 'cloud',
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(canonicalSocialTitleRecord, { fallbackTitle: '网页-20260803-1002' }),
  {
    displayTitle: 'Vol.41 那些年，我做过的独立开发产品',
    fileTitle: '小宇宙-Vol.41 那些年，我做过的独立开发产品',
    source: '小宇宙',
    titleSource: 'source-title',
  },
  'social platforms must retain their canonical source title before AI title or description',
);

const aiSummarizedWechatChannelsRecord = {
  type: 'webpage',
  content: 'https://weixin.qq.com/sph/example',
  metadata: {
    platform: '视频号',
    sourceTitle: '这是发布正文的第一句，不应作为最终标题',
    semanticTitle: 'AI 重写的视频号主题标题',
    aiMetadataSource: 'cloud',
    description: 'AI 根据口播生成的一句话简介。',
    keywords: ['AI关键词', '视频号转写', '内容整理'],
    transcriptionStatus: 'success',
    transcription: '这里是完整的视频号口播转写正文。',
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(aiSummarizedWechatChannelsRecord, { fallbackTitle: '视频号口播文案' }),
  {
    displayTitle: 'AI 重写的视频号主题标题',
    fileTitle: '视频号-AI 重写的视频号主题标题',
    source: '视频号',
    titleSource: 'ai-title',
  },
  '视频号完成 AI 总结后必须优先使用 AI 标题，原始标题只保留为来源信息',
);

const appliedWechatChannelsAiIdentity = applyTranscriptionNoteIdentity(aiSummarizedWechatChannelsRecord, {
  fallbackTitle: '视频号口播文案',
});
assert.strictEqual(appliedWechatChannelsAiIdentity.record.metadata.title, 'AI 重写的视频号主题标题');
assert.strictEqual(appliedWechatChannelsAiIdentity.record.metadata.originalTitle, undefined);
assert.strictEqual(appliedWechatChannelsAiIdentity.record.metadata.sourceTitle, '这是发布正文的第一句，不应作为最终标题');
assert.strictEqual(appliedWechatChannelsAiIdentity.record.metadata.semanticTitleSource, 'ai-title');

const localKeywordFallbackRecord = {
  type: 'voice',
  metadata: {
    keywords: ['推特账号运营', '内容定位', '增长节奏'],
    description: '这是一段关于推特账号运营的录音简介。',
    transcriptionStatus: 'success',
    transcription: '今天聊聊如何安排一周的内容发布节奏。',
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(localKeywordFallbackRecord, { fallbackTitle: '录音-20260803-1002' }),
  {
    displayTitle: '推特账号运营-内容定位',
    fileTitle: '录音-推特账号运营-内容定位',
    source: '录音',
    titleSource: 'keywords',
  },
  'local recordings must use keyword combination before transcription and never reuse the description as title',
);

const localKeywordWithDescriptionDerivedAiTitle = {
  ...localKeywordFallbackRecord,
  metadata: {
    ...localKeywordFallbackRecord.metadata,
    semanticTitle: '这是和军山学院第19届科技管理者领导力班的招生宣传',
    description: '这是和军山学院第19届科技管理者领导力班的招生宣传，面向技术管理者介绍课程。',
    keywords: ['科技管理者', '领导力班', '和军山学院'],
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(localKeywordWithDescriptionDerivedAiTitle, { fallbackTitle: '录音-20260806-2200' }),
  {
    displayTitle: '科技管理者-领导力班',
    fileTitle: '录音-科技管理者-领导力班',
    source: '录音',
    titleSource: 'keywords',
  },
  '本地录音不得把简介第一句复用成标题；关键词组合应优先于描述式 AI 标题',
);

const socialMarkdownTitleFallbackRecord = {
  type: 'webpage',
  content: 'https://www.xiaoyuzhoufm.com/episode/example-markdown-title',
  metadata: {
    platform: '小宇宙',
    markdown: '## 标题\n\nVol.41 那些年，我做过的独立开发产品\n\n## 原文正文\n\n节目简介',
    semanticTitle: '独立开发者的三个产品经历',
    transcriptionStatus: 'success',
    transcription: '这里是节目转写正文。',
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(socialMarkdownTitleFallbackRecord, { fallbackTitle: '小宇宙口播文案' }),
  {
    displayTitle: 'Vol.41 那些年，我做过的独立开发产品',
    fileTitle: '小宇宙-Vol.41 那些年，我做过的独立开发产品',
    source: '小宇宙',
    titleSource: 'source-markdown-title',
  },
  '平台正文已经抓到原始标题时，即使 sourceTitle 字段漏传，也不得被 AI 简介标题覆盖',
);

const genericDouyinChromeRecord = {
  type: 'webpage',
  content: 'https://www.douyin.com/video/123',
  metadata: {
    platform: '抖音',
    sourceTitle: '抖音',
    semanticTitle: '即将拍婚纱照的日常记录',
    transcriptionStatus: 'success',
    transcription: '今天准备拍婚纱照，也记录了店里的日常。',
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(genericDouyinChromeRecord, { fallbackTitle: '抖音口播文案' }),
  {
    displayTitle: '即将拍婚纱照的日常记录',
    fileTitle: '抖音-即将拍婚纱照的日常记录',
    source: '抖音',
    titleSource: 'ai-title',
  },
  '平台名称本身不是原始标题，必须继续使用 AI 生成的语义标题',
);

const duplicateSourceRecord = {
  ...douyinRecord,
  metadata: {
    ...douyinRecord.metadata,
    description: '抖音-为什么越努力的人越容易焦虑',
  },
};
assert.strictEqual(
  buildTranscriptionNoteIdentity(duplicateSourceRecord, { fallbackTitle: '' }).fileTitle,
  '抖音-为什么越努力的人越容易焦虑',
  'source must not be repeated in the file title',
);

const applied = applyTranscriptionNoteIdentity(douyinRecord, {
  fallbackTitle: '抖音口播文案',
});
assert.notStrictEqual(applied.record, douyinRecord);
assert.strictEqual(applied.record.metadata.title, '为什么越努力的人越容易焦虑');
assert.strictEqual(applied.record.metadata.originalTitle, '抖音口播文案');
assert.strictEqual(applied.record.metadata.semanticTitleSource, 'transcription');
assert.strictEqual(applied.fileTitle, '抖音-为什么越努力的人越容易焦虑');

const failedRecord = {
  type: 'webpage',
  metadata: {
    platform: '小宇宙',
    transcriptionStatus: 'failed',
    transcription: '',
  },
};
assert.strictEqual(isSuccessfulTranscriptionRecord(failedRecord), false);
assert.strictEqual(buildTranscriptionNoteIdentity(failedRecord, { fallbackTitle: '原标题' }), null);
assert.strictEqual(
  applyTranscriptionNoteIdentity(failedRecord, { fallbackTitle: '原标题' }).record,
  failedRecord,
  'non-transcription records must remain untouched',
);

const aiFailureWithLegacyDescription = {
  type: 'webpage',
  metadata: {
    platform: '抖音',
    description: '这是网页抓取阶段遗留的通用简介，不是本次 AI 生成的标题。',
    aiMetadataError: 'AI 请求限流',
    transcriptionStatus: 'success',
    transcription: '真正应该作为标题的是这段转写正文的第一个有效句子。后面还有正文。',
  },
};
assert.strictEqual(
  buildSemanticTranscriptionTitle(aiFailureWithLegacyDescription, '抖音口播文案'),
  '真正应该作为标题的是这段转写正文的第一个有效句子',
  'AI failure must skip a legacy webpage description and fall back to the transcript',
);

const shortMultiBindingRecord = {
  type: 'voice',
  metadata: {
    transcriptionStatus: 'success',
    transcription: '嗯。',
  },
};
assert.deepStrictEqual(
  buildTranscriptionNoteIdentity(shortMultiBindingRecord, {
    fallbackTitle: '微信 1-录音-20260803-100000',
    bindingLabel: '微信 1',
  }),
  {
    displayTitle: '20260803-100000',
    fileTitle: '微信 1-录音-20260803-100000',
    source: '录音',
    titleSource: 'fallback',
  },
  'binding labels and source prefixes must stay out of the pure title and must not repeat in the file name',
);

const longRecord = {
  type: 'webpage',
  metadata: {
    platform: '视频号',
    transcriptOnly: true,
    transcriptionStatus: 'success',
    transcription: '这是一个包含斜杠/冒号:星号*问号?引号"和特别特别特别特别特别特别特别特别特别特别特别特别长内容的标题。',
  },
};
const longIdentity = buildTranscriptionNoteIdentity(longRecord, { fallbackTitle: '视频号口播文案' });
assert.ok(longIdentity.displayTitle.length <= 36);
assert.doesNotMatch(longIdentity.displayTitle, /[\\/:*?"<>|]/);
assert.strictEqual(longIdentity.fileTitle.startsWith('视频号-'), true);
