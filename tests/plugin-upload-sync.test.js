const assert = require('assert');
const Module = require('module');
const zlib = require('zlib');

let requestUrlMock = async () => ({});
const notices = [];
const originalLoad = Module._load;

Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Notice: class Notice {
        constructor(message) {
          notices.push(message);
        }
      },
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: (options) => requestUrlMock(options),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;

function createPlugin({ requestUrl, files = {}, settings = {} }) {
  requestUrlMock = requestUrl;
  const plugin = new PluginClass();
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://api.example.com/sync',
    token: 'ABC-123',
    inboxDir: '临时收集',
    aiProvider: 'off',
    ...settings,
  });
  plugin.app = {
    vault: {
      adapter: {
        async exists(path) {
          return Object.prototype.hasOwnProperty.call(files, path);
        },
        async write(path, content) {
          files[path] = content;
        },
        async writeBinary(path, content) {
          files[path] = content;
        },
      },
      async createFolder(path) {
        files[path] = '<folder>';
      },
    },
  };
  return { plugin, files };
}

function createStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  Object.entries(entries).forEach(([name, content]) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  });

  const centralOffset = offset;
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function createDocxBuffer(text) {
  return createStoredZip({
    'word/document.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
      '</w:body>',
      '</w:document>',
    ].join(''),
  });
}

