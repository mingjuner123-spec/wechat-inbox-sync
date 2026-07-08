const STORAGE_KEY = 'ob_admin_console_config';
const DEFAULT_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';

const state = {
  view: 'overview',
  range: 'all',
  apiBase: '',
  adminSecret: '',
  loadedViews: {},
};

const viewMeta = {
  overview: ['总览', '查看访问、绑定、同步和 Pro 转化。'],
  funnel: ['运营漏斗', '当前绑定和近 1/7/30 天同步活跃。'],
  pro: ['Pro 管理', '生成、发放、筛选、删除兑换码，并管理 Pro 用户。'],
};

const SYNC_ACTIVITY_KEYS = [
  'currentBoundUsers',
  'activeSyncUsers1d',
  'activeSyncUsers7d',
  'activeSyncUsers30d',
];

const HIDDEN_OVERVIEW_CARD_KEYS = new Set([
  'visitUsers',
  'boundDevices',
]);

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMinutes(seconds) {
  const value = Number(seconds) || 0;
  return `${Math.round(value / 60)} 分钟`;
}

function getRedeemCodeStatusMeta(item) {
  const status = String(item && item.status ? item.status : 'active');
  const redeemedCount = Number(item && item.redeemedCount) || 0;
  if (status === 'disabled') return { text: '已失效', className: 'tag warn' };
  if (status === 'redeemed' || redeemedCount > 0 || isRedeemCodeAssigned(item)) return { text: '已激活', className: 'tag warn' };
  if (status === 'active') return { text: '可兑换', className: 'tag' };
  return { text: status, className: 'tag warn' };
}

function getProStatusMeta(user) {
  const status = String(user && user.proStatus ? user.proStatus : '');
  if (status === 'active') return { text: '有效', className: 'tag' };
  if (status === 'expired') return { text: '已到期', className: 'tag warn' };
  if (status === 'disabled') return { text: '已停用', className: 'tag warn' };
  if (status === 'inactive') return { text: '未生效', className: 'tag warn' };
  return { text: status || '未知', className: 'tag warn' };
}

function isRedeemCodeAvailable(item) {
  const status = String(item && item.status ? item.status : 'active');
  return status === 'active' && !isRedeemCodeAssigned(item);
}

function isRedeemCodeAssigned(item) {
  if (!item) return false;
  if ((Number(item.redeemedCount) || 0) > 0) return true;
  const deliveryStatus = String(item.deliveryStatus || '').trim().toLowerCase();
  const status = String(item.status || '').trim().toLowerCase();
  return deliveryStatus === 'activated'
    || status === 'redeemed'
    || Boolean(item.lastRedeemedOpenId || item.redeemedOpenId)
    || Boolean(item.paidOwnerOpenid || item.trialOwnerOpenid)
    || Boolean(item.paymentOrderNo || item.latestPaymentOrderNo);
}

function showNotice(message, tone = 'warn') {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.remove('hidden');
  notice.dataset.tone = tone;
  if (!message) notice.classList.add('hidden');
}

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.apiBase = saved.apiBase || DEFAULT_SYNC_API_BASE;
    state.adminSecret = saved.adminSecret || '';
  } catch (error) {
    state.apiBase = DEFAULT_SYNC_API_BASE;
    state.adminSecret = '';
  }
  $('apiBase').value = state.apiBase;
  $('adminSecret').value = state.adminSecret;
}

function normalizeApiBase(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return DEFAULT_SYNC_API_BASE;
  return normalized.replace(/\/admin$/, '');
}

function saveConfig() {
  state.apiBase = normalizeApiBase($('apiBase').value);
  state.adminSecret = $('adminSecret').value.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiBase: state.apiBase,
    adminSecret: state.adminSecret,
  }));
  state.loadedViews = {};
  showNotice('后台配置已保存。', 'ok');
  loadCurrentView(state.view, true);
}

function getApiUrl(path) {
  const base = normalizeApiBase(state.apiBase);
  if (!base) throw new Error('请先填写 syncApi HTTP 地址');
  return `${base}/admin${path}`;
}

