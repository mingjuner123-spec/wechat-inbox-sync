'use strict';

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`record body markdown dependency is required: ${name}`);
  }
  return value;
}

function createRecordBodyMarkdownHelpers(dependencies = {}) {
  const helpers = {
    cleanDisplayUrl: requireFunction(dependencies.cleanDisplayUrl, 'cleanDisplayUrl'),
    cleanMarkdownForStorage: requireFunction(dependencies.cleanMarkdownForStorage, 'cleanMarkdownForStorage'),
    extractKeywordsFromText: requireFunction(dependencies.extractKeywordsFromText, 'extractKeywordsFromText'),
    formatCreatedTime: requireFunction(dependencies.formatCreatedTime, 'formatCreatedTime'),
    getWebpageSourcePrefix: requireFunction(dependencies.getWebpageSourcePrefix, 'getWebpageSourcePrefix'),
    isFeishuUrl: requireFunction(dependencies.isFeishuUrl, 'isFeishuUrl'),
    isWechatChannelsUrl: requireFunction(dependencies.isWechatChannelsUrl, 'isWechatChannelsUrl'),
    isXiaohongshuUrl: requireFunction(dependencies.isXiaohongshuUrl, 'isXiaohongshuUrl'),
    normalizeExtractedUrl: requireFunction(dependencies.normalizeExtractedUrl, 'normalizeExtractedUrl'),
    sanitizeXiaohongshuMarkdownImages: requireFunction(dependencies.sanitizeXiaohongshuMarkdownImages, 'sanitizeXiaohongshuMarkdownImages'),
    stripMarkdownCodeBlocks: requireFunction(dependencies.stripMarkdownCodeBlocks, 'stripMarkdownCodeBlocks'),
  };

  function buildAudioTranscriptMarkdown({
    url,
    transcription,
    transcriptionStatus = 'pending',
    transcriptionSource = '',
    transcriptionError = '',
  }) {
    url = helpers.cleanDisplayUrl(url);
    const status = String(transcriptionStatus || '').toLowerCase();
    const isCloudPending = ['queued', 'processing'].includes(status)
      && String(transcriptionSource || '').includes('cloud');
    const content = String(transcription || '').trim()
      || (status === 'failed'
        ? `转写失败。${transcriptionError || '未能提取到视频/音频文案。'}`
        : isCloudPending
          ? '云端转写中，下次同步会自动更新。'
          : '转写处理中，或未配置可用的转写方案。');
    return [
      '## 口播/音频文案',
      '',
      content,
      '',
    ].filter((line) => line !== '').join('\n');
  }

  function buildSourceMediaAttachmentMarkdown(metadata = {}) {
    const attachmentPath = String(metadata.sourceMediaAttachmentPath || '').trim();
    if (attachmentPath) {
      return [
        '## 原始音视频',
        '',
        `![[${attachmentPath}]]`,
      ].join('\n');
    }
    if (metadata.sourceMediaAttachmentError) {
      return '> 原始音视频未能保存到本地，已保留转写结果。';
    }
    return '';
  }

  function buildTranscriptPropertyMetadata({
    transcription = '',
    title = '',
  } = {}) {
    const text = helpers.cleanMarkdownForStorage(helpers.stripMarkdownCodeBlocks(String(transcription || '')))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return {
        description: '',
        keywords: [],
        aiMetadataSource: '',
      };
    }
    const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
    const description = (sentences[0] || text).slice(0, 160).trim();
    const keywords = helpers.extractKeywordsFromText(text, title).slice(0, 8);
    return {
      description,
      keywords,
      aiMetadataSource: 'transcription',
    };
  }

  function buildTranscriptOnlyMetadata(metadata, {
    url = '',
    platform = '',
    mediaUrl = '',
    mediaUrls = [],
    subtitleUrl = '',
    transcription = '',
    transcriptionStatus = 'failed',
    transcriptionSource = '',
    transcriptionError = '',
    conversionStatus = '',
    markdown: supplementalMarkdown = '',
    sourceTitle = '',
  } = {}) {
    const {
      markdown,
      snapshot,
      contentSnapshot,
      imageUrls,
      images,
      ...rest
    } = metadata || {};

    const sourceName = platform || helpers.getWebpageSourcePrefix(url) || '网页';
    const cleanedSupplementalMarkdown = String(supplementalMarkdown || '').trim();
    const normalizedMediaUrls = Array.from(new Set((Array.isArray(mediaUrls) ? mediaUrls : [])
      .map((item) => helpers.normalizeExtractedUrl(typeof item === 'string' ? item : (item && item.url)))
      .filter((item) => /^https?:\/\//i.test(item))));
    if (mediaUrl && !normalizedMediaUrls.includes(mediaUrl)) normalizedMediaUrls.unshift(mediaUrl);
    return {
      ...rest,
      title: String(sourceTitle || rest.sourceTitle || rest.title || `${sourceName}口播文案`).trim(),
      ...(String(sourceTitle || rest.sourceTitle || '').trim()
        ? { sourceTitle: String(sourceTitle || rest.sourceTitle).trim() }
        : {}),
      url: url || rest.url || '',
      transcriptOnly: true,
      ...(cleanedSupplementalMarkdown ? { markdown: cleanedSupplementalMarkdown } : {}),
      mediaUrl,
      audioUrl: mediaUrl,
      mediaUrls: normalizedMediaUrls,
      subtitleUrl,
      transcription,
      transcriptionStatus,
      transcriptionSource,
      transcriptionError,
      conversionStatus: conversionStatus || transcriptionStatus,
    };
  }

  function buildWebpageMarkdownBody(record, title) {
    const metadata = record.metadata || {};
    const url = helpers.cleanDisplayUrl(metadata.url || record.content || '');
    const pageTitle = metadata.title || title;
    let snapshot = helpers.cleanMarkdownForStorage(
      metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '',
      {
        dedupe: helpers.isFeishuUrl(url),
        feishuTitle: helpers.isFeishuUrl(url) ? pageTitle : '',
        preserveListIndent: helpers.isXiaohongshuUrl(url),
      },
    );
    if (snapshot && helpers.isXiaohongshuUrl(url)) {
      snapshot = helpers.sanitizeXiaohongshuMarkdownImages(snapshot);
    }
    const status = metadata.conversionStatus || 'pending';
    const errorText = metadata.conversionError || '';
    const automaticShareText = metadata.automaticWebpageExtraction
      ? String(metadata.shareText || '').trim()
      : '';
    const automaticShareTextMarkdown = automaticShareText
      ? [
        '## 原始剪切板内容',
        '',
        ...automaticShareText.split(/\r?\n/).map((line) => `> ${line}`),
        '',
      ].join('\n')
      : '';
    if (
      helpers.isWechatChannelsUrl(url)
      && (status === 'failed' || status === 'wechat_captcha' || status === 'link_saved')
    ) {
      return [
        '> ⚠️ 视频号内容解析功能暂未接通，当前已为你保存原始链接。',
        '> 功能上线后，可以重新发送链接进行提取。',
        '',
        automaticShareTextMarkdown,
      ].join('\n');
    }
    if (metadata.transcriptOnly && snapshot && helpers.isWechatChannelsUrl(url) && metadata.conversionStatus === 'link_saved') {
      return `${snapshot}\n`;
    }
    if (metadata.transcriptOnly) {
      const sourceMediaMarkdown = buildSourceMediaAttachmentMarkdown(metadata);
      const transcriptMarkdown = buildAudioTranscriptMarkdown({
        url,
        transcription: metadata.transcription || '',
        transcriptionStatus: metadata.transcriptionStatus || metadata.conversionStatus || 'pending',
        transcriptionSource: metadata.transcriptionSource || metadata.transcriptionProvider || '',
        transcriptionError: metadata.transcriptionError || metadata.conversionError || '',
      });
      return [sourceMediaMarkdown, snapshot, transcriptMarkdown, automaticShareTextMarkdown]
        .filter(Boolean)
        .join('\n\n')
        .trim() + '\n';
    }

    if (snapshot) {
      if (helpers.isFeishuUrl(url)) {
        return [snapshot, automaticShareTextMarkdown].filter(Boolean).join('\n\n').trim() + '\n';
      }
      return [
        '## Markdown 内容',
        '',
        snapshot,
        '',
        automaticShareTextMarkdown,
      ].join('\n');
    }

    if (status === 'failed' || status === 'wechat_captcha' || status === 'link_saved') {
      const reasonLine = status === 'wechat_captcha'
        ? '原因：微信返回了安全验证页，插件无法绕过'
        : `原因：${errorText || '网页抓取失败'}`;
      return [
        '> ⚠️ 这篇文章的正文未能自动提取，原始链接已写入笔记属性。',
        `> ${reasonLine}`,
        '',
        '---',
        '',
        '**如果这个问题持续出现，请复制以下信息发给张张（微信 heyhmjx），帮助产品改进：**',
        '',
        '```',
        `链接：${url}`,
        `错误：${errorText || '未知'}`,
        `时间：${helpers.formatCreatedTime(record.createdAt)}`,
        '```',
        '',
        automaticShareTextMarkdown,
      ].join('\n');
    }

    return [
      '> 网页正文正在处理中，原始链接已写入笔记属性，下次同步时会自动更新。',
      '',
      automaticShareTextMarkdown,
    ].join('\n');
  }

  function buildFileMarkdownBody(record) {
    const metadata = record.metadata || {};
    const fileName = metadata.fileName || record.content || 'upload-file';
    const fileID = metadata.fileID || '';
    const filePath = metadata.filePath || '';
    const converted = helpers.cleanMarkdownForStorage(metadata.markdown || metadata.convertedMarkdown || '');
    const status = metadata.conversionStatus || 'pending';
    const errorText = metadata.conversionError || '';
    const transcriptionStatus = String(metadata.transcriptionStatus || '').toLowerCase();
    const transcription = String(metadata.transcription || '').trim();
    if (transcriptionStatus || transcription) {
      const transcriptionError = metadata.transcriptionError || '';
      const content = transcription || (transcriptionStatus === 'failed'
        ? `转写失败。${transcriptionError || '未能提取到音视频文案。'}`
        : '转写处理中，或未配置可用的转写方案。');
      return [
        `文件名：${fileName}`,
        filePath ? `本地附件：[[${filePath}]]` : '',
        fileID ? `云端文件：${fileID}` : '',
        metadata.transcriptionSource ? `转写来源：${metadata.transcriptionSource}` : '',
        '',
        '## 口播/音频文案',
        '',
        content,
        '',
      ].filter((line) => line !== '').join('\n');
    }
    const fallback = status === 'failed'
      ? `文件转 Markdown 失败，已保存文件信息。${errorText ? `\n\n失败原因：${errorText}` : ''}`
      : status === 'attachment_saved'
        ? `文件附件已保存。${errorText ? `\n\n说明：${errorText}` : '暂未提取到可用正文。'}`
        : '文件转 Markdown 处理中，已先保存文件信息。';

    return [
      `文件名：${fileName}`,
      filePath ? `本地附件：[[${filePath}]]` : '',
      fileID ? `云端文件：${fileID}` : '',
      '',
      '## Markdown 内容',
      '',
      converted || fallback,
      '',
    ].filter((line) => line !== '').join('\n');
  }

  return {
    buildWebpageMarkdownBody,
    buildAudioTranscriptMarkdown,
    buildSourceMediaAttachmentMarkdown,
    buildTranscriptPropertyMetadata,
    buildTranscriptOnlyMetadata,
    buildFileMarkdownBody,
  };
}

module.exports = {
  createRecordBodyMarkdownHelpers,
};
