'use strict';

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const VERSION_TAG_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

function requireString(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} output must be a string`);
  }
  return value;
}

function assertCommit(commit, label) {
  requireString(commit, label);
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error(`${label} must be one complete lowercase Git commit ID`);
  }
  return commit;
}

function parseCommitOutput(output, label = 'Git commit') {
  requireString(output, label);
  const match = output.match(/^([0-9a-f]{40}|[0-9a-f]{64})(?:\r?\n)?$/);
  if (!match) {
    throw new Error(`${label} output must contain exactly one complete lowercase Git commit ID`);
  }
  return match[1];
}

function parseRemoteMainOutput(output) {
  requireString(output, 'remote origin/main');
  const match = output.match(
    /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/main(?:\r?\n)?$/,
  );
  if (!match) {
    throw new Error(
      'remote origin/main cannot be determined from git ls-remote output',
    );
  }
  return match[1];
}

function assertCleanStatus(statusOutput) {
  requireString(statusOutput, 'git status');
  if (statusOutput.length !== 0) {
    throw new Error('release source is dirty; a clean checkout is required');
  }
  return true;
}

function assertHeadMatchesRemote(head, remoteMain) {
  assertCommit(head, 'local HEAD');
  assertCommit(remoteMain, 'remote origin/main');
  if (head !== remoteMain) {
    throw new Error(
      `local HEAD ${head} is stale or divergent from origin/main ${remoteMain}`,
    );
  }
  return true;
}

function assertTagMatchesHead(tagCommit, head) {
  assertCommit(tagCommit, 'tag commit');
  assertCommit(head, 'local HEAD');
  if (tagCommit !== head) {
    throw new Error(
      `tag commit ${tagCommit} differs from checked-out HEAD ${head}`,
    );
  }
  return true;
}

function assertTagMatchesRemote(tagCommit, remoteMain) {
  assertCommit(tagCommit, 'tag commit');
  assertCommit(remoteMain, 'remote origin/main');
  if (tagCommit !== remoteMain) {
    throw new Error(
      `tag commit ${tagCommit} is stale or divergent from origin/main ${remoteMain}`,
    );
  }
  return true;
}

function validateVersionTag(tag) {
  requireString(tag, 'version tag');
  if (!VERSION_TAG_PATTERN.test(tag)) {
    throw new Error('version tag must use strict numeric X.Y.Z form');
  }
  return tag;
}

function validateReleaseVersions(rootVersion, pluginVersion, tag) {
  validateVersionTag(rootVersion);
  validateVersionTag(pluginVersion);
  validateVersionTag(tag);
  if (rootVersion !== pluginVersion) {
    throw new Error(
      `root and plugin manifest versions differ: ${rootVersion} != ${pluginVersion}`,
    );
  }
  if (rootVersion !== tag) {
    throw new Error(
      `version tag ${tag} differs from manifest version ${rootVersion}`,
    );
  }
  return tag;
}

function validateDeployState({
  statusOutput,
  headOutput,
  remoteMainOutput,
} = {}) {
  assertCleanStatus(statusOutput);
  const head = parseCommitOutput(headOutput, 'local HEAD');
  const remoteMain = parseRemoteMainOutput(remoteMainOutput);
  assertHeadMatchesRemote(head, remoteMain);
  return { head, remoteMain };
}

function validateTagState({
  statusOutput,
  headOutput,
  tagOutput,
  remoteMainOutput,
  tag,
  rootVersion,
  pluginVersion,
} = {}) {
  assertCleanStatus(statusOutput);
  const version = validateVersionTag(tag);
  const head = parseCommitOutput(headOutput, 'local HEAD');
  const tagCommit = parseCommitOutput(tagOutput, `tag ${version} commit`);
  const remoteMain = parseRemoteMainOutput(remoteMainOutput);
  assertTagMatchesHead(tagCommit, head);
  assertHeadMatchesRemote(head, remoteMain);
  assertTagMatchesRemote(tagCommit, remoteMain);
  validateReleaseVersions(rootVersion, pluginVersion, version);
  return {
    head,
    tagCommit,
    remoteMain,
    version,
  };
}

module.exports = {
  assertCleanStatus,
  assertHeadMatchesRemote,
  assertTagMatchesHead,
  assertTagMatchesRemote,
  parseCommitOutput,
  parseRemoteMainOutput,
  validateDeployState,
  validateReleaseVersions,
  validateTagState,
  validateVersionTag,
};
