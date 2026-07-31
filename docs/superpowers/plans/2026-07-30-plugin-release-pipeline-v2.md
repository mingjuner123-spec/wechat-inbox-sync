# Plugin Release Pipeline V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic plugin candidate pipeline so local testing, root marketplace mirrors, committed promotion evidence, tags, GitHub Release assets, and ZIP contents all resolve to one verified content identity.

**Architecture:** The canonical source remains `obsidian-plugin/wechat-inbox-sync/`. A pure Node core enumerates and hashes the complete release package, local commands prepare/install/verify/promote immutable candidates, and `release-candidate.json` carries the tested identity through Git and CI. The existing prepublish gate remains strict about local annotated tags; postpublish derives expected bytes from a trusted commit and proves the remote annotated tag through GitHub API plus `ls-remote`.

**Tech Stack:** Node.js CommonJS, `node:test`, PowerShell 5.1+, GitHub Actions YAML, Git/GitHub Release APIs.

---

## File structure

- Create `scripts/plugin-release-candidate-core.js`: pure path, enumeration, normalization, hashing, identity, and comparison functions.
- Create `scripts/prepare-plugin-release-candidate.js`: atomically create `.artifacts/plugin/<candidate-id>/`.
- Create `scripts/verify-plugin-release-candidate.js`: read-only verification CLI.
- Create `scripts/sync-plugin-release-mirror.js`: one-way canonical source to root loose assets.
- Create `scripts/promote-plugin-release-candidate.js`: verify tested candidate and atomically write root mirror plus `release-candidate.json`.
- Create `scripts/install-plugin-release-candidate.ps1`: transactional local installation with full managed-set rollback.
- Create `tests/plugin-release-candidate.test.js`: cross-platform core/CLI tests and Windows-only installer behavior probes.
- Create `release-candidate.json`: deterministic identity of the current `1.3.74` package baseline.
- Modify `.gitignore`: ignore only root `/.artifacts/`.
- Modify `.github/workflows/main-guards.yml`: candidate/mirror/receipt gates and Windows installer behavior.
- Modify `.github/workflows/release.yml`: package from verified candidate bytes and run remote-authority postpublish.
- Modify `scripts/check-plugin-release-identity.js`: separate local prepublish tag evidence from remote postpublish evidence.
- Modify `scripts/plugin-release-identity-core.js`: trusted commit/tag-object validation.
- Modify `tests/plugin-release-identity.test.js`: Runner-local lightweight/missing tag regression and remote tag-move failures.
- Modify `tests/release-governance.test.js`: workflow and PowerShell parser/Windows job contracts.
- Modify `tests/plugin-main-ai.test.js`: fixed-clock entitlement fixtures only; no production source change.
- Modify `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`: candidate prepare/install/verify/promote and tag checks.
- Modify `docs/DECISIONS.md`: permanent release candidate promotion contract.
- Modify `docs/WORKLOG.md`: one L2 closeout result after verification.

### Task 1: Lock governance boundaries and candidate filesystem rules

**Files:**
- Modify: `.gitignore`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/task-cards/plugin-release-pipeline-v2-001.md`
- Test: `tests/plugin-release-candidate.test.js`

- [ ] **Step 1: Write the failing ignore and path-policy tests**

Create `tests/plugin-release-candidate.test.js` with the first contracts:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('root artifacts directory is ignored without hiding nested source directories', () => {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/\.artifacts\/$/m);
  assert.doesNotMatch(gitignore, /^\*?\.artifacts/m);
});

test('candidate task card includes every permanent governance path', () => {
  const card = fs.readFileSync(
    path.join(repoRoot, 'docs/task-cards/plugin-release-pipeline-v2-001.md'),
    'utf8',
  );
  for (const required of [
    '.gitignore',
    'release-candidate.json',
    'docs/DECISIONS.md',
    'docs/WORKLOG.md',
    'obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md',
  ]) {
    assert.ok(card.includes(required), `missing allowed path: ${required}`);
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node tests/plugin-release-candidate.test.js
```

