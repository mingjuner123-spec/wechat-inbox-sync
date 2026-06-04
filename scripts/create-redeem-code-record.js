const {
  DEFAULT_REDEEM_PLAN,
  createRedeemCodeDocument,
} = require('../cloudfunctions/quickstartFunctions/redeem-code-core');

function readArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

function readPositionalCode() {
  return process.argv.slice(2).find((item) => !item.startsWith('--')) || '';
}

const code = readPositionalCode() || readArg('code', 'ZZAI0603');
const durationDays = Number(readArg('days', '30'));
const maxRedemptions = Number(readArg('uses', '1'));
const plan = readArg('plan', DEFAULT_REDEEM_PLAN);
const note = readArg('note', '本地转写内测测试码');
const adminSecret = readArg('secret', '<填你的 REDEEM_ADMIN_SECRET>');
const now = new Date().toISOString();

const document = createRedeemCodeDocument({
  code,
  plan,
  durationDays,
  maxRedemptions,
  note,
  now,
});

const cloudFunctionEvent = {
  type: 'adminUpsertRedeemCode',
  adminSecret,
  code: document.code,
  plan: document.plan,
  durationDays: document.durationDays,
  maxRedemptions: document.maxRedemptions,
  note: document.note,
};

console.log(JSON.stringify({
  redeemCode: document.code,
  databaseCollection: 'redeem_codes',
  databaseDocument: document,
  cloudFunction: 'quickstartFunctions',
  cloudFunctionEvent,
}, null, 2));
