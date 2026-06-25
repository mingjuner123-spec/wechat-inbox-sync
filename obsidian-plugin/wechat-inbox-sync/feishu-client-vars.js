function collectJsonStringValues(source, keys) {
  const values = [];
  const keyPattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`["'](?:${keyPattern})["']\\s*:\\s*["']((?:\\\\.|[^"'\\\\])*)["']`, 'gi');
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    if (match[1]) values.push(decodeJsonStringLiteral(match[1]));
  }
  return values;
}

function decodeJsonStringLiteral(value) {
  try {
    return JSON.parse(`"${String(value || '').replace(/"/g, '\\"')}"`);
  } catch (error) {
    return String(value || '');
  }
}

function pushUniqueUrl(list, value) {
  const url = String(value || '').trim();
  if (!url || list.includes(url)) return;
  list.push(url);
}

function isLikelyImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  if (/^data:image\//i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  return /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(url)
    || /(?:image|img|pic|photo|tos-cn|feishu|lark)/i.test(url);
}

function collectFeishuImageUrls(source) {
  const urls = [];
  collectJsonStringValues(source, [
    'url',
    'src',
    'image',
    'imageUrl',
    'image_url',
    'originUrl',
    'origin_url',
    'downloadUrl',
    'download_url',
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}

function shouldDropFeishuLine(line, title) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^图\s*\d+$/i.test(text)) return true;
  if (/^(?:上传日志|联系客服|功能更新|帮助中心|效率指南)$/.test(text)) return true;
  const normalizedTitle = String(title || '').replace(/\s+/g, '').trim();
  if (normalizedTitle && text.replace(/\s+/g, '').trim() === normalizedTitle) return true;
  return false;
}

function formatFeishuHeadingLine(line) {
  const text = String(line || '').trim();
  if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text)) {
    return text;
  }
  return text;
}

function unwrapFeishuClientVarsPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.block_map || payload.blockMap) return payload;
  if (payload.data && typeof payload.data === 'object') return unwrapFeishuClientVarsPayload(payload.data);
  if (payload.CLIENT_VARS && typeof payload.CLIENT_VARS === 'object') return unwrapFeishuClientVarsPayload(payload.CLIENT_VARS);
  if (payload.clientVars && typeof payload.clientVars === 'object') return unwrapFeishuClientVarsPayload(payload.clientVars);
  return null;
}

function collectFeishuRichText(value, output = [], key = '') {
  if (value === undefined || value === null) return output;
  const normalizedKey = String(key || '').toLowerCase();
  if (typeof value === 'string') {
    if (['text', 'content', 'title', 'name', 'plain_text', 'plainText'].some((item) => normalizedKey === item.toLowerCase())) {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text) output.push(text);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuRichText(item, output, key));
    return output;
  }
  if (typeof value !== 'object') return output;

  if (['text', 'content', 'title', 'name', 'plain_text', 'plaintext'].includes(normalizedKey)) {
    Object.values(value).forEach((item) => {
      if (typeof item === 'string') {
        const text = item.replace(/\s+/g, ' ').trim();
        if (text) output.push(text);
      }
    });
  }

  if (value.initialAttributedTexts && typeof value.initialAttributedTexts === 'object') {
    collectFeishuRichText(value.initialAttributedTexts, output, 'text');
  }
  if (value.text && typeof value.text === 'object' && value.text.initialAttributedTexts) {
    collectFeishuRichText(value.text, output, 'text');
  }
  if (value.nodes && Array.isArray(value.nodes)) {
    value.nodes.forEach((node) => collectFeishuRichText(node, output, 'text'));
  }

  Object.entries(value).forEach(([childKey, childValue]) => {
    if (['id', 'token', 'parent_id', 'parentId', 'children', 'type', 'block_type'].includes(childKey)) return;
    collectFeishuRichText(childValue, output, childKey);
  });
  return output;
}

function getFeishuBlockType(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  return String(data.type || data.block_type || block.type || block.block_type || '').toLowerCase();
}