Expected: FAIL because `.gitignore` does not exist.

- [ ] **Step 3: Add the narrow ignore rule and permanent decision**

Create `.gitignore`:

```gitignore
/.artifacts/
```

Append a decision to `docs/DECISIONS.md` stating:

```markdown
## 2026-07-30: Tested plugin candidates require committed promotion evidence

- `obsidian-plugin/wechat-inbox-sync/` remains the only human-edited plugin source.
- Local testing uses an immutable candidate under ignored `/.artifacts/`.
- A candidate may enter PR/tag/Release only after promotion writes deterministic `release-candidate.json`.
- Main, prepublish, and postpublish recompute the complete package identity from the trusted commit.
- Root loose assets are generated mirrors, never a second source.
```

- [ ] **Step 4: Run the test and verify GREEN**

Run `node tests/plugin-release-candidate.test.js`.

Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore docs/DECISIONS.md docs/task-cards/plugin-release-pipeline-v2-001.md tests/plugin-release-candidate.test.js
git commit -m "test: define plugin candidate governance boundary"
```

### Task 2: Implement deterministic full-package identity

**Files:**
- Create: `scripts/plugin-release-candidate-core.js`
- Modify: `tests/plugin-release-candidate.test.js`

- [ ] **Step 1: Write failing tests for canonical package enumeration**

Add tests that build a real temporary package tree containing loose assets, README, LICENSE, `local-asr/`, and `local-ocr/`. The expected API is:

```js
const {
  PACKAGE_ROOT_FILES,
  enumeratePackageEntries,
  buildCandidateIdentity,
  encodeAggregateEntries,
  validateCandidateIdentity,
} = require('../scripts/plugin-release-candidate-core');

test('candidate identity covers exact release ZIP files with deterministic POSIX paths', () => {
  const entries = enumeratePackageEntries(fixture.pluginRoot);
  assert.deepEqual(entries.map((entry) => entry.path), [
    'LICENSE',
    'README.md',
    'local-asr/install-local-asr-macos.sh',
    'local-asr/install-local-asr.ps1',
    'local-ocr/install-local-ocr-macos.sh',
    'local-ocr/install-local-ocr.ps1',
    'main.js',
    'manifest.json',
    'styles.css',
    'versions.json',
  ]);

  const identity = buildCandidateIdentity({
    pluginId: 'wechat-inbox-sync',
    pluginVersion: '9.9.9',
    sourceRoot: 'obsidian-plugin/wechat-inbox-sync',
    entries,
  });
  assert.equal(identity.candidateId, `9.9.9-${identity.aggregateSha256.slice(0, 16)}`);
  assert.equal(validateCandidateIdentity(identity), true);
});
```

Add negative tests for:

- `..`, absolute, backslash, empty segment, duplicate and non-NFC paths;
- Windows case-fold collisions such as `A.js` and `a.js`;
- symlink/junction/reparse entries and other non-regular files;
- directory name escaping `local-asr`/`local-ocr`;
- candidate ID, directory name, byte count, entry SHA, or aggregate SHA drift;
- CRLF and LF source text producing identical staged bytes and identity.

- [ ] **Step 2: Run tests and verify RED**

Run `node tests/plugin-release-candidate.test.js`.

Expected: FAIL because `plugin-release-candidate-core.js` does not exist.

- [ ] **Step 3: Implement the minimal pure core**

Implement these exports:

```js
const LOOSE_ASSETS = Object.freeze([
  'main.js',
  'manifest.json',
  'styles.css',
  'versions.json',
]);

const PACKAGE_ROOT_FILES = Object.freeze([
  ...LOOSE_ASSETS,
  'README.md',
  'LICENSE',
]);

const PACKAGE_DIRECTORIES = Object.freeze(['local-asr', 'local-ocr']);
const CANDIDATE_HASH_PREFIX_LENGTH = 16;

