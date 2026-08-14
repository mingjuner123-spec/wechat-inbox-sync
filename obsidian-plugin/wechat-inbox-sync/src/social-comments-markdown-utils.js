'use strict';

function createSocialCommentsMarkdownBuilder(dependencies = {}) {
  const {
    normalizeComment = (comment) => comment,
    formatTime = (value) => String(value || '').trim(),
    formatLikes = (value) => String(value || '').trim(),
  } = dependencies;

  return (comments = []) => {
    const items = (comments || []).map((comment) => normalizeComment(comment)).filter(Boolean);
    if (!items.length) return '';
    const lines = ['## \u8bc4\u8bba\u533a', ''];
    const appendComment = (comment, indent = '', reply = false) => {
      const meta = [formatTime(comment.time), formatLikes(comment.likes)].filter(Boolean).join(' \u00b7 ');
      const prefix = comment.author ? '**' + comment.author + '**\uff1a' : '';
      lines.push(
        indent
        + '- '
        + (reply ? '\u21b3 ' : '')
        + prefix
        + comment.content
        + (meta ? '\uff08' + meta + '\uff09' : ''),
      );
      (Array.isArray(comment.replies) ? comment.replies : []).forEach((child) => {
        appendComment(child, indent + '  ', true);
      });
    };
    items.forEach((comment) => appendComment(comment));
    return lines.join('\n').trim();
  };
}

module.exports = {
  createSocialCommentsMarkdownBuilder,
};
