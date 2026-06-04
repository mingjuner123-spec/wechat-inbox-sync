const fs = require('fs');
const path = require('path');

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

const TYPE_DISPLAY_NAMES = {
  text: '文字',
  link: '链接',
  webpage: '网页',
  voice: '语音',
  file: '文件',
};

function getRecordId(record) {
  return record._id || record.id || '';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getChinaTimeParts(createdAt) {
  const parsed = new Date(createdAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const shifted = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: pad2(shifted.getUTCMonth() + 1),
    day: pad2(shifted.getUTCDate()),
    hour: pad2(shifted.getUTCHours()),
    minute: pad2(shifted.getUTCMinutes()),
    second: pad2(shifted.getUTCSeconds()),
  };
}

function getDateFolderName(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatCreatedTime(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getTitleTimePart(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.hour}${parts.minute}${parts.second}`;
}

function getTypeDisplayName(type) {
  const normalized = String(type || '').toLowerCase();
  if (!TYPE_DISPLAY_NAMES[normalized]) {
    throw new Error(`Unsupported record type: ${type}`);
  }
  return TYPE_DISPLAY_NAMES[normalized];
}

function getAttachmentExt(fileName, fallbackExt) {
  const fromName = String(fileName || '').split('.').pop();
  const ext = String(fallbackExt || fromName || '').toLowerCase().replace(/^\./, '');
  return ext === String(fileName || '').toLowerCase() ? '' : ext;
}

function stripFileExtension(fileName) {
  const leaf = String(fileName || '').split(/[\\/]/).pop() || '';
  return leaf.replace(/\.[a-z0-9]{1,12}$/i, '').trim();
}

function getUrlHostname(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch (error) {
    const match = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
    return match && match[1] ? match[1].replace(/^www\./, '') : '';
  }
}

function getUrlLastPathSegment(url) {
  try {
    const parsed = new URL(String(url || ''));
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : '';
  } catch (error) {
    return '';
  }
}

function isFeishuUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('feishu.cn') || text.includes('larksuite.com') || text.includes('feishu.net');
}

function isWechatArticleUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('mp.weixin.qq.com') || text.includes('weixin.qq.com');
}

function isXiaohongshuUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('xiaohongshu.com') || text.includes('xhslink.com');
}

function isDouyinUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('douyin.com') || text.includes('iesdouyin.com') || text.includes('amemv.com');
}

function getWebpageSourcePrefix(url) {
  if (isFeishuUrl(url)) return '飞书';
  if (isWechatArticleUrl(url)) return '公众号';
  if (isXiaohongshuUrl(url)) return '小红书';
  if (isDouyinUrl(url)) return '抖音';
  return '网页';
}

function sanitizeNoteTitlePart(text, fallback = '未命名') {
  const cleaned = String(text || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const value = cleaned || fallback;
  return Array.from(value).slice(0, 56).join('').replace(/[.\s]+$/g, '').trim() || fallback;
}

function getRecordSourcePrefix(record) {
  const type = String(record && record.type || '').toLowerCase();
  const metadata = (record && record.metadata) || {};
  if (type === 'text') return '文本';
  if (type === 'link') return '链接';
  if (type === 'voice') return '录音';
  if (type === 'webpage') return getWebpageSourcePrefix(metadata.url || record.content || '');
  if (type === 'file') return getAttachmentExt(metadata.fileName || record.content || '', metadata.fileExt) || '文件';
  return getTypeDisplayName(type);
}

function getRecordSourceName(record) {
  const type = String(record && record.type || '').toLowerCase();
  const metadata = (record && record.metadata) || {};
  const content = String((record && record.content) || '').trim();
  const fallbackTime = getTitleTimePart(record && record.createdAt);

  if (type === 'file') return stripFileExtension(metadata.fileName || content) || fallbackTime;
  if (type === 'voice') {
    const audioName = stripFileExtension(metadata.originalAudioFileName || metadata.audioFileName || '');
    if (audioName) return audioName;
    if (content && !/^现场语音备忘录\s*-/.test(content)) return content;
    return fallbackTime;
  }
  if (type === 'webpage') {
    const url = metadata.url || content;
    return metadata.title || getUrlLastPathSegment(url) || getUrlHostname(url) || fallbackTime;
  }
  if (type === 'link') {
    const url = metadata.url || content;
    return metadata.title || getUrlHostname(url) || getUrlLastPathSegment(url) || content || fallbackTime;
  }
  return content || fallbackTime;
}

function buildRecordTitleBase(record) {
  const prefix = sanitizeNoteTitlePart(getRecordSourcePrefix(record), '内容');
  const name = sanitizeNoteTitlePart(getRecordSourceName(record), getTitleTimePart(record && record.createdAt));
  return `${prefix}-${name}`;
}

function buildCollectionTimeLine(record) {
  return `收集时间：${formatCreatedTime(record.createdAt)}`;
}

function buildTextBody(record) {
  return `${record.content || ''}\n`;
}

function buildLinkBody(record, title) {
  const metadata = record.metadata || {};
  const pageTitle = metadata.title || title;
  const url = metadata.url || record.content || '';
  const snapshot = metadata.snapshot || metadata.contentSnapshot || '';
  const fetchStatus = metadata.fetchStatus || 'pending';

  const lines = [
    pageTitle,
    '',
    `原始链接：${url}`,
    '',
    '## 正文快照',
    '',
  ];

  if (snapshot) {
    lines.push(snapshot);
  } else if (fetchStatus === 'failed') {
    lines.push('正文抓取失败，已保存标题和原始链接。');
  } else {
    lines.push('正文快照处理中，已先保存标题和原始链接。');
  }

  lines.push('');
  return lines.join('\n');
}

function buildVoiceBody(record, title, audioFileName) {
  const metadata = record.metadata || {};
  const errorText = metadata.transcriptionError || metadata.aiError || '';
  const transcription = metadata.transcription
    || (metadata.transcriptionStatus === 'failed' ? `语音转写失败。${errorText}` : '未开启语音转写。');

  return [
    '## 转写全文',
    '',
    transcription,
    '',
    '## 录音文件',
    '',
    `![[${audioFileName}]]`,
    '',
  ].join('\n');
}

function buildWebpageBody(record, title) {
  const metadata = record.metadata || {};
  const url = metadata.url || record.content || '';
  const snapshot = metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '';
  const status = metadata.conversionStatus || 'pending';

  const lines = [
    `原始链接：${url}`,
    '',
    '## Markdown 内容',
    '',
  ];

  if (snapshot) {
    lines.push(snapshot);
  } else if (status === 'failed') {
    lines.push('网页转 Markdown 失败，已保存原始链接。');
  } else {
    lines.push('网页转 Markdown 处理中，已先保存原始链接。');
  }

  lines.push('');
  return lines.join('\n');
}

function buildFileBody(record) {
  const metadata = record.metadata || {};
  const fileName = metadata.fileName || record.content || 'upload-file';
  const fileID = metadata.fileID || '';
  const filePath = metadata.filePath || '';
  const converted = metadata.markdown || metadata.convertedMarkdown || '';
  const status = metadata.conversionStatus || 'pending';

  const lines = [
    `文件名：${fileName}`,
    filePath ? `本地附件：[[${filePath}]]` : '',
    fileID ? `云端文件：${fileID}` : '',
    '',
    '## Markdown 内容',
    '',
  ].filter((line) => line !== '');

  if (converted) {
    lines.push(converted);
  } else if (status === 'failed') {
    lines.push('文件转 Markdown 失败，已保存文件信息。');
  } else if (status === 'attachment_saved') {
    lines.push('文件附件已保存，PDF / Word 转 Markdown 功能后续接入。');
  } else {
    lines.push('文件转 Markdown 处理中，已先保存文件信息。');
  }

  lines.push('');
  return lines.join('\n');
}

function buildMarkdownForRecord({ record, title, syncedAt }) {
  const type = String(record.type || '').toLowerCase();
  const metadata = record.metadata || {};
  const audioFileName = metadata.audioFileName || `${title}.mp3`;

  let body;
  if (type === 'text') {
    body = buildTextBody(record);
  } else if (type === 'link') {
    body = buildLinkBody(record, title);
  } else if (type === 'webpage') {
    body = buildWebpageBody(record, title);
  } else if (type === 'voice') {
    body = buildVoiceBody(record, title, audioFileName);
  } else if (type === 'file') {
    body = buildFileBody(record);
  } else {
    throw new Error(`Unsupported record type: ${record.type}`);
  }

  return `${buildCollectionTimeLine(record)}\n\n${body}`;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getUniqueTitle(dayDir, baseTitle) {
  if (!fs.existsSync(path.join(dayDir, `${baseTitle}.md`))) {
    return baseTitle;
  }

  let sequence = 2;
  while (fs.existsSync(path.join(dayDir, `${baseTitle}-${String(sequence).padStart(3, '0')}.md`))) {
    sequence += 1;
  }
  return `${baseTitle}-${String(sequence).padStart(3, '0')}`;
}

function syncRecordsToVault({ records, vaultPath, inboxDir = '临时收集', syncedAt = new Date().toISOString() }) {
  if (!vaultPath) {
    throw new Error('Vault path is required');
  }

  const written = [];

  records.forEach((record) => {
    const dateFolder = getDateFolderName(record.createdAt);
    const dayDir = path.join(vaultPath, inboxDir, dateFolder);
    ensureDirectory(dayDir);

    const baseTitle = buildRecordTitleBase(record);
    const title = getUniqueTitle(dayDir, baseTitle);
    const filePath = path.join(dayDir, `${title}.md`);
    const markdown = buildMarkdownForRecord({ record, title, syncedAt });

    fs.writeFileSync(filePath, markdown, 'utf8');
    written.push({
      recordId: getRecordId(record),
      filePath,
      title,
    });
  });

  return { written };
}

module.exports = {
  buildMarkdownForRecord,
  formatCreatedTime,
  getDateFolderName,
  getTitleTimePart,
  getTypeDisplayName,
  buildRecordTitleBase,
  syncRecordsToVault,
};
