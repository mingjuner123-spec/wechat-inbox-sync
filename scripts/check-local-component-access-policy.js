#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'obsidian-plugin', 'wechat-inbox-sync');
const RUNTIME_FILES = Object.freeze([
  path.join(PLUGIN_ROOT, 'src', 'main.js'),
  path.join(PLUGIN_ROOT, 'main.js'),
  path.join(PLUGIN_ROOT, 'local-asr', 'install-local-asr.ps1'),
  path.join(PLUGIN_ROOT, 'local-asr', 'install-local-asr-macos.sh'),
  path.join(PLUGIN_ROOT, 'local-ocr', 'install-local-ocr.ps1'),
  path.join(PLUGIN_ROOT, 'local-ocr', 'install-local-ocr-macos.sh'),
]);
const WORKFLOW_FILES = Object.freeze([
  path.join(REPO_ROOT, '.github', 'workflows', 'main-guards.yml'),
  path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'),
  path.join(REPO_ROOT, '.github', 'workflows', 'component-integrity.yml'),
]);
const PUBLIC_CLOUDBASE_HOST_PATTERN = /(?:tcloudbaseapp\.com|tcb\.qcloud\.la)/i;
const RETIRED_PUBLIC_CHECK_PATTERN = /node\s+scripts\/check-local-(?:components|ocr)-cdn\.js/i;

function readRequiredFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`required file is missing: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function assertContains(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`${label}: required secure-download marker is missing`);
}

function checkAccessPolicy({ runtimeFiles = RUNTIME_FILES, workflowFiles = WORKFLOW_FILES } = {}) {
  for (const filePath of runtimeFiles) {
    const source = readRequiredFile(filePath);
    if (PUBLIC_CLOUDBASE_HOST_PATTERN.test(source)) {
      throw new Error(`${path.relative(REPO_ROOT, filePath)}: public CloudBase static host is forbidden`);
    }
  }

  const pluginSource = readRequiredFile(path.join(PLUGIN_ROOT, 'src', 'main.js'));
  const builtPlugin = readRequiredFile(path.join(PLUGIN_ROOT, 'main.js'));
  for (const [source, label] of [[pluginSource, 'plugin source'], [builtPlugin, 'built plugin']]) {
    assertContains(source, /LOCAL_COMPONENT_MANIFEST_PATH\s*=\s*['"]\/local-components\/manifest['"]/, label);
    assertContains(source, /WECHAT_INBOX_DISABLE_PUBLIC_CLOUDBASE_CDN/, label);
    assertContains(source, /getAuthorizedLocalComponentManifest/, label);
  }

  for (const filePath of workflowFiles) {
    const source = readRequiredFile(filePath);
    if (RETIRED_PUBLIC_CHECK_PATTERN.test(source)) {
      throw new Error(`${path.relative(REPO_ROOT, filePath)}: retired public CDN verifier is still executable`);
    }
    assertContains(source, /node\s+scripts\/check-local-component-access-policy\.js/, path.relative(REPO_ROOT, filePath));
  }

  return {
    runtimeFileCount: runtimeFiles.length,
    workflowFileCount: workflowFiles.length,
  };
}

function runCli() {
  try {
    const result = checkAccessPolicy();
    process.stdout.write(
      `Local component access policy passed (${result.runtimeFileCount} runtime files, ${result.workflowFileCount} workflows).\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`LOCAL_COMPONENT_ACCESS_POLICY_FAILED: ${error.message || error}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  PUBLIC_CLOUDBASE_HOST_PATTERN,
  RETIRED_PUBLIC_CHECK_PATTERN,
  RUNTIME_FILES,
  WORKFLOW_FILES,
  checkAccessPolicy,
  runCli,
};
