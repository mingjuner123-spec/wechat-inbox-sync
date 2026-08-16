'use strict';

const zlib = require('zlib');

function createDocumentTextExtractionHelpers({
  toNodeBuffer,
  cleanMarkdownForStorage,
} = {}) {
  if (typeof toNodeBuffer !== 'function') {
    throw new TypeError('toNodeBuffer must be a function');
  }
  if (typeof cleanMarkdownForStorage !== 'function') {
    throw new TypeError('cleanMarkdownForStorage must be a function');
  }

  function decodeUtf16Be(buffer) {
    const chunks = [];
    for (let index = 0; index + 1 < buffer.length; index += 2) {
      chunks.push(String.fromCharCode(buffer.readUInt16BE(index)));
    }
    return chunks.join('');
  }

  function decodeXmlEntities(text) {
    return String(text || '')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  }

  function inflateZipEntry(buffer, method) {
    if (method === 0) return buffer;
    if (method === 8) return zlib.inflateRawSync(buffer);
    throw new Error(`暂不支持的 docx 压缩方式：${method}`);
  }

  function readZipEntries(bufferLike) {
    const buffer = toNodeBuffer(bufferLike);
    let eocdOffset = -1;
    const minOffset = Math.max(0, buffer.length - 65558);
    for (let index = buffer.length - 22; index >= minOffset; index -= 1) {
      if (buffer.readUInt32LE(index) === 0x06054b50) {
        eocdOffset = index;
        break;
      }
    }

    if (eocdOffset < 0) {
      throw new Error('未找到 docx 压缩包目录');
    }

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let offset = buffer.readUInt32LE(eocdOffset + 16);
    const entries = new Map();

    for (let index = 0; index < entryCount; index += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('docx 压缩包目录格式异常');
      }

      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localHeaderOffset = buffer.readUInt32LE(offset + 42);
      const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');

      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
      entries.set(fileName, inflateZipEntry(compressed, method));

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
  }

  function extractDocxMarkdown(bufferLike) {
    const entries = readZipEntries(bufferLike);
    const documentXml = entries.get('word/document.xml');
    if (!documentXml) {
      throw new Error('docx 中没有找到 word/document.xml');
    }

    const xml = documentXml.toString('utf8');
    const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
    const lines = paragraphs.map((paragraph) => {
      const isHeading = /<w:pStyle[^>]+w:val=["']Heading([1-6])["']/i.exec(paragraph);
      const text = decodeXmlEntities(paragraph
        .replace(/<w:tab\s*\/>/g, '\t')
        .replace(/<w:br\s*\/>/g, '\n')
        .replace(/<w:t[^>]*>/g, '')
        .replace(/<\/w:t>/g, '')
        .replace(/<[^>]+>/g, ''))
        .replace(/[ \t]+\n/g, '\n')
        .trim();

      if (!text) return '';
      if (isHeading) {
        return `${'#'.repeat(Math.min(Number(isHeading[1]), 6))} ${text}`;
      }
      return text;
    }).filter(Boolean);

    if (!lines.length) {
      throw new Error('docx 正文为空，未提取到文本');
    }

    return lines.join('\n\n');
  }

  function decodePdfBytes(buffer) {
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      return decodeUtf16Be(buffer.slice(2));
    }

    let zeroEven = 0;
    for (let index = 0; index < Math.min(buffer.length, 80); index += 2) {
      if (buffer[index] === 0) zeroEven += 1;
    }
    if (zeroEven > 4) {
      return decodeUtf16Be(buffer);
    }

    return buffer.toString('utf8');
  }

  function decodePdfLiteralString(value) {
    const bytes = [];
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char !== '\\') {
        bytes.push(char.charCodeAt(0) & 0xff);
        continue;
      }

      const next = value[index + 1];
      if (!next) break;
      index += 1;
      if (next === 'n') bytes.push(10);
      else if (next === 'r') bytes.push(13);
      else if (next === 't') bytes.push(9);
      else if (next === 'b') bytes.push(8);
      else if (next === 'f') bytes.push(12);
      else if (/[0-7]/.test(next)) {
        let octal = next;
        for (let count = 0; count < 2 && /[0-7]/.test(value[index + 1]); count += 1) {
          index += 1;
          octal += value[index];
        }
        bytes.push(parseInt(octal, 8));
      } else {
        bytes.push(next.charCodeAt(0) & 0xff);
      }
    }
    return decodePdfBytes(Buffer.from(bytes));
  }

  function decodePdfHexString(value, cmap) {
    const hex = String(value || '').replace(/[^0-9a-f]/gi, '');
    if (!hex) return '';
    if (cmap && cmap.size) {
      const mapped = applyPdfCMap(hex, cmap);
      if (mapped) return mapped;
    }
    const normalized = hex.length % 2 ? `${hex}0` : hex;
    return decodePdfBytes(Buffer.from(normalized, 'hex'));
  }

  function unicodeFromPdfHex(hex) {
    const buffer = Buffer.from(String(hex || '').replace(/[^0-9a-f]/gi, ''), 'hex');
    if (!buffer.length) return '';
    if (buffer.length >= 2) return decodeUtf16Be(buffer);
    return buffer.toString('utf8');
  }

  function parsePdfCMap(content, cmap) {
    const source = String(content || '');
    let section;
    const bfcharPattern = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((section = bfcharPattern.exec(source))) {
      const pairPattern = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
      let pair;
      while ((pair = pairPattern.exec(section[1]))) {
        cmap.set(pair[1].toUpperCase(), unicodeFromPdfHex(pair[2]));
      }
    }

    const bfrangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((section = bfrangePattern.exec(source))) {
      const rangePattern = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+(<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
      let range;
      while ((range = rangePattern.exec(section[1]))) {
        const start = parseInt(range[1], 16);
        const end = parseInt(range[2], 16);
        const width = range[1].length;
        if (range[4]) {
          let target = parseInt(range[4], 16);
          for (let code = start; code <= end; code += 1) {
            cmap.set(code.toString(16).toUpperCase().padStart(width, '0'), unicodeFromPdfHex(target.toString(16).padStart(range[4].length, '0')));
            target += 1;
          }
        } else if (range[5]) {
          const values = [...range[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((item) => item[1]);
          values.forEach((value, index) => {
            cmap.set((start + index).toString(16).toUpperCase().padStart(width, '0'), unicodeFromPdfHex(value));
          });
        }
      }
    }
  }

  function buildPdfCMap(streams) {
    const cmap = new Map();
    streams.forEach((stream) => {
      if (String(stream || '').includes('beginbfchar') || String(stream || '').includes('beginbfrange')) {
        parsePdfCMap(stream, cmap);
      }
    });
    return cmap;
  }

  function applyPdfCMap(hex, cmap) {
    const source = String(hex || '').toUpperCase();
    const keyLengths = [...new Set([...cmap.keys()].map((key) => key.length))].sort((a, b) => b - a);
    const out = [];
    let index = 0;

    while (index < source.length) {
      let matched = false;
      for (const length of keyLengths) {
        const part = source.slice(index, index + length);
        if (cmap.has(part)) {
          out.push(cmap.get(part));
          index += length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out.push(decodePdfBytes(Buffer.from(source.slice(index, index + 2), 'hex')));
        index += 2;
      }
    }

    return out.join('').replace(/\0/g, '').trim();
  }

  function extractPdfTextFromContent(content, cmap) {
    const chunks = [];
    const literalPattern = /\((?:\\.|[^\\()])*\)\s*Tj/g;
    const hexPattern = /<([0-9a-fA-F\s]+)>\s*Tj/g;
    const arrayPattern = /\[(.*?)\]\s*TJ/gs;

    let match;
    while ((match = literalPattern.exec(content))) {
      chunks.push(decodePdfLiteralString(match[0].replace(/\s*Tj$/, '').slice(1, -1)));
    }
    while ((match = hexPattern.exec(content))) {
      chunks.push(decodePdfHexString(match[1], cmap));
    }
    while ((match = arrayPattern.exec(content))) {
      const arrayBody = match[1];
      const parts = arrayBody.match(/\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g) || [];
      parts.forEach((part) => {
        if (part.startsWith('(')) chunks.push(decodePdfLiteralString(part.slice(1, -1)));
        else chunks.push(decodePdfHexString(part.slice(1, -1), cmap));
      });
    }

    return chunks
      .map((text) => text.replace(/\0/g, '').trim())
      .filter((text) => text && /[\p{L}\p{N}\u4e00-\u9fff]/u.test(text))
      .join('\n');
  }

  function isPdfMicroLine(line) {
    const text = String(line || '').trim();
    if (!text) return false;
    if (/^[-*+]\s+/.test(text)) return false;
    const compact = text.replace(/\s+/g, '');
    return Array.from(compact).length <= 2;
  }

  function shouldJoinPdfLines(previous, next) {
    const left = String(previous || '').trim();
    const right = String(next || '').trim();
    if (!left || !right) return false;
    if (/^#{1,6}\s+/.test(left) || /^#{1,6}\s+/.test(right)) return false;
    if (/^[-*+]\s+/.test(left) || /^[-*+]\s+/.test(right)) return false;
    if (/^\d{1,3}[.)、]\s*/.test(right)) return false;
    if (/[。！？!?；;：:]$/.test(left)) return false;
    if (/^[,，.。!?！？;；:：)]/.test(right)) return true;
    return /[\p{L}\p{N}\u4e00-\u9fff]$/u.test(left) && /^[\p{L}\p{N}\u4e00-\u9fff]/u.test(right);
  }

  function getPdfLineJoiner(previous, next) {
    const left = String(previous || '').trim();
    const right = String(next || '').trim();
    if (!left || !right) return '';
    if (/^[,，.。!?！？;；:：)]/.test(right)) return '';
    if (/[\u4e00-\u9fff]$/u.test(left) && /^[\u4e00-\u9fff]/u.test(right)) return '';
    if (/\b[A-Z]{1,8}$/u.test(left) && /^[A-Z]\b/u.test(right)) return '';
    return ' ';
  }

  function mergePdfWrappedLines(lines) {
    const merged = [];
    (lines || []).forEach((line) => {
      const current = String(line || '').trim();
      if (!current) {
        if (merged.length && merged[merged.length - 1] !== '') merged.push('');
        return;
      }

      const previous = merged[merged.length - 1];
      if (previous && shouldJoinPdfLines(previous, current)) {
        merged[merged.length - 1] = `${previous}${getPdfLineJoiner(previous, current)}${current}`;
        return;
      }

      merged.push(current);
    });
    return merged;
  }

  function isLowQualityPdfExtraction(text) {
    const source = String(text || '');
    const compact = source.replace(/\s+/g, '');
    if (!compact) return true;
    const controlCount = (source.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
    if (controlCount > 3) return true;
    if (/[锟�]/.test(source)) return true;

    const cjkCount = (compact.match(/[\u4e00-\u9fff]/g) || []).length;
    if (cjkCount >= 2) return false;
    const latinWordCount = (source.match(/[A-Za-z]{2,}/g) || []).length;
    const readableCount = cjkCount + latinWordCount * 2;
    return readableCount < 4;
  }

  function isSuspectPdfGlyphEncoding(text) {
    const source = String(text || '');
    const latinWords = source.match(/[A-Za-z]{12,}/g) || [];
    const longLatinWords = latinWords.filter((word) => word.length >= 18);
    const knownGlyphNoise = source.match(/\b(?:Rhe|Nlaybook|Buildine|Natite|Cncwfe|Copteptu|CHCRVER|Staee|chaneine|Aeentic|aeent|Nroeram|RESOWRCES)\b/gi) || [];
    const compact = source.replace(/\s+/g, '');
    const compactCjk = source.replace(/[^\u4e00-\u9fff]/g, '');
    const oddCjkTokens = source.match(/(?:学么|人未|改取|周朋|练么|可维)/g) || [];
    const cjkRatio = compact ? compactCjk.length / Array.from(compact).length : 0;
    const hasReadableCjkText = compactCjk.length >= 80 && cjkRatio >= 0.25;

    const cjkCharacters = Array.from(compactCjk);
    const uniqueCjkRatio = cjkCharacters.length
      ? new Set(cjkCharacters).size / cjkCharacters.length
      : 1;
    const sentencePunctuationCount = (source.match(/[。！？!?；;]/g) || []).length;
    const sentencePunctuationRatio = cjkCharacters.length
      ? sentencePunctuationCount / cjkCharacters.length
      : 0;
    const longestLineLength = String(source)
      .split(/\r?\n/)
      .reduce((max, line) => Math.max(max, Array.from(line.replace(/\s+/g, '')).length), 0);
    const trigramCounts = new Map();
    let maxTrigramCount = 0;
    for (let index = 0; index <= cjkCharacters.length - 3; index += 1) {
      const trigram = cjkCharacters.slice(index, index + 3).join('');
      const count = (trigramCounts.get(trigram) || 0) + 1;
      trigramCounts.set(trigram, count);
      if (count > maxTrigramCount) maxTrigramCount = count;
    }
    const hasCorruptedCjkRun = cjkCharacters.length >= 200
      && longestLineLength >= 180
      && sentencePunctuationRatio < 0.004
      && (uniqueCjkRatio < 0.28 || maxTrigramCount >= 6);

    if (knownGlyphNoise.length >= 4) return true;
    if (hasCorruptedCjkRun) return true;
    if (!hasReadableCjkText && longLatinWords.length >= 6 && latinWords.length >= 12) return true;
    return compactCjk.length >= 1000 && oddCjkTokens.length >= 8 && longLatinWords.length >= 3;
  }

  function cleanPdfExtractedText(text) {
    const lines = String(text || '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\r\n/g, '\n')
      .split('\n');
    const out = [];
    let microRun = [];
    let pendingBlankAfterMicroRun = 0;

    const flushMicroRun = () => {
      if (!microRun.length) {
        return;
      }

      const compact = microRun.join('').replace(/\s+/g, '');
      const compactLength = Array.from(compact).length;
      if (/^[A-Za-z]{2,8}$/.test(compact)) {
        out.push(compact);
      } else if (microRun.length < 4 && compactLength < 4) {
        out.push(...microRun);
      } else if (compactLength >= 4 && /[\p{L}\p{N}\u4e00-\u9fff]/u.test(compact)) {
        out.push(compact);
      }
      microRun = [];
      pendingBlankAfterMicroRun = 0;
    };

    lines.forEach((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) {
        if (microRun.length && pendingBlankAfterMicroRun < 2) {
          pendingBlankAfterMicroRun += 1;
          return;
        }
        flushMicroRun();
        if (out.length && out[out.length - 1] !== '') out.push('');
        return;
      }

      if (/^\d{1,4}$/.test(trimmed)) {
        flushMicroRun();
        return;
      }

      if (isPdfMicroLine(trimmed)) {
        microRun.push(trimmed);
        pendingBlankAfterMicroRun = 0;
        return;
      }

      flushMicroRun();
      out.push(trimmed);
    });

    flushMicroRun();
    return cleanMarkdownForStorage(mergePdfWrappedLines(out).join('\n'));
  }

  function decodePdfStream(raw, dictionary) {
    if (/\/Subtype\s*\/Image\b/.test(dictionary)) {
      return '';
    }
    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        return zlib.inflateSync(raw).toString('latin1');
      } catch (error) {
        try {
          return zlib.inflateRawSync(raw).toString('latin1');
        } catch (fallbackError) {
          return '';
        }
      }
    }
    return raw.toString('latin1');
  }

  function extractPdfStreamLength(dictionary) {
    const match = String(dictionary || '').match(/\/Length\s+(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function getPdfStreamData({ buffer, source, dictionary, streamKeywordEnd }) {
    let dataStart = streamKeywordEnd;
    if (source[dataStart] === '\r' && source[dataStart + 1] === '\n') {
      dataStart += 2;
    } else if (source[dataStart] === '\n' || source[dataStart] === '\r') {
      dataStart += 1;
    }

    const directLength = extractPdfStreamLength(dictionary);
    if (Number.isFinite(directLength) && directLength >= 0 && dataStart + directLength <= buffer.length) {
      const endstreamOffset = source.indexOf('endstream', dataStart + directLength);
      return {
        raw: buffer.slice(dataStart, dataStart + directLength),
        nextOffset: endstreamOffset > -1 ? endstreamOffset + 9 : dataStart + directLength,
      };
    }

    const streamEnd = source.indexOf('endstream', dataStart);
    if (streamEnd < 0) {
      return null;
    }

    let dataEnd = streamEnd;
    if (source[dataEnd - 2] === '\r' && source[dataEnd - 1] === '\n') {
      dataEnd -= 2;
    } else if (source[dataEnd - 1] === '\n' || source[dataEnd - 1] === '\r') {
      dataEnd -= 1;
    }

    return {
      raw: buffer.slice(dataStart, dataEnd),
      nextOffset: streamEnd + 9,
    };
  }

  function extractPdfMarkdown(bufferLike) {
    const buffer = toNodeBuffer(bufferLike);
    const source = buffer.toString('latin1');
    const streams = [];
    const streamPattern = /(<<[\s\S]{0,5000}?>>)\s*stream/g;
    let match;

    while ((match = streamPattern.exec(source))) {
      const streamData = getPdfStreamData({
        buffer,
        source,
        dictionary: match[1],
        streamKeywordEnd: streamPattern.lastIndex,
      });
      if (!streamData) break;
      streams.push(decodePdfStream(streamData.raw, match[1]));
      streamPattern.lastIndex = streamData.nextOffset;
    }

    const cmap = buildPdfCMap(streams);
    const rawText = streams
      .map((stream) => extractPdfTextFromContent(stream, cmap))
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n');

    if (isLowQualityPdfExtraction(rawText)) {
      throw new Error('PDF 文本提取质量过低，已保留原始 PDF 附件。');
    }

    const text = cleanPdfExtractedText(rawText);

    if (isSuspectPdfGlyphEncoding(text)) {
      throw new Error('PDF 文本层编码异常，已保留原始 PDF 附件。');
    }

    if (!text) {
      throw new Error('PDF 未提取到文本，已保留原始 PDF 附件。');
    }

    return text;
  }

  function extractPdfJsTextContent(textContent = {}) {
    const items = Array.isArray(textContent.items) ? textContent.items : [];
    const lines = [];
    let currentLine = '';
    let previousY = null;
    let previousItem = null;

    const flushLine = () => {
      const normalized = String(currentLine || '').replace(/\s+/g, ' ').trim();
      if (normalized) lines.push(normalized);
      currentLine = '';
    };

    for (const item of items) {
      const value = String(item && item.str || '').replace(/\u0000/g, '').trim();
      if (!value) continue;
      const transform = Array.isArray(item && item.transform) ? item.transform : [];
      const y = Number(transform[5]);
      const movedToNewLine = previousY !== null
        && Number.isFinite(y)
        && Number.isFinite(previousY)
        && Math.abs(y - previousY) > 3;
      if (previousItem && (previousItem.hasEOL === true || movedToNewLine)) flushLine();
      currentLine += `${currentLine ? ' ' : ''}${value}`;
      previousY = Number.isFinite(y) ? y : previousY;
      previousItem = item;
      if (item && item.hasEOL === true) flushLine();
    }
    flushLine();
    return cleanPdfExtractedText(lines.join('\n'));
  }

  function isUsablePdfPageText(value) {
    const text = String(value || '').trim();
    const meaningfulCharacters = text.replace(/[\s\p{P}\p{S}]/gu, '');
    return meaningfulCharacters.length >= 12;
  }

  function createPdfFallbackError(message, options = {}) {
    const error = new Error(message);
    error.code = String(options.code || 'PDF_FALLBACK_FAILED');
    error.diagnostic = options.diagnostic || null;
    return error;
  }

  function normalizePdfJsFailure(error) {
    const name = String(error && error.name || '');
    const message = String(error && error.message || error || '').trim();
    if (/PasswordException/i.test(name) || /password/i.test(message)) {
      return createPdfFallbackError(
        'PDF 已加密或需要密码，原始 PDF 附件已保留；请先解除密码后重新上传。',
        { code: 'PDF_PASSWORD_REQUIRED' },
      );
    }
    if (/InvalidPDFException|MissingPDFException|UnexpectedResponseException/i.test(name)) {
      return createPdfFallbackError(
        'PDF 文件损坏或格式不完整，原始 PDF 附件已保留；请重新导出 PDF 后上传。',
        { code: 'PDF_INVALID' },
      );
    }
    return createPdfFallbackError(
      `PDF.js 无法读取这份 PDF，原始 PDF 附件已保留：${message || '未知解析错误'}`,
      { code: 'PDFJS_OPEN_FAILED' },
    );
  }

  async function extractPdfMarkdownWithFallback(bufferLike, {
    pdfjsLib = null,
    loadPdfJs = null,
    ocrPage = null,
  } = {}) {
    let fastPathError = null;
    try {
      return {
        markdown: extractPdfMarkdown(bufferLike),
        provider: 'pdf-text-layer-fast',
        diagnostic: {
          pageCount: 0,
          textPageNumbers: [],
          ocrPageNumbers: [],
          missingPageNumbers: [],
        },
      };
    } catch (error) {
      fastPathError = error;
    }

    let resolvedPdfJs = pdfjsLib;
    if (!resolvedPdfJs && typeof loadPdfJs === 'function') {
      try {
        resolvedPdfJs = await loadPdfJs();
      } catch (error) {
        throw createPdfFallbackError(
          `PDF 快速解析失败，且 PDF.js 加载失败；原始 PDF 附件已保留：${error.message || error}`,
          { code: 'PDFJS_LOAD_FAILED' },
        );
      }
    }
    if (!resolvedPdfJs || typeof resolvedPdfJs.getDocument !== 'function') {
      throw createPdfFallbackError(
        `PDF 快速解析失败，且 PDF.js 解析器未就绪；原始 PDF 附件已保留：${fastPathError.message || fastPathError}`,
        { code: 'PDFJS_NOT_READY' },
      );
    }

    const buffer = toNodeBuffer(bufferLike);
    let loadingTask;
    let document;
    try {
      loadingTask = resolvedPdfJs.getDocument({
        data: Uint8Array.from(buffer),
        disableFontFace: false,
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: true,
      });
      document = await loadingTask.promise;
    } catch (error) {
      throw normalizePdfJsFailure(error);
    }

    const pages = [];
    const textPageNumbers = [];
    const ocrPageNumbers = [];
    const missingPageNumbers = [];
    try {
      const pageCount = Math.max(0, Number(document && document.numPages) || 0);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent({
          disableCombineTextItems: false,
          includeMarkedContent: false,
        });
        const textLayer = extractPdfJsTextContent(textContent);
        if (isUsablePdfPageText(textLayer)) {
          pages.push(textLayer);
          textPageNumbers.push(pageNumber);
          continue;
        }

        let ocrText = '';
        if (typeof ocrPage === 'function') {
          ocrText = cleanMarkdownForStorage(await ocrPage(page, {
            pageCount,
            pageNumber,
            textLayer,
          }));
        }
        if (ocrText) {
          pages.push(ocrText);
          ocrPageNumbers.push(pageNumber);
          continue;
        }
        if (textLayer) pages.push(textLayer);
        missingPageNumbers.push(pageNumber);
      }

      const markdown = cleanMarkdownForStorage(pages.filter(Boolean).join('\n\n'));
      const diagnostic = {
        pageCount,
        textPageNumbers,
        ocrPageNumbers,
        missingPageNumbers,
        fastPathError: String(fastPathError && fastPathError.message || fastPathError || ''),
      };
      if (!markdown) {
        const pageLabel = missingPageNumbers.length
          ? `第 ${missingPageNumbers.join('、')} 页`
          : '全部页面';
        throw createPdfFallbackError(
          `扫描型 PDF ${pageLabel}没有文本层，且本地 OCR 组件未就绪或未能识别；原始 PDF 附件已保留。请在插件设置中修复本地转写组件后重试。`,
          { code: 'PDF_SCAN_OCR_REQUIRED', diagnostic },
        );
      }
      return {
        markdown,
        provider: ocrPageNumbers.length
          ? 'pdfjs-text-layer+local-ocr'
          : 'pdfjs-text-layer',
        warning: missingPageNumbers.length
          ? `PDF 第 ${missingPageNumbers.join('、')} 页没有可用文本层，且本地 OCR 未能识别；其余页面已保存。`
          : '',
        diagnostic,
      };
    } finally {
      if (document && typeof document.destroy === 'function') {
        try {
          await document.destroy();
        } catch (error) {
          // Best-effort PDF.js cleanup only.
        }
      } else if (loadingTask && typeof loadingTask.destroy === 'function') {
        try {
          await loadingTask.destroy();
        } catch (error) {
          // Best-effort PDF.js cleanup only.
        }
      }
    }
  }

  return {
    cleanPdfExtractedText,
    extractDocxMarkdown,
    extractPdfMarkdown,
    extractPdfMarkdownWithFallback,
    extractPdfJsTextContent,
    isUsablePdfPageText,
  };
}

module.exports = {
  createDocumentTextExtractionHelpers,
};
