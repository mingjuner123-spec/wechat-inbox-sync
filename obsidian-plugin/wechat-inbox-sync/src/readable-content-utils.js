'use strict';

// Only a terminal run of explicit sound annotations is noise. Spoken words,
// mid-speech annotations and repetitions of real sentences are not evidence.
const SOUND_LINE = /^(?:\(\s*(?:音乐|音樂|静音|靜音|music|silence)\s*\)|（\s*(?:音乐|音樂|静音|靜音|music|silence)\s*）|\[\s*(?:音乐|音樂|静音|靜音|music|silence)\s*\])[\s.。!！…]*$/iu;
const CREDIT_LINE = /^(?:\((?:CC\s*)?(?:字幕制作|字幕製作|字幕|subtitles?)\s*[:：]\s*[^()\r\n]{1,50}\)|（(?:CC\s*)?(?:字幕制作|字幕製作|字幕)\s*[:：]\s*[^（）\r\n]{1,50}）)[.。\s]*$/iu;
const PUNCTUATION_LINE = /^[.。…\s]+$/u;

function hasOnlySoundAnnotations(text) {
  const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return lines.some(x => SOUND_LINE.test(x))
    && lines.every(x => SOUND_LINE.test(x) || CREDIT_LINE.test(x) || PUNCTUATION_LINE.test(x));
}

function cleanTranscriptionTail(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  let index = lines.length - 1, markers = 0;
  while (index >= 0) {
    const line = lines[index].trim();
    if (SOUND_LINE.test(line)) markers++;
    else if (line && !CREDIT_LINE.test(line) && !PUNCTUATION_LINE.test(line)) break;
    index--;
  }
  const prefix = lines.slice(0, index + 1).join('\n').trim();
  if (markers >= 2 && (prefix.match(/[\p{L}\p{N}]/gu) || []).length >= 20) return prefix;
  return source.trim();
}