function getFeishuBlockText(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  return Array.from(new Set(collectFeishuRichText(data)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectFeishuTableRowsFromValue(value, rows = []) {
  if (!value) return rows;
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => Array.isArray(item) || (item && typeof item === 'object' && Array.isArray(item.cells)))) {
      value.forEach((row) => {
        const cells = Array.isArray(row) ? row : row.cells;
        const next = cells.map((cell) => getFeishuBlockText(cell) || collectFeishuRichText(cell).join(' ')).map((cell) => String(cell || '').trim());
        if (next.some(Boolean)) rows.push(next);
      });
      return rows;
    }
    value.forEach((item) => collectFeishuTableRowsFromValue(item, rows));
    return rows;
  }
  if (typeof value !== 'object') return rows;

  const directRows = value.rows || value.row_list || value.rowList;
  if (Array.isArray(directRows)) {
    collectFeishuTableRowsFromValue(directRows, rows);
  }

  const cells = value.cells || value.cell_list || value.cellList;
  if (Array.isArray(cells) && cells.length) {
    const matrix = [];
    cells.forEach((cell, index) => {
      const rowIndex = Number(cell.row || cell.rowIndex || cell.row_index || cell.r || 0);
      const colIndex = Number(cell.col || cell.colIndex || cell.col_index || cell.c || index);
      if (!matrix[rowIndex]) matrix[rowIndex] = [];
      matrix[rowIndex][colIndex] = getFeishuBlockText(cell) || collectFeishuRichText(cell).join(' ');
    });
    matrix.filter(Boolean).forEach((row) => {
      const normalized = row.map((cell) => String(cell || '').trim());
      if (normalized.some(Boolean)) rows.push(normalized);
    });
  }
  return rows;
}

function formatMarkdownTableRows(rows) {
  const normalizedSource = (rows || []).filter((row) => Array.isArray(row) && row.some(Boolean));
  if (!normalizedSource.length) return '';
  const columnCount = Math.max(...normalizedSource.map((row) => row.length));
  const normalizedRows = normalizedSource.map((row) => {
    const next = row.map((cell) => String(cell || '').replace(/\|/g, '\\|').trim()).slice(0, columnCount);
    while (next.length < columnCount) next.push('');
    return next;
  });
  const header = normalizedRows[0];
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function formatFeishuClientVarTableBlock(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const rows = collectFeishuTableRowsFromValue(data, []);
  if (rows.length < 2) return '';
  return formatMarkdownTableRows(rows);
}

function collectFeishuBlockImageUrls(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const urls = [];
  collectFeishuImageUrls(JSON.stringify(data || {})).forEach((url) => pushUniqueUrl(urls, url));
  collectJsonStringValues(JSON.stringify(data || {}), [
    'origin_url',
    'originUrl',
    'preview_url',
    'previewUrl',
    'download_url',
    'downloadUrl',
    'src',
    'url',
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}

function getFeishuHeadingLevelFromBlock(block, type) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const headingMatch = String(type || '').match(/heading[_-]?([1-6])|h([1-6])/);
  if (headingMatch) return Number(headingMatch[1] || headingMatch[2] || 1);
  const numericLevel = Number(data.heading_level || data.headingLevel || data.level || data.text_level || data.textLevel || 0);
  return numericLevel >= 1 && numericLevel <= 6 ? numericLevel : 0;
}

function formatFeishuClientVarBlock(block) {
  const text = getFeishuBlockText(block);
  const type = getFeishuBlockType(block);

  if (/table|sheet|grid/i.test(type)) {
    const table = formatFeishuClientVarTableBlock(block);
    if (table) return table;
  }

  if (/image|picture|diagram/i.test(type)) {
    const imageUrls = collectFeishuBlockImageUrls(block);
    if (imageUrls.length) {
      return imageUrls.map((url, index) => `![图片${index ? ` ${index + 1}` : ''}](${url})`).join('\n\n');
    }
  }

  if (!text || shouldDropFeishuLine(text, '')) return '';
  const headingLevel = getFeishuHeadingLevelFromBlock(block, type);
  if (headingLevel) {
    const level = headingLevel;
    return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}`;
  }
  if (/bullet|unordered|todo|check/.test(type)) return `- ${text}`;
  if (/ordered|number/.test(type)) return `1. ${text}`;
  return formatFeishuHeadingLine(text);
}

function extractFeishuMarkdownFromClientVars(payload) {
  const clientVars = unwrapFeishuClientVarsPayload(payload);
  const blockMap = clientVars && (clientVars.block_map || clientVars.blockMap);
  if (!blockMap || typeof blockMap !== 'object') {
    throw new Error('飞书 client_vars 中未找到 block_map');
  }

  const sequence = Array.isArray(clientVars.block_sequence)
    ? clientVars.block_sequence
    : (Array.isArray(clientVars.blockSequence) ? clientVars.blockSequence : Object.keys(blockMap));
  const seen = new Set();
  const lines = [];
  sequence.forEach((id) => {
    const block = blockMap[id];
    if (!block) return;
    const type = getFeishuBlockType(block);
    if (type === 'page' || type === 'root') return;
    const line = formatFeishuClientVarBlock(block);
    if (!line || seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  });

  const markdown = lines.join('\n\n').trim();
  if (markdown.length < 20) {
    throw new Error('飞书 client_vars 中未提取到正文');
  }
  return markdown;
}

module.exports = {
  collectFeishuRichText,
  collectFeishuTableRowsFromValue,
  extractFeishuMarkdownFromClientVars,
  formatFeishuClientVarBlock,
  formatMarkdownTableRows,
  unwrapFeishuClientVarsPayload,
};
