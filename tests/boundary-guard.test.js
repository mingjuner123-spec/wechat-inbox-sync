const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const guardSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'check-plugin-boundaries.js'), 'utf8');

function run(command, args, cwd, options = {}) {
  return childProcess.execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-boundary-'));
  run('git', ['init'], dir);
  run('git', ['config', 'user.email', 'test@example.com'], dir);
  run('git', ['config', 'user.name', 'Boundary Test'], dir);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'feishu'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.js'), 'function plugin() {}\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'check-plugin-boundaries.js'), guardSource);
  fs.writeFileSync(path.join(dir, 'tests', 'xiaohongshu-comments.test.js'), 'console.log("xhs");\n');
  fs.writeFileSync(path.join(dir, 'src', 'feishu', 'extract.js'), 'module.exports = {};\n');
  run('git', ['add', '.'], dir);
  run('git', ['commit', '-m', 'baseline'], dir);
  run('git', ['branch', 'base'], dir);
  return dir;
}

const passingFixture = createFixture();
fs.appendFileSync(path.join(passingFixture, 'tests', 'xiaohongshu-comments.test.js'), 'assert_xiaohongshu_comment = true;\n');
run('git', ['add', '.'], passingFixture);
run('git', ['commit', '-m', 'fix xiaohongshu comments'], passingFixture);
assert.match(
  run('node', ['scripts/check-plugin-boundaries.js', 'base'], passingFixture),
  /plugin boundary guard passed/
);

const failingFixture = createFixture();
fs.appendFileSync(path.join(failingFixture, 'tests', 'xiaohongshu-comments.test.js'), 'assert_xiaohongshu_comment = true;\n');
fs.appendFileSync(path.join(failingFixture, 'src', 'feishu', 'extract.js'), 'const unrelated = "小红书";\n');
run('git', ['add', '.'], failingFixture);
run('git', ['commit', '-m', 'fix xiaohongshu comments'], failingFixture);
assert.throws(
  () => run('node', ['scripts/check-plugin-boundaries.js', 'base'], failingFixture),
  (error) => {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    return output.includes('Plugin boundary guard failed')
      && (
        output.includes('xiaohongshu: out-of-boundary files changed: src/feishu/extract.js')
        || output.includes('feishu: change detected but no matching regression test changed')
      );
  }
);

const multiDomainFixture = createFixture();
fs.writeFileSync(path.join(multiDomainFixture, 'main.js'), [
  'const xiaohongshu = true;',
  'const feishu = true;',
  'const ai = true;',
  'const frontmatter = true;',
  '',
].join('\n'));
fs.writeFileSync(path.join(multiDomainFixture, 'tests', 'xiaohongshu-comments.test.js'), 'console.log("xiaohongshu");\n');
fs.writeFileSync(path.join(multiDomainFixture, 'tests', 'feishu-extract.test.js'), 'console.log("feishu");\n');
fs.writeFileSync(path.join(multiDomainFixture, 'tests', 'ai-metadata.test.js'), 'console.log("ai");\n');
fs.writeFileSync(path.join(multiDomainFixture, 'tests', 'frontmatter.test.js'), 'console.log("frontmatter");\n');
run('git', ['add', '.'], multiDomainFixture);
run('git', ['commit', '-m', 'refactor plugin boundaries'], multiDomainFixture);
assert.match(
  run('node', ['scripts/check-plugin-boundaries.js', 'base'], multiDomainFixture),
  /plugin boundary guard passed/
);

console.log('boundary guard checks passed');
