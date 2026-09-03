'use strict';

function isRetryableAiMetadataError(error) {
  const status = Number(error && (
    error.status
    || error.statusCode
    || (error.response && error.response.status)
  ));
  if (status === 429) return true;
  const message = String(error && (error.message || error) || '').toLowerCase();
  return /(?:status\s*code\s*)?429\b|rate[\s-]?limit|too many requests|请求过于频繁|限流/.test(message);
}

async function retryAiMetadataGeneration(generate, options = {}) {
  if (typeof generate !== 'function') throw new TypeError('AI metadata generator is required');
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts) || 3, 3));
  const wait = typeof options.wait === 'function' ? options.wait : async () => {};
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await generate();
    } catch (error) {
      lastError = error;
      if (!isRetryableAiMetadataError(error) || attempt >= maxAttempts) throw error;
      // eslint-disable-next-line no-await-in-loop
      await wait(800 * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error('AI metadata generation failed');
}

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`AI metadata dependency is required: ${name}`);
  }
  return value;
}

function createAiMetadataHelpers(dependencies = {}) {
  const helpers = {
    tryParseJson: requireFunction(dependencies.tryParseJson, 'tryParseJson'),
    cleanMarkdownForStorage: requireFunction(dependencies.cleanMarkdownForStorage, 'cleanMarkdownForStorage'),
    stripMarkdownCodeBlocks: requireFunction(dependencies.stripMarkdownCodeBlocks, 'stripMarkdownCodeBlocks'),
  };

  function normalizeGeneratedKeywords(value) {
    const source = Array.isArray(value) ? value.join(',') : String(value || '');
    const seen = new Set();
    return source
      .replace(/[\r\n]+/g, ',')
      .split(/[#,\uFF0C\u3001\uFF1B;\s]+/)
      .map((item) => String(item || '').trim())
      .filter((item) => item && item.length <= 24)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function parseGeneratedMetadataResponse(text) {
    const source = String(text || '').trim();
    if (!source) return { description: '', keywords: [] };

    const fencedJsonMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonSource = fencedJsonMatch ? fencedJsonMatch[1].trim() : source;
    const jsonPayload = helpers.tryParseJson(jsonSource);
    if (jsonPayload && typeof jsonPayload === 'object') {
      const title = String(jsonPayload.title || jsonPayload.semanticTitle || jsonPayload.headline || '').trim();
      return {
        ...(title ? { title } : {}),
        description: String(jsonPayload.description || jsonPayload.summary || jsonPayload.excerpt || '').trim(),
        keywords: normalizeGeneratedKeywords(jsonPayload.keywords || jsonPayload.tags || jsonPayload.hashtags || []),
      };
    }

    const titleMatch = source.match(/title\s*[:：]\s*([^\n]+)/i)
      || source.match(/标题\s*[:：]\s*([^\n]+)/i);
    const descriptionMatch = source.match(/description\s*[:：]\s*([^\n]+)/i)
      || source.match(/简介\s*[:：]\s*([^\n]+)/i)
      || source.match(/总结\s*[:：]\s*([^\n]+)/i);
    const keywordsMatch = source.match(/keywords?\s*[:：]\s*([^\n]+)/i)
      || source.match(/标签\s*[:：]\s*([^\n]+)/i)
      || source.match(/关键词\s*[:：]\s*([^\n]+)/i);
    return {
      ...(titleMatch ? { title: String(titleMatch[1] || '').trim() } : {}),
      description: String(descriptionMatch ? descriptionMatch[1] : '').trim(),
      keywords: normalizeGeneratedKeywords(keywordsMatch ? keywordsMatch[1] : ''),
    };
  }

  function normalizeGeneratedMetadataResult(result) {
    const title = String(result && (result.title || result.semanticTitle || result.headline) || '').trim().slice(0, 80);
    return {
      ...(title ? { title } : {}),
      description: String(result && result.description || '').trim().slice(0, 300),
      keywords: normalizeGeneratedKeywords(result && result.keywords),
    };
  }

  function extractAiMetadataInputText(record) {
    const metadata = (record && record.metadata) || {};
    const isTranscriptRecord = metadata.transcriptOnly
      || metadata.webpageMediaType === 'audio_video'
      || (
        metadata.transcriptionStatus === 'success'
        && String(metadata.transcription || '').trim()
      );
    const isWechatChannelsTranscript = isTranscriptRecord
      && String(metadata.platform || '').trim() === '视频号';
    const parts = isTranscriptRecord
      ? [
        ...(isWechatChannelsTranscript
          ? [metadata.sourceTitle, metadata.title, metadata.description]
          : [metadata.title]),
        metadata.transcription,
      ].filter(Boolean)
      : [
        metadata.title,
        metadata.markdown,
        metadata.snapshot,
        metadata.contentSnapshot,
        metadata.description,
        metadata.summary,
        metadata.excerpt,
      ].filter(Boolean);
    return helpers.cleanMarkdownForStorage(
      helpers.stripMarkdownCodeBlocks(parts.join('\n\n'))
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/https?:\/\/[^\s<>()\]]+/gi, ' ')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*>\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n'),
    ).slice(0, 6000);
  }

  return {
    normalizeGeneratedKeywords,
    parseGeneratedMetadataResponse,
    normalizeGeneratedMetadataResult,
    extractAiMetadataInputText,
  };
}

module.exports = {
  createAiMetadataHelpers,
  isRetryableAiMetadataError,
  retryAiMetadataGeneration,
};
