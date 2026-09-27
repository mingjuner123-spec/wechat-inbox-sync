'use strict';

// This literal executes in Electron's isolated renderer. Do not stringify a
// bundled function: bundler-generated helpers are not available in the page.
const READ_TARGET_STATE = String.raw`(function (expectedId) {
  try {
    var page = new URL(String(location.href || ''));
    if (page.protocol !== 'https:' || page.username || page.password
      || (page.port && page.port !== '443')
      || !/(^|\.)xiaohongshu\.com$/i.test(page.hostname)
      || /\/(?:login|verify|captcha)(?:\/|$)/i.test(page.pathname)) return '';
    var route = page.pathname.match(/\/(?:explore|discovery\/item|item)\/([0-9a-z_-]{6,})(?:\/|$)/i);
    var actualId = route ? route[1] : '';
    if (!actualId) {
      for (var queryKey of ['note_id', 'noteId', 'item_id', 'itemId']) {
        var queryId = page.searchParams.get(queryKey) || '';
        if (/^[0-9a-z_-]{6,}$/i.test(queryId)) { actualId = queryId; break; }
      }
    }
    var targetId = String(expectedId || actualId).toLowerCase();
    if (!targetId || (actualId && targetId !== actualId.toLowerCase())
      || (!actualId && page.pathname !== '/')) return '';
    // A shortlink/SPA may finish at the official root. In that case the caller
    // must already know the note identity and the map below must match it.
    var state = window.__INITIAL_STATE__;
    if (!state || typeof state !== 'object') return '';
    var noteState = state.note;
    var maps = [noteState && noteState.noteDetailMap, state.noteDetailMap];
    var note = null;
    for (var map of maps) {
      if (!map || typeof map !== 'object') continue;
      var entry = map[actualId] || map[targetId];
      if (entry && typeof entry === 'object') {
        note = entry.note || entry;
        break;
      }
    }
    if (!note && noteState && typeof noteState === 'object') {
      var directId = String(noteState.noteId || noteState.note_id || '').toLowerCase();
      if (directId === targetId) note = noteState;
    }
    if (!note || typeof note !== 'object') return '';
    for (var idKey of ['noteId', 'note_id']) {
      if (note[idKey] && String(note[idKey]).toLowerCase() !== targetId) return '';
    }
    // Export only content of this note, never the account/session or feed trees.
    var fields = ['noteId', 'note_id', 'title', 'displayTitle', 'display_title',
      'desc', 'description', 'noteContent', 'note_content', 'content',
      'type', 'noteType', 'note_type', 'contentType', 'content_type',
      'video', 'videoInfo', 'video_info', 'videoUrl', 'video_url',
      'imageList', 'image_list', 'tagList', 'tag_list', 'interactInfo', 'interact_info'];
    var nodes = 0;
    var characters = 0;
    var seen = new Set();
    var copy = function (value, depth) {
      if (++nodes > 4000 || depth > 12) throw new Error('state budget');
      if (typeof value === 'string') {
        characters += value.length;
        if (value.length > 100000 || characters > 500000) throw new Error('state budget');
        return value;
      }
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
      seen.add(value);
      var output = Array.isArray(value) ? [] : Object.create(null);
      var keys = Object.keys(value);
      if (keys.length > 1000) throw new Error('state budget');
      for (var key of keys) {
        if (/^(?:__proto__|constructor|prototype|toJSON|user|userInfo|account|session|cookie|authorization|token|xsec_token|xsecToken|access_token|refresh_token|password|secret)$/i.test(key)) continue;
        var child = copy(value[key], depth + 1);
        if (child !== undefined) output[key] = child;
      }
      seen.delete(value);
      return output;
    };
    var selected = Object.create(null);
    for (var field of fields) {
      var copied = copy(note[field], 0);
      if (copied !== undefined) selected[field] = copied;
    }
    var author = note.user || note.userInfo;
    if (author && typeof author === 'object') {
      selected.user = { nickname: copy(author.nickname || author.nickName || author.userName || '', 0) };
    }
    var detailMap = Object.create(null);
    detailMap[targetId] = { note: selected };
    var json = JSON.stringify({ note: { noteDetailMap: detailMap } });
    if (json.length > 600000) return '';
    return '<script type="application/json" data-wechat-inbox-runtime="note">'
      + json.replace(/</g, '\\u003c') + '</script>';
  } catch (_) { return ''; }
})`;

function getXiaohongshuRuntimeSnapshotExpression(expectedId = '') {
  const id = String(expectedId || '');
  return `${READ_TARGET_STATE}(${JSON.stringify(id)})`;
}

module.exports = { getXiaohongshuRuntimeSnapshotExpression };
