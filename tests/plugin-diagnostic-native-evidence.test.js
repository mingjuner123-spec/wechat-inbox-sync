'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const collector = require('../obsidian-plugin/wechat-inbox-sync/src/diagnostic-native-evidence');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-diagnostic-native-evidence-'));
const reports = path.join(scratch, 'reports');
fs.mkdirSync(reports, { recursive: true });
const textReports = path.join(scratch, 'text-reports');
fs.mkdirSync(textReports, { recursive: true });
const startedAt = '2026-10-10T07:59:00.000Z';
const finishedAt = '2026-10-10T07:59:30.000Z';
const binaryPath = '/Applications/Whisper/whisper-cli';
const binaryPathSha256 = crypto.createHash('sha256').update(binaryPath).digest('hex');
const attempt = {
  attempt: 1,
  status: 'failed',
  stage: 'transcribing',
  startedAt,
  finishedAt,
  nativePids: [123],
};
const session = {
  platform: 'darwin',
  startedAt,
  finishedAt,
  runtime: { binaryPathSha256 },
  attempts: [attempt],
};

function writeJsonReport(directory, name, value, mtime = finishedAt) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify(value));
  const time = new Date(mtime);
  fs.utimesSync(file, time, time);
  return file;
}

function writeIpsReport(directory, name, metadata, value, mtime = finishedAt) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify(metadata) + '\n' + JSON.stringify(value));
  const time = new Date(mtime);
  fs.utimesSync(file, time, time);
  return file;
}

function writeTextReport(directory, name, value, mtime = finishedAt) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, value);
  const time = new Date(mtime);
  fs.utimesSync(file, time, time);
  return file;
}

