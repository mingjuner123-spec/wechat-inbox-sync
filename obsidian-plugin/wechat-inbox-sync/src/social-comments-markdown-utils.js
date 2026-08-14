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

function createSocialCommentSectionHelpers(dependencies = {}) {
  const { buildCommentsMarkdown = () => '' } = dependencies;
  const sectionHeading = '## \u8bc4\u8bba\u533a';
  const sectionLinePattern = /^##\s+\u8bc4\u8bba\u533a\s*$/u;
  const sectionStartPattern = /(^|\n)##\s+\u8bc4\u8bba\u533a(?:\s|\n|$)/u;
  const sectionSplitPattern = /(^|\n)##\s+\u8bc4\u8bba\u533a\s*(?:\n|$)/u;
  const commentLinePattern = /^(\s*)-\s+(?:\u21b3\s+)?/u;

  const hasCommentsSection = (markdown = '') => sectionStartPattern.test(String(markdown || ''));

  return {
    hasCommentsSection,

    getStats(markdown = '') {
      let rootCount = 0;
      let replyCount = 0;
      let inComments = false;
      String(markdown || '').split(/\r?\n/).forEach((line) => {
        if (sectionLinePattern.test(line.trim())) {
          inComments = true;
          return;
        }
        if (inComments && /^##\s+/.test(line.trim())) {
          inComments = false;
          return;
        }
        if (!inComments) return;
        const match = line.match(commentLinePattern);
        if (!match) return;
        if (match[1].length > 0) replyCount += 1;
        else rootCount += 1;
      });
      return { rootCount, replyCount };
    },

    appendComments(markdown, comments = []) {
      const source = String(markdown || '').trim();
      if (!source || hasCommentsSection(source)) return source;
      const commentMarkdown = buildCommentsMarkdown(comments);
      return commentMarkdown ? source + '\n\n' + commentMarkdown : source;
    },

    splitComments(markdown = '') {
      const source = String(markdown || '').trim();
      if (!source) return { markdown: '', trailingMarkdown: '' };
      const match = sectionSplitPattern.exec(source);
      if (!match) return { markdown: source, trailingMarkdown: '' };
      const sectionStart = match.index + (match[1] ? match[1].length : 0);
      return {
        markdown: source.slice(0, sectionStart).trim(),
        trailingMarkdown: source.slice(sectionStart).trim(),
      };
    },

    sectionHeading,
  };
}

module.exports = {
  createSocialCommentSectionHelpers,
  createSocialCommentsMarkdownBuilder,
};
