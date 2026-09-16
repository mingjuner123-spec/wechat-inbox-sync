'use strict';

function getWechatImageAssetIdentity(value) {
  let src = String(value || '')
    .replace(/\\x26amp;/gi, '&')
    .replace(/&amp;/gi, '&')
    .trim();
  if (src.startsWith('//')) src = `https:${src}`;
  src = src.replace(/^http:/i, 'https:');
  try {
    const parsed = new URL(src);
    if (parsed.hostname.toLowerCase() === 'mmbiz.qpic.cn') {
      return `https://mmbiz.qpic.cn${parsed.pathname}`;
    }
  } catch (_) {}
  return src.replace(/#.*$/, '');
}

function dedupeWechatImagePostAssets(assets) {
  const unique = [];
  const seen = new Set();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    const identity = getWechatImageAssetIdentity(asset && asset.src);
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    const localIndex = unique.length + 1;
    const alt = String(asset && asset.alt || '').trim();
    unique.push({
      ...asset,
      alt: /^贴图\s+\d+$/.test(alt) ? `贴图 ${localIndex}` : alt,
      localIndex,
    });
  });
  return unique;
}

function normalizeWechatImagePostMarkdown(markdown) {
  const seen = new Set();
  let imageIndex = 0;
  const deduped = String(markdown || '').replace(
    /!\[([^\]]*)\]\((https?:\/\/mmbiz\.qpic\.cn\/[^)\s]+)\)/gi,
    (whole, alt, src) => {
      const identity = getWechatImageAssetIdentity(src);
      if (!identity || seen.has(identity)) return '';
      seen.add(identity);
      imageIndex += 1;
      const nextAlt = /^贴图\s+\d+$/.test(String(alt || '').trim()) ? `贴图 ${imageIndex}` : alt;
      return `![${nextAlt}](${src})`;
    },
  );
  const lines = deduped.replace(/\r\n?/g, '\n').split('\n');
  const merged = [];
  lines.forEach((line) => {
    const previous = merged.length ? merged[merged.length - 1] : '';
    const current = String(line || '');
    const joinsWrappedChineseProse = previous
      && current
      && previous.trim().length >= 30
      && /[\u3400-\u9fff]$/.test(previous)
      && /^[\u3400-\u9fff]/.test(current)
      && !/^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|!\[)/.test(current);
    if (joinsWrappedChineseProse) {
      merged[merged.length - 1] = previous + current.trimStart();
    } else {
      merged.push(current);
    }
  });
  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function collectWechatImagePostStructuredAssets(pageWindow, withEvidence = false) {
  const root = pageWindow && typeof pageWindow === 'object' ? pageWindow : {};
  const lists = [];
  const candidates = [];
  try { candidates.push(root.picture_page_info_list); } catch (_) { candidates.push(null); }
  try { candidates.push(root.cgiDataNew && root.cgiDataNew.picture_page_info_list); } catch (_) { candidates.push(null); }
  try { candidates.push(root.cgiData && root.cgiData.picture_page_info_list); } catch (_) { candidates.push(null); }
  try { candidates.push(root.__QMTPL_SSR_DATA__ && root.__QMTPL_SSR_DATA__.picture_page_info_list); } catch (_) { candidates.push(null); }
  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index];
    if (Array.isArray(value) && value.length && !lists.includes(value)) lists.push(value);
  }

  const assets = [];
  const seen = new Set();
  let missingImageCount = 0;
  lists.forEach((list) => {
    missingImageCount += Math.max(0, list.length - 100);
    list.slice(0, 100).forEach((item) => {
      const value = typeof item === 'string'
        ? item
        : item && (item.cdn_url || item.url || item.image_url || item.src);
      let src = String(typeof value === 'string' ? value : '')
        .replace(/\\x26amp;/gi, '&')
        .replace(/&amp;/gi, '&')
        .trim();
      if (src.startsWith('//')) src = `https:${src}`;
      if (!/^https?:\/\/mmbiz\.qpic\.cn\/(?:mmbiz|sz_mmbiz)(?:_|\/)/i.test(src)) { missingImageCount += 1; return; }
      let identity = src.replace(/^http:/i, 'https:');
      try {
        const parsed = new URL(identity);
        if (parsed.hostname.toLowerCase() === 'mmbiz.qpic.cn') {
          identity = `https://mmbiz.qpic.cn${parsed.pathname}`;
        }
      } catch (_) {}
      if (seen.has(identity)) return;
      seen.add(identity);
      const alt = item && (item.alt || item.title || item.description);
      const width = item && ['number', 'string'].includes(typeof item.width) ? Number(item.width) : 0;
      const height = item && ['number', 'string'].includes(typeof item.height) ? Number(item.height) : 0;
      assets.push({
        src,
        alt: typeof alt === 'string' ? alt.trim() : '',
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0,
      });
    });
  });
  return withEvidence ? { assets, expectedImageCount: assets.length + missingImageCount } : assets;
}