function normalizeRelativePackagePath(input) {
  const normalized = String(input).normalize('NFC');
  // Reject absolute paths, drive prefixes, backslashes, empty/. /.. segments.
  return normalized;
}

function encodeField(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  return Buffer.concat([Buffer.from(`${bytes.length}:`, 'ascii'), bytes]);
}

function encodeAggregateEntries(entries) {
  const chunks = [Buffer.from('WECHAT_INBOX_RELEASE_CANDIDATE_V1\0', 'ascii')];
  for (const entry of entries) {
    chunks.push(
      encodeField(entry.path),
      encodeField(String(entry.bytes)),
      encodeField(entry.sha256),
    );
  }
  return Buffer.concat(chunks);
}
```

Sort paths by `Buffer.compare(Buffer.from(path, 'utf8'), ...)`, reject case-fold/NFC collisions before hashing, use `lstatSync` and reject symbolic links/reparse aliases/non-regular files. Normalize known text files (`.js`, `.json`, `.css`, `.md`, `.ps1`, `.sh`, `.py`, plus `LICENSE`) from CRLF/CR to LF before hashing and staging.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
node tests/plugin-release-candidate.test.js
node --check scripts/plugin-release-candidate-core.js
```

Expected: all candidate core tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/plugin-release-candidate-core.js tests/plugin-release-candidate.test.js
git commit -m "feat: add deterministic plugin package identity"
```

### Task 3: Prepare and verify immutable local candidates

**Files:**
- Create: `scripts/prepare-plugin-release-candidate.js`
- Create: `scripts/verify-plugin-release-candidate.js`
- Modify: `tests/plugin-release-candidate.test.js`

- [ ] **Step 1: Write failing real-filesystem CLI tests**

Tests must invoke the CLIs against temporary copied fixture repositories and assert:

```js
test('prepare creates an immutable full-package candidate and reuses identical identity', () => {
  const first = runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', fixture.artifactsRoot,
  ]);
  assert.equal(first.status, 0, first.stderr);

  const receipt = JSON.parse(first.stdout);
  assert.match(receipt.candidateId, /^9\.9\.9-[a-f0-9]{16}$/);
  assert.ok(fs.existsSync(path.join(receipt.candidateDirectory, 'candidate.json')));
  assert.ok(fs.existsSync(path.join(receipt.candidateDirectory, 'package/local-asr/install-local-asr.ps1')));

  const second = runNode(/* same args */);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).candidateId, receipt.candidateId);
});
```

Add tests proving:

- different content cannot overwrite an existing candidate directory;
- partial temp directories are not reported as valid candidates;
- `candidate.json` provenance changes do not change deterministic identity;
- verify fails on source/package/root/install/receipt controlled-file drift;
- verify ignores extra install files including opaque `data.json`;
- all CLI output is JSON and contains no absolute path unless explicitly requested by the local operator.

- [ ] **Step 2: Run tests and verify RED**

Run `node tests/plugin-release-candidate.test.js`.

Expected: FAIL because prepare/verify CLIs are missing.

- [ ] **Step 3: Implement atomic prepare and read-only verify**

`prepare` must:

1. parse only fixed named arguments;
2. enumerate and normalize the complete package;
3. create `.artifacts/plugin/.tmp-<random>`;
4. write normalized package bytes and `candidate.json`;
5. validate the temp candidate;
6. rename to `<version>-<hash16>`;
7. reuse an existing candidate only when package plus deterministic identity match.

`verify` must support:

```text
--candidate <dir>
--source <dir>
--root-mirror <repo-root>
--installed <vault/.obsidian/plugins/wechat-inbox-sync>
--promotion <repo-root/release-candidate.json>
--json-out <result.json>
```

Only `--candidate` is mandatory. Every supplied comparison target fails closed.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
node tests/plugin-release-candidate.test.js
node --check scripts/prepare-plugin-release-candidate.js
node --check scripts/verify-plugin-release-candidate.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/prepare-plugin-release-candidate.js scripts/verify-plugin-release-candidate.js tests/plugin-release-candidate.test.js
git commit -m "feat: prepare and verify immutable plugin candidates"
```

