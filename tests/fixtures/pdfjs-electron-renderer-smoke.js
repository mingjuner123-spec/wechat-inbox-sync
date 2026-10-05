'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

async function run() {
  const nativeProcess = process;
  const [bundlePath, pdfBase64, mode = 'candidate'] = nativeProcess.argv.slice(2);
  for (const method of ['log', 'warn', 'info']) {
    console[method] = (...values) => nativeProcess.stderr.write(`[pdfjs] ${values.join(' ')}\\n`);
  }
  assert.ok(bundlePath && pdfBase64, 'bundle path and PDF fixture are required');

  const bundle = fs.readFileSync(bundlePath, 'utf8');
  const moduleUrl = bundle.match(
    /var PDFJS_MODULE_DATA_URL = (?:true \? )?"(data:text\/javascript;base64,[A-Za-z0-9+/=]+)"(?: : "")?;/,
  )?.[1];
  const workerUrl = bundle.match(
    /var PDFJS_WORKER_DATA_URL = (?:true \? )?"(data:text\/javascript;base64,[A-Za-z0-9+/=]+)"(?: : "")?;/,
  )?.[1];
  assert.ok(moduleUrl, 'bundle must embed its PDF.js module');
  assert.ok(workerUrl, 'bundle must embed the matching PDF.js worker');

  const workerSource = Buffer.from(workerUrl.split(',')[1], 'base64').toString('utf8');
  assert.ok(!workerSource.includes('globalThis.pdfjsWorker = {}'), 'worker must not overwrite a global worker');
  const sentinelWorker = { WorkerMessageHandler: { sentinel: true } };
  const sentinelPdfJs = { sentinel: true };
  const sentinelPdfJsPromise = Promise.resolve(sentinelPdfJs);
  globalThis.pdfjsWorker = sentinelWorker;
  globalThis.pdfjsLib = sentinelPdfJs;
  globalThis.pdfjsLibPromise = sentinelPdfJsPromise;
  globalThis.DOMMatrix ||= class DOMMatrix {};
  globalThis.process = { versions: { electron: 'test' }, type: 'renderer' };
  globalThis.Worker = undefined;
  globalThis.fetch = async () => {
    throw new Error('network access blocked in PDF renderer fixture');
  };
  http.request = () => {
    throw new Error('network access blocked in PDF renderer fixture');
  };
  https.request = () => {
    throw new Error('network access blocked in PDF renderer fixture');
  };

  const loaderMatch = bundle.match(
    /async function loadPdfJsLibrary\(\) \{[\s\S]*?\n\}[\r\n]+__name\(loadPdfJsLibrary, "loadPdfJsLibrary"\);/,
  );
  assert.ok(loaderMatch, 'bundle must contain the compiled production PDF.js loader');
  const loaderSource = loaderMatch[0].replace(/\n__name\(loadPdfJsLibrary, "loadPdfJsLibrary"\);$/, '');
  const loadPdfJsLibrary = new Function(
    'PDFJS_MODULE_DATA_URL',
    'PDFJS_WORKER_DATA_URL',
    'let cachedPdfJsLibraryPromise = null;\n' + loaderSource + '\nreturn loadPdfJsLibrary;',
  )(moduleUrl, workerUrl);
  const pdfjsLib = mode === 'candidate'
    ? await loadPdfJsLibrary()
    : await import(moduleUrl);
  assert.strictEqual(globalThis.pdfjsWorker, sentinelWorker, 'PDF.js must not reuse or replace another bundle worker');
  assert.strictEqual(globalThis.pdfjsLib, sentinelPdfJs, 'PDF.js module must not replace another bundle global');
  assert.strictEqual(globalThis.pdfjsLibPromise, sentinelPdfJsPromise, 'PDF.js module must not replace another bundle promise');
  assert.strictEqual(
    pdfjsLib.GlobalWorkerOptions.workerSrc,
    mode === 'candidate' ? workerUrl : '',
    'the production loader must configure only its matching embedded worker',
  );

  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(Buffer.from(pdfBase64, 'base64')),
    disableWorker: true,
  });
  const document = await loadingTask.promise;
  try {
    assert.strictEqual(document.numPages, 1);
    const page = await document.getPage(1);
    const text = await page.getTextContent();
    assert.ok(text.items.some((item) => item.str.includes('Renderer worker recovers this PDF.')));
  } finally {
    await loadingTask.destroy();
  }
  assert.strictEqual(globalThis.pdfjsWorker, sentinelWorker, 'worker load must preserve foreign global worker');
  assert.strictEqual(globalThis.pdfjsLib, sentinelPdfJs, 'module load must preserve foreign global library');
  assert.strictEqual(globalThis.pdfjsLibPromise, sentinelPdfJsPromise, 'module load must preserve foreign global promise');
  nativeProcess.stdout.write(JSON.stringify({ ok: true, renderer: 'electron-test', embeddedWorker: true }));
}

const nativeProcess = process;
run().catch((error) => {
  nativeProcess.stderr.write(`PDF renderer probe failed: ${error && error.message ? error.message : String(error)}`);
  nativeProcess.exitCode = 1;
});
