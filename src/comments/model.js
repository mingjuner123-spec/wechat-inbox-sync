const DEFAULT_COMMENT_LIMIT = 100;

const DEFAULT_LABELS = {
  sectionTitle: '评论区',
  anonymous: '匿名用户',
  reply: '回复',
  likes: '赞',
  separator: ' · ',
  colon: '：',
  metaOpen: '（',
  metaClose: '）',
};

function trimEdgeColon(value) {
  return String(value || '').replace(/^[:：]+|[:：]+$/g, '').trim();
}

function createCommentModel(options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_COMMENT_LIMIT;
  const isNoiseText = typeof options.isNoiseText === 'function' ? options.isNoiseText : () => false;
  const labels = { ...DEFAULT_LABELS, ...(options.labels || {}) };

  function normalizeSocialComment(comment) {
    const source = comment || {};
    const author = trimEdgeColon(source.author);
    const content = String(source.content || '').replace(/\s+/g, ' ').trim();
    if (!content || content.length < 2) return null;
    if (isNoiseText(content)) return null;
    if (author && isNoiseText(author)) return null;
    const normalized = {
      id: String(source.id || source.commentId || source.comment_id || '').trim(),
      rootId: String(source.rootId || source.root_id || source.rootCommentId || source.root_comment_id || '').trim(),
      parentId: String(source.parentId || source.parent_id || source.parentCommentId || source.parent_comment_id || source.targetCommentId || source.target_comment_id || '').trim(),
      author,
      content,
      time: String(source.time || '').trim(),
      likes: String(source.likes || '').trim(),
      replyTo: trimEdgeColon(source.replyTo || source.reply_to),
    };
    const normalizedReplies = (Array.isArray(source.replies) ? source.replies : [])
      .map((reply) => normalizeSocialComment(reply))
      .filter(Boolean)
      .map((reply) => ({
        ...reply,
        replyTo: reply.replyTo || normalized.author,
      }));
    normalized.replies = normalizedReplies;
    return normalized;
  }

  function pushSocialComment(comments, seen, comment) {
    const normalized = normalizeSocialComment(comment || {});
    if (!normalized) return;
    const key = `${normalized.author}|${normalized.content}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push(normalized);
  }

  function threadSocialComments(comments = [], maxItems = limit) {
    const flattened = [];
    let syntheticIndex = 0;
    const flatten = (comment, parent = null) => {
      const normalized = normalizeSocialComment(comment);
      if (!normalized) return;
      const replies = normalized.replies || [];
      const selfKey = normalized.id || `__comment_${syntheticIndex += 1}`;
      flattened.push({
        ...normalized,
        _threadKey: selfKey,
        rootId: normalized.rootId || (parent ? parent.rootId || parent._threadKey || parent.id || '' : ''),
        parentId: normalized.parentId || (parent ? parent._threadKey || parent.id || '' : ''),
        replyTo: normalized.replyTo || (parent ? parent.author || '' : ''),
        replies: [],
      });
      replies.forEach((reply) => flatten(reply, { ...normalized, _threadKey: selfKey }));
    };
    (comments || []).forEach((comment) => flatten(comment));

    const byId = new Map();
    const roots = [];
    const seenKeys = new Set();
    const keyFor = (comment) => comment.id || comment._threadKey || `${comment.author}|${comment.content}`;
    const register = (comment) => {
      const key = keyFor(comment);
      if (!key || seenKeys.has(key)) return null;
      seenKeys.add(key);
      const next = { ...comment, replies: [] };
      if (next.id) byId.set(next.id, next);
      if (next._threadKey) byId.set(next._threadKey, next);
      return next;
    };

    flattened.forEach((comment) => {
      const next = register(comment);
      if (!next) return;
      const isReply = Boolean(next.rootId || next.parentId || next.replyTo);
      const rootId = next.rootId && next.rootId !== next.id ? next.rootId : '';
      const parentId = next.parentId && next.parentId !== next.id ? next.parentId : '';
      if (isReply && !rootId && next.replyTo) {
        const rootByReplyTo = [...roots].reverse().find((item) => item.author && item.author === next.replyTo);
        if (rootByReplyTo) {
          rootByReplyTo.replies.push(next);
          return;
        }
      }
      if (!isReply || !rootId) {
        roots.push(next);
        return;
      }
      const root = byId.get(rootId);
      const parent = parentId ? byId.get(parentId) : null;
      if (parent && parent !== root) {
        next.replyTo = next.replyTo || parent.author || '';
        const rootForParent = root || roots.find((item) => item.id === rootId);
        if (rootForParent) rootForParent.replies.push(next);
        else parent.replies.push(next);
        return;
      }
      if (root) {
        next.replyTo = next.replyTo || root.author || '';
        root.replies.push(next);
        return;
      }
      roots.push(next);
    });

    const countThread = (items) => {
      let count = 0;
      const visit = (item) => {
        if (!item || count >= maxItems) return;
        count += 1;
        (item.replies || []).forEach(visit);
      };
      (items || []).forEach(visit);
      return count;
    };
    while (countThread(roots) > maxItems && roots.length) {
      const last = roots[roots.length - 1];
      if (last.replies && last.replies.length) last.replies.pop();
      else roots.pop();
    }
    return roots;
  }

  function buildSocialCommentsMarkdown(comments = [], renderOptions = {}) {
    const maxItems = Number(renderOptions.limit) > 0 ? Number(renderOptions.limit) : limit;
    const items = threadSocialComments((comments || []).map(normalizeSocialComment).filter(Boolean), maxItems);
    if (!items.length) return '';
    const lines = [`## ${labels.sectionTitle}`, ''];
    const renderCommentLine = (comment, indent = '') => {
      const meta = [comment.time, comment.likes ? `${comment.likes} ${labels.likes}` : ''].filter(Boolean).join(labels.separator);
      const author = comment.author || labels.anonymous;
      const relation = comment.replyTo ? ` ${labels.reply} **${comment.replyTo}**` : '';
      return `${indent}- **${author}**${relation}${labels.colon}${comment.content}${meta ? `${labels.metaOpen}${meta}${labels.metaClose}` : ''}`;
    };
    const renderThread = (comment, depth = 0) => {
      lines.push(renderCommentLine(comment, '  '.repeat(depth)));
      (comment.replies || []).forEach((reply) => renderThread(reply, depth + 1));
    };
    items.forEach((comment) => {
      renderThread(comment);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  return {
    normalizeSocialComment,
    pushSocialComment,
    threadSocialComments,
    buildSocialCommentsMarkdown,
  };
}

const defaultModel = createCommentModel();

module.exports = {
  DEFAULT_COMMENT_LIMIT,
  DEFAULT_LABELS,
  createCommentModel,
  normalizeSocialComment: defaultModel.normalizeSocialComment,
  pushSocialComment: defaultModel.pushSocialComment,
  threadSocialComments: defaultModel.threadSocialComments,
  buildSocialCommentsMarkdown: defaultModel.buildSocialCommentsMarkdown,
};