### Task 4: Install the full candidate transactionally on Windows

**Files:**
- Create: `scripts/install-plugin-release-candidate.ps1`
- Modify: `tests/plugin-release-candidate.test.js`
- Modify: `.github/workflows/main-guards.yml`
- Modify: `tests/release-governance.test.js`

- [ ] **Step 1: Write failing Windows installer contract and behavior tests**

Static cross-platform assertions:

```js
test('candidate installer is included in every PowerShell parser gate', () => {
  const installer = 'scripts/install-plugin-release-candidate.ps1';
  for (const workflow of ['.github/workflows/main-guards.yml', '.github/workflows/release.yml']) {
    assert.ok(read(workflow).includes(installer), `${workflow} misses ${installer}`);
  }
});
```

Windows-only behavior probes invoke PowerShell against temp paths shaped as:

```text
<temp>/vault/.obsidian/plugins/wechat-inbox-sync
```

They must prove:

- success installs the complete package and preserves `data.json` byte-for-byte;
- a forced failure after the second managed entry restores every original managed byte;
- source directory, candidate directory, ordinary same-name directory, symlink/junction target, and running Obsidian are rejected;
- non-managed files remain byte-for-byte untouched.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node tests/plugin-release-candidate.test.js
node tests/release-governance.test.js
```

Expected: FAIL because the installer and workflow entries do not exist.

- [ ] **Step 3: Implement the transactional installer**

The PowerShell entry point must accept:

```powershell
param(
  [Parameter(Mandatory = $true)][string]$CandidateDirectory,
  [Parameter(Mandatory = $true)][string]$TargetDirectory,
  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$TestFailAfterSecondEntry
)
```

Production behavior:

- resolve all paths with `GetFullPath`;
- walk every target ancestor and reject `FileAttributes.ReparsePoint`;
- require final path segments `.obsidian`, `plugins`, `wechat-inbox-sync`;
- reject any target contained by repository/candidate/artifacts paths;
- reject a running `Obsidian` process;
- stage the complete managed package on the same volume;
- backup only managed paths;
- promote every managed path;
- verify with `verify-plugin-release-candidate.js`;
- on any error restore all managed paths before returning non-zero;
- never open, hash, move, delete, or overwrite `data.json`.

The test-only failure switch is allowed only when `WECHAT_INBOX_CANDIDATE_TEST=1`; otherwise it must be rejected.

- [ ] **Step 4: Add Windows job execution and parser lists**

Add the installer path to PowerShell parser arrays. In `windows-deployer`, run:

```yaml
- name: Test plugin release candidate installer
  run: node tests/plugin-release-candidate.test.js
```

Keep the Linux guards test too; Windows behavior is authoritative for PowerShell execution.

- [ ] **Step 5: Run tests and verify GREEN**

Run on Windows:

```powershell
node tests/plugin-release-candidate.test.js
node tests/release-governance.test.js
```

Expected: all candidate installer tests pass, including rollback.

- [ ] **Step 6: Commit**

```powershell
git add scripts/install-plugin-release-candidate.ps1 tests/plugin-release-candidate.test.js .github/workflows/main-guards.yml tests/release-governance.test.js
git commit -m "feat: install plugin candidates transactionally"
```

### Task 5: Generate root mirrors and committed promotion evidence

**Files:**
- Create: `scripts/sync-plugin-release-mirror.js`
- Create: `scripts/promote-plugin-release-candidate.js`
- Create: `release-candidate.json`
- Modify: `tests/plugin-release-candidate.test.js`
- Modify: `.github/workflows/main-guards.yml`
- Modify: `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`

- [ ] **Step 1: Write failing mirror and promotion tests**

Cover:

```js
test('mirror check fails on drift and write copies only loose assets from candidate bytes', () => {
  // Corrupt root main.js, expect --check non-zero.
  // Run --write, then expect exact normalized bytes for four loose assets.
  // Assert README/local-asr/local-ocr are never copied to repository root.
});

