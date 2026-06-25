const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DOMAIN_RULES = [
  {
    name: 'xiaohongshu',
    patterns: [/xiaohongshu/i, /小红书/u, /\bxhs\b/i],
    allowed: [
      /^main\.js$/,
      /^manifest\.json$/,
      /^versions\.json$/,
      /^styles\.css$/,
      /^README\.md$/,
      /^RELEASE_CHECKLIST\.md$/,
      /^src\/comments\//,
      /^src\/xiaohongshu\//,
      /^tests\/comments-model\.test\.js$/,
      /^tests\/xiaohongshu-/,
      /^tests\/plugin-main-ai\.test\.js$/,
      /^tests\/release-social-feishu-ai\.test\.js$/,
      /^scripts\/check-plugin-boundaries\.js$/,
      /^docs\/superpowers\//,
      /^\.github\/workflows\//,
    ],
    requiredTest: /^tests\/(comments-model|xiaohongshu-.*|plugin-main-ai|release-social-feishu-ai)\.test\.js$/,
  },
  {
    name: 'feishu',
    patterns: [/feishu/i, /飞书/u],
    allowed: [
      /^main\.js$/,
      /^manifest\.json$/,
      /^versions\.json$/,
      /^styles\.css$/,
      /^README\.md$/,
      /^RELEASE_CHECKLIST\.md$/,
      /^src\/feishu\//,
      /^tests\/feishu-/,
      /^tests\/plugin-main-ai\.test\.js$/,
      /^tests\/release-social-feishu-ai\.test\.js$/,
      /^scripts\/check-plugin-boundaries\.js$/,
      /^docs\/superpowers\//,
      /^\.github\/workflows\//,
    ],
    requiredTest: /^tests\/(feishu-.*|plugin-main-ai|release-social-feishu-ai)\.test\.js$/,
  },
  {
    name: 'wechat',
    patterns: [/wechat/i, /公众号/u, /weixin/i],
    allowed: [
      /^main\.js$/,
      /^manifest\.json$/,
      /^versions\.json$/,
      /^styles\.css$/,
      /^README\.md$/,
      /^RELEASE_CHECKLIST\.md$/,
      /^src\/comments\//,
      /^src\/wechat\//,
      /^tests\/comments-model\.test\.js$/,
      /^tests\/wechat-/,
      /^tests\/plugin-main-ai\.test\.js$/,
      /^tests\/release-social-feishu-ai\.test\.js$/,
      /^scripts\/check-plugin-boundaries\.js$/,
      /^docs\/superpowers\//,
      /^\.github\/workflows\//,
      /^local-asr\//,
    ],
    requiredTest: /^tests\/(comments-model|wechat-.*|plugin-main-ai|release-social-feishu-ai)\.test\.js$/,
  },
  {
    name: 'ai',
    patterns: [/\bai\b/i, /metadata/i, /keyword/i, /description/i, /简介/u, /关键词/u],
    allowed: [
      /^main\.js$/,
      /^manifest\.json$/,
      /^versions\.json$/,
      /^styles\.css$/,
      /^README\.md$/,
      /^RELEASE_CHECKLIST\.md$/,
      /^src\/ai\//,
      /^tests\/ai-/,
      /^tests\/plugin-main-ai\.test\.js$/,
      /^tests\/release-social-feishu-ai\.test\.js$/,
      /^scripts\/check-plugin-boundaries\.js$/,
      /^docs\/superpowers\//,
      /^\.github\/workflows\//,
    ],
    requiredTest: /^tests\/(ai-.*|plugin-main-ai|release-social-feishu-ai)\.test\.js$/,
  },
  {
    name: 'frontmatter',
    patterns: [/frontmatter/i, /property/i, /properties/i, /属性/u],
    allowed: [
      /^main\.js$/,
      /^manifest\.json$/,
      /^versions\.json$/,
      /^styles\.css$/,
      /^README\.md$/,
      /^RELEASE_CHECKLIST\.md$/,
      /^src\/frontmatter\.js$/,
      /^tests\/frontmatter\.test\.js$/,
      /^tests\/plugin-main-ai\.test\.js$/,
      /^tests\/release-social-feishu-ai\.test\.js$/,
      /^scripts\/check-plugin-boundaries\.js$/,
      /^docs\/superpowers\//,
      /^\.github\/workflows\//,
    ],
    requiredTest: /^tests\/(frontmatter|plugin-main-ai|release-social-feishu-ai)\.test\.js$/,
  },
];

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function normalizePath(file) {
  return file.replace(/\\/g, '/');
}

function getChangedFiles(baseRef) {
  const untracked = runGit(['ls-files', '--others', '--exclude-standard']);
  const outputs = [
    runGit(['diff', '--name-only', `${baseRef}...HEAD`]),
    runGit(['diff', '--name-only', '--cached']),
    runGit(['diff', '--name-only']),
    untracked,
  ];
  return [...new Set(outputs
    .flatMap((output) => output.split(/\r?\n/))
    .map(normalizePath)
    .filter(Boolean))];
}

function getDiffText(baseRef) {
  return [
    runGit(['diff', '--unified=0', `${baseRef}...HEAD`, '--', 'main.js', 'src', 'tests']),
    runGit(['diff', '--unified=0', '--cached', '--', 'main.js', 'src', 'tests']),
    runGit(['diff', '--unified=0', '--', 'main.js', 'src', 'tests']),
  ].filter(Boolean).join('\n');
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function main() {
  const baseRef = process.argv[2] || 'origin/main';
  const changedFiles = getChangedFiles(baseRef);
  if (!changedFiles.length) {
    console.log('plugin boundary guard: no changed files');
    return;
  }

  const scopedFiles = changedFiles.filter((file) => /^(main\.js|src\/|tests\/)/.test(file));
  const changedText = `${scopedFiles.join('\n')}\n${getDiffText(baseRef)}`;
  const failures = [];

  const activeRules = DOMAIN_RULES.filter((rule) => matchesAny(changedText, rule.patterns));
  const singleDomainChange = activeRules.length === 1;

  activeRules.forEach((rule) => {
    if (!matchesAny(changedText, rule.patterns)) return;
    if (singleDomainChange) {
      const outOfBoundary = changedFiles.filter((file) => !matchesAny(file, rule.allowed));
      if (outOfBoundary.length) {
        failures.push(`${rule.name}: out-of-boundary files changed: ${outOfBoundary.join(', ')}`);
      }
    }
    const hasDomainTest = changedFiles.some((file) => rule.requiredTest.test(file));
    if (!hasDomainTest) {
      failures.push(`${rule.name}: change detected but no matching regression test changed`);
    }
  });

  if (failures.length) {
    console.error('Plugin boundary guard failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log(`plugin boundary guard passed for ${changedFiles.length} changed file(s)`);
}

if (require.main === module) {
  if (!fs.existsSync(path.join(ROOT, 'main.js'))) {
    console.error('Run this script from the plugin repository layout.');
    process.exit(1);
  }
  main();
}
