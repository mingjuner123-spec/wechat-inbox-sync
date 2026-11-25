'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

// Windows Smart App Control (SAC) blocks unsigned executables and DLLs. The
// local ASR bundle ships unsigned whisper.cpp binaries, so an affected machine
// stops with 0xC0E90002 (STATUS_SYSTEM_INTEGRITY_POLICY_VIOLATION) no matter
// how the files were downloaded. Detect the policy up front and point the user
// at the exact settings page instead of surfacing a raw hex code.
const SMART_APP_CONTROL_REGISTRY_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy';
const SMART_APP_CONTROL_REGISTRY_VALUE = 'VerifiedAndReputablePolicyState';
const SMART_APP_CONTROL_SETTINGS_URI = 'windowsdefender://smartapp/';
const SMART_APP_CONTROL_EXIT_CODES = Object.freeze(['0XC0E90002', '0XC0000428']);
const SMART_APP_CONTROL_EXIT_DECIMALS = Object.freeze(['-1058471934', '-1073740760']);

function smartAppControlGuidance() {
  return '本地组件因 Windows 智能应用控制或代码完整性检查而暂停。请保留安全设置和任务编号，以便排查组件兼容性。';
}

// `reg query` prints "VerifiedAndReputablePolicyState    REG_DWORD    0x1".
// 0 = off, 1 = enforced, 2 = evaluation; a missing value means SAC is absent.
function parseSmartAppControlPolicyState(stdout) {
  const match = String(stdout || '').match(
    /VerifiedAndReputablePolicyState\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)/i,
  );
  if (!match) return null;
  const raw = match[1];
  const value = /^0x/i.test(raw) ? parseInt(raw.slice(2), 16) : parseInt(raw, 10);
  if (value === 0) return 'off';
  if (value === 1) return 'on';
  if (value === 2) return 'evaluation';
  return null;
}

function isSmartAppControlBlockingMessage(value) {
  const text = String(value || '');
  if (!text) return false;
  const upper = text.toUpperCase();
  return SMART_APP_CONTROL_EXIT_CODES.some((code) => upper.includes(code))
    || SMART_APP_CONTROL_EXIT_DECIMALS.some((code) => text.includes(code))
    || /smart app control|智能应用控制/i.test(text);
}

function resolveRegPath() {
  const roots = [process.env.SystemRoot, process.env.windir].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, 'System32', 'reg.exe');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) { /* fall through to PATH */ }
  }
  return 'reg.exe';
}

function getSmartAppControlState(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return Promise.resolve(null);
  const execFile = options.execFile || childProcess.execFile;
  return new Promise((resolve) => {
    try {
      execFile(
        resolveRegPath(),
        ['query', SMART_APP_CONTROL_REGISTRY_KEY, '/v', SMART_APP_CONTROL_REGISTRY_VALUE],
        { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          resolve(parseSmartAppControlPolicyState(stdout));
        },
      );
    } catch (_) {
      resolve(null);
    }
  });
}

module.exports = {
  SMART_APP_CONTROL_REGISTRY_KEY,
  SMART_APP_CONTROL_REGISTRY_VALUE,
  SMART_APP_CONTROL_SETTINGS_URI,
  getSmartAppControlState,
  isSmartAppControlBlockingMessage,
  parseSmartAppControlPolicyState,
  smartAppControlGuidance,
};
