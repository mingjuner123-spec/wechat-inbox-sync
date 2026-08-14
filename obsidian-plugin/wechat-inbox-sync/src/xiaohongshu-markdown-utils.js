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

module.exports = {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  createXiaohongshuMarkdownBuilder,
};