function formatTranscriptForReading(text) {
  const source = cleanTranscriptionTail(text);
  if (!source) return '';
  // Already-structured Markdown must retain code, lists, timestamps and links.
  if (/^(?:\s*(?:```|~~~|#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|\|)|\s*\[?\d{1,2}:\d{2})/m.test(source)
    || /!?\[[^\]\n]*\]\(/.test(source)) return source;
  const paragraphs = [];
  for (const block of source.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
    let joined = '';
    for (const line of lines) {
      // Never concatenate two English words while joining subtitle fragments.
      const separator = /[\p{Script=Han}]$/u.test(joined) && /^[\p{Script=Han}]/u.test(line) ? '' : ' ';
      joined += (joined ? separator : '') + line;
    }
    // Sentence boundaries only; do not insert punctuation or split a word.
    const sentences = joined.match(/[\s\S]+?(?:[。！？!?]+[”’」』"']*|\.(?=\s|$)|$)/gu) || [];
    let paragraph = '';
    for (const sentence of sentences) {
      if (paragraph.length >= 140) { paragraphs.push(paragraph.trim()); paragraph = ''; }
      // Some recognizers emit no punctuation but separate phrases with spaces.
      // Use only those existing boundaries; never cut an unbroken token.
      const parts = sentence.length > 500 ? sentence.match(/\S+\s*|\s+/g) || [sentence] : [sentence];
      for (const part of parts) {
        if (paragraph.length >= 240 && /\s$/.test(paragraph)) { paragraphs.push(paragraph.trim()); paragraph = ''; }
        paragraph += part;
      }
    }
    if (paragraph.trim()) paragraphs.push(paragraph.trim());
  }
  return paragraphs.join('\n\n');
}

// Self-contained: injected into the hidden browser as well as tested in Node.
function prepareBrowserArticleImages(root, baseUrl) {
  const assets = [];
  root.querySelectorAll('img').forEach(image => {
    let src = '';
    const candidates = [image.currentSrc, image.getAttribute('data-src'), image.getAttribute('data-original'), image.getAttribute('data-lazy-src'), image.getAttribute('src')];
    for (const candidate of candidates) {
      if (!candidate || /^data:/i.test(candidate)) continue;
      try { const url = new URL(String(candidate).trim(), baseUrl); if (/^https?:$/.test(url.protocol)) { src = url.href; break; } } catch (_) { /* Try the next explicit image source. */ }
    }
    if (!src) { image.remove(); return; }
    const alt = String(image.getAttribute('alt') || image.getAttribute('data-alt') || '图片').replace(/\s+/g, ' ').trim();
    assets.push({ src, alt });
    image.setAttribute('src', src); image.setAttribute('alt', alt);
    for (const attribute of ['srcset','data-src','data-original','data-lazy-src','data-fail']) image.removeAttribute(attribute);
  });
  return assets;
}

// Preserve semantic blocks before the existing URL/image/table converter.
// Preformatted code and tables are opaque here and retain their old converter.
function preserveHtmlReadingStructure(html) {
  const protectedBlocks = [];
  const input = String(html || '').replace(/<(pre|table|script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, block => {
    const marker = `\uE000READABLE${protectedBlocks.length}\uE001`;
    protectedBlocks.push(block); return marker;
  });
  const root = { tag: '', children: [] }, stack = [root];
  const tokens = input.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+|</g) || [];
  for (const token of tokens) {
    const match = token.match(/^<(\/?)\s*([a-z][\w-]*)\b[^>]*>/i);
    if (!match) { stack[stack.length - 1].children.push(token); continue; }
    const closing = Boolean(match[1]), tag = match[2].toLowerCase();
    if (closing) {
      const index = stack.map(x => x.tag).lastIndexOf(tag);
      if (index > 0) stack.length = index;
    } else {
      const node = { tag, token, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!['br','img','hr','input','meta','link','source','wbr','area','base','embed'].includes(tag) && !/\/\s*>$/.test(token)) stack.push(node);
    }
  }
  function render(node, context = {}) {
    if (typeof node === 'string') return node;
    const { tag, token = '' } = node;
    const bold = ['strong','b'].includes(tag) || (tag === 'span' && /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(token));
    const italic = ['em','i'].includes(tag);
    if (tag === 'br') return '\n';
    if (tag === 'img' || tag === 'hr') return token;
    if (tag === 'ol' || tag === 'ul') {
      let count = Number(token.match(/\bstart=["']?(\d+)/i)?.[1] || 1);
      const items = node.children.map(child => {
        if (typeof child === 'string') return child.trim();
        if (child.tag !== 'li') return render(child, context);
        const body = render(child, context).trim();
        const marker = tag === 'ol' ? `${count++}. ` : '- ';
        const lines = body.split('\n');
        return marker + lines[0] + lines.slice(1).map(line => '\n' + ' '.repeat(marker.length) + line).join('');
      }).filter(Boolean);
      return '\n\n' + items.join('\n') + '\n\n';
    }
    const content = node.children.map(child => render(child, { ...context, bold: context.bold || bold, italic: context.italic || italic })).join('');
    if (tag === 'a') return token + content + '</a>';
    if (tag === 'blockquote') return '\n\n' + content.trim().replace(/\n\s*\n(?:\s*\n)+/g, '\n\n').split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (/^h[1-6]$/.test(tag)) {
      const visible = content.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').trim();
      return '\n\n' + (visible ? '#'.repeat(Number(tag[1])) + ' ' : '') + content.trim() + '\n\n';
    }
    if (['p','div','section','article','main','header','footer'].includes(tag)) return '\n\n' + content.trim() + '\n\n';
    const marker = bold && !context.bold ? '**' : italic && !context.italic ? '*' : '';
    if (marker) return content.split(/(\n\s*\n)/).map(part => {
      if (!part.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').trim()) return part;
      return part.replace(/^(\s*)([\s\S]*?\S)(\s*)$/, (_, before, value, after) => before + marker + value + marker + after);
    }).join('');
    return content;
  }
  const out = render(root);
  return out.replace(/\uE000READABLE(\d+)\uE001/g, (_, index) => protectedBlocks[Number(index)]);
}

module.exports = { cleanTranscriptionTail, formatTranscriptForReading, hasOnlySoundAnnotations, preserveHtmlReadingStructure, prepareBrowserArticleImages };
