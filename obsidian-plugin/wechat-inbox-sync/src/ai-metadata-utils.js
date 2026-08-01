'use strict';

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
      return {
        description: String(jsonPayload.description || jsonPayload.summary || jsonPayload.excerpt || '').trim(),
        keywords: normalizeGeneratedKeywords(jsonPayload.keywords || jsonPayload.tags || jsonPayload.hashtags || []),
      };
    }

    const descriptionMatch = source.match(/description\s*[:：]\s*([^\n]+)/i)
      || source.match(/简介\s*[:：]\s*([^\n]+)/i)
      || source.match(/总结\s*[:：]\s*([^\n]+)/i);
    const keywordsMatch = source.match(/keywords?\s*[:：]\s*([^\n]+)/i)
      || source.match(/标签\s*[:：]\s*([^\n]+)/i)
      || source.match(/关键词\s*[:：]\s*([^\n]+)/i);
    return {
      description: String(descriptionMatch ? descriptionMatch[1] : '').trim(),
      keywords: normalizeGeneratedKeywords(keywordsMatch ? keywordsMatch[1] : ''),
    };
  }

  function normalizeGeneratedMetadataResult(result) {
    return {
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
    const parts = isTranscriptRecord
      ? [
        metadata.title,
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

module.exports = { createAiMetadataHelpers };
