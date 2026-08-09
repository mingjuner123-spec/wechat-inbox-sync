'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'document-text-extraction-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');

assert.ok(fs.existsSync(modulePath), 'Document text extraction module must exist');

const { createDocumentTextExtractionHelpers } = require(modulePath);
assert.strictEqual(typeof createDocumentTextExtractionHelpers, 'function');

function toNodeBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(data || []);
}

function cleanMarkdownForStorage(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const {
  cleanPdfExtractedText,
  extractDocxMarkdown,
  extractPdfMarkdown,
} = createDocumentTextExtractionHelpers({
  toNodeBuffer,
  cleanMarkdownForStorage,
});

for (const [name, value] of Object.entries({
  cleanPdfExtractedText,
  extractDocxMarkdown,
  extractPdfMarkdown,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be returned by the factory`);
}

assert.throws(
  () => createDocumentTextExtractionHelpers({ cleanMarkdownForStorage }),
  /toNodeBuffer/,
);
assert.throws(
  () => createDocumentTextExtractionHelpers({ toNodeBuffer }),
  /cleanMarkdownForStorage/,
);

function createZip(entries, compressionMethod = 8) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const fileName = Buffer.from(name, 'utf8');
    const data = Buffer.from(value);
    const compressed = compressionMethod === 8 ? zlib.deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, fileName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, fileName);

    localOffset += local.length + fileName.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const entryCount = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const docx = createZip({
  'word/document.xml': Buffer.from([
    '<w:document xmlns:w="urn:test"><w:body>',
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>标题 &amp; 计划</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>第一段</w:t></w:r><w:tab/><w:r><w:t>补充</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join(''), 'utf8'),
});
assert.strictEqual(
  extractDocxMarkdown(docx),
  '## 标题 & 计划\n\n第一段\t补充',
);

assert.throws(
  () => extractDocxMarkdown(createZip({ '[Content_Types].xml': '<Types />' }, 0)),
  /word\/document\.xml/,
);

function utf16BeHex(text) {
  const bytes = [0xfe, 0xff];
  Array.from(text).forEach((char) => {
    const code = char.charCodeAt(0);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  });
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function createUtf16BePdfBuffer(text) {
  const stream = `BT /F1 12 Tf 72 720 Td <${utf16BeHex(text)}> Tj ET`;
  const streamBuffer = Buffer.from(stream, 'latin1');
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${streamBuffer.length} >>\nstream\n`, 'latin1'),
    streamBuffer,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

function createFlateUtf16BePdfBuffer(text) {
  const stream = 'BT /F1 12 Tf 72 720 Td <' + utf16BeHex(text) + '> Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(stream, 'latin1'));
  const header = '%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n';
  return Buffer.concat([
    Buffer.from(header, 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

const pdfText = extractPdfMarkdown(createFlateUtf16BePdfBuffer([
  '这是第一段完整的中文文档内容。',
  '这是第二段，用于验证 PDF 文本层解析保持不变。',
].join('\n')));
assert.ok(pdfText.includes('这是第一段完整的中文文档内容'));
assert.ok(pdfText.includes('这是第二段'));

assert.throws(
  () => extractPdfMarkdown(createUtf16BePdfBuffer('x')),
  (error) => error && error.message === 'PDF 文本提取质量过低，已保留原始 PDF 附件。',
);

const corruptedPdfText = '异常乱码循环片段'.repeat(80);
assert.throws(
  () => extractPdfMarkdown(createUtf16BePdfBuffer(corruptedPdfText)),
  (error) => error && error.message === 'PDF 文本层编码异常，已保留原始 PDF 附件。',
);

const cleaned = cleanPdfExtractedText([
  '创始人手册',
  'The Founders Playbook',
  '',
  'A',
  '',
  'I',
  '',
  'M',
  'V',
  'P',
  '',
  '一个',
  '普通',
  '人',
  '也',
  '可以',
].join('\n'));
assert.ok(cleaned.includes('创始人手册 The Founders Playbook'));
assert.ok(cleaned.includes('AIMVP'));
assert.ok(cleaned.includes('一个普通人也可以'));

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
assert.ok(
  sourceMain.includes("require('./document-text-extraction-utils')"),
  'src/main.js must consume the extracted document module',
);
for (const functionName of [
  'decodeUtf16Be',
  'decodeXmlEntities',
  'inflateZipEntry',
  'readZipEntries',
  'extractDocxMarkdown',
  'decodePdfBytes',
  'decodePdfLiteralString',
  'decodePdfHexString',
  'unicodeFromPdfHex',
  'parsePdfCMap',
  'buildPdfCMap',
  'applyPdfCMap',
  'extractPdfTextFromContent',
  'isPdfMicroLine',
  'shouldJoinPdfLines',
  'getPdfLineJoiner',
  'mergePdfWrappedLines',
  'isLowQualityPdfExtraction',
  'isSuspectPdfGlyphEncoding',
  'cleanPdfExtractedText',
  'decodePdfStream',
  'extractPdfStreamLength',
  'getPdfStreamData',
  'extractPdfMarkdown',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}

console.log('plugin document text extraction tests passed');
