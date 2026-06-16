const STORAGE_KEY = 'ob_admin_console_config';
const DEFAULT_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';

const state = {
  view: 'overview',
  range: 'all',
  apiBase: '',
  adminSecret: '',
  loadedViews: {},
};

const viewMeta = {
  overview: ['总览', '查看访问、绑定、同步和 Pro 转化。'],
  funnel: ['运营漏斗', '上一天关键漏斗和转化掉点。'],
  pro: ['Pro 管理', '生成、发放、筛选、删除兑换码，并管理 Pro 用户。'],
};

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
  if (status === 'redeemed' || redeemedCount > 0) return { text: '已兑换', className: 'tag warn' };
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
  const redeemedCount = Number(item && item.redeemedCount) || 0;
  return status === 'active' && redeemedCount <= 0;
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

function renderFunnel(steps = []) {
  $('funnelList').innerHTML = steps.map((item) => `
    <article class="funnel-step">
      <div class="funnel-label">${escapeHtml(item.label)}</div>
      <div class="funnel-value">${escapeHtml(item.value)}</div>
      <div class="funnel-rate">上一步 ${escapeHtml(item.rateText || '-')}</div>
      <div class="funnel-hint">${escapeHtml(item.hint || '')}</div>
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

function renderYesterdayFunnel(data = {}) {
  const cards = data.cards || [
    { label: '访问用户总数', value: data.visitUserTotal || 0, hint: data.day || '' },
    { label: '新用户数', value: data.newUserCount || 0, hint: '昨天前未完成绑定' },
    { label: '老用户数', value: data.returningUserCount || 0, hint: '昨天前已完成绑定' },
    { label: '新用户中完成绑定的用户', value: data.newBoundUserCount || 0, hint: '昨天完成首次绑定' },
    { label: '开通 Pro 的用户数', value: data.proOpenedUsers || 0, hint: '含 7 天体验' },
    { label: '开通付费数', value: data.paidOpenedUsers || 0, hint: 'Pro 时长 30 天及以上' },
    { label: '总 Pro 开通数', value: data.totalProOpenedUsers || 0, hint: '历史累计' },
    { label: '总绑定数', value: data.totalBoundCount || 0, hint: '历史绑定设备数' },
    { label: '总访问数', value: data.totalVisitEvents || 0, hint: '历史访问人次' },
  ];
  $('yesterdayFunnelGrid').innerHTML = cards.map((item) => `
    <article class="metric-card">
      <div class="metric-label">${escapeHtml(item.label)}</div>
      <div class="metric-value">${escapeHtml(item.value)}</div>
      <div class="metric-hint">${escapeHtml(item.hint || '')}</div>
    </article>
  `).join('');
}

function renderBreakpoints(items = []) {
  $('breakpointList').innerHTML = items.length ? items.map((item) => `
    <article class="breakpoint-item ${escapeHtml(item.severity || 'ok')}">
      <div>
        <div class="breakpoint-title">${escapeHtml(item.from)} → ${escapeHtml(item.to)}</div>
        <div class="breakpoint-desc">流失 ${escapeHtml(item.dropValue)} 人，转化 ${escapeHtml(item.conversionText || '-')}，掉点 ${escapeHtml(item.dropText || '-')}</div>
        <div class="breakpoint-action">${escapeHtml(item.action || '')}</div>
      </div>
      <div class="breakpoint-number">${escapeHtml(item.fromValue)} → ${escapeHtml(item.toValue)}</div>
    </article>
  `).join('') : '<div class="stack-item"><div class="stack-desc">暂无漏斗断点数据</div></div>';
}

function renderSegments(items = []) {
  $('segmentGrid').innerHTML = items.map((item) => `
    <article class="segment-item">
      <div class="segment-label">${escapeHtml(item.label)}</div>
      <div class="segment-value">${escapeHtml(item.value)}</div>
      <div class="segment-hint">${escapeHtml(item.hint || '')}</div>
    </article>
  `).join('');
}

function renderTrends(items = []) {
  const maxValue = Math.max(1, ...items.map((item) => Math.max(item.visits || 0, item.binds || 0, item.syncs || 0, item.pros || 0, item.records || 0)));
  $('trendList').innerHTML = items.map((item) => {
    const width = Math.max(4, Math.round(((item.visits || item.records || item.syncs || 0) / maxValue) * 100));
    return `
      <article class="trend-row">
        <div class="trend-day">${escapeHtml(String(item.day || '').slice(5))}</div>
        <div class="trend-bars">
          <div class="trend-bar" style="width:${width}%"></div>
        </div>
        <div class="trend-meta">访 ${escapeHtml(item.visits)} / 绑 ${escapeHtml(item.binds)} / 同 ${escapeHtml(item.syncs)} / Pro ${escapeHtml(item.pros)}</div>
      </article>
    `;
  }).join('');
}

async function loadOverview() {
  const data = await request('/summary', { range: state.range, maxRead: 5000 });
  renderMetrics(data.cards || []);
  renderFunnel((data.funnel && data.funnel.steps) || []);
  renderStack('diagnosisList', data.diagnoses || [], '暂无明显异常');
  renderStack('issueList', data.issues || [], '暂无待处理异常');
  $('scopeText').textContent = data.scope ? `${data.scope.label} · ${data.scope.desc}` : '';
}

async function loadFunnel() {
  const data = await request('/summary', { range: 'all', maxRead: 5000 });
  renderYesterdayFunnel(data.yesterdayFunnel || {});
  $('conversionGrid').innerHTML = (data.funnel && data.funnel.conversionCards ? data.funnel.conversionCards : []).map((item) => `
    <article class="metric-card">
      <div class="metric-label">${escapeHtml(item.label)}</div>
      <div class="metric-value">${escapeHtml(item.value)}</div>
      <div class="metric-hint">${escapeHtml(item.hint || '')}</div>
    </article>
  `).join('');
  renderBreakpoints((data.funnel && data.funnel.breakpoints) || []);
  renderSegments(data.segments || []);
  renderTrends((data.trends && data.trends.daily) || []);
  $('funnelScopeText').textContent = data.yesterdayFunnel && data.yesterdayFunnel.day
    ? `${data.yesterdayFunnel.day} · ${data.scope ? data.scope.label : ''}`
    : (data.scope ? `${data.scope.label} · ${data.scope.desc}` : '');
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
  return {
    ...user,
    redeemedCount: Number(codeInfo.redeemedCount) || Number(user && user.redeemedCount) || 0,
    maxRedemptions: 1,
    lastRedeemedOpenId: codeInfo.lastRedeemedOpenId || codeInfo.redeemedOpenId || (user && user.openid) || '',
    lastRedeemedAt: codeInfo.lastRedeemedAt || codeInfo.redeemedAt || (user && user.redeemedAt) || '',
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