test('promotion refuses drift and writes deterministic release-candidate.json', () => {
  // Candidate, source, mirror, installed target all match.
  // Promote, parse receipt, assert it equals candidate.identity and has no provenance/path/time.
  // Change one installed managed byte, expect promotion non-zero and receipt unchanged.
});
```

- [ ] **Step 2: Run tests and verify RED**

Run `node tests/plugin-release-candidate.test.js`.

Expected: FAIL because mirror/promotion CLIs are missing.

- [ ] **Step 3: Implement mirror check/write and promotion**

`sync-plugin-release-mirror.js`:

- fixed modes `--check` and `--write`;
- source defaults to canonical plugin directory;
- write uses normalized candidate-compatible bytes;
- check requires exact four-file bytes.

`promote-plugin-release-candidate.js`:

1. verify candidate, source, root mirror, and installed target;
2. atomically write only deterministic `identity` as root `release-candidate.json`;
3. re-read and validate the receipt;
4. never write time, Git HEAD, local path, or provenance into the committed receipt.

Generate the initial `release-candidate.json` for the unchanged `1.3.74` package baseline and verify it against current canonical source.

- [ ] **Step 4: Wire main guard and release checklist**

Main guard commands:

```yaml
- run: node scripts/sync-plugin-release-mirror.js --check
- run: node scripts/verify-plugin-release-candidate.js --candidate-from-promotion release-candidate.json --source obsidian-plugin/wechat-inbox-sync --root-mirror .
```

Checklist sequence:

```text
prepare → install → user test → verify → mirror --write → promote → commit/PR
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```powershell
node tests/plugin-release-candidate.test.js
node tests/release-governance.test.js
node scripts/sync-plugin-release-mirror.js --check
node scripts/verify-plugin-release-candidate.js --candidate-from-promotion release-candidate.json --source obsidian-plugin/wechat-inbox-sync --root-mirror .
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add scripts/sync-plugin-release-mirror.js scripts/promote-plugin-release-candidate.js release-candidate.json tests/plugin-release-candidate.test.js .github/workflows/main-guards.yml obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md
git commit -m "feat: bind tested plugin candidate to git"
```

### Task 6: Remove wall-clock expiry from entitlement tests

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Add a failing source contract for active fixtures**

Add a helper and a source-level assertion:

```js
function withFixedNow(iso, callback) {
  const originalNow = Date.now;
  Date.now = () => new Date(iso).getTime();
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
}

assert.doesNotMatch(
  pluginMainTestSource,
  /expiresAt:\s*'2026-(?:07-30|08-0[13])T[^']+'/,
  'active entitlement fixtures must not expire with wall-clock time',
);
```

The first run should fail on the existing dates.

- [ ] **Step 2: Run the test and verify RED**

Run `node tests/plugin-main-ai.test.js`.

Expected: FAIL identifying active fixed dates.

- [ ] **Step 3: Convert active/expired behavior fixtures to fixed-clock relative values**

For each validity-sensitive test:

```js
withFixedNow('2030-01-01T00:00:00.000Z', () => {
  const activeExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // existing assertions
});
```

Expired tests use `Date.now() - ...`. Preserve fixed historical dates only where the date string itself is the subject of formatting/parsing assertions.

- [ ] **Step 4: Run tests and verify GREEN plus clock restoration**

Run `node tests/plugin-main-ai.test.js`.

Expected: all tests pass and a final assertion confirms `Date.now === originalNow`.

