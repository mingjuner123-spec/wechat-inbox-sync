# 网页音视频解析中转服务

这个服务给云端转写使用：小程序保存音视频链接后，云函数先请求这个服务解析真实媒体地址，再把媒体地址交给云端 ASR。

## Windows 运行

先确认电脑安装了 Node.js 18+。然后在 PowerShell 里执行：

```powershell
cd media-resolver
powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1 -ResolverSecret "replace-with-a-long-random-secret"
```

先做本地健康检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8787/health
```

如果已经有公网地址，再带上 `PublicBaseUrl` 启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1 `
  -ResolverSecret "replace-with-a-long-random-secret" `
  -PublicBaseUrl "https://your-domain.example"
```

如果 B 站等平台提示 412、需要登录态或解析不到，可以额外提供 `cookies.txt`：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1 `
  -ResolverSecret "replace-with-a-long-random-secret" `
  -PublicBaseUrl "https://your-domain.example" `
  -CookieFile "D:\path\to\cookies.txt"
```

## Linux/macOS 本地运行

先安装 Node.js 18+、Python、`yt-dlp`：

```bash
python3 -m pip install -U yt-dlp
cd media-resolver
RESOLVER_SECRET=replace-with-a-long-random-secret \
PUBLIC_BASE_URL=https://your-domain.example \
npm start
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

解析测试：

```bash
curl -X POST http://127.0.0.1:8787/resolve \
  -H "Content-Type: application/json" \
  -H "x-resolver-secret: replace-with-a-long-random-secret" \
  -d '{"url":"https://xhslink.com/example"}'
```

## Docker 运行

```bash
docker build -t wechat-inbox-media-resolver ./media-resolver
docker run -d --name wechat-inbox-media-resolver \
  -p 8787:8787 \
  -e RESOLVER_SECRET=replace-with-a-long-random-secret \
  -e PUBLIC_BASE_URL=https://your-domain.example \
  wechat-inbox-media-resolver
```

## 云函数配置

把这个服务暴露成公网 HTTPS 地址，然后给 `quickstartFunctions` 配置环境变量：

```text
MEDIA_RESOLVER_URL=https://your-domain.example/resolve
MEDIA_RESOLVER_SECRET=replace-with-a-long-random-secret
```

`PUBLIC_BASE_URL` 是这个服务自己的公网访问地址，不带 `/resolve`，例如 `https://media.example.com`。配置后，服务会把解析到的真实媒体地址包装成 `/media/<token>` 代理地址，避免部分平台因为缺少 Referer、User-Agent 等请求头导致豆包下载失败。

如果暂时没有域名，可以先用 Cloudflare Tunnel、Caddy、Nginx 反向代理或服务器商的 HTTPS 网关。

## 风险

- 小红书、抖音、B 站等平台可能会调整网页结构或风控策略，`yt-dlp` 需要定期更新。
- 部分链接需要登录态或 Cookie 才能解析；第一版不内置 Cookie，避免账号风险。
- 如果开启代理下载，音视频文件会经过这台中转电脑，长视频会占用带宽。
- 云函数会在解析服务失败时退回静态 HTML 提取，仍然提取不到时会把记录标为云端转写失败，插件同步时可以继续走本地兜底。
