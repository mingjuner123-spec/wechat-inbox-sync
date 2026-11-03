'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const helpers = require('../obsidian-plugin/wechat-inbox-sync/src/transcript-segment-utils');
const { extractManagedScript } = require('../obsidian-plugin/wechat-inbox-sync/src/asr-startup-timeout');
const plugin = path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync');
const spoken = text => text.replace(/[\s\p{P}\p{S}]/gu, '');
function body(markdown) { return markdown.replace(/^#{2,3}[^\n]*\n/gm, '').trim(); }

const english = 'Dr. Lee paid 3.14 dollars. The next sentence stays complete! Does the last sentence survive?';
const englishOut = body(helpers.buildUntimedTranscriptMarkdown(english));
assert.equal(englishOut, 'Dr. Lee paid 3.14 dollars.\n\nThe next sentence stays complete!\n\nDoes the last sentence survive?');
for (const input of [
  '前面的句子。' + '这是一段较长没有标点的转写内容需要保留全部识别文字'.repeat(110) + '最后的结尾不能消失',
  'First sentence. ' + 'Keep every original spoken word throughout the second half of this recording '.repeat(110) + 'The final sentence must remain.',
  '这是第一句。Hello world. This is the second sentence! 最后一句必须保留。',
]) {
  const timed = helpers.buildTranscriptSegmentsMarkdown([{ startMs: 120000, endMs: 600000, text: input }]);
  const untimed = helpers.buildUntimedTranscriptMarkdown(input);
  for (const output of [timed, untimed]) {
    assert.equal(spoken(body(output)), spoken(input), 'all words including long segment tails must survive');
    assert.ok(body(output).split('\n\n').every(p => p.length <= 250), 'paragraph density must stay bounded through the tail');
    assert.equal((output.match(/## 分段转写/g) || []).length, 1);
  }
  assert.equal((timed.match(/### \[/g) || []).length, 1, 'never invent sentence timestamps');
  assert.doesNotMatch(untimed, /\[\d\d:\d\d\]/);
}
const validText = '这段真实的内容需要完整保留，不能把用户原话改成个人简介或者总结。';
const noise = [{ startMs: 0, endMs: 1000, text: validText }, { startMs: 1000, endMs: 2000, text: '[music]' }, { startMs: 2000, endMs: 3000, text: '[music]' }];
assert.equal(spoken(body(helpers.buildTranscriptSegmentsMarkdown(noise))), spoken(validText));
assert.ok(helpers.transcriptSegmentsCoverText(noise, validText + '\n[music]\n[music]'));
assert.match(helpers.buildUntimedTranscriptMarkdown(validText + '\n请关注我的频道。'), /请关注我的频道/, 'spoken closing words are not proven noise');
assert.equal(helpers.normalizeTranscriptSegments([{ startMs: null, endMs: null, text: 'unknown timing' }]).length, 0);
assert.equal(helpers.parseTranscriptSegmentsSidecar({ chunks: [{ offsetMs: 0, result: { transcription: [{ offsets: { from: null, to: 2000 }, text: 'bad' }] } }] }).length, 0);

// Execute the actual generated macOS wrapper against fake media binaries.
// This tests sidecar production and ingestion together without user media,
// network access, or installing/replacing an ASR component.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-sidecar-'));
const slash = p => p.replace(/\\/g, '/');
fs.mkdirSync(path.join(scratch, 'bin')); fs.mkdirSync(path.join(scratch, 'models'));
fs.writeFileSync(path.join(scratch, 'models/ggml-small.bin'), 'fixture');
fs.writeFileSync(path.join(scratch, 'input.mp4'), 'fixture');
fs.writeFileSync(path.join(scratch, 'transcribe.sh'), extractManagedScript(fs.readFileSync(path.join(plugin, 'local-asr/install-local-asr-macos.sh'), 'utf8')));
fs.writeFileSync(path.join(scratch, 'bin/ffmpeg'), `#!/bin/bash
if [ "$#" = 3 ]; then echo 'Duration: 00:04:00.00' >&2; exit 0; fi
last="\${!#}"
list=''
while [ "$#" -gt 0 ]; do if [ "$1" = -segment_list ]; then shift; list="$1"; fi; shift; done
touch "\${last//%03d/000}" "\${last//%03d/001}"
printf 'chunk-000.wav,0.000000,120.032000\nchunk-001.wav,120.032000,240.000000\n' > "$list"
`);
fs.writeFileSync(path.join(scratch, 'bin/whisper-cli'), `#!/bin/bash
if [ "\${1:-}" = --help ]; then echo fixture; exit 0; fi
base=''; language=''; json=0
while [ "$#" -gt 0 ]; do
case "$1" in -of) shift; base="$1";; -l) shift; language="$1";; -oj) json=1;; esac
shift
done
printf '%s\n' "$language" >> "$FIXTURE_ARGS"
printf 'A complete sentence. Another sentence.\n' > "$base.txt"
if [ "$json" = 1 ] && [ "\${FIXTURE_MISSING_JSON:-0}" != 1 ]; then
printf '{"transcription":[{"offsets":{"from":100,"to":1200},"text":"A complete sentence."},{"offsets":{"from":1500,"to":3000},"text":"Another sentence."}]}' > "$base.json"
fi
`);
for (const file of ['bin/ffmpeg', 'bin/whisper-cli']) fs.chmodSync(path.join(scratch, file), 0o755);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
function run(missing, language) {
  const result = cp.spawnSync(bash, [slash(path.join(scratch, 'transcribe.sh')), '--input', slash(path.join(scratch, 'input.mp4')), '--output', slash(path.join(scratch, 'output.txt')), '--language', language], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, FIXTURE_ARGS: slash(path.join(scratch, 'args')), FIXTURE_MISSING_JSON: missing ? '1' : '0' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}
run(false, 'en');
const parsed = helpers.parseTranscriptSegmentsSidecar(fs.readFileSync(path.join(scratch, 'output.segments.json'), 'utf8'));
assert.deepEqual(parsed.map(s => s.startMs), [100, 1500, 120132, 121532], 'use actual ffmpeg offsets, not nominal chunk seconds');
assert.ok(helpers.transcriptSegmentsCoverText(parsed, fs.readFileSync(path.join(scratch, 'output.txt'), 'utf8')));
assert.match(helpers.buildTranscriptSegmentsMarkdown(parsed), /### \[02:00\]/);
assert.equal(fs.readFileSync(path.join(scratch, 'args'), 'utf8'), 'en\nen\n');
run(true, 'zh');
assert.equal(fs.existsSync(path.join(scratch, 'output.segments.json')), false, 'missing JSON must clear a previous sidecar');
assert.ok(fs.readFileSync(path.join(scratch, 'output.txt'), 'utf8').includes('Another sentence.'));
if (process.platform === 'win32') {
  const installer = fs.readFileSync(path.join(plugin, 'local-asr/install-local-asr.ps1'), 'utf8');
  const template = installer.match(/\$embeddedTranscribeTemplate = @'\r?\n([\s\S]*?)\r?\n'@/)[1];
  fs.writeFileSync(path.join(scratch, 'windows-template.ps1'), template);
  fs.writeFileSync(path.join(scratch, 'windows-language-test.ps1'), String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:TEST_TEMPLATE, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'generated transcribe script does not parse' }
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-WhisperChunk' }, $true)
Invoke-Expression $function.Extent.Text
function Invoke-NativeProcess { param($FilePath, $Arguments, [switch]$ReportProgress, $ProgressStage, $ProgressCurrent, $ProgressTotal) return ,$Arguments }
$attemptModelPath = 'fixture.bin'; $WhisperThreads = 2; $Whisper = @{ FullName = 'fake-whisper' }
foreach ($lang in @('en', 'zh')) {
  $TranscriptionLanguage = $lang
  $result = Invoke-WhisperChunk -ChunkPath 'input.wav' -ChunkBase 'output' -PathForNative { param($value) $value }
  if ($result[[Array]::IndexOf($result, '-l') + 1] -ne $lang) { throw 'language not forwarded' }
  if ($result -notcontains '-oj') { throw 'timestamp output disabled' }
}
Write-Output 'Windows zh/en arguments passed'
`);
  const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scratch, 'windows-language-test.ps1')], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, TEST_TEMPLATE: path.join(scratch, 'windows-template.ps1') },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Windows zh\/en arguments passed/);
}
console.log('transcript quality handoff: full-text preservation, English/mixed layout, tail cleanup, macOS sidecar and stale-data fallback passed');
