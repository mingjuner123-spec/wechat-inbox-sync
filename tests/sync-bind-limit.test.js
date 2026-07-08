const assert = require('assert');

const {
  evaluatePluginBindingLimit,
} = require('../cloudfunctions/syncApi/inbox-core');

const existingFreeCode = {
  _id: 'bind-free-1',
  code: 'FREE-01',
  openid: 'openid-free',
  status: 'bound',
  clients: [{ clientId: 'client-1', boundAt: '2026-07-01T08:00:00.000Z' }],
};

const existingProCode = {
  _id: 'bind-pro-1',
  code: 'PRO-001',
  openid: 'openid-pro',
  status: 'bound',
  clients: [{ clientId: 'client-1', boundAt: '2026-07-01T08:00:00.000Z' }],
};

assert.deepStrictEqual(evaluatePluginBindingLimit({
  clientId: 'client-1',
  existingBindCodes: [existingFreeCode],
  targetBindCode: {
    _id: 'bind-free-2',
    code: 'FREE-02',
    openid: 'openid-free-2',
  },
  proOpenids: [],
}), {
  allowed: false,
  reason: 'free-plugin-binding-limit',
  currentCount: 1,
  limit: 1,
  hasProBinding: false,
});

assert.deepStrictEqual(evaluatePluginBindingLimit({
  clientId: 'client-1',
  existingBindCodes: [existingFreeCode],
  targetBindCode: {
    _id: 'bind-pro-2',
    code: 'PRO-002',
    openid: 'openid-pro',
  },
  proOpenids: ['openid-pro'],
}), {
  allowed: true,
  reason: '',
  currentCount: 1,
  limit: 3,
  hasProBinding: true,
});

assert.deepStrictEqual(evaluatePluginBindingLimit({
  clientId: 'client-1',
  existingBindCodes: [existingProCode],
  targetBindCode: {
    _id: 'bind-free-2',
    code: 'FREE-02',
    openid: 'openid-free-2',
  },
  proOpenids: ['openid-pro'],
}), {
  allowed: true,
  reason: '',
  currentCount: 1,
  limit: 3,
  hasProBinding: true,
});

assert.deepStrictEqual(evaluatePluginBindingLimit({
  clientId: 'client-1',
  existingBindCodes: [
    existingProCode,
    {
      _id: 'bind-free-2',
      code: 'FREE-02',
      openid: 'openid-free-2',
      clients: [{ clientId: 'client-1' }],
    },
    {
      _id: 'bind-free-3',
      code: 'FREE-03',
      openid: 'openid-free-3',
      clients: [{ clientId: 'client-1' }],
    },
  ],
  targetBindCode: {
    _id: 'bind-free-4',
    code: 'FREE-04',
    openid: 'openid-free-4',
  },
  proOpenids: ['openid-pro'],
}), {
  allowed: false,
  reason: 'pro-plugin-binding-limit',
  currentCount: 3,
  limit: 3,
  hasProBinding: true,
});

assert.deepStrictEqual(evaluatePluginBindingLimit({
  clientId: 'client-1',
  existingBindCodes: [existingFreeCode],
  targetBindCode: existingFreeCode,
  proOpenids: [],
}), {
  allowed: true,
  reason: '',
  currentCount: 1,
  limit: 1,
  hasProBinding: false,
});

console.log('sync bind limit tests passed');
