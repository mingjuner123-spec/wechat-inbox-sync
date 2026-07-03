const fs = require('fs');
const path = require('path');

const TYPE_DISPLAY_NAMES = {
  text: '文字',
  link: '链接',
  webpage: '网页',
  voice: '语音',
  file: '文件',
};

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

function getRecordId(record) {
  return record._id || record.id || '';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getDateFolderName(createdAt) {
  const parsed = new Date(createdAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const shifted = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);
  return [
    shifted.getUTCFullYear(),
    pad2(shifted.getUTCMonth() + 1),
    pad2(shifted.getUTCDate()),
  ].join('-');
}

function getTypeDisplayName(type) {
  const normalized = String(type || '').toLowerCase();
  if (!TYPE_DISPLAY_NAMES[normalized]) {
    throw new Error(`Unsupported record type: ${type}`);
  }
  return TYPE_DISPLAY_NAMES[normalized];
}

function yamlValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r?\n/g, ' ');
}

function buildFrontmatter(lines) {
  return ['---', ...lines, '---', ''].join('\n');
}

function buildTextBody(record, title) {
  return [`# ${title}`, '', record.content || '', ''].join('\n');
}

function buildLinkBody(record) {
  const metadata = record.metadata || {};
  const pageTitle = metadata.title || '链接-001';
  const url = metadata.url || record.content || '';
  const snapshot = metadata.snapshot || metadata.contentSnapshot || '';
  const fetchStatus = metadata.fetchStatus || 'pending';

  const lines = [
    `# ${pageTitle}`,
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
  const summary = metadata.summary || (metadata.summaryStatus === 'failed' ? '摘要生成失败。' : '摘要处理中。');
  const transcription = metadata.transcription || (metadata.transcriptionStatus === 'failed' ? '语音转写失败。' : '转写处理中。');

  return [
    `# ${title}`,
    '',
    '## 摘要',
    '',
    summary,
    '',
    '## 转写全文',
    '',
    transcription,
    '',
    '## 录音文件',
    '',
    `[${audioFileName}](./${audioFileName})`,
    '',
  ].join('\n');
}

function buildWebpageBody(record, title) {
  const metadata = record.metadata || {};
  const url = metadata.url || record.content || '';
  const snapshot = metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '';
  const status = metadata.conversionStatus || 'pending';

  const lines = [
    `# ${title}`,
    '',
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
    `# ${fileName}`,
    '',
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

  const frontmatter = [
    `id: ${yamlValue(getRecordId(record))}`,
    `type: ${yamlValue(type)}`,
    `created_at: ${yamlValue(record.createdAt)}`,
    `synced_at: ${yamlValue(syncedAt)}`,
    `source: ${yamlValue(record.source || 'wechat-miniprogram')}`,
    'status: synced',
  ];

  if (type === 'link') {
    frontmatter.push(`url: ${yamlValue(metadata.url || record.content)}`);
    frontmatter.push(`title: ${yamlValue(metadata.title || '')}`);
    frontmatter.push(`fetch_status: ${yamlValue(metadata.fetchStatus || 'pending')}`);
  }

  if (type === 'webpage') {
    frontmatter.push(`url: ${yamlValue(metadata.url || record.content)}`);
    frontmatter.push(`conversion_status: ${yamlValue(metadata.conversionStatus || 'pending')}`);
  }

  if (type === 'voice') {
    frontmatter.push(`audio_file: ./${yamlValue(audioFileName)}`);
    frontmatter.push(`audio_file_id: ${yamlValue(metadata.audioFileID || '')}`);
    frontmatter.push(`transcription_status: ${yamlValue(metadata.transcriptionStatus || 'pending')}`);
    frontmatter.push(`summary_status: ${yamlValue(metadata.summaryStatus || 'pending')}`);
  }

  if (type === 'file') {
    frontmatter.push(`file_name: ${yamlValue(metadata.fileName || record.content || '')}`);
    frontmatter.push(`file_id: ${yamlValue(metadata.fileID || '')}`);
    frontmatter.push(`file_ext: ${yamlValue(metadata.fileExt || '')}`);
    frontmatter.push(`conversion_status: ${yamlValue(metadata.conversionStatus || 'pending')}`);
  }

  let body;
  if (type === 'text') {
    body = buildTextBody(record, title);
  } else if (type === 'link') {
    body = buildLinkBody(record);
  } else if (type === 'webpage') {
    body = buildWebpageBody(record, title);
  } else if (type === 'voice') {
    body = buildVoiceBody(record, title, audioFileName);
  } else if (type === 'file') {
    body = buildFileBody(record);
  } else {
    throw new Error(`Unsupported record type: ${record.type}`);
  }

  return `${buildFrontmatter(frontmatter)}\n${body}`;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getNextSequence(dayDir, typeName) {
  if (!fs.existsSync(dayDir)) return 1;
  const files = fs.readdirSync(dayDir);
  const pattern = new RegExp(`^${typeName}-(\\d{3})\\.md$`);
  const max = files.reduce((currentMax, fileName) => {
    const match = fileName.match(pattern);
    if (!match) return currentMax;
    return Math.max(currentMax, Number(match[1]));
  }, 0);
  return max + 1;
}

function formatSequence(sequence) {
  return String(sequence).padStart(3, '0');
}

function syncRecordsToVault({ records, vaultPath, inboxDir = '临时收集', syncedAt = new Date().toISOString() }) {
  if (!vaultPath) {
    throw new Error('Vault path is required');
  }

  const written = [];

  records.forEach((record) => {
    const dateFolder = getDateFolderName(record.createdAt);
    const typeName = getTypeDisplayName(record.type);
    const dayDir = path.join(vaultPath, inboxDir, dateFolder);
    ensureDirectory(dayDir);

    const sequence = getNextSequence(dayDir, typeName);
    const title = `${typeName}-${formatSequence(sequence)}`;
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
  getDateFolderName,
  getTypeDisplayName,
  syncRecordsToVault,
};
