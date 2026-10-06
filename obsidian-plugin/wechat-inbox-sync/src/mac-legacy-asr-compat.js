'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEGACY_WHEEL_INTEL_SHA256 = '08491f7bfa1636ac6f7756c3a6f591225578fa876e6cf97fdc64b7838bc3aa95';
const COMPAT_INTEL_SHA256 = 'e5ffe7edff2b95eee8454e5a1f2db2d7d320fd8c254138e043226dba6dbba8ea';
const COMPAT_INTEL_BYTES = 1366840;
const COMPAT_RELATIVE_PATH = path.join('bin', 'compat', 'v1.5.5', 'x64', 'whisper-cpp');
const WRAPPER_BACKUP_SUFFIX = '.before-macos-legacy-asr-compat-v1';
const MACHO_X86_64_MAGIC = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]);
const WHISPER_CPP_MIT_LICENSE = `MIT License

Copyright (c) 2023-2024 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function digestBytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function digestFile(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function digestFileOrEmpty(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isFile() && !stat.isSymbolicLink() ? digestFile(filePath) : '';
  } catch (_) { return ''; }
}
function macVersionInRange(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (major > 12 || (major === 12 && minor >= 0)) && (major < 13 || (major === 13 && minor < 3));
}
function isSafeShellPath(value) {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value) && !/[\"$`\r\n]/.test(value);
}
function renderManagedWrapper(binaryPath, metalResourcesPath = '') {
  if (!isSafeShellPath(binaryPath) || (metalResourcesPath && !isSafeShellPath(metalResourcesPath))) throw new Error('unsafe-wrapper-path');
  return [
    '#!/usr/bin/env bash',
    `WHISPER_CPP_BIN="${binaryPath}"`,
    `GGML_METAL_RESOURCES_DIR="${metalResourcesPath}"`,
    'if [ -n "$GGML_METAL_RESOURCES_DIR" ] && [ -f "$GGML_METAL_RESOURCES_DIR/ggml-metal.metal" ]; then',
    '  export GGML_METAL_PATH_RESOURCES="$GGML_METAL_RESOURCES_DIR"',
    '  exec "$WHISPER_CPP_BIN" "$@"',
    'fi',
    'exec "$WHISPER_CPP_BIN" --no-gpu "$@"',
    '',
  ].join('\n');
}
function parseManagedWrapper(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^#!\/usr\/bin\/env bash\nWHISPER_CPP_BIN="([^"\r\n]+)"\nGGML_METAL_RESOURCES_DIR="([^"\r\n]*)"\n/);
  if (!match) return null;
  try { if (renderManagedWrapper(match[1], match[2]) !== normalized) return null; }
  catch (_) { return null; }
  return { binaryPath: match[1], metalResourcesPath: match[2] };
}
function wrapperPathFor(root) { return path.join(root, 'bin', 'whisper-cli'); }
function compatPathFor(root) { return path.join(root, COMPAT_RELATIVE_PATH); }
function readManagedWrapper(root) {
  const wrapperPath = wrapperPathFor(root);
  try {
    const stat = fs.lstatSync(wrapperPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const text = fs.readFileSync(wrapperPath, 'utf8');
    const parsed = parseManagedWrapper(text);
    return parsed ? { wrapperPath, text, ...parsed } : null;
  } catch (_) { return null; }
}
function validateMachOBytes(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 8
    && bytes.subarray(0, 4).equals(MACHO_X86_64_MAGIC)
    && bytes.readInt32LE(4) === 0x01000007;
}
function ensureCompatLicense(directory) {
  const target = path.join(directory, 'LICENSE.txt');
  const contents = Buffer.from(WHISPER_CPP_MIT_LICENSE, 'utf8');
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    return fs.readFileSync(target).equals(contents);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return false;
    try { fs.writeFileSync(target, contents, { flag: 'wx', mode: 0o600 }); return true; }
    catch (_) {
      try { const stat = fs.lstatSync(target); return stat.isFile() && !stat.isSymbolicLink() && fs.readFileSync(target).equals(contents); } catch (_) { return false; }
    }
  }
}
function inspectCandidate(candidatePath) {
  try {
    const stat = fs.lstatSync(candidatePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform === 'darwin' && (stat.mode & 0o111) === 0)) return { valid: false, reason: 'candidate-not-executable-file' };
    if (stat.size !== COMPAT_INTEL_BYTES) return { valid: false, reason: 'candidate-byte-length-mismatch' };
    if (digestFile(candidatePath) !== COMPAT_INTEL_SHA256) return { valid: false, reason: 'candidate-sha256-mismatch' };
    const fd = fs.openSync(candidatePath, 'r');
    let header;
    try { header = Buffer.alloc(8); fs.readSync(fd, header, 0, 8, 0); } finally { fs.closeSync(fd); }
    if (!validateMachOBytes(header)) return { valid: false, reason: 'candidate-not-thin-x86_64-macho' };
    return { valid: true, reason: 'candidate-verified' };
  } catch (error) { return { valid: false, reason: error && error.code === 'ENOENT' ? 'candidate-missing' : 'candidate-unreadable' }; }
}
function inspectMacLegacyAsr(options = {}) {
  const { platform, arch, macOSVersion, managed, installRoot, runtimeIdentity } = options;
  const compatPath = installRoot ? compatPathFor(installRoot) : null;
  const base = { eligible: false, alreadyActive: false, status: 'not-applicable', reason: 'not-target-runtime', originalBinaryPath: null,
    compatPath, expectedCompatSha256: COMPAT_INTEL_SHA256, expectedCompatByteLength: COMPAT_INTEL_BYTES };
  if (platform !== 'darwin' || arch !== 'x64' || !macVersionInRange(macOSVersion)) return base;
  if (managed !== true || !installRoot) return { ...base, status: 'blocked', reason: 'not-managed-install' };
  if (!isSafeShellPath(path.resolve(installRoot))) return { ...base, status: 'blocked', reason: 'unsafe-install-root' };
  const wrapper = readManagedWrapper(installRoot);
  const reportedBinary = String(runtimeIdentity && runtimeIdentity.binary || '');
  if (!wrapper || !path.isAbsolute(wrapper.binaryPath) || path.resolve(wrapper.binaryPath) !== path.resolve(reportedBinary)) {
    return { ...base, status: 'blocked', reason: 'unknown-or-custom-wrapper' };
  }
  const actualHash = digestFileOrEmpty(wrapper.binaryPath);
  const reportedHash = String(runtimeIdentity && runtimeIdentity.binarySha256 || '').toLowerCase();
  if (path.resolve(wrapper.binaryPath) === path.resolve(compatPath) && actualHash === COMPAT_INTEL_SHA256) {
    return { ...base, status: 'already-active', alreadyActive: true, reason: 'compat-already-active' };
  }
  if (!actualHash || actualHash !== LEGACY_WHEEL_INTEL_SHA256 || reportedHash !== actualHash) {
    return { ...base, status: 'blocked', reason: 'native-binary-not-known-legacy-wheel', originalBinaryPath: wrapper.binaryPath };
  }
  const candidate = inspectCandidate(compatPath);
  return { ...base, eligible: true, status: candidate.valid ? 'ready-to-activate' : 'needs-download', reason: candidate.reason,
    originalBinaryPath: wrapper.binaryPath, originalBinarySha256: actualHash, wrapperPath: wrapper.wrapperPath };
}
function installMacLegacyAsrCompat(options = {}) {
  const { installRoot, bytes } = options;
  if (!installRoot || !isSafeShellPath(path.resolve(installRoot)) || !Buffer.isBuffer(bytes)) return { installed: false, reason: 'invalid-install-input' };
  if (bytes.length !== COMPAT_INTEL_BYTES) return { installed: false, reason: 'candidate-byte-length-mismatch' };
  if (digestBytes(bytes) !== COMPAT_INTEL_SHA256) return { installed: false, reason: 'candidate-sha256-mismatch' };
  if (!validateMachOBytes(bytes)) return { installed: false, reason: 'candidate-not-thin-x86_64-macho' };
  const candidatePath = compatPathFor(installRoot);
  const directory = path.dirname(candidatePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const existing = inspectCandidate(candidatePath);
  if (existing.valid) return ensureCompatLicense(directory)
    ? { installed: true, reason: 'candidate-already-installed', candidatePath }
    : { installed: false, reason: 'compat-license-missing-or-mismatched', candidatePath };
  if (existing.reason !== 'candidate-missing') return { installed: false, reason: 'existing-candidate-invalid', candidatePath };
  const temporary = `${candidatePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o700);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.chmodSync(temporary, 0o700);
    const verified = inspectCandidate(temporary);
    if (!verified.valid) { fs.unlinkSync(temporary); return { installed: false, reason: verified.reason }; }
    fs.renameSync(temporary, candidatePath);
    if (!ensureCompatLicense(directory)) return { installed: false, reason: 'compat-license-missing-or-mismatched', candidatePath };
    return { installed: true, reason: 'candidate-installed', candidatePath };
  } catch (_) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(temporary); } catch (_) {}
    return { installed: false, reason: 'candidate-atomic-install-failed' };
  }
}
function restoreWrapper(wrapperPath, contents) {
  const tempPath = `${wrapperPath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.rollback.tmp`;
  let fd;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o700); fs.writeFileSync(fd, contents); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.chmodSync(tempPath, 0o700); fs.renameSync(tempPath, wrapperPath); return true;
  } catch (_) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(tempPath); } catch (_) {}
    return false;
  }
}
function activateMacLegacyAsrCompat(options = {}) {
  const { installRoot, candidatePath } = options;
  if (!installRoot || !isSafeShellPath(path.resolve(installRoot)) || !candidatePath || path.resolve(candidatePath) !== path.resolve(compatPathFor(installRoot))) return { applied: false, reason: 'candidate-path-not-managed' };
  const candidate = inspectCandidate(candidatePath);
  if (!candidate.valid) return { applied: false, reason: candidate.reason };
  const wrapper = readManagedWrapper(installRoot);
  if (!wrapper) return { applied: false, reason: 'unknown-or-custom-wrapper' };
  const oldHash = digestFileOrEmpty(wrapper.binaryPath);
  if (path.resolve(wrapper.binaryPath) === path.resolve(candidatePath) && oldHash === COMPAT_INTEL_SHA256) return { applied: true, reason: 'already-active' };
  if (oldHash !== LEGACY_WHEEL_INTEL_SHA256) return { applied: false, reason: 'native-binary-not-known-legacy-wheel' };
  const backupPath = wrapper.wrapperPath + WRAPPER_BACKUP_SUFFIX;
  try {
    if (fs.existsSync(backupPath)) {
      const backupStat = fs.lstatSync(backupPath);
      if (!backupStat.isFile() || backupStat.isSymbolicLink()) return { applied: false, reason: 'wrapper-backup-not-regular-file' };
      if (fs.readFileSync(backupPath, 'utf8').replace(/\r\n/g, '\n') !== wrapper.text.replace(/\r\n/g, '\n')) return { applied: false, reason: 'wrapper-backup-mismatch' };
    } else fs.writeFileSync(backupPath, wrapper.text, { flag: 'wx', mode: 0o700 });
    const currentWrapper = readManagedWrapper(installRoot);
    if (!currentWrapper || currentWrapper.text !== wrapper.text) return { applied: false, reason: 'wrapper-changed-before-switch' };
    const tempPath = `${wrapper.wrapperPath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
    let fd;
    try {
      fd = fs.openSync(tempPath, 'wx', 0o700);
      fs.writeFileSync(fd, renderManagedWrapper(candidatePath, ''));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.chmodSync(tempPath, 0o700);
      fs.renameSync(tempPath, wrapper.wrapperPath);
    } catch (error) {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(tempPath); } catch (_) {}
      throw error;
    }
    const after = readManagedWrapper(installRoot);
    if (!after || path.resolve(after.binaryPath) !== path.resolve(candidatePath) || digestFileOrEmpty(after.binaryPath) !== COMPAT_INTEL_SHA256) {
      const rolledBack = restoreWrapper(wrapper.wrapperPath, wrapper.text);
      return { applied: false, reason: rolledBack ? 'post-switch-readback-failed-rolled-back' : 'post-switch-readback-and-rollback-failed' };
    }
    return { applied: true, reason: 'compat-activated', wrapperBackupPath: backupPath, compatPath: candidatePath };
  } catch (_) { return { applied: false, reason: 'atomic-wrapper-switch-failed' }; }
}
module.exports = { LEGACY_WHEEL_INTEL_SHA256, COMPAT_INTEL_SHA256, COMPAT_INTEL_BYTES, COMPAT_RELATIVE_PATH,
  macVersionInRange, isSafeShellPath, renderManagedWrapper, parseManagedWrapper, inspectMacLegacyAsr, installMacLegacyAsrCompat, activateMacLegacyAsrCompat };
