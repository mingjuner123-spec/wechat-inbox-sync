# 用户反馈问题排查日志

> 产品：Obsidian 内容同步助手 / WeChat Inbox Sync  
> 维护日期：2026-06-01  
> 用途：沉淀真实用户反馈、原因判断、用户端解决办法和开发侧修复记录。

## 问题总表

| 问题 | 用户常见描述 | 根因分类 | 用户端解决办法 | 开发侧状态 |
| --- | --- | --- | --- | --- |
| 插件 403 | `Request failed, status 403` / 云开发安全验证 | 绑定码无效、旧码失效、码与插件实例不匹配、浏览器误开 API 地址 | 重新生成绑定码，点“立即绑定”；API 地址保持默认；不要浏览器打开 API 地址 | `1.0.1` 优化绑定机制和提示 |
| 无法安装插件 | 插件市场安装不上 / 搜不到 / 下载失败 | 插件市场网络、GitHub 下载、第三方插件未开启、手机端不支持 | 电脑端安装；开启第三方插件；插件市场失败则手动安装压缩包 | 保留压缩包分发方案 |
| 插件加载失败 | `"wechat-inbox-sync" 插件加载失败` | 文件夹层级错误、包不完整、旧插件冲突、Obsidian 未重启 | 确认 `.obsidian/plugins/wechat-inbox-sync/main.js`；删除旧插件；重启 Obsidian | 发布包测试覆盖关键文件 |
| 绑定失败 | `net::ERR_CONNECTION_CLOSED` / 绑定码无效 / 已被绑定 | Obsidian 网络层断连、绑定码业务错误、API 地址被改错、插件版本旧 | 更新 `v1.0.14`；重新生成码；API 地址保持默认；点“立即绑定” | `1.0.14` 增加 Node http/https 备用请求 |

## 2026-05-20：403 与旧绑定机制

### 现象

用户反馈插件同步时出现：

- `Request failed, status 403`
- `请求失败，状态 403`
- 绑定码填写后无法正常同步

### 原因

早期绑定机制存在两个容易误导用户的点：

1. 插件设置页可能显示历史默认绑定码，用户容易直接使用。
2. 同一个绑定码可能被多个插件实例填写，导致同步归属混乱。

### 修复

插件 `1.0.1` 开始：

- 绑定码输入框不再预填默认绑定码。
- 新增“立即绑定”按钮。
- 绑定成功、绑定码无效、绑定码已被绑定分别给出提示。
- 同步请求带插件实例 `clientId`，云端校验绑定码与插件实例是否匹配。

### 用户端解决办法

让用户重新打开小程序绑定页，复制新绑定码，在插件设置页粘贴后点击“立即绑定”。

## 2026-05-25 前后：无法安装插件

### 现象

用户反馈：

- 插件市场安装不上。
- 插件市场下载失败。
- 不知道是否需要 VPN。

### 原因

主要是分发环境问题，不是插件业务代码问题：

- Obsidian 插件市场和插件资源下载在部分网络环境下不稳定。
- 用户未开启第三方插件。
- 用户在手机端 Obsidian 查找插件，但当前插件是桌面端插件。

### 解决办法

保留两种安装方式：

1. 插件市场搜索 `WeChat Inbox Sync`。
2. 插件市场失败时，使用压缩包手动安装。

手动安装时必须确认最终路径：

```text
.obsidian/plugins/wechat-inbox-sync/main.js
.obsidian/plugins/wechat-inbox-sync/manifest.json
.obsidian/plugins/wechat-inbox-sync/styles.css
```

## 2026-05-25 前后：插件加载失败

### 现象

用户反馈：

```text
"wechat-inbox-sync" 插件加载失败
```

### 原因

常见原因：

- 解压后多套了一层文件夹。
- 缺少 `main.js` 或 `manifest.json`。
- 旧插件 `wechat-obsidian-inbox` 和新插件同时存在。
- 覆盖安装后没有重启 Obsidian。

### 用户端解决办法

删除旧插件文件夹，重新安装最新版，确认目录结构正确后重启 Obsidian。

### 开发侧措施

`plugin-marketplace-package.test.js` 检查发布包必须包含：

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`
- `README.md`
- `LICENSE`
- `local-asr/install-local-asr.ps1`
- `local-asr/README.md`

## 2026-06-01：绑定失败 `net::ERR_CONNECTION_CLOSED`

### 现象

用户反馈绑定时报：

```text
绑定失败：net::ERR_CONNECTION_CLOSED
```

### 排查结论

本地验证：

- 官方同步 API 可访问。
- `/sync` 返回 401，说明云函数在线。
- 用 Node 原生 `https` 请求 `/sync/bind` 能得到正常业务响应。

因此本次问题不是云函数挂了，也不是绑定码业务逻辑本身错误，而是 Obsidian/Electron 的 `requestUrl` 网络层在部分环境中连接被断开。

### 修复

插件 `1.0.14` 增加备用请求通道：

- 默认仍使用 Obsidian `requestUrl`。
- 当出现 `net::ERR_CONNECTION_CLOSED`、`ERR_CONNECTION_RESET`、`ETIMEDOUT`、`socket hang up` 等网络层错误时，自动改用 Node 原生 `http/https` 请求。
- 已补测试模拟 `requestUrl` 抛 `net::ERR_CONNECTION_CLOSED`，确认 `/bind` 可通过备用请求成功。

### 用户端解决办法

让用户更新到 `v1.0.14` 或更高版本，重新生成绑定码，并保持同步 API 地址为默认值。

