'use strict';
const { isWechatArticleUrl } = require('./wechat-article-utils');
const MESSAGES = [
  '微信公众号未返回正文，已保存原始链接和可用线索；可在微信内打开后重试。',
  '公众号文章暂时不可访问，未能取得正文。',
  '公众号文章触发了微信安全验证，插件不能自动绕过验证。',
];
function isWechatArticleFailurePlaceholder(markdown) {
  const body = String(markdown || '').replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/^\s*<!--\s*wechat-inbox-(?:record-id|content-kind):[^>]*-->\s*/g, '').trimStart()
    .replace(/^#{1,2}\s+Markdown 内容\s*\r?\n/, '').trimStart();
  if (![...body.matchAll(/^原始链接[：:]\s*(https?:\/\/[^\s<>]+)\s*$/gm)].some(match => isWechatArticleUrl(match[1]))) return false;
  return MESSAGES.some(message => body === message || body.startsWith(message + '\n') || body.startsWith(message + '\r\n'));
}
function getWechatPlaceholderRecoveryUrl(markdown) {
  if (!isWechatArticleFailurePlaceholder(markdown)) return '';
  const urls = [...String(markdown).matchAll(/^原始链接[：:]\s*(https?:\/\/[^\s<>]+)\s*$/gm)].map(match => match[1]);
  const unique = [...new Set(urls)];
  if (unique.length !== 1 || !isWechatArticleUrl(unique[0])) return '';
  const parsed = new URL(unique[0]);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port ? unique[0] : '';
}
module.exports = { isWechatArticleFailurePlaceholder, getWechatPlaceholderRecoveryUrl };
