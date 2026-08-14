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

module.exports = {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  createXiaohongshuCommentMarkdownHelpers,
  createXiaohongshuMarkdownBuilder,
};
