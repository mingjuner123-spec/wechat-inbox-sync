function stripMarkdownCodeBlocks(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
}


function normalizeTitleForCompare(text) {
  return String(text || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[-–—]\s*飞书云文档\s*$/i, '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeFeishuMarkdownLine(line) {
  return String(line || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/^-\s*$/, '')
    .replace(/^-\s+/, '- ')
    .replace(/^Plain Text复制$/i, '')
    .replace(/^代码块$/i, '')
    .trim();
}

function shouldDropFeishuLine(line, title) {
  const text = String(line || '').trim();
  if (!text) return true;
  const plainText = text.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').trim();
  const normalized = normalizeTitleForCompare(text);
  const normalizedTitle = normalizeTitleForCompare(title);
  const noise = new Set([
    '飞书云文档',
    '与我分享',
    '登录/注册',
    '帮助中心',
    '效率指南',
    '添加快捷方式',
    '最近修改',
    '搜索',
    '墨度',
    '莞尔',
    '分享',
    '回复...',
    '附件不支持打印',
    '上传日志',
    '联系客服',
    '功能更新',
    'header-v2',
    '评论（0）',
    '跳转至首条评论',
    'Plain Text',
    'Plain Text复制',
    '复制',
    'Bash',
    '重播',
    '播放',
    '直播',
    '进入全屏',
    '画中画',
    '原画',
    '点击按住可拖动视频',
    '星辰大海',
    '蟹',
    '蟹老板-老王1',
    '正在以画中画形式播放',
    '语句划分',
    '音频时长核定',
    '画面规划',
    '画面代码审查',
    '多AIAGENT优化',
    '人点赞',
  ]);
  if (noise.has(text) || noise.has(plainText)) return true;
  if (/^\d{1,3}%$/.test(plainText)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:KB|MB|GB)$/i.test(plainText)) return true;
  if (/^(?:-\s*)?\d{3,4}p$/i.test(plainText)) return true;
  if (/^(?:-\s*)?\d+(?:\.\d+)?x$/i.test(plainText)) return true;
  if (/^\d{1,2}月\d{1,2}日修改$/.test(plainText)) return true;
  if (/^(?:\d{1,2}:\d{2}|\/|[0-9]+(?:\.[0-9]+)?x)$/.test(plainText)) return true;
  if (/^\S{1,30}的云文档$/.test(plainText)) return true;
  if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/u.test(plainText)) return true;
  if (normalizedTitle && normalized.includes(normalizedTitle) && normalized !== normalizedTitle && normalized.length <= normalizedTitle.length + 24) return true;
  if (/添加快捷方式\s*最近修改\s*[:：]?/.test(text)) return true;
  if (/^最近修改\s*[:：]?/.test(text)) return true;
  if (/^你可能还想问/.test(text)) return true;
  if (/^查询.*更多相关内容$/.test(text)) return true;
  if (/^推荐内容由\s*AI\s*生成$/i.test(text)) return true;
  if (/^加载中/.test(text)) return true;
  if (/^本文暂未(?:引用|被).*文档/.test(text)) return true;
  if (/^取消发送$/.test(text)) return true;
  if (/^\d+\s*人点赞$/.test(text)) return true;
  if (/^-\s+.+\s-\s+.+/.test(text) && text.length > 40) return true;
  if (/^-\s*(?:上传日志|联系客服|功能更新|帮助中心|效率指南)$/.test(text)) return true;
  if (/^-\s*(?:第[一二三四五六七八九十\d]+(?:次|个)?风口|规律：|什么是|举个例子|知识付费|最后|第[一二三四五六七八九十\d]+[步层：])/.test(text)) return true;
  if (/^图\s*\d+$/i.test(text)) return true;
  if (/^\d{1,2}$/.test(text)) return true;
  if (/^\+\d+$/.test(text)) return true;
  if (/^共有\s*\d+\s*个协作者$/.test(text)) return true;
  if (/^最近修改\s*[:：]?\s*/.test(text)) return true;
  if (/^昨天\s*\d{1,2}:\d{2}$/.test(text)) return true;
  if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text)) return true;
  if (/^最新修改时间为/.test(text)) return true;
  if (/^\d+\s*字$/.test(text)) return true;
  if (/^评论/.test(text)) return true;
  if (/^[春壹始]$/.test(text)) return true;
  if (/^[\u4e00-\u9fa5]{1,4}$/.test(text) && /(?:斤|斧|淇|钖|作者|头像)/.test(text)) return true;
  if (/成长笔记(?:昨天\s*\d{1,2}:\d{2})?$/.test(text)) return true;
  if (/^春树.*云文档$/.test(text)) return true;
  if (normalizedTitle && normalized === normalizedTitle) return true;
  return false;
}

