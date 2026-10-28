const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-failure-reduction-'));
os.homedir = () => home;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'obsidian') return {
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
    Notice: class {}, requestUrl: async () => { throw new Error('Unexpected network'); },
  };
  return originalLoad.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;
const h = Plugin.__test;
const { classifyFailureReason } = require('../obsidian-plugin/wechat-inbox-sync/src/operator-media-node');

function run() {
  // 1. Only a strictly newer numeric version is an update; a pre-release
  // suffix never makes a build look newer.
  assert.equal(h.isNewerPluginVersion('1.3.200', '1.3.199'), true);
  assert.equal(h.isNewerPluginVersion('1.4.0', '1.3.199'), true);
  assert.equal(h.isNewerPluginVersion('1.3.199', '1.3.199'), false);
  assert.equal(h.isNewerPluginVersion('1.3.199', '1.3.200'), false);
  assert.equal(h.isNewerPluginVersion('1.3.9', '1.3.10'), false);
  assert.equal(h.isNewerPluginVersion('', '1.3.199'), false);
  assert.equal(h.isNewerPluginVersion('not-a-version', '1.3.199'), false);

  // 2. A Douyin note page carries its description and image list in the router
  // state; the extractor turns them into a content note instead of a failed
  // transcription.
  {
    const noteId = '7281122334455667788';
    const page = `<html><body><script>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: {
        [`note_${noteId}`]: {
          videoInfoRes: {
            item_list: [{
              aweme_id: noteId,
              desc: '今天分享三个整理笔记的小技巧 #效率',
              item_title: '整理笔记的小技巧',
              author: { nickname: '整理研究所' },
              images: [
                { url_list: ['https://p3.douyinpic.com/one.jpg'] },
                { url_list: ['https://p3.douyinpic.com/two.jpg'] },
              ],
            }],
          },
        },
      },
    })};</script></body></html>`;
    const extracted = h.extractDouyinNoteContent(page, noteId);
    assert.ok(extracted, 'the note page must yield content');
    assert.equal(extracted.title, '整理笔记的小技巧');
    assert.equal(extracted.author, '整理研究所');
    assert.deepEqual(extracted.imageUrls, [
      'https://p3.douyinpic.com/one.jpg',
      'https://p3.douyinpic.com/two.jpg',
    ]);
    assert.match(extracted.markdown, /整理笔记的小技巧|今天分享三个整理笔记/);
    assert.match(extracted.markdown, /!\[抖音笔记图片 1\]\(https:\/\/p3\.douyinpic\.com\/one\.jpg\)/);
  }

  // 3. A page with no matching detail (login wall, challenge page) yields
  // nothing, so the caller can still save the link instead of inventing text.
  {
    assert.equal(h.extractDouyinNoteContent('<html><body>验证</body></html>', '7281122334455667788'), null);
    assert.equal(h.extractDouyinNoteContent('', '7281122334455667788'), null);
  }

  // 4. Two notes are the same source only when host and path agree; tracking
  // parameters and a trailing slash must not create a duplicate.
  assert.equal(
    h.normalizeNoteSourceIdentity('https://www.xiaohongshu.com/explore/abc?xsec_token=xyz'),
    h.normalizeNoteSourceIdentity('https://www.xiaohongshu.com/explore/abc/'),
  );
  assert.notEqual(
    h.normalizeNoteSourceIdentity('https://www.xiaohongshu.com/explore/abc'),
    h.normalizeNoteSourceIdentity('https://www.xiaohongshu.com/explore/def'),
  );

  // 5. The writer reads the existing note's own source link before deciding
  // that a repeat sync is a duplicate.
  {
    const reads = new Map([
      ['dup.md', '---\ntitle: 笔记\nurl: https://www.xiaohongshu.com/explore/abc\n---\n正文'],
      ['other.md', '---\ntitle: 别的\n---\n见 https://example.com/a'],
    ]);
    const adapter = { read: async (filePath) => reads.get(path.basename(filePath)) || '' };
    return (async () => {
      assert.equal(
        await h.readNoteSourceIdentity(adapter, '/vault/dup.md'),
        h.normalizeNoteSourceIdentity('https://www.xiaohongshu.com/explore/abc'),
      );
      assert.equal(await h.readNoteSourceIdentity(adapter, '/vault/other.md'), h.normalizeNoteSourceIdentity('https://example.com/a'));
      assert.equal(await h.readNoteSourceIdentity(adapter, '/vault/missing.md'), '');

      // 6. Operator node failures now carry a reason bucket instead of a bare
      // code, so the cloud job and the user can tell the causes apart.
      assert.equal(classifyFailureReason(Object.assign(new Error('需要更新 Cookie'), { code: 'DOUYIN_COOKIE_REFRESH_REQUIRED' })), 'login-required');
      assert.equal(classifyFailureReason(Object.assign(new Error('安全验证'), { code: 'DOUYIN_CHALLENGE' })), 'risk-control');
      assert.equal(classifyFailureReason(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })), 'network');
      assert.equal(classifyFailureReason(Object.assign(new Error('笔记已删除'), { code: 'XHS_NOT_FOUND' })), 'content-unavailable');
      assert.equal(classifyFailureReason(new Error('???')), 'unknown');
      assert.equal(classifyFailureReason(Object.assign(new Error('ffmpeg not found'), { code: 'CLOUD_MEDIA_TRANSCODER_UNAVAILABLE' })), 'transcoder-missing');
      assert.equal(classifyFailureReason(Object.assign(new Error('ffmpeg failed with exit code -22'), { code: 'CLOUD_MEDIA_TRANSCODE_FAILED' })), 'transcode-failed');
      assert.equal(classifyFailureReason(Object.assign(new Error('Worker operation timed out'), { code: 'WORKER_OPERATION_TIMEOUT' })), 'worker-timeout');

      // 7. The update hint must never write settings: a settings write is what
      // could disturb a user's bindings, and this check only shows a notice.
      {
        const plugin = new Plugin();
        plugin.settings = { bindings: [{ token: 'PRO-1' }] };
        let saved = 0;
        plugin.saveSettings = async () => { saved += 1; };
        plugin.showSyncProgress = () => {};
        await plugin.maybeCheckPluginUpdate();
        assert.equal(saved, 0, 'the version check must not persist settings');
        assert.deepEqual(plugin.settings.bindings, [{ token: 'PRO-1' }]);
      }

      // 8. A locked transcribe run log is a transient script failure: the run
      // is retried once instead of being reported as a broken transcription.
      {
        const plugin = new Plugin();
        let calls = 0;
        plugin.runLocalTranscriptionCore = async () => {
          calls += 1;
          const error = new Error('Add-Content : cannot get content writer');
          error.code = 'LOCAL_ASR_FAILED';
          throw error;
        };
        await assert.rejects(plugin.runLocalTranscription('https://example.com/a.mp3', {}), /Add-Content/);
        assert.equal(calls, 2, 'a locked log is retried exactly once');
      }

      // 9. Whisper producing no text becomes a sentence the user can act on,
      // not a raw script dump.
      {
        const raw = Object.assign(new Error('Whisper did not generate transcript text. See C:/x/transcribe-last.log'), { code: 'LOCAL_ASR_FAILED' });
        assert.equal(h.isTransientLocalAsrScriptError(raw), false);
        const normalized = h.normalizeLocalAsrFailure(raw);
        assert.match(normalized.message, /纯音乐|无声/);
        assert.equal(normalized.code, 'LOCAL_ASR_FAILED');
        assert.equal(normalized.retryable, false);
      }

      // 10. The installed Windows transcribe script is hardened in place so a
      // locked run log stops aborting the run; the original is kept beside it.
      {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-script-'));
        const scriptPath = path.join(root, 'transcribe.ps1');
        fs.writeFileSync(scriptPath, [
          'param([string]$InputPath, [string]$OutputPath)',
          '$ErrorActionPreference = "Stop"',
          '$Root = Split-Path -Parent $MyInvocation.MyCommand.Path',
          '$RunLog = Join-Path $Root "transcribe-last.log"',
          '@("time=x") | Set-Content -LiteralPath $RunLog -Encoding UTF8',
          'Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value @("status=pending")',
          'Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value "status=success"',
        ].join('\n'));
        assert.equal(h.hardenLocalAsrRunLogScript(root, 'win32'), 'patched');
        const patched = fs.readFileSync(scriptPath, 'utf8');
        assert.match(patched, /wechat-inbox-log-write-tolerance-v1/);
        assert.equal((patched.match(/-ErrorAction SilentlyContinue/g) || []).length, 3);
        assert.ok(fs.existsSync(`${scriptPath}.bak-log-tolerance`), 'the original script is kept');
        assert.equal(h.hardenLocalAsrRunLogScript(root, 'win32'), 'already');
        assert.equal(h.hardenLocalAsrRunLogScript(root, 'darwin'), 'not-applicable');

        const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-script-unknown-'));
        fs.writeFileSync(path.join(unknownRoot, 'transcribe.ps1'), 'param()\nWrite-Host hi\n');
        assert.equal(h.hardenLocalAsrRunLogScript(unknownRoot, 'win32'), 'unknown-script');
      }

      // 11. Settings can never roll back: a no-argument save keeps the current
      // settings, and startup repairs a snapshot that lost its binding.
      {
        const plugin = new Plugin();
        let saved = null;
        plugin.saveData = async (value) => { saved = JSON.parse(JSON.stringify(value)); };
        plugin.settings = { bindings: [{ token: 'PRO-1' }], clientId: 'c1', apiBase: 'https://example.com/sync', settingsRevision: 5 };
        plugin.writeSettingsGuard = () => {};
        await plugin.saveSettings();
        assert.equal(saved.bindings.length, 1, 'a no-argument save must not rebuild defaults');
        assert.equal(saved.settingsRevision, 6, 'every save advances the revision');

        const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-guard-'));
        fs.writeFileSync(path.join(guardDir, 'settings-guard.json'), JSON.stringify({
          schema: 1,
          revision: 10,
          bindings: [{ token: 'PRO-1' }],
          token: 'PRO-1',
          clientId: 'c1',
          apiBase: 'https://example.com/sync',
        }));
        const rolledBack = new Plugin();
        rolledBack.saveData = async (value) => { saved = JSON.parse(JSON.stringify(value)); };
        rolledBack.getPluginBaseDir = () => guardDir;
        rolledBack.settings = { bindings: [], clientId: '', apiBase: 'https://example.com/sync', settingsRevision: 0 };
        await rolledBack.applySettingsRollbackGuard();
        assert.equal(rolledBack.settings.bindings.length, 1, 'the guard restores the lost binding');
        assert.equal(rolledBack.settings.clientId, 'c1', 'the guard restores the bound client id');
        assert.equal(rolledBack.settings.settingsRevision, 11);
      }

      // 12. The resolver status names the failure so the user is told whether to
      // install or to reinstall.
      {
        const resolverUtils = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-status-'));
        const exe = path.join(dir, 'yt-dlp.exe');
        assert.equal(resolverUtils.getVerifiedResolverStatus(exe, 'win32', 'x64').reason, 'not-installed');
        fs.writeFileSync(`${exe}.verified.json`, JSON.stringify({ schema: 1, platform: 'win32', arch: 'x64', sha256: 'a'.repeat(64), byteLength: 3 }));
        assert.equal(resolverUtils.getVerifiedResolverStatus(exe, 'win32', 'x64').reason, 'executable-missing');
        fs.writeFileSync(exe, 'abc');
        assert.equal(resolverUtils.getVerifiedResolverStatus(exe, 'win32', 'x64').reason, 'hash-mismatch');
        const crypto = require('node:crypto');
        const sha = crypto.createHash('sha256').update('abc').digest('hex');
        fs.writeFileSync(`${exe}.verified.json`, JSON.stringify({ schema: 1, platform: 'win32', arch: 'x64', sha256: sha, byteLength: 3, version: '1' }));
        const ok = resolverUtils.getVerifiedResolverStatus(exe, 'win32', 'x64');
        assert.equal(ok.ready, true);
        assert.equal(ok.version, '1');
      }

      console.log('plugin failure reduction tests passed');
    })();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
