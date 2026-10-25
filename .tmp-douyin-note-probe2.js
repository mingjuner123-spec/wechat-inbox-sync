const https = require('node:https');
function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); get(new URL(res.headers.location, url).toString()).then(resolve); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
  });
}
(async () => {
  const id = '7700232024245751055';
  for (const url of [
    `https://www.iesdouyin.com/share/note/${id}/?from_ssr=1`,
    `https://www.douyin.com/note/${id}`,
  ]) {
    const page = await get(url);
    const hasRouter = page.body.includes('_ROUTER_DATA');
    const hasDesc = /"desc"\s*:/.test(page.body);
    const hasImages = /image_post_info|"images"\s*:/.test(page.body);
    console.log(url.slice(0, 70), 'status', page.status, 'bytes', page.body.length, 'router', hasRouter, 'desc', hasDesc, 'images', hasImages);
    if (page.body && hasDesc) {
      const idx = page.body.indexOf('_ROUTER_DATA');
      console.log(page.body.slice(idx, idx + 400).replace(/\s+/g, ' ').slice(0, 400));
    }
  }
})();