function formatFeishuHeadingLine(line) {
  const text = String(line || '').trim();
  if (/^#\s+(?:创建项目|或者克隆|应输出)/.test(text)) return `\\${text}`;
  if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text)) {
    return text;
  }
  const numericSection = text.match(/^(\d+)\.(\d{1,3})(.+)$/);
  if (numericSection && Number(numericSection[1]) <= 6 && !/^(?:[+]|MB|GB|KB|（推荐|推荐)/i.test(numericSection[3].trim())) {
    return numericSection[2].length >= 2 ? `### ${text}` : `## ${text}`;
  }
  const length = Array.from(text).length;
  if (length >= 4 && length <= 34) {
    if (/^[一二三四五六七八九十]+[、.．]\s*.+/.test(text)) return `# ${text}`;
    if (/^[（(]\d+[）)]\s*.+/.test(text)) return `### ${text}`;
    if (/^\d{4}年之前，我没有任何目标$/.test(text)) return `## ${text}`;
    if (/^(第[一二三四五六七八九十\d]+[、.．]?\s*)?[^，。！？!?]{0,16}风口[：:]/.test(text)) return `## ${text}`;
    if (/^(什么是.+原理|举个例子|最后|知识付费的下一个形态)$/.test(text)) return `## ${text}`;
    if (/^第[一二三四五六七八九十\d]+[步层：:]/.test(text)) return `### ${text}`;
  }
  return text;
}

function isFeishuTocBulletLine(line) {
  const text = String(line || '').trim().replace(/^[-*]\s+/, '');
  return /^[一二三四五六七八九十]+[、.．]/.test(text)
    || /^\d+\.\d/.test(text)
    || /^[（(]\d+[）)]/.test(text)
    || /^第[一二三四五六七八九十\d]+[步层：:]/.test(text)
    || /^.+(?:成果|经验|收获|流程|配置|安装|教学|优化|什么|想法|视频|画面|审查|制作|下一步).*$/.test(text);
}

function removeFeishuTocBlocks(lines) {
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    if (!/^[-*]\s+/.test(line.trim())) {
      output.push(line);
      continue;
    }
    const block = [];
    let cursor = index;
    while (cursor < lines.length && /^[-*]\s+/.test(String(lines[cursor] || '').trim())) {
      block.push(String(lines[cursor] || ''));
      cursor += 1;
    }
    const tocCount = block.filter(isFeishuTocBulletLine).length;
    if (block.length >= 4 && tocCount >= Math.ceil(block.length * 0.65)) {
      index = cursor - 1;
      continue;
    }
    output.push(...block);
    index = cursor - 1;
  }
  return output;
}

