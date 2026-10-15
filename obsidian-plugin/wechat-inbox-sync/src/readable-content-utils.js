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
  function attribute(token, name) {
    const match = String(token || '').match(new RegExp('\\s' + name + '\\s*=\\s*(?:(["\\\'])([\\s\\S]*?)\\1|([^\\s"\\\'=<>`]+))', 'i'));
    return match?.[2] || match?.[3] || '';
  }
  function visualContext(node, parent = {}) {
    const style = attribute(node.token, 'style');
    const align = style.match(/(?:^|;)\s*text-align\s*:\s*(\w+)/i)?.[1];
    const size = style.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px\b/i)?.[1];
    const weight = style.match(/(?:^|;)\s*font-weight\s*:\s*(bold|normal|[1-9]00)\b/i)?.[1];
    return {
      centered: align ? align.toLowerCase() === 'center' : parent.centered,
      size: size ? Number(size) : parent.size || 0,
      allBold: weight ? /^(?:bold|[6-9]00)$/i.test(weight) : ['strong','b'].includes(node.tag) || parent.allBold,
      suppressVisual: parent.suppressVisual || attribute(node.token, 'role').toLowerCase() === 'heading' || /^(?:li|ul|ol|blockquote|pre|code|table|h[1-6])$/.test(node.tag),
    };
  }
  function visualHeading(node, context) {
    if (!node || typeof node === 'string' || !['p','section','div'].includes(node.tag) || context.suppressVisual) return null;
    const state = visualContext(node, context);
    if (!state.centered || attribute(node.token, 'role') === 'heading') return null;
    let text = '', minSize = Infinity, valid = true;
    function collect(child, inherited) {
      if (typeof child === 'string') {
        const meaningful = child.replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').trim();
        text += child;
        if (meaningful) { valid = valid && Boolean(inherited.allBold); minSize = Math.min(minSize, inherited.size); }
        return;
      }
      if (/^(?:p|section|div|br|img|a|hr|li|ul|ol|blockquote|pre|code|table|h[1-6]|video|audio|iframe)$/.test(child.tag)) { valid = false; return; }
      const next = visualContext(child, inherited);
      child.children.forEach(x => collect(x, next));
    }
    node.children.forEach(child => collect(child, state));
    text = text.replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!valid || !text || text.length > 60) return null;
    if (/^\d{1,2}$/.test(text) && minSize >= 24) return { kind: 'number', text };
    if (minSize >= 17 && (text.match(/[\p{L}]/gu) || []).length >= 2 && !/[。；;！!]/.test(text)) return { kind: 'title', text };
    return null;
  }
  function renderChildren(children, context) {
    let result = '';
    for (let i = 0; i < children.length; i++) {
      const number = visualHeading(children[i], context);
      if (number?.kind === 'number') {
        let next = i + 1;
        while (typeof children[next] === 'string' && !children[next].trim()) next++;
        const title = visualHeading(children[next], context);
        if (title?.kind === 'title') {
          result += '\n\n## ' + number.text + ' ' + title.text + '\n\n'; i = next; continue;
        }
      }
      result += render(children[i], context);
    }
    return result;
  }
  function render(node, context = {}) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    const { tag, token = '' } = node;
    const state = { ...context, ...visualContext(node, context) };
    const bold = ['strong','b'].includes(tag) || (tag === 'span' && /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(token));
    const italic = ['em','i'].includes(tag);
    if (tag === 'br') return '\n';
    if (tag === 'img' || tag === 'hr') return token;
    if (tag === 'ol' || tag === 'ul') {
      let count = Number(token.match(/\bstart=["']?(\d+)/i)?.[1] || 1);
      const items = node.children.map(child => {
        if (typeof child === 'string') return child.trim();
        if (child.tag !== 'li') return render(child, context);
        const body = render(child, { ...state, suppressVisual: true }).trim();
        const marker = tag === 'ol' ? `${count++}. ` : '- ';
        const lines = body.split('\n');
        return marker + lines[0] + lines.slice(1).map(line => '\n' + ' '.repeat(marker.length) + line).join('');
      }).filter(Boolean);
      return '\n\n' + items.join('\n') + '\n\n';
    }
    const content = renderChildren(node.children, { ...state, bold: context.bold || bold, italic: context.italic || italic });
    if (tag === 'a') return token + content + '</a>';
    if (tag === 'blockquote') return '\n\n' + content.trim().replace(/\n\s*\n(?:\s*\n)+/g, '\n\n').split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (/^h[1-6]$/.test(tag)) {
      const visible = content.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').trim();
      return '\n\n' + (visible ? '#'.repeat(Number(tag[1])) + ' ' : '') + content.trim() + '\n\n';
    }
    if (attribute(token, 'role').toLowerCase() === 'heading') {
      const level = attribute(token, 'aria-level');
      const visible = content.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ').trim();
      return '\n\n' + (visible ? '#'.repeat(/^[1-6]$/.test(level) ? Number(level) : 2) + ' ' : '') + content.trim() + '\n\n';
    }
    const visual = visualHeading(node, context);
    if (visual?.kind === 'title') return '\n\n## ' + visual.text + '\n\n';
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