async function run() {
  const ips = {
    pid: 123,
    procName: 'whisper-cli',
    procPath: binaryPath,
    captureTime: finishedAt,
    exception: { type: 'EXC_BAD_ACCESS', token: 'should-be-redacted' },
    termination: { namespace: 'SIGNAL', code: 11 },
    faultingThread: 0,
    threads: [{
      frames: [
        { symbol: 'fixture_stack_frame', imageIndex: 1, imageOffset: 8 },
        { symbol: 'ggml_compute', imageIndex: 1, imageOffset: 9 },
      ],
    }],
    usedImages: [{
      name: '/Users/alice/private/libunused.dylib',
      path: '/Users/alice/private/libunused.dylib',
      uuid: 'unused-uuid',
      arch: 'x86_64',
      base: 2048,
      size: 64,
    }, {
      name: '/Users/alice/private/libwhisper.dylib',
      path: '/Users/alice/private/libwhisper.dylib',
      uuid: 'fixture-uuid',
      arch: 'x86_64',
      base: 4096,
      size: 123,
    }],
  };
  writeIpsReport(reports, 'whisper-cli-matched.ips', { bug_type: 309, fixture: 'metadata' }, ips);

  const matched = collector.collectNativeCrashEvidence({
    session,
    attempt,
    directories: [reports],
    settings: { token: 'should-be-redacted' },
  });
  assert.equal(matched.status, 'matched');
  assert.equal(matched.truncated, false);
  assert.ok(matched.originalBytes > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(matched), 'utf8') <= collector.DEFAULT_MAX_BYTES);
  assert.equal(matched.format, 'ips');
  assert.equal(matched.pid, 123);
  assert.equal(matched.association.reliability, 'same_attempt_pid_and_time');
  assert.equal(matched.faultThread.frames.length, 2);
  assert.equal(matched.faultThread.frames[0].symbol, 'fixture_stack_frame');
  assert.equal(matched.modules.items[0].name, 'libwhisper.dylib');
  assert.equal(matched.modules.items[0].index, 1);
  assert.ok(matched.modules.items.some(module => module.name === 'libunused.dylib' && module.index === 0));
  assert.ok(matched.summary.includes('same_attempt_pid_and_time'));
  assert.ok(!JSON.stringify(matched).includes('should-be-redacted'));
  assert.ok(!JSON.stringify(matched).includes('/Users/alice/private'));
  const nullFaultThreadReports = path.join(scratch, 'null-fault-thread-reports');
  fs.mkdirSync(nullFaultThreadReports, { recursive: true });
  writeIpsReport(nullFaultThreadReports, 'whisper-cli-null-fault-thread.ips', { bug_type: 309, fixture: 'null-fault-thread' }, { ...ips, faultingThread: null });
  const nullFaultThreadEvidence = collector.collectNativeCrashEvidence({ session, attempt, directories: [nullFaultThreadReports] });
  assert.equal(nullFaultThreadEvidence.status, 'matched');
  assert.equal(nullFaultThreadEvidence.faultThread.thread, null);
  assert.deepEqual(nullFaultThreadEvidence.faultThread.frames, []);
  const lateReports = path.join(scratch, 'late-reports');
  fs.mkdirSync(lateReports, { recursive: true });
  const lateCapture = finishedAt;
  const lateMtime = new Date(Date.parse(finishedAt) + 1000).toISOString();
  writeIpsReport(lateReports, 'whisper-cli-late.ips', { bug_type: 309, fixture: 'late-mtime' }, { ...ips, captureTime: lateCapture }, lateMtime);
  const lateMtimeMatch = collector.collectNativeCrashEvidence({ session, attempt, directories: [lateReports] });
  assert.equal(lateMtimeMatch.status, 'matched');
  assert.equal(lateMtimeMatch.pid, 123);
  assert.equal(lateMtimeMatch.association.reliability, 'same_attempt_pid_and_time');
  const beyondGraceReports = path.join(scratch, 'beyond-grace-reports');
  fs.mkdirSync(beyondGraceReports, { recursive: true });
  const beyondGraceMtime = new Date(Date.parse(finishedAt) + 300001).toISOString();
  writeIpsReport(beyondGraceReports, 'whisper-cli-beyond-grace.ips', { bug_type: 309, fixture: 'beyond-grace' }, { ...ips, captureTime: lateCapture }, beyondGraceMtime);
  const beyondGrace = collector.collectNativeCrashEvidence({ session, attempt, directories: [beyondGraceReports] });
  assert.equal(beyondGrace.status, 'unavailable');
  assert.equal(beyondGrace.unavailableReason, 'no_report_matching_time_and_native_pid');

  const wrongEngineDirectory = path.join(scratch, 'wrong-engine');
  fs.mkdirSync(wrongEngineDirectory);
  writeJsonReport(wrongEngineDirectory, 'whisper-cli-wrong.ips', {
    ...ips,
    procPath: '/Applications/Other/whisper-cli',
    exception: { type: 'WRONG_ENGINE' },
  });
  const wrongEngine = collector.collectNativeCrashEvidence({
    session,
    attempt,
    directories: [wrongEngineDirectory],
  });
  assert.equal(wrongEngine.status, 'unavailable');
  assert.equal(wrongEngine.unavailableReason, 'no_report_matching_time_and_native_pid');

  const multipleAttempts = collector.collectNativeCrashEvidence({
    session: { ...session, attempts: [attempt, { ...attempt, attempt: 2, nativePids: [124] }] },
    directories: [reports],
  });
  assert.equal(multipleAttempts.status, 'unavailable');
  assert.equal(multipleAttempts.unavailableReason, 'attempt_not_provided');

  const windows = collector.collectNativeCrashEvidence({
    session: { ...session, platform: 'win32' },
    attempt,
    directories: [reports],
  });
  assert.equal(windows.status, 'not_applicable');
  assert.equal(windows.unavailableReason, 'platform_not_macos');

  const text = [
    'Process: whisper-cli [123]',
    'Path: /Applications/Whisper/whisper-cli',
    'Date/Time: ' + finishedAt,
    'Exception Type: EXC_BAD_ACCESS',
    'Crashed Thread: 2',
    'Thread 0:',
    '0   libsystem 0x00000000 NORMAL_BEFORE',
    'Thread 2 Crashed:: Dispatch queue: com.apple.main',
    '0   libwhisper 0x00000002 CRASHED_FRAME',
    '1   ggml 0x00000003 CRASHED_SECOND',
    '2   whisper 0x00000004 CRASHED_THIRD',
    'Thread 3:',
    '0   libsystem 0x00000003 NORMAL_AFTER',
    'Binary Images:',
    '0x00000000 - 0x00000010 libwhisper.dylib x86_64',
    '0x00000011 - 0x00000020 ggml.dylib x86_64',
  ].join('\n');
  writeTextReport(textReports, 'whisper-cli-thread.crash', text);
  const textEvidence = collector.collectNativeCrashEvidence({
    session,
    attempt,
    directories: [textReports],
  });
  assert.equal(textEvidence.status, 'matched');
  assert.equal(textEvidence.format, 'crash');
  assert.equal(textEvidence.faultThread.lines.length, 4);
  assert.ok(textEvidence.faultThread.lines.some(line => line.includes('CRASHED_THIRD')));
  assert.equal(textEvidence.modules.lines.length, 3);
  assert.ok(textEvidence.modules.lines.some(line => line.includes('libwhisper.dylib')));

  const largeDirectory = path.join(scratch, 'large');
  fs.mkdirSync(largeDirectory);
  writeIpsReport(largeDirectory, 'whisper-cli-large.ips', { bug_type: 309, fixture: 'metadata' }, {
    ...ips,
    threads: [{
      frames: Array.from({ length: 5000 }, (_, index) => ({ symbol: 'frame_' + index, imageIndex: 0, imageOffset: index })),
    }],
    usedImages: Array.from({ length: 5000 }, (_, index) => ({
      name: '/Users/alice/private/module-' + index + '.dylib',
      uuid: 'uuid-' + index,
      arch: 'x86_64',
      base: index,
      size: 10,
    })),
  }, '2026-10-10T07:59:29.000Z');
  const limited = collector.collectNativeCrashEvidence({
    session,
    attempt,
    directories: [largeDirectory],
    maxBytes: 16 * 1024,
  });
  assert.equal(limited.status, 'matched');
  assert.equal(limited.truncated, true);
  assert.ok(limited.originalBytes > 16 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(limited), 'utf8') <= 16 * 1024);
  assert.ok(limited.faultThread.frames.length < 5000);
  assert.ok(limited.faultThread.framesOmitted > 0 || limited.modules.itemsOmitted > 0);

  console.log('PASS: native crash evidence keeps strict PID/time/engine matching, full bounded fault thread/modules, explicit missing states, Windows fallback, and credential/path redaction');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});