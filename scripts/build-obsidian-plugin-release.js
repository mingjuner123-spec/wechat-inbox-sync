const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const outDir = path.join(repoRoot, 'build', 'obsidian-plugin-release');
const copyEntries = [
  'manifest.json',
  'styles.css',
  'versions.json',
  'README.md',
  'LICENSE',
  'local-asr',
];

function removePath(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((entry) => {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function toBundleVar(specifier) {
  return `__wechatInboxModule_${specifier.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}`;
}

function readLocalModule(specifier) {
  const modulePath = path.join(pluginDir, `${specifier}.js`);
  if (!fs.existsSync(modulePath)) {
    throw new Error(`Missing local plugin module: ${modulePath}`);
  }
  return fs.readFileSync(modulePath, 'utf8');
}

function buildModulePrelude(specifier) {
  const source = readLocalModule(specifier);
  const varName = toBundleVar(specifier);
  return `const ${varName} = (() => {\n  const module = { exports: {} };\n  const exports = module.exports;\n${source.replace(/^/gm, '  ')}\n  return module.exports;\n})();\n`;
}

function bundleMain() {
  const mainPath = path.join(pluginDir, 'main.js');
  let source = fs.readFileSync(mainPath, 'utf8');
  const moduleSpecifiers = Array.from(source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g))
    .map((match) => match[1])
    .filter((specifier, index, list) => list.indexOf(specifier) === index);
  const prelude = moduleSpecifiers.map(buildModulePrelude).join('\n');

  source = source.replace(/require\(['"]\.\/([^'"]+)['"]\)/g, (_, specifier) => toBundleVar(specifier));
  if (/require\(['"]\.\//.test(source)) {
    throw new Error('Release main.js still contains local runtime require calls');
  }
  return `${prelude}\n${source}`;
}

removePath(outDir);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'main.js'), bundleMain(), 'utf8');
copyEntries.forEach((entry) => {
  copyRecursive(path.join(pluginDir, entry), path.join(outDir, entry));
});

console.log(`Built Obsidian release package at ${outDir}`);
