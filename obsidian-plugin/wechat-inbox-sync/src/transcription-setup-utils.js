'use strict';
const SETUP_CODES = new Set(['LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED', 'LOCAL_TRANSCRIPTION_BINDING_REQUIRED', 'LOCAL_COMPONENT_SETUP_REQUIRED']);
function membershipGuidance(status = {}, feature = '音视频转写') {
  if (status.status === 'unbound') return '待绑定：请先在插件设置中完成小程序绑定，再刷新会员状态。';
  const reason = status.status === 'expired' ? 'Pro 会员已过期' : '当前没有有效 Pro 会员';
  return '待开通会员：' + reason + '。' + feature + '需要有效 Pro。请前往微信小程序「Obsidian 内容同步助手」领取试用会员（如可领取）或开通/续费会员；生效后点击「安装／更新本地组件」（已安装可跳过），再在小程序同步历史中重试。';
}
function setupError(code, message, diagnostic = {}) {
  return Object.assign(new Error(message), {code, transcriptionSetupRequired: true, setupRequired: true,
    diagnostic: {...diagnostic, setupRequired: true, setupCode: code, setupMessage: message}});
}
function isSetupRequired(error) { return !!error && SETUP_CODES.has(error.code); }
function setupSummary(bound, status, readiness = {}, installing = false) {
  const components = [['asr','音视频转写'],['ocr','图片文字识别'],['resolver','抖音解析']].map(([key,label]) => ({key,label,ready: readiness[key+'Status']?.ready === true}));
  const active = !!status?.hasAccess && status.status !== 'expired' && Date.parse(status.expiresAt || '') > Date.now();
  const message = !bound ? membershipGuidance({status:'unbound'}) : !status ? '会员状态待确认，请刷新检查。' : !active ? membershipGuidance(status) : installing ? '组件正在安装，请等待完成。' : components.every(x=>x.ready) ? '转写准备已完成。兼容可用的组件无需更新。' : '待安装组件：'+components.filter(x=>!x.ready).map(x=>x.label).join('、')+'。已就绪的功能可以继续使用。';
  return {message,components,active,bound};
}
module.exports={membershipGuidance,setupError,isSetupRequired,setupSummary};
