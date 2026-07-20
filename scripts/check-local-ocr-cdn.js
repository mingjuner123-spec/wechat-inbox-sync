#!/usr/bin/env node

const { runCli } = require('./check-local-components-cdn');

runCli(process.argv.slice(2), {
  failurePrefix: 'LOCAL_OCR_CDN_CHECK_FAILED',
}).then((exitCode) => {
  process.exitCode = exitCode;
});
