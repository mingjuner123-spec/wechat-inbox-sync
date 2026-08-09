const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync');
const sourceMainPath = path.join(pluginRoot, 'src', 'main.js');
const modulePath = path.join(pluginRoot, 'src', 'cloud-transcription-response-utils.js');

const helpers = require(modulePath);
const migratedFunctions = [
  'parseTencentCreateTaskResponse',
  'cleanTencentResultText',
  'tryParseJson',
  'extractOpenAICompatibleText',
  'parseAliyunTranscriptionResult',
  'getHeader',
  'formatHttpError',
  'normalizeDoubaoSpeakerText',
  'parseDoubaoAsrResult',
  'parseDoubaoAsrTaskState',
  'parseTencentTaskStatusResponse',
];

for (const name of migratedFunctions) {
  assert.strictEqual(typeof helpers[name], 'function', `${name} must be exported`);
}

assert.deepStrictEqual(helpers.tryParseJson('{"ok":true}'), { ok: true });
assert.strictEqual(helpers.tryParseJson('not-json'), null);
assert.strictEqual(helpers.extractOpenAICompatibleText({
  choices: [{ delta: { content: '第一段' } }],
}), '第一段');
assert.strictEqual(helpers.extractOpenAICompatibleText({
  choices: [{ message: { content: [{ text: '甲' }, { content: '乙' }] } }],
}), '甲乙');
assert.strictEqual(helpers.extractOpenAICompatibleText({}), '');

assert.strictEqual(
  helpers.parseAliyunTranscriptionResult('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\ndata: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n'),
  '第一段第二段',
);
assert.strictEqual(
  helpers.parseAliyunTranscriptionResult('{"choices":[{"message":{"content":"普通 JSON"}}]}'),
  '普通 JSON',
);
assert.strictEqual(helpers.parseAliyunTranscriptionResult('纯文本结果'), '纯文本结果');

assert.strictEqual(
  helpers.cleanTencentResultText('[0:0.000,0:2.000] 第一段\n[0:2.000,0:4.000] 第二段'),
  '第一段\n第二段',
);
assert.strictEqual(helpers.parseTencentCreateTaskResponse({
  Response: { Data: { TaskID: 123456 } },
}), 123456);
assert.throws(
  () => helpers.parseTencentCreateTaskResponse({
    Response: { Error: { Code: 'Invalid', Message: 'failed' } },
  }),
  /Invalid: failed/,
);
assert.deepStrictEqual(helpers.parseTencentTaskStatusResponse({
  Response: {
    Data: {
      Status: 2,
      StatusStr: 'SUCCESS',
      Result: '[0:0.000,0:2.000] 第一段',
    },
  },
}), {
  status: 2,
  statusStr: 'success',
  transcription: '第一段',
  errorMsg: '',
});
assert.deepStrictEqual(helpers.parseTencentTaskStatusResponse({
  Response: { Error: { Code: 'Failed', Message: 'denied' } },
}), {
  status: 3,
  statusStr: 'failed',
  transcription: '',
  errorMsg: 'Failed: denied',
});

assert.strictEqual(helpers.getHeader({
  'x-api-status-code': '20000000',
}, 'X-Api-Status-Code'), '20000000');
assert.strictEqual(helpers.getHeader(null, 'X-Api-Status-Code'), '');
assert.strictEqual(
  helpers.formatHttpError('Doubao', {
    status: 403,
    headers: {
      'X-Api-Status-Code': '4030001',
      'X-Api-Message': 'permission denied',
      'X-Api-Request-Id': 'req-1',
    },
    text: '{"message":"no permission"}',
  }),
  'Doubao请求失败：HTTP 403；X-Api-Status-Code=4030001；X-Api-Message=permission denied；X-Api-Request-Id=req-1；{"message":"no permission"}',
);

assert.strictEqual(helpers.normalizeDoubaoSpeakerText({
  utterances: [
    { speaker: 1, text: '第一位说话。' },
    { additions: { speaker_id: 2 }, result_text: '第二位回应。' },
  ],
}), '说话人1：第一位说话。\n说话人2：第二位回应。');
assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: {
    text: ['重复句', '重复句', '继续往下'].join('\n'),
  },
}), '重复句\n继续往下');
assert.deepStrictEqual(helpers.parseDoubaoAsrTaskState({
  status: 200,
  headers: { 'X-Api-Status-Code': '20000001' },
  json: {},
}), {
  status: 'processing',
  transcription: '',
});
assert.deepStrictEqual(helpers.parseDoubaoAsrTaskState({
  status: 200,
  headers: { 'X-Api-Status-Code': '20000000' },
  json: { result: { text: '豆包结果' } },
}), {
  status: 'success',
  transcription: '豆包结果',
});
assert.throws(
  () => helpers.parseDoubaoAsrTaskState({
    status: 403,
    headers: { 'X-Api-Message': 'permission denied' },
    text: 'forbidden',
  }),
  /HTTP 403/,
);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const name of migratedFunctions) {
  assert.strictEqual(
    new RegExp(`function\\s+${name}\\s*\\(`).test(sourceMain),
    false,
    `${name} must not remain defined in src/main.js`,
  );
}

console.log('plugin cloud transcription response utils tests passed');