function createPdfBuffer(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n%%EOF`, 'latin1');
}

function createCompressedPdfBuffer(text) {
  const stream = Buffer.from(`BT /F1 12 Tf 72 720 Td (${text}) Tj ET`, 'latin1');
  const compressed = zlib.deflateSync(stream);
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    compressed,
    Buffer.from('\nthis-extra-junk-would-break-old-parser\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

function createCMapPdfBuffer() {
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '1 beginbfchar',
    '<0001> <4E2D>',
    '<0002> <6587>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  const content = 'BT /F1 12 Tf 72 720 Td <00010002> Tj ET';
  return Buffer.from([
    '%PDF-1.4',
    `1 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj`,
    `2 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj`,
    '%%EOF',
  ].join('\n'), 'latin1');
}

function utf16BeHex(text) {
  const bytes = [0xfe, 0xff];
  Array.from(text).forEach((char) => {
    const code = char.charCodeAt(0);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  });
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function createPdfBufferWithVerticalNoise() {
  const verticalNoise = ['，', '擎', '人', '的', '未', '来']
    .map((text) => `<${utf16BeHex(text)}> Tj`)
    .join('\n');
  const paragraph = `<${utf16BeHex('这个10倍跃迁的目标成为你的过滤器，将大部分无关紧要的事情过滤掉。')}> Tj`;
  const stream = `BT\n/F1 12 Tf\n${verticalNoise}\n${paragraph}\nET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n%%EOF`, 'latin1');
}

function createPdfBufferWithMicroWrappedText() {
  const chunks = ['一', '个', '普', '通', '人', '也', '可', '以', '用', 'AI', '把', '内', '容', '做', '起', '来'];
  const stream = `BT\n/F1 12 Tf\n${chunks.map((text) => `<${utf16BeHex(text)}> Tj`).join('\n')}\nET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n%%EOF`, 'latin1');
}

function createPdfBufferWithControlNoise() {
  const chunks = ['\u0003k', '\u00064', 'K', 'Z', 'Z', 'G', 'G', 'Q', '�', '�'];
  const stream = `BT\n/F1 12 Tf\n${chunks.map((text) => `(${text}) Tj`).join('\n')}\nET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n%%EOF`, 'utf8');
}

(async () => {
  assert.strictEqual(
    PluginClass.__test.isRequestUrlTransportError('Request failed, status 500'),
    true
  );

  {
    const { plugin, files } = createPlugin({
      requestUrl: async () => ({}),
      settings: {
        noteSaveMode: 'root',
      },
    });

    const item = await plugin.writeRecord({
      _id: 'root-save-1',
      type: 'text',
      content: '直接保存到根目录',
      createdAt: '2026-06-15T10:00:00.000Z',
      metadata: {},
    }, '2026-06-15T10:01:00.000Z');

    assert.strictEqual(item.filePath, '临时收集/文本-直接保存到根目录.md');
    assert.strictEqual(files['临时收集/2026-06-15'], undefined);
    assert.ok(files['临时收集/文本-直接保存到根目录.md'].includes('直接保存到根目录'));
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async (options) => {
        if (String(options.url).includes('/files/download-url')) {
          return {
            json: {
              success: false,
              errMsg: 'temp url failed',
            },
          };
        }
        return {};
      },
    });

    await plugin.writeRecord({
      _id: 'file-1',
      type: 'file',
      content: 'example.pdf',
      createdAt: '2026-05-13T12:00:00.000Z',
      source: 'wechat-miniprogram',
      metadata: {
        fileID: 'cloud://files/example.pdf',
        fileName: 'example.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:01:00.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('example.pdf'));
    assert.ok(note.includes('temp url failed'));
  }

  {
    const synced = [];
    const { plugin, files } = createPlugin({
      requestUrl: async (options) => {
        if (String(options.url).includes('/records?status=pending')) {
          return {
            json: {
              success: true,
              data: [
                {
                  _id: 'bad-1',
                  type: 'unknown',
                  content: 'bad',
                  createdAt: '2026-05-13T12:00:00.000Z',
                  metadata: {},
                },
                {
                  _id: 'text-1',
                  type: 'text',
                  content: 'hello',
                  createdAt: '2026-05-13T12:01:00.000Z',
                  metadata: {},
                },
              ],
            },
          };
        }
        if (String(options.url).includes('/records/text-1/synced')) {
          synced.push('text-1');
          return { json: { success: true, data: { id: 'text-1' } } };
        }
        return { json: { success: true } };
      },
    });

    await plugin.syncInbox(true);

    assert.deepStrictEqual(synced, ['text-1']);
    assert.ok(Object.keys(files).some((path) => path.endsWith('.md')));
    assert.ok(String(notices[notices.length - 1]).includes('1'));
  }

  {
    const fixtures = {
      'https://temp.example.com/example.docx': createDocxBuffer('Docx paragraph text'),
      'https://temp.example.com/example.pdf': createPdfBuffer('PDF paragraph text'),
      'https://temp.example.com/compressed.pdf': createCompressedPdfBuffer('Compressed PDF text'),
      'https://temp.example.com/cmap.pdf': createCMapPdfBuffer(),
      'https://temp.example.com/vertical.pdf': createPdfBufferWithVerticalNoise(),
      'https://temp.example.com/wrapped.pdf': createPdfBufferWithMicroWrappedText(),
      'https://temp.example.com/noise.pdf': createPdfBufferWithControlNoise(),
    };
    const { plugin, files } = createPlugin({
      requestUrl: async (options) => {
        if (String(options.url).includes('/files/download-url')) {
          const fileID = decodeURIComponent(String(options.url).split('fileID=')[1] || '');
          const name = fileID.endsWith('vertical.pdf')
            ? 'vertical.pdf'
            : fileID.endsWith('wrapped.pdf') ? 'wrapped.pdf' : fileID.endsWith('noise.pdf') ? 'noise.pdf' : fileID.endsWith('cmap.pdf') ? 'cmap.pdf' : fileID.endsWith('compressed.pdf') ? 'compressed.pdf' : fileID.endsWith('.pdf') ? 'example.pdf' : 'example.docx';
          return {
            json: {
              success: true,
              data: {
                tempFileURL: `https://temp.example.com/${name}`,
              },
            },
          };
        }
        if (fixtures[options.url]) {
          return { arrayBuffer: fixtures[options.url] };
        }
        return {};
      },
    });

    await plugin.writeRecord({
      _id: 'docx-1',
      type: 'file',
      content: 'example.docx',
      createdAt: '2026-05-13T12:02:00.000Z',
      metadata: {
        fileID: 'cloud://files/example.docx',
        fileName: 'example.docx',
        fileExt: 'docx',
      },
    }, '2026-05-13T12:03:00.000Z');

    await plugin.writeRecord({
      _id: 'pdf-1',
      type: 'file',
      content: 'example.pdf',
      createdAt: '2026-05-13T12:03:00.000Z',
      metadata: {
        fileID: 'cloud://files/example.pdf',
        fileName: 'example.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:04:00.000Z');

    await plugin.writeRecord({
      _id: 'pdf-2',
      type: 'file',
      content: 'cmap.pdf',
      createdAt: '2026-05-13T12:04:30.000Z',
      metadata: {
        fileID: 'cloud://files/cmap.pdf',
        fileName: 'cmap.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:04:40.000Z');

    await plugin.writeRecord({
      _id: 'pdf-3',
      type: 'file',
      content: 'compressed.pdf',
      createdAt: '2026-05-13T12:04:50.000Z',
      metadata: {
        fileID: 'cloud://files/compressed.pdf',
        fileName: 'compressed.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:04:55.000Z');

    await plugin.writeRecord({
      _id: 'pdf-4',
      type: 'file',
      content: 'vertical.pdf',
      createdAt: '2026-05-13T12:04:56.000Z',
      metadata: {
        fileID: 'cloud://files/vertical.pdf',
        fileName: 'vertical.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:04:57.000Z');

    await plugin.writeRecord({
      _id: 'pdf-5',
      type: 'file',
      content: 'wrapped.pdf',
      createdAt: '2026-05-13T12:04:58.000Z',
      metadata: {
        fileID: 'cloud://files/wrapped.pdf',
        fileName: 'wrapped.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:04:59.000Z');

    await plugin.writeRecord({
      _id: 'pdf-6',
      type: 'file',
      content: 'noise.pdf',
      createdAt: '2026-05-13T12:05:00.000Z',
      metadata: {
        fileID: 'cloud://files/noise.pdf',
        fileName: 'noise.pdf',
        fileExt: 'pdf',
      },
    }, '2026-05-13T12:05:01.000Z');

    const notes = Object.entries(files)
      .filter(([path]) => path.endsWith('.md'))
      .map(([, content]) => content)
      .join('\n');
    assert.ok(notes.includes('Docx paragraph text'));
    assert.ok(notes.includes('PDF paragraph text'));
    assert.ok(notes.includes('中文'));
    assert.ok(notes.includes('Compressed PDF text'));
    assert.ok(notes.includes('这个10倍跃迁的目标成为你的过滤器'));
    assert.ok(notes.includes('一个普通人也可以用AI把内容做起来'));
    assert.ok(notes.includes('PDF 文本提取质量过低'));
    assert.strictEqual(/^[，擎人的未来]$/m.test(notes), false);
    assert.strictEqual(notes.includes('\u0003k'), false);
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async () => {
        throw new Error('Feishu page should not be fetched directly');
      },
    });

    await plugin.writeRecord({
      _id: 'feishu-1',
      type: 'webpage',
      content: 'https://my.feishu.cn/wiki/example',
      createdAt: '2026-05-13T12:05:00.000Z',
      metadata: {
        url: 'https://my.feishu.cn/wiki/example',
      },
    }, '2026-05-13T12:06:00.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('飞书链接已保存'));
    assert.ok(note.includes('https://my.feishu.cn/wiki/example'));
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async () => ({
        text: '<html><script>window.__DATA__={"text":"Feishu static paragraph content for markdown export"}</script></html>',
      }),
    });

    await plugin.writeRecord({
      _id: 'feishu-2',
      type: 'webpage',
      content: 'https://my.feishu.cn/wiki/static',
      createdAt: '2026-05-13T12:06:30.000Z',
      metadata: {
        url: 'https://my.feishu.cn/wiki/static',
      },
    }, '2026-05-13T12:06:40.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('Feishu static paragraph content'));
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async (options) => {
        if (String(options.url || '').includes('/space/api/docx/pages/client_vars')) {
          return {
            json: {
              code: 0,
              data: {
                id: 'doc-token',
                block_sequence: ['doc-token', 'paragraph-block'],
                block_map: {
                  'doc-token': { id: 'doc-token', data: { type: 'page' } },
                  'paragraph-block': {
                    id: 'paragraph-block',
                    data: {
                      type: 'text',
                      text: { initialAttributedTexts: { text: { 0: 'Feishu client vars paragraph content' } } },
                    },
                  },
                },
              },
            },
          };
        }
        throw new Error('Static Feishu page should not be needed');
      },
    });

    await plugin.writeRecord({
      _id: 'feishu-client-vars',
      type: 'webpage',
      content: 'https://my.feishu.cn/docx/doc-token',
      createdAt: '2026-05-13T12:07:30.000Z',
      metadata: {
        url: 'https://my.feishu.cn/docx/doc-token',
      },
    }, '2026-05-13T12:07:40.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('Feishu client vars paragraph content'));
  }

  {
    let metadataRequestSeen = false;
    const { plugin, files } = createPlugin({
      settings: {
        aiMetadataEnabled: true,
      },
      requestUrl: async (options) => {
        if (String(options.url || '').endsWith('/metadata/generate')) {
          metadataRequestSeen = true;
          const body = JSON.parse(options.body || '{}');
          assert.ok(body.content.includes('Cloud metadata source text'));
          return {
            json: {
              success: true,
              data: {
                description: 'Cloud generated description',
                keywords: ['Cloud', 'Metadata'],
              },
            },
          };
        }
        return {};
      },
    });

    await plugin.writeRecord({
      _id: 'ai-metadata-cloud',
      type: 'text',
      content: 'Cloud metadata source text',
      createdAt: '2026-05-13T12:08:30.000Z',
      metadata: {},
    }, '2026-05-13T12:08:40.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.strictEqual(metadataRequestSeen, true);
    assert.ok(note.includes('description: Cloud generated description'));
    assert.ok(note.includes('keywords: Cloud, Metadata'));
  }

  {
    const { plugin, files } = createPlugin({
      settings: {
        aiMetadataEnabled: true,
      },
      requestUrl: async (options) => {
        if (String(options.url || '').endsWith('/metadata/generate')) {
          return {
            status: 500,
            json: {
              error: {
                message: 'metadata cloud failed',
              },
            },
          };
        }
        return {};
      },
    });

    await plugin.writeRecord({
      _id: 'ai-metadata-cloud-fails-but-note-saves',
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/explore/ai-fallback',
      createdAt: '2026-05-13T12:09:30.000Z',
      metadata: {
        url: 'https://www.xiaohongshu.com/explore/ai-fallback',
        markdown: 'Xiaohongshu parsed body should still be saved when AI metadata fails.',
        conversionStatus: 'success',
      },
    }, '2026-05-13T12:09:40.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('Xiaohongshu parsed body should still be saved when AI metadata fails.'));
    assert.strictEqual(note.includes('description:'), false);
    assert.strictEqual(note.includes('keywords:'), false);
  }

  {
    const repeatedTitle = '手把手教学 - 用Claude code 搭建属于你的自动化AI内容生产系统';
    const cleaned = PluginClass.__test.cleanMarkdownForStorage([
      '飞书云文档',
      '春',
      '登录/注册',
      repeatedTitle,
      '评论（0）',
      '0 字',
      '一、先看成品',
      '系统页面截图',
      '1.',
      '采集爆款。每天系统自动采集同行业的爆款笔记。',
      '•',
      '选题不用自己想——AI 基于行业爆款和你的定位。',
      '正文内容。',
      '正文内容。',
    ].join('\n\n'), {
      dedupe: true,
      feishuTitle: repeatedTitle,
    });
    assert.strictEqual(cleaned.includes('飞书云文档'), false);
    assert.strictEqual(cleaned.includes('登录/注册'), false);
    assert.strictEqual(cleaned.includes('评论'), false);
    assert.strictEqual(cleaned.includes('0 字'), false);
    assert.ok(cleaned.includes('## 一、先看成品'));
    assert.ok(cleaned.includes('### 系统页面截图'));
    assert.ok(cleaned.includes('1. 采集爆款。每天系统自动采集同行业的爆款笔记。'));
    assert.ok(cleaned.includes('- 选题不用自己想——AI 基于行业爆款和你的定位。'));
    assert.strictEqual((cleaned.match(/正文内容/g) || []).length, 1);

    const { plugin, files } = createPlugin({
      requestUrl: async () => ({}),
    });

    await plugin.writeRecord({
      _id: 'feishu-duplicate',
      type: 'webpage',
      content: 'https://my.feishu.cn/wiki/duplicate',
      createdAt: '2026-05-13T12:06:50.000Z',
      metadata: {
        url: 'https://my.feishu.cn/wiki/duplicate',
        title: repeatedTitle,
        conversionStatus: 'success',
        markdown: [
          '飞书云文档',
          repeatedTitle,
          '飞书云文档',
          repeatedTitle,
          '正文第一段，应该只保留一次。',
          '正文第一段，应该只保留一次。',
          '正文第二段。',
        ].join('\n\n'),
      },
    }, '2026-05-13T12:07:00.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.startsWith('---\n'));
    assert.ok(note.includes('\ntitle: '));
    assert.strictEqual((note.replace(/^---[\s\S]*?---\n/, '').match(new RegExp(repeatedTitle, 'g')) || []).length, 0);
    assert.strictEqual((note.match(/飞书云文档/g) || []).length, 0);
    assert.strictEqual((note.match(/正文第一段/g) || []).length, 1);
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async () => ({}),
    });
    const markdown = await plugin.saveWebpageImageAssets(
      '正文\n\n![飞书图片](blob:https://feishu.example/image-1)\n',
      [{
        src: 'blob:https://feishu.example/image-1',
        alt: '飞书图片',
        dataUrl: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
      }],
      '临时收集',
      '2026-05-14',
      '网页-101632',
    );

    assert.ok(markdown.includes('![[临时收集/网页图片/2026-05-14/网页-101632-image-01.png]]'));
    assert.ok(Buffer.isBuffer(files['临时收集/网页图片/2026-05-14/网页-101632-image-01.png']));
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async (options) => {
        if (String(options.url).includes('/files/download-url')) {
          return {
            json: {
              success: true,
              data: {
                tempFileURL: 'https://temp.example.com/album-video.mp4',
              },
            },
          };
        }
        if (options.url === 'https://temp.example.com/album-video.mp4') {
          return { arrayBuffer: Buffer.from('video-bytes') };
        }
        return {};
      },
    });

    await plugin.writeRecord({
      _id: 'album-video-1',
      type: 'voice',
      content: 'album-video.mp4',
      createdAt: '2026-06-11T10:00:00.000Z',
      metadata: {
        audioFileID: 'cloud://voices/album-video.mp4',
        audioFileName: 'album-video.mp4',
      },
    }, '2026-06-11T10:01:00.000Z');

    const savedPaths = Object.keys(files);
    assert.ok(savedPaths.some((filePath) => filePath.endsWith('album-video.mp4')));
    assert.strictEqual(savedPaths.some((filePath) => filePath.endsWith('album-video.mp3')), false);
    const note = Object.entries(files).find(([filePath]) => filePath.endsWith('.md'))[1];
    assert.ok(note.includes('album-video.mp4'));
    assert.strictEqual(note.includes('album-video.mp3'), false);
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async () => ({
        text: [
          '<html><body><article>',
          '<p>Wechat article text content long enough.</p>',
          '<img data-src="https://img.example.com/a.jpg" alt="cover">',
          '</article></body></html>',
        ].join(''),
      }),
    });

    await plugin.writeRecord({
      _id: 'wechat-1',
      type: 'webpage',
      content: 'https://mp.weixin.qq.com/s/example',
      createdAt: '2026-05-13T12:07:00.000Z',
      metadata: {
        url: 'https://mp.weixin.qq.com/s/example',
      },
    }, '2026-05-13T12:08:00.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('Wechat article text content'));
    assert.ok(note.includes('![cover](https://img.example.com/a.jpg)'));
  }

  {
    const { plugin, files } = createPlugin({
      requestUrl: async () => ({
        text: [
          '<html><body><article>',
          '<p>Legacy link record article text.</p>',
          '<img data-src="https://img.example.com/legacy.jpg" alt="legacy-cover">',
          '</article></body></html>',
        ].join(''),
      }),
    });

    await plugin.writeRecord({
      _id: 'wechat-link-legacy',
      type: 'link',
      content: 'https://mp.weixin.qq.com/s/example',
      createdAt: '2026-06-11T06:49:22.000Z',
      metadata: {
        url: 'https://mp.weixin.qq.com/s/example',
      },
    }, '2026-06-11T06:50:00.000Z');

    const savedPath = Object.keys(files).find((filePath) => filePath.endsWith('.md'));
    const note = files[savedPath];
    assert.ok(savedPath.includes('公众号-'));
    assert.ok(note.includes('Legacy link record article text'));
    assert.ok(note.includes('![legacy-cover](https://img.example.com/legacy.jpg)'));
    assert.strictEqual(note.includes('正文快照处理中'), false);
  }

  {
    const targetUrl = 'https://mp.weixin.qq.com/s/_2i9jUViG8VG1ktMSThjvA';
    const captchaUrl = `https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=token&target_url=${encodeURIComponent(targetUrl)}`;
    const { plugin, files } = createPlugin({
      requestUrl: async () => ({
        text: [
          '<html><head><title>公众号-wappoc_appmsgcaptcha</title></head><body>',
          '<h1>环境异常</h1>',
          '<p>当前环境异常，完成验证后即可继续访问。</p>',
          '<a>去验证</a>',
          '<p>视频</p><p>小程序</p><p>赞，轻点两下取消赞</p>',
          '</body></html>',
        ].join(''),
      }),
    });

    await plugin.writeRecord({
      _id: 'wechat-captcha',
      type: 'webpage',
      content: captchaUrl,
      createdAt: '2026-05-25T05:05:21.000Z',
      metadata: {
        url: captchaUrl,
      },
    }, '2026-05-25T05:06:00.000Z');

    const note = Object.entries(files).find(([path]) => path.endsWith('.md'))[1];
    assert.ok(note.includes('公众号文章触发了微信安全验证'));
    assert.ok(note.includes(targetUrl));
    assert.strictEqual(note.includes('当前环境异常，完成验证后即可继续访问'), false);
    assert.strictEqual(note.includes('轻点两下取消赞'), false);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
