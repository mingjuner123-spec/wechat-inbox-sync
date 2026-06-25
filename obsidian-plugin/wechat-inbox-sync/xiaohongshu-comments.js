function decodeUrlComponentSafely(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (error) {
    return String(value || '');
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return null;
  }
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function isNoiseSocialCommentText(text) {
  const source = decodeHtmlEntities(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!source) return true;
  const compact = source.replace(/\s+/g, '');
  if (!compact) return true;
  if (/^(?:回复|展开|收起|查看更多|查看更多回复|全部回复|更多回复|写评论|说点什么|抢首评)$/i.test(compact)) return true;
  if (/登录(?:后查看|查看更多|查看全部评论)/.test(compact)) return true;
  if (/请先登录|手机号登录|扫码登录|验证码|小红书网页登录/.test(compact)) return true;
  return false;
}

function normalizeSocialComment(comment) {
  const author = String(comment && comment.author || '').replace(/^[:：]+|[:：]+$/g, '').trim();
  const content = String(comment && comment.content || '').replace(/\s+/g, ' ').trim();
  if (!content || content.length < 2) return null;
  if (isNoiseSocialCommentText(content)) return null;
  if (author && isNoiseSocialCommentText(author)) return null;
  const normalized = {
    id: String(comment && (comment.id || comment.commentId || comment.comment_id) || '').trim(),
    rootId: String(comment && (comment.rootId || comment.root_id || comment.rootCommentId || comment.root_comment_id) || '').trim(),
    parentId: String(comment && (comment.parentId || comment.parent_id || comment.parentCommentId || comment.parent_comment_id || comment.targetCommentId || comment.target_comment_id) || '').trim(),
    author,
    content,
    time: String(comment && comment.time || '').trim(),
    likes: String(comment && comment.likes || '').trim(),
    replyTo: String(comment && (comment.replyTo || comment.reply_to) || '').replace(/^[:：]+|[:：]+$/g, '').trim(),
  };
  normalized.replies = (Array.isArray(comment && comment.replies) ? comment.replies : [])
    .map((reply) => normalizeSocialComment(reply))
    .filter(Boolean)
    .map((reply) => ({ ...reply, replyTo: reply.replyTo || normalized.author }));
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

function readCommentField(item, keys) {
  for (const key of keys) {
    if (item && Object.prototype.hasOwnProperty.call(item, key) && item[key] !== undefined && item[key] !== null) {
      const value = item[key];
      if (typeof value === 'object') {
        const nested = readCommentField(value, ['text', 'content', 'contentText', 'commentText', 'value', 'nickname', 'nickName', 'name']);
        if (nested) return nested;
      } else {
        const text = String(value).trim();
        if (text) return text;
      }
    }
  }
  return '';
}

function getCommentId(value) {
  return readCommentField(value, ['id', 'comment_id', 'commentId', 'commentID', 'commentid']);
}

function getRootCommentId(value) {
  return readCommentField(value, ['root_comment_id', 'rootCommentId', 'root_id', 'rootId', 'top_comment_id', 'topCommentId']);
}

function getParentCommentId(value) {
  return readCommentField(value, [
    'parent_comment_id',
    'parentCommentId',
    'parent_id',
    'parentId',
    'target_comment_id',
    'targetCommentId',
    'reply_comment_id',
    'replyCommentId',
  ]);
}

function getCommentAuthor(value) {
  return readCommentField(value, [
    'nick_name',
    'nickname',
    'nickName',
    'userNickname',
    'user_nickname',
    'userName',
    'user_name',
    'name',
    'author',
  ]) || readCommentField(value && (value.user || value.userInfo || value.user_info || value.authorInfo || value.author_info || value.user_info_detail) || {}, [
    'nick_name',
    'nickname',
    'nickName',
    'userName',
    'user_name',
    'name',
  ]);
}

function getReplyTargetAuthor(value, fallback = '') {
  return getCommentAuthor(value && (
    value.target_comment
    || value.targetComment
    || value.reply_to
    || value.replyTo
    || value.parent_comment
    || value.parentComment
  )) || fallback || '';
}

function getCommentContent(value) {
  return readCommentField(value, [
    'content',
    'contentText',
    'content_text',
    'text',
    'commentText',
    'comment_text',
    'commentContent',
    'comment_content',
  ]);
}

function getCommentTime(value) {
  return readCommentField(value, ['create_time', 'createTime', 'time', 'date']);
}

function getCommentLikes(value) {
  return readCommentField(value, ['like_count', 'liked_count', 'likeCount', 'likedCount', 'like_num', 'likeNum', 'likes']);
}

function threadSocialComments(comments = [], limit = 20) {
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
      parent.replies.push(next);
      return;
    }
    if (root) {
      next.replyTo = next.replyTo || root.author || '';
      root.replies.push(next);
      return;
    }
    roots.push(next);
  });

  return roots.slice(0, limit);
}

