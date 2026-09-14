'use strict';

const DEFAULT_TITLE = '\u5c0f\u7ea2\u4e66\u7b14\u8bb0';
const DEFAULT_DESCRIPTION = '\u9875\u9762\u672a\u76f4\u63a5\u66b4\u9732\u6b63\u6587\uff0c\u539f\u59cb\u94fe\u63a5\u5df2\u5199\u5165\u7b14\u8bb0\u5c5e\u6027\u3002';

function createXiaohongshuMarkdownBuilder(dependencies = {}) {
  const { buildCommentsMarkdown = () => '' } = dependencies;
  return ({
    title = DEFAULT_TITLE,
    description = '',
    tags = [],
    imageUrls = [],
    videoUrl = '',
    comments = [],
  } = {}) => {
    const images = Array.isArray(imageUrls) ? imageUrls : [];
    const normalizedTags = Array.isArray(tags) ? tags : [];
    const lines = [
      '## \u6807\u9898',
      '',
      title,
      '',
      '## \u6b63\u6587',
      '',
      description || DEFAULT_DESCRIPTION,
      '',
    ];

    if (normalizedTags.length) {
      lines.push('## \u6807\u7b7e', '', normalizedTags.join(' '), '');
    }

    if (images.length) {
      lines.push('## \u56fe\u7247', '', '### \u5c01\u9762', '', '![\u5c01\u9762](' + images[0] + ')', '');
      if (images.length > 1) {
        lines.push('### \u5185\u9875\u56fe', '');
        images.slice(1).forEach((image, index) => {
          lines.push('![\u5185\u9875\u56fe ' + (index + 1) + '](' + image + ')', '');
        });
      }
    }

    if (videoUrl) {
      lines.push('## \u89c6\u9891\u6e90', '', '[\u89c6\u9891\u6587\u4ef6](' + videoUrl + ')', '');
    }

    const commentsMarkdown = buildCommentsMarkdown(comments);
    if (commentsMarkdown) {
      lines.push(commentsMarkdown, '');
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };
}

function createXiaohongshuCommentMarkdownHelpers(dependencies = {}) {
  const { buildCommentsMarkdown = () => '' } = dependencies;
  const commentHeadingPattern = /^##\s+\u8bc4\u8bba\u533a\s*$/u;
  const nextHeadingPattern = /^##\s+\S/u;
  const diagnosticPattern = /\n*<!-- xhs-comment-diag:[\s\S]*?-->\s*$/u;
  const diagnosticLiteralPattern = /^<!-- xhs-comment-diag: [\s\S]* -->$/u;

  const buildCommentDiagnostic = (details = {}) => {
    const source = String(details.source || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
    const toCount = (value) => Math.max(0, Math.floor(Number(value) || 0));
    const toLabel = (value, fallback = 'unknown') => String(value || fallback).replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || fallback;
    const scrollMode = toLabel(details.scrollMode);
    const pageApiStopReason = toLabel(details.pageApiStopReason);
    const stopReason = String(details.stopReason || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'unknown';
    return '<!-- xhs-comment-diag: source=' + source
      + '; root=' + toCount(details.rootCount)
      + '; replies=' + toCount(details.replyCount)
      + '; pages=' + toCount(details.pageCount)
      + '; root_pages=' + toCount(details.rootPageCount)
      + '; reply_pages=' + toCount(details.replyPageCount)
      + '; root_requests=' + toCount(details.rootRequestCount)
      + '; reply_requests=' + toCount(details.replyRequestCount)
      + '; merged_root=' + toCount(details.mergedRootCount)
      + '; merged_replies=' + toCount(details.mergedReplyCount)
      + '; restored_root=' + toCount(details.restoredRootCount)
      + '; restored_replies=' + toCount(details.restoredReplyCount)
      + '; final_root=' + toCount(details.finalRootCount)
      + '; final_replies=' + toCount(details.finalReplyCount)
      + '; lost_root=' + toCount(details.lostRootCount)
      + '; lost_replies=' + toCount(details.lostReplyCount)
      + '; fallback=' + toCount(details.fallbackAddedCount)
      + '; deduped=' + toCount(details.dedupedFallbackCount)
      + '; dropped=' + toCount(details.droppedFallbackCount)
      + '; unmatched=' + toCount(details.unmatchedReplyCount)
      + '; invalid=' + toCount(details.invalidPayloadCount)
      + '; partial=' + (details.partial ? 1 : 0)
      + '; scroll=' + scrollMode
      + '; api_stop=' + pageApiStopReason
      + '; stop=' + stopReason
      + ' -->';
  };

  const stripComments = (markdown = '') => {
    const source = String(markdown || '').replace(diagnosticPattern, '').trim();
    if (!source) return '';
    const kept = [];
    let skippingComments = false;
    source.split(/\r?\n/).forEach((line) => {
      if (commentHeadingPattern.test(line.trim())) {
        skippingComments = true;
        return;
      }
      if (skippingComments && nextHeadingPattern.test(line.trim())) {
        skippingComments = false;
      }
      if (!skippingComments) kept.push(line);
    });
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  return {
    buildCommentDiagnostic,

    appendCommentDiagnostic(markdown, details = {}) {
      const source = String(markdown || '').trim().replace(diagnosticPattern, '').trim();
      if (!source) return source;
      const diagnostic = typeof details === 'string' && diagnosticLiteralPattern.test(details)
        ? details
        : buildCommentDiagnostic(details);
      return source + '\n\n' + diagnostic;
    },

    stripComments,

    replaceComments(markdown, comments = []) {
      const source = stripComments(markdown);
      const commentMarkdown = buildCommentsMarkdown(comments);
      return [source, commentMarkdown].filter(Boolean).join('\n\n').trim();
    },
  };
}

// Only structured evidence belongs in support diagnostics. Never copy response
// bodies, URLs, cookies, or arbitrary exception text into these fields.
function sanitizeXiaohongshuCommentResult(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  const count = (value) => Math.max(0, Math.min(1000000, Math.floor(Number.isFinite(Number(value)) ? Number(value) : 0)));
  const pick = (value, values, fallback) => values.includes(value) ? value : fallback;
  const token = (value) => [
    'unknown', 'disabled', 'pro_not_confirmed', 'existing_content', 'login_unconfirmed',
    'content_pending', 'content_failed', 'capture_started', 'capture_returned', 'capture_error', 'empty_result',
    'exhausted', 'source_exhausted', 'root_unavailable', 'root_request_failed', 'reply_request_failed',
    'root_cursor_missing', 'reply_cursor_missing', 'root_cursor_repeated', 'time_budget_exceeded',
    'total_limit_reached', 'limit_reached', 'reply_limit_reached', 'note_id_missing',
    'network_root_idle', 'network_source_exhausted', 'network_root_cursor_missing',
    'network_root_request_failed', 'network_root_unavailable', 'max_rounds', 'root_idle',
  ].includes(value) ? value : 'unknown';
  return {
    schema: 1,
    attemptId: /^[0-9a-f]{8}$/.test(input.attemptId || '') ? input.attemptId : '',
    loginCookiePresent: typeof input.loginCookiePresent === 'boolean' ? input.loginCookiePresent : null,
    loginEvidence: pick(input.loginEvidence, ['account_signal', 'page_signal', 'cookie_only', 'none', 'unknown'], 'unknown'),
    time: /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(input.time || '') ? input.time : '',
    status: pick(input.status, ['not_attempted', 'running', 'skipped', 'captured', 'partial', 'failed', 'empty_unconfirmed', 'aborted'], 'not_attempted'),
    reason: token(input.reason),
    stage: pick(input.stage, ['content', 'capability', 'login_check', 'comment_extraction', 'root_request', 'reply_request'], 'content'),
    enabled: input.enabled === true,
    proAccess: typeof input.proAccess === 'boolean' ? input.proAccess : null,
    loginCheck: pick(input.loginCheck, ['passed', 'unconfirmed', 'not_checked'], 'not_checked'),
    rootCount: count(input.rootCount),
    replyCount: count(input.replyCount),
    pageCount: count(input.pageCount),
    rootRequestCount: count(input.rootRequestCount),
    replyRequestCount: count(input.replyRequestCount),
    invalidPayloadCount: count(input.invalidPayloadCount),
    stopReason: token(input.stopReason),
    errorCode: /^(?:HTTP_\d{3}|BUSINESS_-?\d{1,10}|TIMEOUT|REQUEST_FAILED|INVALID_RESPONSE|SECURITY_RESTRICTION|BROWSER_UNAVAILABLE)$/.test(input.errorCode || '') ? input.errorCode : '',
  };
}

function getXiaohongshuCommentErrorCode(error) {
  const message = String(error && (error.code || error.message) || error || '');
  if (/^(?:HTTP_\d{3}|BUSINESS_-?\d{1,10}|INVALID_RESPONSE)$/i.test(message)) return message.toUpperCase();
  if (/timeout|timed?\s*out|AbortError/i.test(message)) return 'TIMEOUT';
  if (/security_restriction|300011/i.test(message)) return 'SECURITY_RESTRICTION';
  return 'REQUEST_FAILED';
}

function formatXiaohongshuCommentResult(input, diagnostic = false) {
  if (!input) return '';
  const result = sanitizeXiaohongshuCommentResult(input);
  const count = result.rootCount + result.replyCount;
  const messages = {
    not_attempted: '本次尚未执行小红书评论提取',
    running: '小红书评论提取尚未结束',
    skipped: result.reason === 'disabled' ? '小红书评论提取已关闭'
      : result.reason === 'pro_not_confirmed' ? '小红书评论未提取：未确认 Pro 权限'
        : result.reason === 'existing_content' ? '本次复用了已保存正文，未重新提取小红书评论'
          : '小红书评论未提取：登录预检未通过，尚不能确定是登录失效还是检测失败',
    captured: `小红书评论已提取 ${count} 条（主评论 ${result.rootCount} 条，回复 ${result.replyCount} 条）`,
    partial: `小红书评论可能不完整：已提取 ${count} 条（主评论 ${result.rootCount} 条，回复 ${result.replyCount} 条）`,
    failed: `小红书评论提取失败${result.loginCheck === 'passed' ? '（登录预检已通过）' : ''}`,
    empty_unconfirmed: '小红书评论未获取到，无法确认原笔记是否没有评论',
    aborted: '小红书评论提取已取消',
  };
  const advice = ['failed', 'partial', 'empty_unconfirmed'].includes(result.status)
    ? '；请在插件设置的“同步/安装失败诊断”中复制诊断信息' : '';
  const message = messages[result.status] + advice;
  return diagnostic ? `${message}\n${JSON.stringify(result)}` : message;
}

module.exports = {
  sanitizeXiaohongshuCommentResult,
  getXiaohongshuCommentErrorCode,
  formatXiaohongshuCommentResult,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  createXiaohongshuCommentMarkdownHelpers,
  createXiaohongshuMarkdownBuilder,
};