function repairFeishuMarkdownTables(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = String(lines[index] || '').trim();
    if (current === '|') continue;
    const nextNonBlank = [];
    let scan = index;
    while (scan < lines.length && nextNonBlank.length < 8) {
      const value = String(lines[scan] || '').trim();
      if (value && value !== '|') nextNonBlank.push({ value, index: scan });
      scan += 1;
    }
    let headers = null;
    let separatorPattern = null;
    if (
      current === '组件'
      && nextNonBlank.some((item) => item.value === '要求')
      && nextNonBlank.some((item) => item.value === '说明')
    ) {
      headers = ['组件', '要求', '说明'];
      separatorPattern = /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|$/;
    } else if (
      current === '序号'
      && nextNonBlank.some((item) => item.value === '版本')
      && nextNonBlank.some((item) => item.value === '用途')
      && nextNonBlank.some((item) => item.value === '是否必须')
    ) {
      headers = ['序号', '版本', '用途', '是否必须'];
      separatorPattern = /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*(?:\|\s*---\s*)?\|$/;
    }
    if (!headers || !nextNonBlank.some((item) => separatorPattern.test(item.value))) {
      output.push(lines[index]);
      continue;
    }

    const separator = nextNonBlank.find((item) => separatorPattern.test(item.value));
    const cells = [];
    let cursor = separator.index + 1;
    while (cursor < lines.length) {
      const value = String(lines[cursor] || '').trim();
      if (!value) {
        cursor += 1;
        continue;
      }
      if (value === '|' || /^#{1,6}\s+/.test(value) || /^!\[/.test(value) || /^\[[^\]]+]\(/.test(value)) break;
      if (headers.includes(value) && cells.length) break;
      if (shouldDropFeishuLine(value, '')) {
        cursor += 1;
        continue;
      }
      cells.push(value.replace(/\|/g, '\\|'));
      cursor += 1;
      if (cells.length >= 30) break;
    }
    const rows = [];
    for (let cellIndex = 0; cellIndex + headers.length - 1 < cells.length; cellIndex += headers.length) {
      rows.push(cells.slice(cellIndex, cellIndex + headers.length));
    }
    if (rows.length) {
      output.push(`| ${headers.join(' | ')} |`);
      output.push(`| ${headers.map(() => '---').join(' | ')} |`);
      rows.forEach((row) => output.push(`| ${row.join(' | ')} |`));
      index = Math.max(index, cursor - 1);
      continue;
    }
    output.push(lines[index]);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function removeFeishuResidualTableLines(markdown) {
  const residue = new Set(['组件', '要求', '说明', 'CPU', '内存', '硬盘', '序号', '版本', '用途', '是否必须']);
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  let recentlySawTable = 0;
  lines.forEach((line) => {
    const text = String(line || '').trim();
    if (/^\|.+\|$/.test(text)) {
      recentlySawTable = 8;
      output.push(line);
      return;
    }
    if (recentlySawTable > 0 && residue.has(text)) {
      recentlySawTable -= 1;
      return;
    }
    if (recentlySawTable > 0) recentlySawTable -= 1;
    output.push(line);
  });
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isFeishuCodeLanguageLine(line) {
  return /^(?:Bash|Shell|PowerShell|JavaScript|TypeScript|Python|JSON|YAML|HTML|CSS)$/i.test(String(line || '').trim());
}

function isFeishuCommandLikeLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^#\s+/.test(text)) return true;
  if (/^\\#\s+/.test(text)) return true;
  if (/^(?:npx|npm|pnpm|yarn|node|python|pip|conda|ffmpeg|git|cd|mkdir|curl|brew|uv|powershell|pwsh|setx|export)\b/i.test(text)) return true;
  if (/^(?:[A-Za-z]:\\|\.\/|\.\.\/|~\/)/.test(text)) return true;
  if (/^[A-Z_][A-Z0-9_]*=/.test(text)) return true;
  return false;
}

function isFeishuNarrativeAfterCode(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^#{1,6}\s+/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text) || /^\|.+\|$/.test(text)) return true;
  return /[。！？；：]$/.test(text) || /^[\u4e00-\u9fa5].{4,}$/.test(text);
}

function formatFeishuCodeBlocks(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = String(lines[index] || '').trim();
    if (!isFeishuCodeLanguageLine(current)) {
      output.push(lines[index]);
      continue;
    }
    const language = current.toLowerCase() === 'bash' || current.toLowerCase() === 'shell' ? 'bash' : current.toLowerCase();
    const codeLines = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const value = String(lines[cursor] || '').trim();
      if (!value) {
        cursor += 1;
        continue;
      }
      if (isFeishuCodeLanguageLine(value) || /^```/.test(value) || /^#{1,6}\s+/.test(value) || /^\|.+\|$/.test(value)) break;
      if (isFeishuCommandLikeLine(value)) {
        codeLines.push(value.replace(/^\\#/, '#'));
        cursor += 1;
        continue;
      }
      if (codeLines.length && isFeishuNarrativeAfterCode(value)) break;
      if (!codeLines.length) break;
      codeLines.push(value.replace(/^\\#/, '#'));
      cursor += 1;
    }
    if (!codeLines.length) {
      output.push(lines[index]);
      continue;
    }
    if (output.length && String(output[output.length - 1] || '').trim()) output.push('');
    output.push(`\`\`\`${language}`);
    output.push(...codeLines);
    output.push('```');
    output.push('');
    index = cursor - 1;
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isFeishuRecommendationTitleLine(line) {
  const text = String(line || '').trim();
  if (!text || /^#{1,6}\s+/.test(text) || /^[-*]\s+/.test(text) || /^\|.+\|$/.test(text) || /^!\[/.test(text) || /^\[[^\]]+]\(/.test(text)) return false;
  if (text.length < 8 || text.length > 80) return false;
  if (/[。！？；：]$/.test(text)) return false;
  return /(?:REMOTION|Remotion|AI|Agent|Hermes|Qwen|TTS|部署|教程|经验|分享|方法|踩坑|实操|策略|指南)/i.test(text);
}

function trimFeishuTrailingRecommendations(lines) {
  const source = Array.isArray(lines) ? lines.slice() : [];
  let lastContentIndex = source.length - 1;
  while (lastContentIndex >= 0 && !String(source[lastContentIndex] || '').trim()) lastContentIndex -= 1;
  if (lastContentIndex < 0) return source;
  let start = lastContentIndex;
  while (start >= 0 && isFeishuRecommendationTitleLine(source[start])) start -= 1;
  const count = lastContentIndex - start;
  if (count >= 3) return source.slice(0, start + 1);
  return source;
}

function hasFeishuDanglingTableTail(lines) {
  const source = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  if (source.length < 10) return false;
  const joined = source.join('\n');
  if (!/(?:安装清单总览|逐步安装指南|配置要求|以下是所有需要安装的软件和工具)/.test(joined)) return false;
  const tail = source.slice(-18);
  const shortFragmentCount = tail.filter((line) => {
    if (/^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^!\[/.test(line)) return false;
    if (/[。！？；：]$/.test(line)) return false;
    return line.length <= 28;
  }).length;
  const toolFragmentCount = tail.filter((line) => /^(?:Node\.js|npm|FFmpeg|Python|Conda|CUDA Toolkit|Remotion|v?\d|必须|推荐|用途|版本|序号|是否必须)/i.test(line)).length;
  return shortFragmentCount >= 8 && toolFragmentCount >= 4;
}

function isFeishuMarkdownLikelyTruncated(markdown) {
  const lines = String(markdown || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const trimmed = trimFeishuTrailingRecommendations(lines);
  if (trimmed.length <= lines.length - 3) return true;
  if (hasFeishuDanglingTableTail(lines)) return true;
  if (lines.length < 20) return false;
  const lastHeadingIndex = lines.map((line, index) => (/^#{1,6}\s+/.test(line) ? index : -1)).filter((index) => index >= 0).pop() ?? -1;
  const tail = lines.slice(Math.max(0, lines.length - 12));
  return lastHeadingIndex >= 0
    && lines.length - lastHeadingIndex < 12
    && tail.filter(isFeishuRecommendationTitleLine).length >= 3;
}

function postProcessFeishuMarkdown(markdown, title = '') {
  let lines = String(markdown || '').split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && (!shouldDropFeishuLine(line, title) || isFeishuCodeLanguageLine(line)));
  const commentsIndex = lines.findIndex((line) => /^(?:真诚点赞，手留余香|全文评论)$/.test(line));
  if (commentsIndex >= 0) {
    lines = lines.slice(0, commentsIndex);
  }
  lines = removeFeishuTocBlocks(lines);
  lines = lines.map((line) => {
    if (/^[-*]\s+读完这篇/.test(line)) return line.replace(/^[-*]\s+/, '# ');
    if (/^[-*]\s+/.test(line) && isFeishuTocBulletLine(line)) return '';
    return formatFeishuHeadingLine(line);
  }).filter(Boolean);
  lines = trimFeishuTrailingRecommendations(lines);
  return formatFeishuCodeBlocks(removeFeishuResidualTableLines(repairFeishuMarkdownTables(lines.join('\n')))).replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = {
  stripMarkdownCodeBlocks,
  normalizeTitleForCompare,
  normalizeFeishuMarkdownLine,
  shouldDropFeishuLine,
  formatFeishuHeadingLine,
  isFeishuCodeLanguageLine,
  postProcessFeishuMarkdown,
  isFeishuMarkdownLikelyTruncated,
};
