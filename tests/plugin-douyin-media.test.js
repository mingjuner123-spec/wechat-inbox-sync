'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      Notice: class {},
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: async () => ({}),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/src/main.js';
const PluginClass = require(pluginMainPath);
const helpers = PluginClass.__test;

function runTargetBoundDomFallbackWithoutRouteIdentityTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/target-dom-video/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      canonicalUrl: 'https://www.douyin.com/',
      domMediaCandidates: [{
        index: 0,
        urls: [targetMediaUrl],
        identityIds: [targetAwemeId],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 320000,
      }],
    }),
    [targetMediaUrl],
    'the exact target DOM player must remain usable when Douyin strips the id from final/canonical URLs',
  );
}

function runUniquePageIdentityFallbackTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/visible-target-video/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      canonicalUrl: 'https://www.douyin.com/',
      pageIdentityIds: [targetAwemeId],
      domMediaCandidates: [{
        index: 0,
        urls: [targetMediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 320000,
      }],
    }),
    [targetMediaUrl],
    'a uniquely target-bound page may use its visible playing media even if the player node has no id attribute',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      pageIdentityIds: [targetAwemeId, '9999999999999999999'],
      domMediaCandidates: [{
        urls: ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'],
    'mixed page identities alone must not reject the visible playing media from the opened target page',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      pageIdentityIds: [targetAwemeId],
      domMediaCandidates: [{
        urls: ['https://v11-weba.douyinvod.com/unbound-player-1/?mime_type=video_mp4'],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }, {
        urls: ['https://v11-weba.douyinvod.com/unbound-player-2/?mime_type=video_mp4'],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 800000,
      }],
    }),
    ['https://v11-weba.douyinvod.com/unbound-player-1/?mime_type=video_mp4'],
    'multiple unbound players should select the strongest visible playing candidate instead of failing closed',
  );
}

