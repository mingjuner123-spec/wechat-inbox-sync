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

function collectWechatImagePostStructuredAssets(pageWindow) {
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
  lists.forEach((list) => {
    list.slice(0, 100).forEach((item) => {
      const value = typeof item === 'string'
        ? item
        : item && (item.cdn_url || item.url || item.image_url || item.src);
      let src = String(value || '')
        .replace(/\\x26amp;/gi, '&')
        .replace(/&amp;/gi, '&')
        .trim();
      if (src.startsWith('//')) src = `https:${src}`;
      if (!/^https?:\/\/mmbiz\.qpic\.cn\/(?:mmbiz|sz_mmbiz)(?:_|\/)/i.test(src)) return;
      let identity = src.replace(/^http:/i, 'https:');
      try {
        const parsed = new URL(identity);
        if (parsed.hostname.toLowerCase() === 'mmbiz.qpic.cn') {
          identity = `https://mmbiz.qpic.cn${parsed.pathname}`;
        }
      } catch (_) {}
      if (seen.has(identity)) return;
      seen.add(identity);
      assets.push({
        src,
        alt: String(item && (item.alt || item.title || item.description) || '').trim(),
        width: Number(item && item.width) || 0,
        height: Number(item && item.height) || 0,
      });
    });
  });
  return assets;
}

module.exports = {
  collectWechatImagePostStructuredAssets,
  dedupeWechatImagePostAssets,
  getWechatImageAssetIdentity,
  normalizeWechatImagePostMarkdown,
};
