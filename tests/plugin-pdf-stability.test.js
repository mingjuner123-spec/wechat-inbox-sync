'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(
  repoRoot,
  'obsidian-plugin',
  'wechat-inbox-sync',
  'src',
  'document-text-extraction-utils.js',
);
const { createDocumentTextExtractionHelpers } = require(modulePath);

function toNodeBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value || []);
}

function cleanMarkdownForStorage(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createPage(items = []) {
  return {
    async getTextContent() {
      return { items };
    },
  };
}

function createPdfJs(pages = []) {
  const calls = [];
  return {
    calls,
    getDocument(options) {
      calls.push(options);
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          async getPage(pageNumber) {
            return pages[pageNumber - 1];
          },
          async destroy() {},
        }),
      };
    },
  };
}

function createValidPdfWithQuoteOperator(text) {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) ' ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, 'latin1'));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source, 'latin1');
  source += `xref\n0 ${objects.length + 1}\n`;
  source += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, 'latin1');
}

async function run() {
  const helpers = createDocumentTextExtractionHelpers({
    toNodeBuffer,
    cleanMarkdownForStorage,
  });
  assert.strictEqual(
    typeof helpers.extractPdfMarkdownWithFallback,
    'function',
    'PDF stability helper must expose an async fallback entrypoint',
  );

  const fastStream = 'BT /F1 12 Tf 72 720 Td (This is a complete ordinary PDF text paragraph that stays on the fast path.) Tj ET';
  const fastPdf = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${Buffer.byteLength(fastStream, 'latin1')} >>\nstream\n`
      + fastStream
      + '\nendstream\nendobj\n%%EOF',
    'latin1',
  );
  const unusedPdfJs = createPdfJs([]);
  let pdfJsLoadCalls = 0;
  let fastOcrCalls = 0;
  const fastResult = await helpers.extractPdfMarkdownWithFallback(fastPdf, {
    loadPdfJs: () => {
      pdfJsLoadCalls += 1;
      return unusedPdfJs;
    },
    ocrPage: async () => {
      fastOcrCalls += 1;
      return '';
    },
  });
  assert.strictEqual(fastResult.provider, 'pdf-text-layer-fast');
  assert.strictEqual(pdfJsLoadCalls, 0, 'fast path must not load the PDF.js module');
  assert.strictEqual(unusedPdfJs.calls.length, 0, 'fast path must not load PDF.js');
  assert.strictEqual(fastOcrCalls, 0, 'fast path must not invoke OCR');

  const textPdfJs = createPdfJs([
    createPage([
      { str: 'PDF.js 恢复出的完整标题', transform: [1, 0, 0, 1, 20, 700], hasEOL: true },
      { str: '这是复杂字体编码 PDF 的正文内容。', transform: [1, 0, 0, 1, 20, 680], hasEOL: false },
    ]),
  ]);
  let textOcrCalls = 0;
  const textResult = await helpers.extractPdfMarkdownWithFallback(Buffer.from('%PDF-broken'), {
    pdfjsLib: textPdfJs,
    ocrPage: async () => {
      textOcrCalls += 1;
      return '';
    },
  });
  assert.strictEqual(textResult.provider, 'pdfjs-text-layer');
  assert.ok(textResult.markdown.includes('PDF.js 恢复出的完整标题'));
  assert.ok(textResult.markdown.includes('复杂字体编码 PDF 的正文内容'));
  assert.strictEqual(textOcrCalls, 0, 'usable PDF.js text must not invoke OCR');

  const mixedPdfJs = createPdfJs([
    createPage([
      { str: '第一页已有足够完整的文本层内容。', transform: [1, 0, 0, 1, 20, 700], hasEOL: false },
    ]),
    createPage([]),
    createPage([
      { str: '第三页也有足够完整的文本层内容。', transform: [1, 0, 0, 1, 20, 700], hasEOL: false },
    ]),
  ]);
  const ocrPages = [];
  const mixedResult = await helpers.extractPdfMarkdownWithFallback(Buffer.from('%PDF-mixed'), {
    pdfjsLib: mixedPdfJs,
    ocrPage: async (_page, context) => {
      ocrPages.push(context.pageNumber);
      return '第二页扫描图片识别出的正文。';
    },
  });
  assert.deepStrictEqual(ocrPages, [2], 'only the page without a usable text layer should use OCR');
  assert.strictEqual(mixedResult.provider, 'pdfjs-text-layer+local-ocr');
  assert.ok(
    mixedResult.markdown.indexOf('第一页')
      < mixedResult.markdown.indexOf('第二页扫描')
      && mixedResult.markdown.indexOf('第二页扫描')
        < mixedResult.markdown.indexOf('第三页'),
    'merged PDF markdown must preserve page order',
  );
  assert.deepStrictEqual(mixedResult.diagnostic.ocrPageNumbers, [2]);

  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = class DOMMatrix {};
  const actualPdfJs = await import(pathToFileURL(path.join(
    repoRoot,
    'obsidian-plugin',
    'wechat-inbox-sync',
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.mjs',
  )).href);
  const actualPdfResult = await helpers.extractPdfMarkdownWithFallback(
    createValidPdfWithQuoteOperator('PDF.js integration fallback recovers this complete sentence.'),
    { pdfjsLib: actualPdfJs },
  );
  assert.strictEqual(actualPdfResult.provider, 'pdfjs-text-layer');
  assert.ok(actualPdfResult.markdown.includes('PDF.js integration fallback'));

  const scannedPdfJs = createPdfJs([createPage([])]);
  await assert.rejects(
    helpers.extractPdfMarkdownWithFallback(Buffer.from('%PDF-scanned'), {
      pdfjsLib: scannedPdfJs,
    }),
    /扫描型 PDF.*OCR 组件未就绪|扫描型 PDF.*OCR/,
  );

  const sourceMain = fs.readFileSync(path.join(
    repoRoot,
    'obsidian-plugin',
    'wechat-inbox-sync',
    'src',
    'main.js',
  ), 'utf8');
  assert.ok(sourceMain.includes('__WECHAT_INBOX_PDFJS_DATA_URL__'));
  assert.ok(sourceMain.includes('import(PDFJS_MODULE_DATA_URL)'));
  assert.ok(sourceMain.includes('await extractPdfMarkdownWithFallback(nodeBuffer'));
  assert.ok(sourceMain.includes('loadPdfJs: loadPdfJsLibrary'));
  assert.ok(sourceMain.includes('renderPdfPageForLocalOcr'));
  assert.ok(sourceMain.includes('metadata.pdfExtractionWarning'));

  const bundledMain = fs.readFileSync(path.join(
    repoRoot,
    'obsidian-plugin',
    'wechat-inbox-sync',
    'main.js',
  ), 'utf8');
  assert.ok(bundledMain.includes('Bundled dependency: pdfjs-dist 4.2.67'));
  assert.ok(bundledMain.includes('Apache License'));
  assert.ok(bundledMain.includes('data:text/javascript;base64,'));

  const bundledDataUrlMatch = bundledMain.match(
    /var PDFJS_MODULE_DATA_URL = "(data:text\/javascript;base64,[A-Za-z0-9+/=]+)";/,
  );
  assert.ok(bundledDataUrlMatch, 'built plugin must contain the self-contained PDF.js module');
  const bundledPdfJs = await import(bundledDataUrlMatch[1]);
  const bundledPdfResult = await helpers.extractPdfMarkdownWithFallback(
    createValidPdfWithQuoteOperator('Bundled PDF.js recovers this complete sentence.'),
    { pdfjsLib: bundledPdfJs },
  );
  assert.strictEqual(bundledPdfResult.provider, 'pdfjs-text-layer');
  assert.ok(bundledPdfResult.markdown.includes('Bundled PDF.js recovers'));

  console.log('plugin PDF stability tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
