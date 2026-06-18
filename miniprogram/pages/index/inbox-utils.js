function classifyContent(content) {
  const text = (content || '').trim();
  const url = extractHttpUrl(text);
  if (isSupportedWebpageUrl(url)) {
    return 'WEBPAGE';
  }
  if (text.startsWith('http://') || text.startsWith('https://')) {
    return 'LINK';
  }
  return 'TEXT';
}

function extractHttpUrl(content) {
  const text = String(content || '');
  const match = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i);
  if (!match) return '';

  return match[0].replace(/[.,!?;:)\]}]+$/g, '');
}

function isSupportedWebpageUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('mp.weixin.qq.com')
    || text.includes('feishu.cn')
    || text.includes('larksuite.com')
    || text.includes('feishu.net')
    || text.includes('xiaohongshu.com')
    || text.includes('xhslink.com')
    || text.includes('douyin.com')
    || text.includes('iesdouyin.com')
    || text.includes('amemv.com')
    || text.includes('bilibili.com')
    || text.includes('b23.tv')
    || text.includes('xiaoyuzhoufm.com')
    || text.includes('xiaoyuzhou.com');
}

function hasXiaohongshuAudioVideoIntent(url) {
  const text = String(url || '').toLowerCase();
  return /([?&]type=video\b|\/video\/|xhslink\.com\/a\/)/i.test(text);
}

function isAudioVideoWebpageUrl(url, sourceText = '') {
  const text = `${String(url || '')}\n${String(sourceText || '')}`.toLowerCase();
  const urlText = String(url || '').toLowerCase();
  if (
    text.includes('douyin.com')
    || text.includes('iesdouyin.com')
    || text.includes('amemv.com')
    || text.includes('bilibili.com/video')
    || text.includes('b23.tv')
    || text.includes('xiaoyuzhoufm.com')
    || text.includes('xiaoyuzhou.com')
  ) {
    return true;
  }
  if (urlText.includes('xhslink.com')) {
    return hasXiaohongshuAudioVideoIntent(urlText);
  }
  if (urlText.includes('xiaohongshu.com')) {
    return /([?&]type=video\b|\/video\/)/i.test(urlText);
  }
  return false;
}

function generateBindCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 3; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  code += '-';
  for (let i = 0; i < 3; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getLabelClass(type) {
  if (type === 'LINK') return 'label-link';
  if (type === 'VOICE') return 'label-voice';
  if (type === 'WEBPAGE') return 'label-webpage';
  if (type === 'FILE') return 'label-file';
  return 'label-text';
}

function createRecentItem(type, content) {
  return {
    id: `${type.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    type,
    labelClass: getLabelClass(type),
    content,
    time: '刚刚',
    pending: true,
  };
}

function formatDuration(duration) {
  const totalSeconds = Math.round((duration || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildTextOrLinkPayload(content) {
  const text = (content || '').trim();
  const type = classifyContent(text);
  const url = extractHttpUrl(text);
  if (type === 'WEBPAGE' && url) {
    return buildWebpagePayload(url, text);
  }
  if (type === 'LINK') {
    return {
      contentType: 'link',
      content: text,
      url: text,
    };
  }
  return {
    contentType: 'text',
    content: text,
  };
}

function buildWebpagePayload(url, sourceText, options = {}) {
  const text = (url || '').trim();
  const payload = {
    contentType: 'webpage',
    content: text,
    url: text,
  };
  const originalText = String(sourceText || '').trim();
  if (originalText && originalText !== text) {
    payload.shareText = originalText;
  }
  if (options.webpageMediaType) {
    payload.webpageMediaType = options.webpageMediaType;
  }
  if (options.cloudPreTranscription) {
    payload.cloudPreTranscription = options.cloudPreTranscription;
  }
  return payload;
}

function getFileExt(fileName) {
  const text = String(fileName || '');
  const index = text.lastIndexOf('.');
  return index >= 0 ? text.slice(index + 1).toLowerCase() : '';
}

function buildFilePayload(file) {
  const name = file.name || '未命名文件';
  return {
    contentType: 'file',
    content: name,
    fileID: file.fileID,
    fileName: name,
    fileExt: getFileExt(name),
    fileSize: file.size || 0,
  };
}

function buildVoicePayload(audioFileID, duration, audioFileName, options = {}) {
  const formattedDuration = formatDuration(duration);
  const payload = {
    contentType: 'voice',
    content: `现场语音备忘录 - ${formattedDuration}`,
    audioFileID,
    duration,
  };

  if (audioFileName) {
    payload.audioFileName = audioFileName;
  }

  if (options.cloudPreTranscription) {
    payload.cloudPreTranscription = options.cloudPreTranscription;
  }

  return payload;
}

module.exports = {
  classifyContent,
  extractHttpUrl,
  generateBindCode,
  createRecentItem,
  buildFilePayload,
  buildTextOrLinkPayload,
  buildWebpagePayload,
  buildVoicePayload,
  formatDuration,
  getFileExt,
  isSupportedWebpageUrl,
  isAudioVideoWebpageUrl,
};