function collectXiaohongshuApiCommentItems(value, items = [], depth = 0, context = {}) {
  if (!value || depth > 8) return items;
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const content = getCommentContent(item);
      const id = getCommentId(item);
      const author = getCommentAuthor(item);
      const rootId = getRootCommentId(item) || context.rootId || '';
      const parentId = getParentCommentId(item) || (context.rootId ? context.parentId : '');
      if (content) items.push({ item, context });
      collectXiaohongshuApiCommentItems(item, items, depth + 1, content ? {
        rootId: rootId || id || context.rootId || '',
        parentId: id || parentId || '',
        parentAuthor: author || context.parentAuthor || '',
      } : context);
    });
    return items;
  }
  if (typeof value !== 'object') return items;
  Object.keys(value).forEach((key) => {
    const child = value[key];
    if (/comment|cmt|reply|list|items|data/i.test(key)) {
      collectXiaohongshuApiCommentItems(child, items, depth + 1, context);
    }
  });
  return items;
}

function extractXiaohongshuNoteIdFromUrl(url) {
  const source = String(url || '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source);
    const pathMatch = parsed.pathname.match(/\/(?:explore|discovery\/item|item)\/([0-9a-zA-Z]+)/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1];
    const noteId = parsed.searchParams.get('note_id') || parsed.searchParams.get('noteId');
    if (noteId) return noteId;
  } catch (error) {
    // Fall back to regex for copied or partially encoded share links.
  }
  const match = source.match(/\/(?:explore|discovery\/item|item)\/([0-9a-zA-Z]+)/i)
    || source.match(/[?&]note_?id=([0-9a-zA-Z]+)/i);
  return match && match[1] ? match[1] : '';
}

function extractXiaohongshuXsecTokenFromUrl(url) {
  const source = String(url || '').trim();
  if (!source) return '';
  try {
    const parsed = new URL(source);
    return parsed.searchParams.get('xsec_token') || parsed.searchParams.get('xsecToken') || '';
  } catch (error) {
    const match = source.match(/[?&]xsec_?token=([^&#]+)/i);
    return match && match[1] ? decodeUrlComponentSafely(match[1]) : '';
  }
}

function extractXiaohongshuCommentsFromApiPayload(payload, limit = 20) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const roots = [
    data && data.data && data.data.comments,
    data && data.data && data.data.comment_list,
    data && data.data && data.data.list,
    data && data.comments,
    data && data.comment_list,
  ].filter(Boolean);
  const sourceItems = roots.length
    ? roots.flatMap((root) => collectXiaohongshuApiCommentItems(root, [], 0))
    : collectXiaohongshuApiCommentItems(data, [], 0);
  const comments = [];
  const seen = new Set();
  sourceItems.forEach((entry) => {
    const item = entry && entry.item ? entry.item : entry;
    const context = entry && entry.context ? entry.context : {};
    pushSocialComment(comments, seen, {
      id: getCommentId(item),
      rootId: getRootCommentId(item) || context.rootId || '',
      parentId: getParentCommentId(item) || (context.rootId ? context.parentId : ''),
      author: getCommentAuthor(item),
      content: getCommentContent(item),
      time: getCommentTime(item),
      likes: getCommentLikes(item),
      replyTo: getReplyTargetAuthor(item, context.parentAuthor || ''),
    });
  });
  return threadSocialComments(comments, limit);
}

function buildXiaohongshuCommentApiUrl(url, cursor = '') {
  const noteId = extractXiaohongshuNoteIdFromUrl(url);
  if (!noteId) return '';
  const apiUrl = new URL('https://edith.xiaohongshu.com/api/sns/web/v2/comment/page');
  apiUrl.searchParams.set('note_id', noteId);
  apiUrl.searchParams.set('cursor', cursor || '');
  apiUrl.searchParams.set('top_comment_id', '');
  apiUrl.searchParams.set('image_scenes', 'FD_WM_WEBP,CRD_WM_WEBP');
  const xsecToken = extractXiaohongshuXsecTokenFromUrl(url);
  if (xsecToken) apiUrl.searchParams.set('xsec_token', xsecToken);
  return apiUrl.toString();
}

module.exports = {
  buildXiaohongshuCommentApiUrl,
  extractXiaohongshuCommentsFromApiPayload,
  extractXiaohongshuNoteIdFromUrl,
  extractXiaohongshuXsecTokenFromUrl,
  isNoiseSocialCommentText,
  normalizeSocialComment,
  pushSocialComment,
  readCommentField,
  threadSocialComments,
};
