'use strict';

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`note output dependency is required: ${name}`);
  }
  return value;
}

function createNoteOutputPlanHelpers(dependencies = {}) {
  const {
    buildAiMetadataErrorComment,
    buildFileMarkdownBody,
    buildRecordIdMarker,
    buildWebpageMarkdownBody,
    cleanDisplayUrl,
    defaultNotePropertyFields,
    getRecordAuthor,
    getRecordDescription,
    getRecordId,
    getRecordKeywords,
    getRecordSourceLabel,
    getRecordUrl,
    getWebpageSourcePrefix,
    isFeishuUrl,
    isSuccessfulTranscriptionRecord,
    normalizeNotePropertyFields,
    normalizeVaultPath,
  } = dependencies;

  if (typeof defaultNotePropertyFields !== 'string') {
    throw new TypeError('defaultNotePropertyFields is required');
  }

  const helpers = {
    buildAiMetadataErrorComment: requireFunction(buildAiMetadataErrorComment, 'buildAiMetadataErrorComment'),
    buildFileMarkdownBody: requireFunction(buildFileMarkdownBody, 'buildFileMarkdownBody'),
    buildRecordIdMarker: requireFunction(buildRecordIdMarker, 'buildRecordIdMarker'),
    buildWebpageMarkdownBody: requireFunction(buildWebpageMarkdownBody, 'buildWebpageMarkdownBody'),
    cleanDisplayUrl: requireFunction(cleanDisplayUrl, 'cleanDisplayUrl'),
    getRecordAuthor: requireFunction(getRecordAuthor, 'getRecordAuthor'),
    getRecordDescription: requireFunction(getRecordDescription, 'getRecordDescription'),
    getRecordId: requireFunction(getRecordId, 'getRecordId'),
    getRecordKeywords: requireFunction(getRecordKeywords, 'getRecordKeywords'),
    getRecordSourceLabel: requireFunction(getRecordSourceLabel, 'getRecordSourceLabel'),
    getRecordUrl: requireFunction(getRecordUrl, 'getRecordUrl'),
    getWebpageSourcePrefix: requireFunction(getWebpageSourcePrefix, 'getWebpageSourcePrefix'),
    isFeishuUrl: requireFunction(isFeishuUrl, 'isFeishuUrl'),
    isSuccessfulTranscriptionRecord: requireFunction(isSuccessfulTranscriptionRecord, 'isSuccessfulTranscriptionRecord'),
    normalizeNotePropertyFields: requireFunction(normalizeNotePropertyFields, 'normalizeNotePropertyFields'),
    normalizeVaultPath: requireFunction(normalizeVaultPath, 'normalizeVaultPath'),
  };

  function yamlValue(value, options = {}) {
    if (value === undefined || value === null) return '';
    const normalize = (input) => String(input ?? '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (Array.isArray(value)) {
      value = value
        .map((item) => normalize(item))
        .filter(Boolean)
        .join(', ');
    }
    const text = normalize(value);
    if (!text) return '';
    if (options.quote || /[\r\n]/.test(text) || /^(?:true|false|null|yes|no|on|off)$/i.test(text)) {
      return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return text;
  }

  function buildFrontmatter(lines) {
    return ['---', ...lines, '---', ''].join('\n');
  }

  function parseNotePropertyFields(propertyFields) {
    return helpers.normalizeNotePropertyFields(propertyFields).split(',').filter(Boolean);
  }

  function cleanFeishuPropertyText(value) {
    return String(value || '')
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f\s*\u6700\u8fd1\u4fee\u6539\s*[:\uff1a]?\s*[^,\uff0c\u3002\uff01\uff1f!?]{0,30}/g, ' ')
      .replace(/\u6700\u8fd1\u4fee\u6539\s*[:\uff1a]?\s*[^,\uff0c\u3002\uff01\uff1f!?]{0,30}/g, ' ')
      .replace(/\bheader-v2\b/gi, ' ')
      .replace(/\b\u5206\u4eab\b/g, ' ')
      .replace(/-\s+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanFeishuDescriptionForFrontmatter(value) {
    const beforeShell = String(value || '').split(/\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f|\u6700\u8fd1\u4fee\u6539|header-v2/i)[0] || value;
    const cleaned = cleanFeishuPropertyText(beforeShell);
    const firstSentence = cleaned.split(/[\u3002\uff01\uff1f!?]\s*/).map((item) => item.trim()).filter(Boolean)[0] || cleaned;
    return firstSentence.slice(0, 160).trim();
  }

  function cleanRecordFrontmatterField(record, key, value) {
    const metadata = (record && record.metadata) || {};
    const url = helpers.getRecordUrl(record || {}, metadata);
    if (!helpers.isFeishuUrl(url)) return value;
    if (key === 'title' || key === 'author' || key === 'source') return cleanFeishuPropertyText(value);
    if (key === 'description') return cleanFeishuDescriptionForFrontmatter(value);
    if (key === 'keywords' && Array.isArray(value)) return value.map((item) => cleanFeishuPropertyText(item)).filter(Boolean);
    if (key === 'keywords') return cleanFeishuPropertyText(value);
    return value;
  }

  function buildRecordFrontmatter(record, title, syncedAt, audioFileName, propertyFields = defaultNotePropertyFields) {
    const type = String(record.type || '').toLowerCase();
    const metadata = record.metadata || {};
    const aiMetadataSource = String(metadata.aiMetadataSource || '').trim();
    const socialMetrics = metadata.socialMetrics && typeof metadata.socialMetrics === 'object'
      ? metadata.socialMetrics
      : {};
    const fields = {
      id: helpers.getRecordId(record),
      type,
      title,
      author: helpers.getRecordAuthor(metadata),
      url: helpers.getRecordUrl(record, metadata),
      created_at: record.createdAt,
      synced_at: syncedAt,
      source: helpers.getRecordSourceLabel(record, metadata),
      description: aiMetadataSource ? helpers.getRecordDescription(metadata) : '',
      keywords: aiMetadataSource ? helpers.getRecordKeywords(metadata) : [],
      views: socialMetrics.views,
      likes: socialMetrics.likes,
      collects: socialMetrics.collects,
      comments: socialMetrics.comments,
      shares: socialMetrics.shares,
      coins: socialMetrics.coins,
      metrics_captured_at: socialMetrics.capturedAt,
      status: 'synced',
    };

    if (type === 'link') fields.fetch_status = metadata.fetchStatus || 'pending';
    if (type === 'webpage') fields.conversion_status = metadata.conversionStatus || 'pending';
    if (type === 'voice') {
      fields.audio_file = audioFileName;
      fields.audio_file_id = metadata.audioFileID || '';
      fields.transcription_status = metadata.transcriptionStatus || 'pending';
    }
    if (type === 'file') {
      fields.file_name = metadata.fileName || record.content || '';
      fields.file_id = metadata.fileID || '';
      fields.file_ext = metadata.fileExt || '';
      fields.conversion_status = metadata.conversionStatus || 'pending';
    }

    const defaultFieldOrder = parseNotePropertyFields(defaultNotePropertyFields);
    const legacyFieldOrder = ['id', 'type', 'title', 'author', 'url', 'created_at', 'synced_at', 'source', 'description', 'keywords', 'views', 'likes', 'collects', 'comments', 'shares', 'coins', 'metrics_captured_at', 'status', 'fetch_status', 'conversion_status', 'audio_file', 'audio_file_id', 'transcription_status', 'file_name', 'file_id', 'file_ext'];
    const selectedFields = parseNotePropertyFields(propertyFields);
    const fieldOrder = selectedFields.length ? selectedFields : (defaultFieldOrder.length ? defaultFieldOrder : legacyFieldOrder);
    const shouldQuoteFrontmatterValue = helpers.isFeishuUrl(helpers.getRecordUrl(record, metadata));
    const lines = fieldOrder
      .filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
      .map((key) => [key, cleanRecordFrontmatterField(record, key, fields[key])])
      .filter(([, value]) => yamlValue(value, { quote: shouldQuoteFrontmatterValue }))
      .map(([key, value]) => `${key}: ${yamlValue(value, { quote: shouldQuoteFrontmatterValue })}`);
    return buildFrontmatter(lines);
  }

  function buildMarkdownForRecord({ record, title, syncedAt, propertyFields = defaultNotePropertyFields }) {
    const type = String(record.type || '').toLowerCase();
    const metadata = record.metadata || {};
    const audioFileName = metadata.audioFileName || `${title}.mp3`;
    let body = '';
    if (type === 'text') {
      body = `${record.content || ''}\n`;
    } else if (type === 'link') {
      const pageTitle = metadata.title || title;
      const snapshot = metadata.snapshot || metadata.contentSnapshot || '';
      const fallback = metadata.fetchStatus === 'failed'
        ? '正文抓取失败，已保存标题和原始链接。'
        : '正文快照处理中，已先保存标题和原始链接。';
      body = [pageTitle, '', '## 正文快照', '', snapshot || fallback, ''].join('\n');
    } else if (type === 'webpage') {
      body = helpers.buildWebpageMarkdownBody(record, title);
    } else if (type === 'voice') {
      const errorText = metadata.transcriptionError || metadata.aiError || '';
      const transcription = metadata.transcription
        || (metadata.transcriptionStatus === 'failed' ? `语音转写失败。${errorText}` : '未开启语音转写。');
      body = ['## 转写全文', '', transcription, '', '## 录音文件', '', `![[${audioFileName}]]`, ''].join('\n');
    } else if (type === 'file') {
      body = helpers.buildFileMarkdownBody(record);
    } else {
      throw new Error(`Unsupported record type: ${record.type}`);
    }

    const frontmatter = buildRecordFrontmatter(record, title, syncedAt, audioFileName, propertyFields);
    const recordIdMarker = helpers.buildRecordIdMarker(helpers.getRecordId(record));
    const aiMetadataErrorMarker = metadata.aiMetadataError
      ? helpers.buildAiMetadataErrorComment(metadata.aiMetadataError)
      : '';
    const diagnosticMarkers = [recordIdMarker, aiMetadataErrorMarker].filter(Boolean).join('\n');
    const titleHeading = helpers.isSuccessfulTranscriptionRecord(record) ? `# ${title}\n\n` : '';
    return `${frontmatter}\n${diagnosticMarkers ? `${diagnosticMarkers}\n\n` : ''}${titleHeading}${body}`;
  }

  function buildNoteOutputPlan({ record, title, fileTitle = title, syncedAt, noteDir, propertyFields = defaultNotePropertyFields }) {
    return {
      markdown: buildMarkdownForRecord({ record, title, syncedAt, propertyFields }),
      filePath: helpers.normalizeVaultPath(`${noteDir}/${fileTitle}.md`),
    };
  }

  return { buildRecordFrontmatter, buildMarkdownForRecord, buildNoteOutputPlan };
}

module.exports = { createNoteOutputPlanHelpers };