async function request(path, payload = {}) {
  if (!state.adminSecret) throw new Error('请先填写管理密钥');
  const response = await fetch(getApiUrl(path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-secret': state.adminSecret,
    },
    body: JSON.stringify({
      ...payload,
      adminSecret: state.adminSecret,
    }),
  });
  const text = await response.text();
  let result = {};
  try {
    result = JSON.parse(text);
  } catch (error) {
    throw new Error(text || '接口返回不是 JSON');
  }
  if (!response.ok || !result.success) {
    throw new Error(result.errMsg || `请求失败：${response.status}`);
  }
  return result.data;
}

async function run(action) {
  showNotice('');
  try {
    await action();
  } catch (error) {
    showNotice(error.message || String(error));
  }
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((item) => {
    item.classList.remove('active');
  });
  $(`${view}View`).classList.add('active');
  const [title, desc] = viewMeta[view];
  $('pageTitle').textContent = title;
  $('pageDesc').textContent = desc;
  loadCurrentView(view);
}

function loadCurrentView(view = state.view, force = false) {
  if (!state.apiBase || !state.adminSecret) return;
  if (!force && state.loadedViews[view]) return;
  const loaders = {
    overview: loadOverview,
    funnel: loadFunnel,
    pro: loadProManagement,
  };
  const loader = loaders[view];
  if (!loader) return;
  state.loadedViews[view] = true;
  run(loader);
}

function renderMetrics(cards = []) {
  $('metricGrid').innerHTML = cards.map((item) => `
    <article class="metric-card">
      <div class="metric-label">${escapeHtml(item.label)}</div>
      <div class="metric-value">${escapeHtml(item.value)}</div>
      <div class="metric-hint">${escapeHtml(item.hint || '')}</div>
    </article>
  `).join('');
}

function getOverviewCards(data = {}) {
  const activityCards = getSyncActivityCards(data);
  const activityKeys = new Set(activityCards.map((item) => item.key));
  const safeCards = (data.cards || [])
    .filter((item) => item && !HIDDEN_OVERVIEW_CARD_KEYS.has(item.key))
    .filter((item) => item && !activityKeys.has(item.key));
  return [
    ...activityCards,
    ...safeCards,
  ];
}

function renderFunnel(steps = []) {
  $('funnelList').innerHTML = steps.map((item) => `
    <article class="funnel-step">
      <div class="funnel-label">${escapeHtml(item.label)}</div>
      <div class="funnel-value">${escapeHtml(item.value)}</div>
      <div class="funnel-rate">占当前绑定 ${escapeHtml(item.rateText || '-')}</div>
      <div class="funnel-hint">${escapeHtml(item.hint || '')}</div>
    </article>
  `).join('');
}

function getSyncActivityCards(data = {}) {
  const funnel = data.funnel || {};
  const currentBoundUsers = funnel.currentBoundUsers ?? funnel.boundUsers ?? 0;
  const fallbackCards = [
    { key: 'currentBoundUsers', label: '当前已绑定微信用户', value: currentBoundUsers, rateText: '-', hint: '当前绑定码里仍处于已绑定状态的微信用户数' },
    { key: 'activeSyncUsers1d', label: '近 1 天仍同步', value: funnel.activeSyncUsers1d ?? '-', rateText: '-', hint: '已绑定用户里，最近 1 天仍然有同步动作的人数' },
    { key: 'activeSyncUsers7d', label: '近 7 天仍同步', value: funnel.activeSyncUsers7d ?? '-', rateText: '-', hint: '已绑定用户里，最近 7 天仍然有同步动作的人数' },
    { key: 'activeSyncUsers30d', label: '近 30 天仍同步', value: funnel.activeSyncUsers30d ?? '-', rateText: '-', hint: '已绑定用户里，最近 30 天仍然有同步动作的人数' },
  ];
  const sourceCards = Array.isArray(funnel.activityCards) && funnel.activityCards.length
    ? funnel.activityCards
    : (Array.isArray(funnel.steps) ? funnel.steps : []);
  const cardMap = new Map(sourceCards
    .filter((item) => item && SYNC_ACTIVITY_KEYS.includes(item.key))
    .map((item) => [item.key, item]));
  return fallbackCards.map((item) => ({
    ...item,
    ...(cardMap.get(item.key) || {}),
  }));
}