function runOnlyExplicitFinalRouteMismatchIsRejectedTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/target-video/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/video/9999999999999999999',
      debuggerMediaUrls: [targetMediaUrl],
    }),
    [],
    'an explicit final route mismatch must win over stale debugger media from the previous page',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/video/9999999999999999999',
      pageIdentityIds: [targetAwemeId],
      domMediaCandidates: [{
        urls: [targetMediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [],
    'an explicit loaded route for another work must still be rejected',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      domMediaCandidates: [{
        urls: [targetMediaUrl],
        identityIds: ['9999999999999999999'],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [targetMediaUrl],
    'candidate identity metadata must not block the visible playing media on the opened page',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      canonicalUrl: 'https://www.douyin.com/video/9999999999999999999',
      domMediaCandidates: [{
        urls: [targetMediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [targetMediaUrl],
    'canonical metadata from a preloaded work must not override the current playable page',
  );
}

function runNoStableAwemeIdStillUsesPrimaryPlayerTest() {
  const mediaUrl = 'https://v11-weba.douyinvod.com/no-stable-id/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId: '',
      finalUrl: 'https://www.douyin.com/',
      domMediaCandidates: [{
        urls: [mediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [mediaUrl],
    'missing aweme id must not fail closed when the current page has a playable primary video',
  );
}

function runBrowserFallbackRequestKeepsNonStrictCurrentPageTest() {
  assert.deepStrictEqual(
    helpers.buildDouyinBrowserFallbackRequest(
      'https://v.douyin.com/example/',
      'https://www.douyin.com/',
    ),
    {
      awemeId: '',
      url: 'https://www.douyin.com/',
      strictDouyinTarget: false,
    },
    'a current Douyin page without an id must still enter non-strict browser fallback',
  );

  assert.deepStrictEqual(
    helpers.buildDouyinBrowserFallbackRequests(
      'https://v.douyin.com/example/',
      'https://douyin.com/video/7644566503081119019?previous_page=app_code_link',
    ),
    [{
      awemeId: '7644566503081119019',
      url: 'https://v.douyin.com/example/',
      strictDouyinTarget: false,
      inputKind: 'original-page',
    }, {
      awemeId: '7644566503081119019',
      url: 'https://douyin.com/video/7644566503081119019?previous_page=app_code_link',
      strictDouyinTarget: false,
      inputKind: 'resolved-page',
    }, {
      awemeId: '7644566503081119019',
      url: 'https://www.douyin.com/video/7644566503081119019',
      strictDouyinTarget: false,
      inputKind: 'target-page',
    }],
    'a known target id must preserve the 1.3.30 current-page fallbacks and retry the canonical work page',
  );
}

function runPaceSsrStateMediaExtractionTest() {
  const awemeId = '7659688856577697920';
  const mediaUrl = 'https://v11-web.douyinvod.com/video-tos-cn-p-0015/example.mp4?mime_type=video_mp4';
  const pageState = encodeURIComponent(JSON.stringify({
    videoDetail: {
      awemeId,
      video: {
        playAddr: [{ src: mediaUrl }],
      },
    },
  }));
  const html = `<script>self.__pace_f.push([1, ${JSON.stringify(pageState)}]);</script>`;

  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(html, awemeId),
    [mediaUrl],
    'current Douyin React SSR state must provide the target play address even when no DOM media request fires',
  );
}

function runLocalYtDlpDownloadContractTest() {
  const sourceUrl = 'https://v.douyin.com/7G5Eb8dG13c/';
  const outputTemplate = 'C:\\Temp\\wechat-inbox-douyin-%(id)s.%(ext)s';
  assert.deepStrictEqual(
    helpers.buildYtDlpDownloadArguments(sourceUrl, outputTemplate),
    [
      '--no-playlist',
      '--no-progress',
      '--no-warnings',
      '--no-update',
      '--format', 'bestaudio/best',
      '--retries', '3',
      '--fragment-retries', '3',
      '--socket-timeout', '60',
      '--output', outputTemplate,
      '--print', 'after_move:filepath',
      sourceUrl,
    ],
    'Douyin should use the extractor as a bounded local-media downloader, not as a cloud service or a permanent download archive',
  );

  assert.deepStrictEqual(
    helpers.getLocalYtDlpExecutableCandidates('C:\\Users\\demo\\.wechat-inbox-local-asr', 'win32'),
    [
      'C:\\Users\\demo\\.wechat-inbox-local-asr\\bin\\yt-dlp.exe',
      'C:\\Users\\demo\\.wechat-inbox-local-asr\\yt-dlp.exe',
    ],
  );
  assert.deepStrictEqual(
    helpers.getLocalYtDlpExecutableCandidates('/Users/demo/.wechat-inbox-local-asr', 'darwin'),
    [
      '/Users/demo/.wechat-inbox-local-asr/bin/yt-dlp',
      '/Users/demo/.wechat-inbox-local-asr/python-venv/bin/yt-dlp',
    ],
  );

  assert.deepStrictEqual(
    helpers.buildYtDlpBrowserCookieArguments('chrome'),
    ['--cookies-from-browser', 'chrome'],
    'a cookie retry must only ask yt-dlp to read the named local browser profile',
  );
  assert.deepStrictEqual(
    helpers.buildYtDlpBrowserCookieArguments('unsupported-browser'),
    [],
    'unknown browser names must never be forwarded to the downloader',
  );
  assert.strictEqual(
    helpers.isYtDlpBrowserCookieRetryableFailure('Fresh cookies are needed to extract this content'),
    true,
    'Douyin login challenges should unlock one local-browser retry',
  );
  assert.strictEqual(
    helpers.isYtDlpBrowserCookieRetryableFailure('Unable to resolve host'),
    false,
    'network outages must not trigger unnecessary local-cookie reads',
  );
  assert.strictEqual(
    helpers.classifyYtDlpFailure('ERROR: Could not copy Chrome cookie database'),
    'browser-cookie-locked',
    'a locked browser profile needs a precise retry instruction, not a generic transcription failure',
  );
  assert.strictEqual(
    helpers.classifyYtDlpFailure('ERROR: Failed to decrypt with DPAPI'),
    'browser-cookie-unavailable',
    'unreadable local browser encryption must remain distinguishable from missing media',
  );
}

function runLocalYtDlpInstallerContractTest() {
  const sourceRoot = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
  const windowsInstaller = fs.readFileSync(path.join(sourceRoot, 'local-asr', 'install-local-asr.ps1'), 'utf8');
  const macInstaller = fs.readFileSync(path.join(sourceRoot, 'local-asr', 'install-local-asr-macos.sh'), 'utf8');
  assert.match(windowsInstaller, /yt-dlp\.exe/i, 'the Windows ASR update must also provision the local Douyin downloader');
  assert.match(windowsInstaller, /github\.com\/yt-dlp\/yt-dlp/i, 'the Windows downloader must come from its official upstream release');
  assert.match(macInstaller, /yt-dlp/i, 'the macOS ASR update must also provision the local Douyin downloader');
}

function runYtDlpIsPrimaryDouyinAcquisitionPathTest() {
  const sourcePath = path.resolve(__dirname, pluginMainPath);
  if (path.basename(sourcePath) === 'main.js' && !sourcePath.includes(`${path.sep}src${path.sep}`)) {
    return;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const primaryBlock = source.match(/const isDouyinMediaRequest[\s\S]{0,1800}?\/\/ If yt-dlp fails, do not clear candidates/);
  assert.ok(primaryBlock, 'Douyin transcription must define one explicit local-downloader primary path');
  assert.match(
    primaryBlock[0],
    /if \(isDouyinMediaRequest\)[\s\S]*?downloadDouyinWithLocalYtDlp/,
    'the local yt-dlp acquisition must run before legacy direct media candidates are used',
  );
  assert.doesNotMatch(
    primaryBlock[0],
    /candidates\s*=\s*\[\s*\]/,
    'a yt-dlp failure must not erase pre-existing direct media candidates',
  );
  assert.match(source, /If yt-dlp fails, do not clear candidates/, 'legacy page/API media addresses must remain a fallback, not be deleted');
}

function runZeroCandidateDouyinRouteStillStartsLocalDownloaderTest() {
  const sourcePath = path.resolve(__dirname, pluginMainPath);
  if (path.basename(sourcePath) === 'main.js' && !sourcePath.includes(`${path.sep}src${path.sep}`)) {
    return;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /const isDouyinPage = isDouyinUrl\(url\) \|\| isDouyinUrl\(resolvedUrl\);/,
    'the outer webpage route must identify Douyin before checking whether legacy parsing found a media URL',
  );
  assert.match(
    source,
    /if \(mediaUrl \|\| isDouyinPage\) \{[\s\S]{0,2600}?buildTranscriptRecordFromMedia/,
    'a Douyin page with zero legacy media candidates must still reach the local yt-dlp acquisition path',
  );
}

function runYtDlpAbortAndInstallerDegradeContractTest() {
  const sourceRoot = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
  const sourcePath = path.resolve(__dirname, pluginMainPath);
  if (path.basename(sourcePath) === 'main.js' && !sourcePath.includes(`${path.sep}src${path.sep}`)) {
    return;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const windowsInstaller = fs.readFileSync(path.join(sourceRoot, 'local-asr', 'install-local-asr.ps1'), 'utf8');
  const macInstaller = fs.readFileSync(path.join(sourceRoot, 'local-asr', 'install-local-asr-macos.sh'), 'utf8');
  assert.match(
    source,
    /options\.signal\.addEventListener\('abort', abortHandler, \{ once: true \}\)/,
    'stopping a transcription must actively stop the yt-dlp child process',
  );
  assert.match(
    source,
    /runLocalTranscriptionWithCleanup[\s\S]{0,800}?finally[\s\S]{0,400}?localInputCleanupDirectory/,
    'a downloaded temporary media file must be removed even when ASR setup fails before transcription starts',
  );
  assert.match(
    windowsInstaller,
    /try\s*\{\s*Install-YtDlp[\s\S]{0,300}?\}\s*catch\s*\{/,
    'a yt-dlp update outage must not make an otherwise usable Windows ASR installation fail',
  );
  assert.match(
    macInstaller,
    /if ! install_ytdlp; then/,
    'a yt-dlp update outage must not make an otherwise usable macOS ASR installation fail',
  );
}

function runLegacyPlayerActivationAndPageMediaFallbackContractTest() {
  const sourcePath = path.resolve(__dirname, pluginMainPath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /node\.muted\s*=\s*true;[\s\S]{0,240}node\.play\(\)\.catch\(\(\)\s*=>\s*\{\}\)/,
    'the hidden browser must activate the current video so Douyin emits its real media request',
  );
  assert.doesNotMatch(
    source,
    /isXiaohongshuUrl\(url\)\s*\|\|\s*Boolean\(douyinAwemeId\)\s*\?\s*\[\]/,
    'discovering an aweme id must not discard media already present in the opened page HTML',
  );
  assert.doesNotMatch(
    source,
    /allowGenericSocialMediaRender\s*=\s*!\(douyinAwemeId/,
    'discovering an aweme id must not disable the 1.3.30 current-page renderer',
  );
}

function runTargetPlayerInsideMixedIdentityContainerTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/target-inside-feed/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: `https://www.douyin.com/video/${targetAwemeId}`,
      canonicalUrl: `https://www.douyin.com/video/${targetAwemeId}`,
      domMediaCandidates: [{
        index: 0,
        urls: [targetMediaUrl],
        identityIds: [targetAwemeId, '9999999999999999999'],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [targetMediaUrl],
    'the visible playing target media must survive recommendation ids inherited from a shared feed container',
  );
}

async function runBrowserNavigationFailureDiagnosticTest() {
  const webContents = new EventEmitter();
  global.window = { setTimeout, clearTimeout };
  const waiting = helpers.waitForWebContents(webContents, 1000);
  webContents.emit('did-fail-load', {}, -118, 'net::ERR_CONNECTION_TIMED_OUT');
  assert.deepStrictEqual(
    await waiting,
    { outcome: 'failed', errorCode: -118 },
    'a hidden-browser navigation failure must keep its safe Chromium error code for the Douyin diagnostic',
  );
  delete global.window;
}

async function runLocalYtDlpCookieRetryExecutionTest() {
  const originalExecFile = require('child_process').execFile;
  const calls = [];
  require('child_process').execFile = (executable, args, options, callback) => {
    calls.push({ executable, args });
    const outputTemplate = args[args.indexOf('--output') + 1];
    if (!args.includes('--cookies-from-browser')) {
      const error = Object.assign(new Error('exit 1'), { code: 1 });
      callback(error, '', 'Fresh cookies are needed to extract this content');
      return { kill() {} };
    }
    const outputPath = outputTemplate.replace('%(ext)s', 'm4a');
    fs.writeFileSync(outputPath, 'audio');
    callback(null, `${outputPath}\n`, '');
    return { kill() {} };
  };
  try {
    const result = await PluginClass.prototype.downloadDouyinWithLocalYtDlp.call({
      getLocalYtDlpExecutable: () => 'C:\\component\\bin\\yt-dlp.exe',
      installLocalAsr: async () => { throw new Error('installer should not run when downloader is present'); },
    }, 'https://v.douyin.com/7G5Eb8dG13c/');
    assert.strictEqual(calls.length, 2, 'the downloader should make one unauthenticated attempt before one local-browser retry');
    assert.deepStrictEqual(
      calls[1].args.slice(-3),
      ['https://v.douyin.com/7G5Eb8dG13c/', '--cookies-from-browser', 'chrome'],
      'the successful retry must explicitly use the local Chrome profile and keep the original source link',
    );
    assert.ok(fs.existsSync(result.localInputPath), 'the successful downloader result must be a real temporary media file');
    fs.rmSync(result.cleanupDirectory, { recursive: true, force: true });
  } finally {
    require('child_process').execFile = originalExecFile;
  }
}

async function runLocalYtDlpAbortStopsChildTest() {
  const originalExecFile = require('child_process').execFile;
  let killed = 0;
  let outputDirectory = '';
  require('child_process').execFile = (executable, args, options, callback) => {
    outputDirectory = path.dirname(args[args.indexOf('--output') + 1]);
    return {
      kill() { killed += 1; },
    };
  };
  try {
    const controller = new AbortController();
    const pending = PluginClass.prototype.downloadDouyinWithLocalYtDlp.call({
      getLocalYtDlpExecutable: () => 'C:\\component\\bin\\yt-dlp.exe',
    }, 'https://v.douyin.com/7G5Eb8dG13c/', { signal: controller.signal });
    controller.abort();
    await assert.rejects(
      pending,
      (error) => error && error.name === 'AbortError',
      'stopping a transcription must reject the active yt-dlp download',
    );
    assert.strictEqual(killed, 1, 'stopping a transcription must kill the active yt-dlp child process exactly once');
    assert.strictEqual(fs.existsSync(outputDirectory), false, 'stopping a transcription must remove yt-dlp temporary media files');
  } finally {
    require('child_process').execFile = originalExecFile;
  }
}

async function runLocalYtDlpAbortDuringListenerRegistrationDoesNotStartChildTest() {
  const originalExecFile = require('child_process').execFile;
  let starts = 0;
  const signal = {
    aborted: false,
    addEventListener(eventName, listener) {
      if (eventName !== 'abort') return;
      this.aborted = true;
      listener();
    },
    removeEventListener() {},
  };
  require('child_process').execFile = () => {
    starts += 1;
    return { kill() {} };
  };
  try {
    await assert.rejects(
      PluginClass.prototype.downloadDouyinWithLocalYtDlp.call({
        getLocalYtDlpExecutable: () => 'C:\\component\\bin\\yt-dlp.exe',
      }, 'https://v.douyin.com/7G5Eb8dG13c/', { signal }),
      (error) => error && error.name === 'AbortError',
      'an abort during listener registration must stop the downloader before it starts',
    );
    assert.strictEqual(starts, 0, 'a stopped task must never start a new yt-dlp child process');
  } finally {
    require('child_process').execFile = originalExecFile;
  }
}

async function run() {
  runBrowserFallbackRequestKeepsNonStrictCurrentPageTest();
  runPaceSsrStateMediaExtractionTest();
  runLocalYtDlpDownloadContractTest();
  runLocalYtDlpInstallerContractTest();
  runYtDlpIsPrimaryDouyinAcquisitionPathTest();
  runZeroCandidateDouyinRouteStillStartsLocalDownloaderTest();
  runYtDlpAbortAndInstallerDegradeContractTest();
  runLegacyPlayerActivationAndPageMediaFallbackContractTest();
  runTargetBoundDomFallbackWithoutRouteIdentityTest();
  runUniquePageIdentityFallbackTest();
  runOnlyExplicitFinalRouteMismatchIsRejectedTest();
  runTargetPlayerInsideMixedIdentityContainerTest();
  runNoStableAwemeIdStillUsesPrimaryPlayerTest();
  await runBrowserNavigationFailureDiagnosticTest();
  await runLocalYtDlpCookieRetryExecutionTest();
  await runLocalYtDlpAbortStopsChildTest();
  await runLocalYtDlpAbortDuringListenerRegistrationDoesNotStartChildTest();
  console.log('plugin-douyin-media.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
