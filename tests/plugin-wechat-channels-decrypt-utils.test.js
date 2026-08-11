const assert = require('assert');

const {
  generateWechatChannelsDecryptorBytes,
  decryptWechatChannelsMediaBuffer,
} = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-channels-decrypt-utils');

function runFixedVectorTest() {
  const expected = '9c87e6946a410182aee08a5a116f7cb986f10740dd490b9a330cd31db53ddc4a';
  assert.strictEqual(
    generateWechatChannelsDecryptorBytes('123456789', 32).toString('hex'),
    expected,
  );
  assert.strictEqual(
    generateWechatChannelsDecryptorBytes('0x75BCD15', 32).toString('hex'),
    expected,
  );
}

function runInvalidAndEmptyInputTest() {
  assert.deepStrictEqual(generateWechatChannelsDecryptorBytes('', 32), Buffer.alloc(0));
  assert.deepStrictEqual(generateWechatChannelsDecryptorBytes('not-a-key', 32), Buffer.alloc(0));

  const input = Buffer.from([1, 2, 3, 4]);
  const invalidResult = decryptWechatChannelsMediaBuffer(input, 'not-a-key');
  assert.deepStrictEqual(invalidResult, input);
  assert.notStrictEqual(invalidResult, input);
  assert.deepStrictEqual(decryptWechatChannelsMediaBuffer(Buffer.alloc(0), '123'), Buffer.alloc(0));
}

function runLimitAndRoundTripTest() {
  const input = Buffer.alloc(131073, 0x5a);
  const defaultResult = decryptWechatChannelsMediaBuffer(input, '123456789');
  assert.notDeepStrictEqual(defaultResult.subarray(0, 131072), input.subarray(0, 131072));
  assert.strictEqual(defaultResult[131072], input[131072]);

  const shortInput = Buffer.from([10, 20, 30, 40, 50]);
  const limited = decryptWechatChannelsMediaBuffer(shortInput, '123456789', 2);
  assert.notStrictEqual(limited[0], shortInput[0]);
  assert.notStrictEqual(limited[1], shortInput[1]);
  assert.deepStrictEqual(limited.subarray(2), shortInput.subarray(2));

  const restored = decryptWechatChannelsMediaBuffer(limited, '123456789', 2);
  assert.deepStrictEqual(restored, shortInput);
}

runFixedVectorTest();
runInvalidAndEmptyInputTest();
runLimitAndRoundTripTest();

console.log('plugin wechat channels decrypt utils contract passed');