function renderSyncActivity(data = {}) {
  const cards = getSyncActivityCards(data);
  $('syncActivityGrid').innerHTML = cards.map((item) => `
    <article class="sync-activity-card">
      <div class="metric-label">${escapeHtml(item.label)}</div>
      <div class="metric-value">${escapeHtml(item.value)}</div>
      <div class="metric-hint">${escapeHtml(item.hint || '')}</div>
      <div class="sync-activity-rate">${item.key === 'currentBoundUsers' ? '基准人数' : `占当前绑定 ${escapeHtml(item.rateText || '-')}`}</div>
    </article>
  `).join('');
}

function renderStack(id, items = [], emptyText = '暂无数据') {
  $(id).innerHTML = items.length ? items.map((item) => `
    <article class="stack-item">
      <div class="stack-title">${escapeHtml(item.title || item.type || '-')}</div>
      <div class="stack-desc">${escapeHtml(item.desc || '')}</div>
    </article>
  `).join('') : `<div class="stack-item"><div class="stack-desc">${emptyText}</div></div>`;
}

async function loadOverview() {
  const data = await request('/summary', { range: state.range, maxRead: 5000 });
  renderMetrics(getOverviewCards(data));
  renderFunnel(getSyncActivityCards(data));
  renderStack('diagnosisList', data.diagnoses || [], '暂无明显异常');
  renderStack('issueList', data.issues || [], '暂无待处理异常');
  $('scopeText').textContent = data.scope ? `${data.scope.label} · ${data.scope.desc}` : '';
}

async function loadFunnel() {
  const data = await request('/summary', { range: 'all', maxRead: 5000 });
  renderSyncActivity(data);
  $('funnelScopeText').textContent = data.scope ? `${data.scope.label} · ${data.scope.desc}` : '';
}

async function loadProManagement() {
  const proKeyword = $('proKeyword').value.trim();
  const codeKeyword = $('codeKeyword').value.trim();
  const status = $('codeStatusFilter').value;
  const deliveryStatus = $('codeDeliveryFilter').value;
  const paymentStatus = $('paymentStatusFilter').value;
  const [proData, codeData, allCodeData] = await Promise.all([
    request('/pro-users', { keyword: proKeyword, limit: 300, maxRead: 5000 }),
    request('/redeem-codes', { keyword: codeKeyword, status, deliveryStatus, limit: 500, maxRead: 5000 }),
    request('/redeem-codes', { keyword: '', limit: 500, maxRead: 5000 }),
  ]);
  let paymentData = { total: 0, items: [] };
  try {
    paymentData = await request('/payment-orders', { keyword: proKeyword, status: paymentStatus, limit: 500 });
  } catch (error) {
    paymentData = {
      total: 0,
      items: [],
      unavailableText: `付费订单接口暂不可用：${error.message || error}`,
    };
  }
  const redeemCodeMap = buildRedeemCodeMap(allCodeData.items || []);
  const proUsers = (proData.items || []).map((user) => attachRedeemActivationInfo(user, redeemCodeMap));
  const activeProUsers = proUsers.filter((user) => user.proStatus === 'active');
  const expiredProUsers = proUsers.filter((user) => user.proStatus === 'expired');
  const availableRedeemCodes = (codeData.items || []).filter((item) => isRedeemCodeAvailable(item));
  renderProUsers({ total: activeProUsers.length, items: activeProUsers }, 'proCount', 'proTable');
  renderProUsers({ total: expiredProUsers.length, items: expiredProUsers }, 'expiredProCount', 'expiredProTable');
  renderRedeemCodes({ total: availableRedeemCodes.length, items: availableRedeemCodes }, 'availableCodeCountText', 'availableCodeTable');
  renderPaymentOrders(paymentData || {});
}

function buildRedeemCodeMap(items) {
  return new Map((Array.isArray(items) ? items : [])
    .filter((item) => item && item.code)
    .map((item) => [String(item.code).toUpperCase(), item]));
}

function attachRedeemActivationInfo(user, redeemCodeMap) {
  const code = String((user && user.redeemCode) || '').toUpperCase();
  const codeInfo = redeemCodeMap.get(code) || {};
  const assigned = isRedeemCodeAssigned(codeInfo);
  return {
    ...user,
    redeemedCount: Number(codeInfo.redeemedCount) || (assigned ? 1 : Number(user && user.redeemedCount) || 0),
    maxRedemptions: 1,
    lastRedeemedOpenId: codeInfo.lastRedeemedOpenId
      || codeInfo.redeemedOpenId
      || codeInfo.paidOwnerOpenid
      || codeInfo.trialOwnerOpenid
      || codeInfo.deliveredTo
      || (user && user.openid)
      || '',
    lastRedeemedAt: codeInfo.lastRedeemedAt
      || codeInfo.redeemedAt
      || codeInfo.paymentPaidAt
      || codeInfo.deliveredAt
      || (user && user.redeemedAt)
      || '',
  };
}