// Shared between static extraction and the isolated browser. Generic bundle
// strings (from_masonry/image_list/swiper) are not page identity.
function detectWechatImagePostDocument({ html = '', url = '', bodyText = '', hasBody = false, structuredCount = 0 } = {}) {
  try { if (new URL(url).searchParams.get('t') === 'pages/image_detail') return true; } catch (_) {}
  const source = String(html || '');
  // Current /s/<slug> picture posts declare appmsg_type=9, without a
  // newspic marker or image_detail URL. Only accept a page-level declaration,
  // not a matching string inside a shared JavaScript bundle.
  const numericPictureType = Array.from(source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
    .some((match) => /(?:^|[;\n])\s*(?:var|let|const)\s+appmsg_type\s*=\s*(?:"9"|'9'|9)(?=\s*(?:[;,\n]|$))/.test(match[1]));
  const explicitType = /(?:\b(?:var|let|const)\s+(?:article_type|appmsg_type)|(?:window\.)?(?:cgiDataNew|cgiData|__QMTPL_SSR_DATA__)\.(?:article_type|appmsg_type))\s*=\s*["']newspic["']/i.test(source)
    || /(?:window\.)?(?:cgiDataNew|cgiData|__QMTPL_SSR_DATA__)\s*=\s*\{[^{}]{0,4096}\b(?:article_type|appmsg_type)["']?\s*:\s*["']newspic["']/i.test(source);
  if (explicitType || numericPictureType || structuredCount > 0) return true;
  if (hasBody && String(bodyText).replace(/\s+/g, '').length >= 200) return false;
  const visibleMarkup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  return /class=["'][^"']*(?:image[_-]detail|pic[_-]album|newspic)[^"']*["']/i.test(visibleMarkup)
    && /<img\b[^>]*(?:data-src|src)=["'](?:https?:)?\/\/mmbiz\.qpic\.cn\//i.test(visibleMarkup);
}

// Read page data as a small, bounded literal grammar. Never execute a page's
// scripts (eval/vm/Function); unknown expressions simply leave browser fallback.
function readWechatImagePostHtmlData(html) {
  const source = String(html || '');
  const empty = { assets: [], invalidImageCount: 0, parsed: false, parseState: 'absent', title: '', description: '' };
  if (source.length > 8 * 1024 * 1024) return { ...empty, parseState: 'limit' };
  let nodes = 0;
  let readFailures = 0;
  function readLiteral(text, start) {
    let pos = start;
    const limit = Math.min(text.length, start + 512 * 1024);
    const skip = () => { while (pos < limit && /\s/.test(text[pos])) pos += 1; };
    function value(depth = 0) {
      if (depth > 30 || ++nodes > 30000 || pos >= limit) throw new Error('data limit');
      skip();
      const ch = text[pos];
      let result;
      if (ch === '"' || ch === "'") {
        pos += 1;
        result = '';
        let closed = false;
        while (pos < limit) {
          let next = text[pos++];
          if (next === ch) { closed = true; break; }
          if (next === '\\') {
            next = text[pos++];
            if (next === 'x' || next === 'u') {
              const size = next === 'x' ? 2 : 4;
              const hex = text.slice(pos, pos + size);
              if (!new RegExp(`^[a-fA-F0-9]{${size}}$`).test(hex)) throw new Error('invalid escape');
              result += String.fromCharCode(parseInt(hex, 16)); pos += size;
            } else {
              const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
              result += Object.prototype.hasOwnProperty.call(escapes, next) ? escapes[next] : next;
            }
          } else result += next;
        }
        if (!closed) throw new Error('unterminated string');
      } else if (ch === '{' || ch === '[') {
        const object = ch === '{';
        const end = object ? '}' : ']';
        result = object ? Object.create(null) : [];
        pos += 1; skip();
        while (pos < limit && text[pos] !== end) {
          let key;
          if (object) {
            if (text[pos] === '"' || text[pos] === "'") key = value(depth + 1);
            else {
              const identifier = /^[A-Za-z_$][\w$]*/.exec(text.slice(pos));
              if (!identifier) throw new Error('invalid key');
              key = identifier[0]; pos += key.length;
            }
            skip(); if (text[pos++] !== ':') throw new Error('expected colon');
          }
          const entry = value(depth + 1);
          if (object) result[key] = entry; else result.push(entry);
          skip();
          if (text[pos] === end) break;
          if (text[pos++] !== ',') throw new Error('expected comma');
          skip();
        }
        if (text[pos++] !== end) throw new Error('unterminated data');
      } else {
        const primitive = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(pos));
        if (!primitive) throw new Error('unsupported expression');
        result = JSON.parse(primitive[0]); pos += primitive[0].length;
      }
      skip();
      // WeChat renders numeric fields as '1080' * 1.
      if (text.slice(pos, pos + 1) === '*' && /^[*]\s*1\b/.test(text.slice(pos))) {
        const multiply = /^[*]\s*1\b/.exec(text.slice(pos))[0];
        if (!['number', 'string'].includes(typeof result) || !Number.isFinite(Number(result))) throw new Error('invalid number');
        result = Number(result); pos += multiply.length; skip();
      }
      return result;
    }
    const result = value();
    if (!/[;,\n}\s]/.test(text[pos] || ';')) throw new Error('unsupported expression suffix');
    return result;
  }
  const roots = [];
  for (const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const assignment = /(?:^|[;\n])\s*(?:(?:var|let|const)\s+)?(?:window\.)?(cgiDataNew|cgiData|__QMTPL_SSR_DATA__|picture_page_info_list)\s*=\s*(?=[{[])/g;
    for (const match of script[1].matchAll(assignment)) {
      try {
        const data = readLiteral(script[1], match.index + match[0].length);
        const root = match[1] === 'picture_page_info_list' ? { picture_page_info_list: data } : data;
        if (root && Array.isArray(root.picture_page_info_list) && root.picture_page_info_list.length) roots.push(root);
      } catch (_) { readFailures += 1; /* Keep the browser path for unfamiliar JavaScript. */ }
      if (roots.length >= 8 || nodes > 30000) break;
    }
    if (roots.length >= 8 || nodes > 30000) break;
  }
  if (!roots.length) return { ...empty, parseState: readFailures ? 'unsupported-literal' : 'absent' };
  const assets = dedupeWechatImagePostAssets(roots.flatMap(root => collectWechatImagePostStructuredAssets(root)));
  const invalidImageCount = roots.reduce((count, root) => count + root.picture_page_info_list.filter(item => (
    !collectWechatImagePostStructuredAssets({ picture_page_info_list: [item] }).length
  )).length + Math.max(0, root.picture_page_info_list.length - 100), 0);
  return { assets, invalidImageCount, parsed: true, parseState: 'parsed',
    title: typeof roots[0].title === 'string' ? roots[0].title.slice(0, 500) : '',
    description: typeof roots[0].desc === 'string' ? roots[0].desc.slice(0, 20000) : '' };
}

module.exports = {
  readWechatImagePostHtmlData,
  detectWechatImagePostDocument,
  collectWechatImagePostStructuredAssets,
  dedupeWechatImagePostAssets,
  getWechatImageAssetIdentity,
  normalizeWechatImagePostMarkdown,
};