- [ ] **Step 5: Commit**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test: make entitlement fixtures time stable"
```

### Task 7: Fix postpublish Runner tag false negatives without weakening tag safety

**Files:**
- Modify: `scripts/plugin-release-identity-core.js`
- Modify: `scripts/check-plugin-release-identity.js`
- Modify: `tests/plugin-release-identity.test.js`

- [ ] **Step 1: Write failing postpublish regression tests**

Build a bare remote fixture where:

- remote tag ref points to an annotated tag object;
- peeled tag points to the trusted commit;
- local checkout has no tag or a lightweight tag;
- Release API fixtures and assets match the trusted commit.

Expected behavior:

```js
assert.doesNotThrow(() => validatePostpublishEvidence({
  trustedCommit,
  remoteRefObjectSha,
  remoteTagObject,
  remoteLsRemote,
  release,
  samples,
}));
```

Negative tests mutate:

- Ref API tag-object SHA;
- Git Tag API object SHA or target commit;
- unpeeled/peeled `ls-remote` pair;
- tag between sample 1 and sample 2;
- Release target;
- expected asset bytes.

Prepublish fixture with local lightweight tag must continue to throw.

- [ ] **Step 2: Run tests and verify RED**

Run `node tests/plugin-release-identity.test.js`.

Expected: the local-missing/lightweight postpublish case fails with “local release tag must be an annotated Git tag object”.

- [ ] **Step 3: Split prepublish local evidence from postpublish remote evidence**

Change local input collection to:

```js
function collectLocalInputs({ tag, requireLocalAnnotatedTag }) {
  const inputs = {
    headOutput: runGit(['rev-parse', 'HEAD'], 'local HEAD'),
    statusOutput: runGit(['status', '--porcelain=v1'], 'worktree status'),
  };
  if (requireLocalAnnotatedTag) {
    inputs.tagTypeOutput = runGit(['cat-file', '-t', `refs/tags/${tag}`], `annotated tag ${tag}`);
    inputs.tagCommitOutput = runGit(['rev-list', '-n', '1', tag], `tag commit ${tag}`);
  }
  return inputs;
}
```

Prepublish passes `true`; postpublish passes `false`.

For postpublish:

- establish `trustedCommit` from verified default branch/remote tag evidence;
- read expected source bytes with `git show <trustedCommit>:<path>`;
- verify `release-candidate.json` from that commit;
- bind GitHub Ref API object SHA, Git Tag API payload, and `ls-remote` unpeeled/peeled SHAs;
- repeat remote sampling and reject any movement.

- [ ] **Step 4: Run identity tests and verify GREEN**

Run:

```powershell
node tests/plugin-release-identity.test.js
node --check scripts/plugin-release-identity-core.js
node --check scripts/check-plugin-release-identity.js
```

Expected: all pass; prepublish lightweight rejection remains covered.

- [ ] **Step 5: Commit**

```powershell
git add scripts/plugin-release-identity-core.js scripts/check-plugin-release-identity.js tests/plugin-release-identity.test.js
git commit -m "fix: trust remote annotated tag after release"
```

### Task 8: Package Release assets from the verified candidate identity

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `tests/release-governance.test.js`
- Modify: `tests/plugin-release-candidate.test.js`

- [ ] **Step 1: Write failing workflow contract tests**

Require release workflow ordering:

```text
verify release-candidate.json
prepare candidate from trusted checkout
compare candidate identity to receipt
package ZIP from candidate/package
publish four loose assets from candidate/package
postpublish remote-authority verification
```

Assert ZIP input is not the raw plugin worktree directory.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node tests/release-governance.test.js
node tests/plugin-release-candidate.test.js
```

Expected: FAIL because `release.yml` still zips from `obsidian-plugin/wechat-inbox-sync`.

- [ ] **Step 3: Update the workflow**

Use a deterministic CI candidate directory:

```yaml
- name: Prepare verified release candidate
  run: |
    node scripts/prepare-plugin-release-candidate.js \
      --source obsidian-plugin/wechat-inbox-sync \
      --artifacts-root .artifacts/plugin \
      --verify-promotion release-candidate.json \
      --json-out .artifacts/release-candidate-result.json

- name: Package plugin release assets
  run: |
    set -euo pipefail
    PACKAGE_DIR="$(node -p "require('./.artifacts/release-candidate-result.json').packageDirectory")"
    cd "$PACKAGE_DIR"
    zip -r "../wechat-inbox-sync-$TAG_NAME.zip" main.js manifest.json styles.css versions.json README.md LICENSE local-asr local-ocr
```