function renderProUsers(data = {}, countId = 'proCount', tableId = 'proTable') {
  $(countId).textContent = `共 ${data.total || 0} 个用户`;
  $(tableId).innerHTML = (data.items || []).length ? (data.items || []).map((user) => {
    const statusMeta = getProStatusMeta(user);
    return `
    <tr>
      <td><div class="mono">${escapeHtml(user.openid)}</div></td>
      <td><span class="${statusMeta.className}">${escapeHtml(statusMeta.text)}</span></td>
      <td>${formatDate(user.proExpiresAt)}<br>${escapeHtml(user.remainingDays ?? '-')} 天</td>
      <td>
        <div>激活时间：${formatDate(user.redeemedAt)}</div>
        <span class="muted">兑换 ${escapeHtml(user.redeemedCount || 0)} / ${escapeHtml(user.maxRedemptions || 1)} 次 · 微信 ${escapeHtml(user.lastRedeemedOpenId || user.openid || '-')}</span>
      </td>
      <td>
        <div>${escapeHtml(formatMinutes(user.cloudUsedSeconds))} / ${escapeHtml(formatMinutes(user.cloudQuotaSeconds))}</div>
        <span class="muted">剩余 ${escapeHtml(formatMinutes(user.cloudRemainingSeconds))}</span>
      </td>
      <td><span class="mono">${escapeHtml(user.redeemCode || '-')}</span></td>
      <td class="row-actions">
        <button class="button" data-entitlement-id="${escapeHtml(user.entitlementId || '')}" data-entitlement-action="extend">续期</button>
        <button class="button" data-entitlement-id="${escapeHtml(user.entitlementId || '')}" data-entitlement-action="addCloudQuota">加分钟</button>
        <button class="button" data-entitlement-id="${escapeHtml(user.entitlementId || '')}" data-entitlement-action="activate">启用</button>
        <button class="button danger" data-entitlement-id="${escapeHtml(user.entitlementId || '')}" data-entitlement-action="disable">禁用</button>
      </td>
    </tr>
  `;
  }).join('') : '<tr><td colspan="7" class="table-empty">暂无数据</td></tr>';
}

