'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const PLUGIN_ROOT = __dirname;
const SOURCE_PATH = path.join(PLUGIN_ROOT, 'src', 'main.js');
const OUTPUT_PATH = path.join(PLUGIN_ROOT, 'main.js');
const PDFJS_PACKAGE_PATH = path.join(PLUGIN_ROOT, 'node_modules', 'pdfjs-dist', 'package.json');
const PDFJS_LICENSE_PATH = path.join(PLUGIN_ROOT, 'node_modules', 'pdfjs-dist', 'LICENSE');
const PDFJS_MODULE_PATH = path.join(
  PLUGIN_ROOT,
  'node_modules',
  'pdfjs-dist',
  'legacy',
  'build',
  'pdf.mjs',
);

function getPdfJsLicenseBanner() {
  const packageMetadata = JSON.parse(fs.readFileSync(PDFJS_PACKAGE_PATH, 'utf8'));
  const licenseText = fs.readFileSync(PDFJS_LICENSE_PATH, 'utf8').trim();
  return [
    '/*!',
    ` * Bundled dependency: pdfjs-dist ${packageMetadata.version}`,
    ` * License: ${packageMetadata.license}`,
    ' *',
    ...licenseText.split(/\r?\n/).map((line) => (line ? ` * ${line}` : ' *')),
    ' */',
  ].join('\n');
}

function getPdfJsDataUrl() {
  const pdfJsSource = fs.readFileSync(PDFJS_MODULE_PATH, 'utf8');
  const browserRuntimeSource = [
    'const process = undefined;',
    pdfJsSource,
  ].join('\n');
  return `data:text/javascript;base64,${Buffer.from(browserRuntimeSource, 'utf8').toString('base64')}`;
}

function hasSourceModules(sourcePath = SOURCE_PATH) {
  const sourceDirectory = path.dirname(sourcePath);
  const entryPath = path.resolve(sourcePath);
  const pendingDirectories = [sourceDirectory];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPathname = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPathname);
      } else if (entry.isFile()
        && entry.name.endsWith('.js')
        && path.resolve(entryPathname) !== entryPath) {
        return true;
      }
    }
  }
  return false;
}

function sourceReferencesLocalModule(sourceBytes) {
  const source = Buffer.isBuffer(sourceBytes)
    ? sourceBytes.toString('utf8')
    : String(sourceBytes || '');
  return /require\s*\(\s*['"]\./.test(source)
    || /\bfrom\s*['"]\./.test(source)
    || /\bimport\s*['"]\./.test(source);
}

function assertNoDynamicRequire(sourceBytes, label = 'plugin source') {
  const source = Buffer.isBuffer(sourceBytes)
    ? sourceBytes.toString('utf8')
    : String(sourceBytes || '');
  if (/\brequire\s*\(\s*(?!['"])/.test(source)) {
    throw new Error(`${label} contains a dynamic require that cannot be proven self-contained`);
  }
}

function assertNoUnbundledRelativeRequire(outputBytes) {
  const output = Buffer.isBuffer(outputBytes)
    ? outputBytes.toString('utf8')
    : String(outputBytes || '');
  assertNoDynamicRequire(output, 'plugin bundle');
  if (/\brequire\s*\(\s*['"]\.{1,2}[\\/]/.test(output)) {
    throw new Error('plugin bundle contains an unbundled relative require');
  }
}

function getPluginBuildBytes({
  sourcePath = SOURCE_PATH,
  outputPath = OUTPUT_PATH,
} = {}) {
  const sourceBytes = fs.readFileSync(sourcePath);
  assertNoDynamicRequire(sourceBytes);
  if (!hasSourceModules(sourcePath) && !sourceReferencesLocalModule(sourceBytes)) {
    return sourceBytes;
  }

  const result = esbuild.buildSync({
    absWorkingDir: PLUGIN_ROOT,
    banner: {
      js: getPdfJsLicenseBanner(),
    },
    bundle: true,
    charset: 'utf8',
    define: {
      __WECHAT_INBOX_PDFJS_DATA_URL__: JSON.stringify(getPdfJsDataUrl()),
    },
    entryPoints: [sourcePath],
    external: ['obsidian'],
    format: 'cjs',
    keepNames: true,
    loader: {
      '.ps1': 'text',
      '.py': 'text',
      '.sh': 'text',
    },
    legalComments: 'inline',
    logLevel: 'silent',
    minify: false,
    outfile: outputPath,
    platform: 'node',
    sourcemap: false,
    target: 'node16',
    write: false,
  });
  const outputFile = Array.isArray(result.outputFiles)
    ? result.outputFiles.find((file) => path.resolve(file.path) === path.resolve(outputPath))
      || result.outputFiles[0]
    : null;
  if (!outputFile || !outputFile.contents) {
    throw new Error('plugin build failed: esbuild returned no JavaScript output');
  }
  const outputBytes = Buffer.from(outputFile.contents);
  assertNoUnbundledRelativeRequire(outputBytes);
  return outputBytes;
}

function checkPluginBuild({
  sourcePath = SOURCE_PATH,
  outputPath = OUTPUT_PATH,
} = {}) {
  if (!fs.existsSync(sourcePath) || !fs.existsSync(outputPath)) {
    return false;
  }
  return getPluginBuildBytes({ sourcePath, outputPath }).equals(fs.readFileSync(outputPath));
}

function buildPlugin({
  sourcePath = SOURCE_PATH,
  outputPath = OUTPUT_PATH,
} = {}) {
  const outputBytes = getPluginBuildBytes({ sourcePath, outputPath });
  const outputDirectory = path.dirname(outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  fs.mkdirSync(outputDirectory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, outputBytes);
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }

  return outputPath;
}

function run(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    buildPlugin();
    process.stdout.write('plugin main.js generated from src/main.js\n');
    return;
  }

  if (argv.length === 1 && argv[0] === '--check') {
    if (!checkPluginBuild()) {
      throw new Error('plugin build drift: run build-plugin.js and commit src/main.js with main.js');
    }
    process.stdout.write('plugin build check passed\n');
    return;
  }

  throw new Error('unsupported argument; usage: node build-plugin.js [--check]');
}

module.exports = {
  OUTPUT_PATH,
  SOURCE_PATH,
  buildPlugin,
  checkPluginBuild,
  getPluginBuildBytes,
  hasSourceModules,
  assertNoDynamicRequire,
  assertNoUnbundledRelativeRequire,
  run,
  sourceReferencesLocalModule,
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error && error.message ? error.message : 'plugin build failed'}\n`);
    process.exitCode = 1;
  }
}
