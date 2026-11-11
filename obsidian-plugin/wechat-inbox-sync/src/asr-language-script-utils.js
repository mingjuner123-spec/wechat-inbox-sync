'use strict';

// Keep the installed component unchanged. Older Windows components apply the
// Chinese punctuation model to English too, stripping spaces between words.
// A per-run copy only disables that optional step and keeps the same engine,
// model, diagnostics, time segments and decoding parameters.
function buildEnglishAsrScript(source, installRoot) {
  const text = String(source || '').replace(/^\uFEFF/, '');
  const rootLine = '$Root = Split-Path -Parent $MyInvocation.MyCommand.Path';
  const punctuationLine = '$PunctuationReady = [bool](';
  if (!text.includes(punctuationLine)) return null;
  if (!text.includes(rootLine) || !text.includes('$TranscriptionLanguage = $Language')
    || !text.includes('function Add-UnitPunctuation')) throw new Error('无法确认英文转写脚本结构');
  const root = String(installRoot || '');
  if (!root || /[\r\n\0]/.test(root)) throw new Error('无效的本地转写目录');
  return text.replace(rootLine, () => `$Root = '${root.replace(/'/g, "''")}'`)
    .replace(punctuationLine, '$PunctuationReady = ($TranscriptionLanguage -ne "en") -and [bool](');
}

module.exports = { buildEnglishAsrScript };