function renderRedeemCodes(data = {}, countId = 'availableCodeCountText', tableId = 'availableCodeTable') {
  $(countId).textContent = `共 ${data.total || 0} 个兑换码`;
  $(tableId).innerHTML = (data.items || []).length ? (data.items || []).map((item) => {
    const statusMeta = getRedeemCodeStatusMeta(item);
    return `
      <tr>
        <td>
          <div class="mono">${escapeHtml(item.code)}</div>
          <span class="${statusMeta.className}">${escapeHtml(statusMeta.text)}</span>
          <span class="muted">${escapeHtml(item.durationDays || 0)} 天</span>
        </td>
        <td>${escapeHtml(item.deliveryStatusText)}<br>${escapeHtml(item.deliveredTo || '-')}</td>
        <td>${escapeHtml(item.note || '-')}</td>
        <td class="row-actions">
          <button class="button" data-code-id="${escapeHtml(item._id)}" data-code-action="markSent">标记已发</button>
          <button class="button" data-code-id="${escapeHtml(item._id)}" data-code-action="markUnsent">撤回</button>
          <button class="button danger" data-code-id="${escapeHtml(item._id)}" data-code-action="disable">删除</button>
        </td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="4" class="table-empty">暂无数据</td></tr>';
}

function getPaymentStatusText(status) {
  if (status === 'paid') return '已支付';
  if (status === 'cancelled') return '已取消';
  return '待确认';
}

function renderPaymentOrders(data = {}) {
  $('paymentOrderCountText').textContent = `共 ${data.total || 0} 个订单`;
  if (data.unavailableText) {
    $('paymentOrderTable').innerHTML = `<tr><td colspan="7" class="table-empty">${escapeHtml(data.unavailableText)}</td></tr>`;
    return;
  }
  $('paymentOrderTable').innerHTML = (data.items || []).length ? (data.items || []).map((item) => `
    <tr>
      <td><div class="mono">${escapeHtml(item.orderNo || '-')}</div></td>
      <td><div class="mono">${escapeHtml(item.openid || '-')}</div></td>
      <td>${escapeHtml(item.planName || item.planId || '-')}<br><span class="muted">${escapeHtml(item.durationDays || 0)} 天</span></td>
      <td>${escapeHtml(item.amountText || '-')}</td>
      <td><span class="tag ${item.status === 'paid' ? '' : 'warn'}">${escapeHtml(getPaymentStatusText(item.status))}</span></td>
      <td>创建：${formatDate(item.createdAt)}<br><span class="muted">支付：${formatDate(item.paidAt)}</span></td>
      <td class="row-actions">
        <button class="button" data-order-no="${escapeHtml(item.orderNo || '')}" data-order-action="markPaid">标记已支付</button>
        <button class="button danger" data-order-no="${escapeHtml(item.orderNo || '')}" data-order-action="cancel">取消</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="table-empty">暂无数据</td></tr>';
}

async function generateCodes() {
  const data = await request('/redeem-codes/generate', {
    count: Number($('codeCount').value),
    durationDays: Number($('codeDays').value),
    maxRedemptions: 1,
    prefix: $('codePrefix').value,
    note: $('codeNote').value,
  });
  $('generatedCodes').value = data.plainText || '';
  await loadProManagement();
}

async function updateCode(codeId, action) {
  await request('/redeem-codes/update', {
    codeId,
    action,
    deliveredTo: $('deliveredTo').value.trim(),
  });
  await loadProManagement();
}

async function updateEntitlement(entitlementId, action) {
  if (!entitlementId) throw new Error('这条记录缺少 Pro 权限 ID，无法操作');
  await request('/entitlements/update', {
    entitlementId,
    action,
    days: Number($('extendDays').value) || 30,
    minutes: Number($('cloudCreditMinutes').value) || 60,
  });
  await loadProManagement();
}

async function updatePaymentOrder(orderNo, action) {
  if (!orderNo) throw new Error('缺少订单号');
  await request('/payment-orders/update', {
    orderNo,
    action,
  });
  await loadProManagement();
}

function bindEvents() {
  $('saveConfig').addEventListener('click', saveConfig);
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => setView(item.dataset.view));
  });
  document.querySelectorAll('#rangeTabs button').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#rangeTabs button').forEach((tab) => tab.classList.remove('active'));
      item.classList.add('active');
      state.range = item.dataset.range;
      state.loadedViews.overview = false;
      run(loadOverview);
    });
  });
  $('refreshOverview').addEventListener('click', () => { state.loadedViews.overview = false; run(loadOverview); });
  $('refreshFunnel').addEventListener('click', () => { state.loadedViews.funnel = false; run(loadFunnel); });
  $('refreshPro').addEventListener('click', () => { state.loadedViews.pro = false; run(loadProManagement); });
  ['proKeyword', 'codeKeyword', 'codeStatusFilter', 'codeDeliveryFilter', 'paymentStatusFilter'].forEach((id) => {
    $(id).addEventListener('change', () => { state.loadedViews.pro = false; run(loadProManagement); });
  });
  $('generateCodes').addEventListener('click', () => run(generateCodes));
  ['availableCodeTable'].forEach((tableId) => $(tableId).addEventListener('click', (event) => {
    const target = event.target.closest('[data-code-action]');
    if (!target) return;
    run(() => updateCode(target.dataset.codeId, target.dataset.codeAction));
  }));
  ['proTable', 'expiredProTable'].forEach((tableId) => $(tableId).addEventListener('click', (event) => {
    const target = event.target.closest('[data-entitlement-action]');
    if (!target) return;
    run(() => updateEntitlement(target.dataset.entitlementId, target.dataset.entitlementAction));
  }));
  $('paymentOrderTable').addEventListener('click', (event) => {
    const target = event.target.closest('[data-order-action]');
    if (!target) return;
    run(() => updatePaymentOrder(target.dataset.orderNo, target.dataset.orderAction));
  });
}

loadConfig();
bindEvents();
setView('overview');
if (state.apiBase && state.adminSecret) {
  loadCurrentView('overview', true);
}
