'use strict';

// Reading-view glue for transcript notes: make the [mm:ss] entries in
// "## 分段转写" seek the note's embedded player, and offer a manual screenshot
// button under embedded videos. Obsidian renders ![[clip.mp4]] as a native
// <video>; this module only binds behaviour, it never builds its own player.

const TIMESTAMP_PATTERN = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/;
const SEGMENT_HEADING_PATTERN = /分段转写/;
const SEEK_CLASS = 'wb-transcript-seek';
const BAR_CLASS = 'wb-transcript-media-bar';
const BUTTON_CLASS = 'wb-transcript-screenshot';
const SEEK_FLASH_CLASS = 'wb-transcript-seek-active';

function parseTimestampSeconds(text) {
  const match = TIMESTAMP_PATTERN.exec(String(text || ''));
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] === undefined ? null : Number(match[3]);
  const hours = third === null ? 0 : first;
  const minutes = third === null ? first : second;
  const seconds = third === null ? second : third;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatScreenshotTimestamp(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '00000000-000000';
  return `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}-${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

// Snapshots land next to the note in 附件/ unless the vault already routes
// attachments to a dedicated folder.
function resolveScreenshotFolder(vault, sourcePath) {
  const notePath = String(sourcePath || '');
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  let configured = '';
  try {
    configured = String((vault && typeof vault.getConfig === 'function' && vault.getConfig('attachmentFolderPath')) || '').trim();
  } catch (error) {
    configured = '';
  }
  const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/^\/+/, '');
  if (!configured || configured === '/' || configured === './' || configured === '.') {
    return joinPath(noteDir, '附件');
  }
  if (configured.startsWith('./')) return joinPath(noteDir, configured.slice(2));
  return joinPath(configured);
}

async function ensureFolder(vault, folderPath) {
  const path = String(folderPath || '').replace(/^\/+|\/+$/g, '');
  if (!path) return;
  if (vault.getAbstractFileByPath(path)) return;
  const segments = path.split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (vault.getAbstractFileByPath(current)) continue;
    try {
      await vault.createFolder(current);
    } catch (error) {
      // A concurrent create (or an existing file with that name) is not fatal
      // here; the binary write below surfaces the real problem.
    }
  }
}

async function createUniqueScreenshotPath(vault, folderPath, prefix) {
  const base = `截图-${prefix}`;
  let candidate = `${folderPath ? `${folderPath}/` : ''}${base}.png`;
  let index = 1;
  while (vault.getAbstractFileByPath(candidate)) {
    candidate = `${folderPath ? `${folderPath}/` : ''}${base}-${index}.png`;
    index += 1;
    if (index > 500) throw new Error('截图文件名冲突过多');
  }
  return candidate;
}

async function captureVideoFrame(video) {
  const width = Number(video.videoWidth) || 0;
  const height = Number(video.videoHeight) || 0;
  if (!width || !height) throw new Error('视频画面尚未加载，请播放后再截图');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise((resolve, reject) => {
    try {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('截图编码失败'));
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
  return blob;
}

function findSegmentItems(root) {
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const heading = headings.find((item) => SEGMENT_HEADING_PATTERN.test(item.textContent || ''));
  if (!heading) return [];
  const items = [];
  let node = heading.nextElementSibling;
  while (node) {
    if (/^H[1-6]$/.test(node.tagName)) break;
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      items.push(...Array.from(node.querySelectorAll('li')));
    } else if (node.tagName === 'LI') {
      items.push(node);
    } else {
      items.push(...Array.from(node.querySelectorAll('li')));
    }
    node = node.nextElementSibling;
  }
  return items;
}

// Obsidian renders ![[clip.mp4]] into its own block, and markdown post
// processors commonly run per block. The transcript list and the player are
// therefore usually NOT inside the same `el`; look up the note root instead.
function resolveNoteRoot(el) {
  if (!el || typeof el.closest !== 'function') return el;
  return el.closest('.markdown-preview-sizer')
    || el.closest('.markdown-embed-content')
    || el.closest('.markdown-reading-view')
    || el;
}

function seekSingleMedia(media, seconds) {
  const apply = () => {
    try {
      if (typeof media.pause === 'function') media.pause();
      media.currentTime = seconds;
      const playResult = typeof media.play === 'function' ? media.play() : null;
      if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
      return true;
    } catch (error) {
      return false;
    }
  };
  // Before metadata is known a browser silently ignores currentTime.
  if (Number(media.readyState) >= 1) return apply();
  let done = false;
  const onReady = () => {
    if (done) return;
    done = true;
    apply();
  };
  try {
    media.addEventListener('loadedmetadata', onReady, { once: true });
    window.setTimeout(onReady, 3000);
    return true;
  } catch (error) {
    return apply();
  }
}

function seekMedia(mediaList, seconds) {
  let handled = false;
  mediaList.forEach((media) => {
    if (seekSingleMedia(media, seconds)) handled = true;
  });
  return handled;
}

function decorateSegmentItems(items, mediaList) {
  items.forEach((item) => {
    if (!item || item.querySelector(`.${SEEK_CLASS}`)) return;
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, null);
    let textNode = walker.nextNode();
    while (textNode && !TIMESTAMP_PATTERN.test(textNode.nodeValue || '')) {
      textNode = walker.nextNode();
    }
    if (!textNode) return;
    const value = String(textNode.nodeValue || '');
    const match = TIMESTAMP_PATTERN.exec(value);
    if (!match) return;
    const seconds = parseTimestampSeconds(match[0]);
    if (seconds === null) return;
    const before = value.slice(0, match.index);
    const after = value.slice(match.index + match[0].length);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = SEEK_CLASS;
    button.textContent = match[0];
    button.title = '跳转到该时间点';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const media = mediaList.filter((element) => element.isConnected);
      if (!seekMedia(media, seconds)) return;
      button.classList.add(SEEK_FLASH_CLASS);
      window.setTimeout(() => button.classList.remove(SEEK_FLASH_CLASS), 600);
    });
    const fragment = document.createDocumentFragment();
    if (before) fragment.appendChild(document.createTextNode(before));
    fragment.appendChild(button);
    if (after) fragment.appendChild(document.createTextNode(after));
    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

function createScreenshotBar({ video, vault, sourcePath, notify }) {
  const bar = document.createElement('div');
  bar.className = BAR_CLASS;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.textContent = '截图';
  button.title = '保存当前画面到笔记附件';
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) return;
    button.disabled = true;
    try {
      const blob = await captureVideoFrame(video);
      const buffer = await blob.arrayBuffer();
      const folder = resolveScreenshotFolder(vault, sourcePath);
      await ensureFolder(vault, folder);
      const path = await createUniqueScreenshotPath(vault, folder, formatScreenshotTimestamp(new Date()));
      await vault.createBinary(path, buffer);
      const embed = `![[${path}]]`;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(embed);
          notify(`截图已保存：${path}\n嵌入语法已复制到剪贴板`);
        } else {
          notify(`截图已保存：${path}\n${embed}`);
        }
      } catch (error) {
        notify(`截图已保存：${path}`);
      }
    } catch (error) {
      const message = String((error && error.message) || error || '');
      notify(/SecurityError|tainted|insecure/i.test(message)
        ? '该视频不支持直接截图，请用系统截图工具'
        : `截图失败：${message || '未知错误'}`);
    } finally {
      button.disabled = false;
    }
  });
  bar.appendChild(button);
  return bar;
}

function createTranscriptMediaPlayer({
  vault,
  getSettings,
  notify = () => {},
} = {}) {
  const boundMedia = new WeakSet();

  const bindScreenshot = (video, sourcePath, settings) => {
    if (settings.transcriptScreenshotEnabled !== true) return;
    if (boundMedia.has(video)) return;
    boundMedia.add(video);
    const host = video.closest('.internal-embed') || video.parentElement;
    if (!host || !host.parentNode) return;
    if (host.parentNode.querySelector(`.${BAR_CLASS}`)) return;
    const bar = createScreenshotBar({ video, vault, sourcePath, notify });
    host.insertAdjacentElement('afterend', bar);
  };

  return function scan(el, sourcePath) {
    if (!el || !vault) return;
    const settings = (typeof getSettings === 'function' ? getSettings() : null) || {};
    const timestampsEnabled = settings.transcriptTimestampsEnabled === true;
    const screenshotEnabled = settings.transcriptScreenshotEnabled === true;
    if (!timestampsEnabled && !screenshotEnabled) return;

    const root = resolveNoteRoot(el);
    const apply = () => {
      const mediaList = Array.from(root.querySelectorAll('video, audio'));
      if (timestampsEnabled && mediaList.length) {
        const items = findSegmentItems(root);
        if (items.length) {
          items.forEach((item) => { item.dataset.wbTranscriptSegments = '1'; });
          decorateSegmentItems(items, mediaList);
        }
      }
      if (screenshotEnabled) {
        root.querySelectorAll('video').forEach((video) => bindScreenshot(video, sourcePath, settings));
      }
    };

    apply();
    // ![[video]] embeds can mount after the markdown section renders.
    if (typeof MutationObserver !== 'function' || (!root.querySelector('video, audio') && !root.querySelector('h1, h2, h3'))) return;
    let attempts = 0;
    const observer = new MutationObserver(() => {
      attempts += 1;
      apply();
      if (attempts > 20 || (root.querySelector('video, audio') && root.querySelector(`.${SEEK_CLASS}, .${BUTTON_CLASS}`))) {
        observer.disconnect();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 8000);
  };
}

module.exports = {
  createTranscriptMediaPlayer,
  parseTimestampSeconds,
  formatScreenshotTimestamp,
  resolveScreenshotFolder,
};
