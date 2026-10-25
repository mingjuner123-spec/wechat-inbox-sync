const https = require('node:https');
const { createDouyinMediaHelpers } = require('./obsidian-plugin/wechat-inbox-sync/src/douyin-media-utils');
const helpers = createDouyinMediaHelpers({
  normalizeBrowserCapturedMediaUrls: (urls) => urls,
  getSocialRequestHeaders: () => ({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' }),
  douyinMobileShareUserAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  pushUniqueMediaUrl: (a, b) => { if (b && !a.includes(b)) a.push(b); },
  sortMediaUrlsForTranscription: (urls) => urls,
});
function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        get(new URL(res.headers.location, url).toString()).then(resolve);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, finalUrl: url }));
    });
    req.on('error', () => resolve({ status: 0, body: '', finalUrl: url }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: '', finalUrl: url }); });
  });
}
(async () => {
  const short = process.argv[2];
  const first = await get(short);
  console.log('resolved', first.status, first.finalUrl);
  const awemeId = helpers.extractDouyinAwemeId(first.finalUrl) || '';
  console.log('awemeId', awemeId);
  const noteId = (first.finalUrl.match(/\/note\/(\d{8,30})/) || [])[1] || awemeId;
  console.log('noteId', noteId);
  const urls = helpers.getDouyinMobileSharePageUrls(noteId);
  for (const url of urls) {
    const page = await get(url);
    console.log('share page', page.status, url.slice(0, 80), 'bytes', page.body.length, 'hasRouter', page.body.includes('_ROUTER_DATA'));
    if (page.body) {
      const media = helpers.extractDouyinMediaUrlsFromShareHtml(page.body, noteId);
      const detail = helpers.extractDouyinDetailFromShareHtml(page.body, noteId);
      console.log('mediaUrls', media.length, 'detail?', Boolean(detail), detail ? JSON.stringify({ desc: String(detail.desc || '').slice(0, 40), images: (detail.images || []).length, imagePost: detail.image_post_info ? (detail.image_post_info.images || []).length : 0 }) : '');
    }
  }
})();