Publish loose assets and ZIP from the candidate result paths. Refuse any receipt/version/tag mismatch before `gh release create`.

- [ ] **Step 4: Run tests and verify GREEN**

Run both governance and candidate suites.

Expected: all workflow ordering and packaging contracts pass.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/release.yml tests/release-governance.test.js tests/plugin-release-candidate.test.js
git commit -m "ci: package releases from verified candidates"
```

### Task 9: Full verification, closeout, and local handoff

**Files:**
- Modify: `docs/WORKLOG.md`
- Modify: `docs/task-cards/plugin-release-pipeline-v2-001.md`

- [ ] **Step 1: Run syntax and focused suites**

```powershell
node --check scripts/plugin-release-candidate-core.js
node --check scripts/prepare-plugin-release-candidate.js
node --check scripts/verify-plugin-release-candidate.js
node --check scripts/sync-plugin-release-mirror.js
node --check scripts/promote-plugin-release-candidate.js
node --check scripts/check-plugin-release-identity.js
node tests/plugin-release-candidate.test.js
node tests/plugin-release-identity.test.js
node tests/release-governance.test.js
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
```

Expected: all pass with zero failures.

- [ ] **Step 2: Run real candidate loop in a temporary vault**

Create only a temporary local vault-shaped directory inside `.artifacts/test-vault/.obsidian/plugins/wechat-inbox-sync`, seed an opaque `data.json`, then:

```powershell
$candidateResultPath = '.artifacts/candidate-result.json'
$testTargetPath = Join-Path (Get-Location) '.artifacts/test-vault/.obsidian/plugins/wechat-inbox-sync'
New-Item -ItemType Directory -Force -Path $testTargetPath | Out-Null
Set-Content -LiteralPath (Join-Path $testTargetPath 'data.json') -Value '{"opaque":"preserve"}' -NoNewline
node scripts/prepare-plugin-release-candidate.js --source obsidian-plugin/wechat-inbox-sync --artifacts-root .artifacts/plugin --json-out $candidateResultPath
$candidateResult = Get-Content -Raw -LiteralPath $candidateResultPath | ConvertFrom-Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-plugin-release-candidate.ps1 -CandidateDirectory $candidateResult.candidateDirectory -TargetDirectory $testTargetPath
node scripts/verify-plugin-release-candidate.js --candidate $candidateResult.candidateDirectory --source obsidian-plugin/wechat-inbox-sync --root-mirror . --installed $testTargetPath
```

Expected: controlled hashes match and `data.json` SHA-256 is unchanged.

- [ ] **Step 3: Confirm business freeze**

Run:

```powershell
git diff 4405dcef -- obsidian-plugin/wechat-inbox-sync/main.js main.js
```

Expected: empty output. Also confirm no plugin version bump.

- [ ] **Step 4: Independent review**

Request one independent reviewer to inspect:

- candidate identity and path alias defenses;
- Windows transaction rollback;
- committed promotion binding;
- pre/post tag security;
- test sufficiency and no business code changes.

Fix all P0/P1 findings and rerun the focused suites.

- [ ] **Step 5: Record closeout**

Update task card status to `审核中` and add one `docs/WORKLOG.md` entry with:

- no deployment/release;
- exact test commands and counts;
- current stable version remains `1.3.74`;
- local handoff command;
- next step is user local acceptance, then return to `main.js` architecture map/refactor.

- [ ] **Step 6: Commit**

```powershell
git add docs/WORKLOG.md docs/task-cards/plugin-release-pipeline-v2-001.md
git commit -m "docs: close plugin release pipeline v2"
```

- [ ] **Step 7: Final status check**

```powershell
git status --short
git log --oneline 4405dcef..HEAD
```

Expected: clean worktree with only the planned commits; no push, tag, Release, deployment, or user-plugin replacement performed.
