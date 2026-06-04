# Obsidian 收集箱小程序

微信侧 Obsidian Inbox，用来快速收集文字、链接和语音，并通过云端收集箱等待后续 Obsidian 插件同步到本地 vault。

## 当前已实现

- 首页 UI：按 Gemini 提供的移动端界面复刻
- 文字保存：输入或粘贴文字后调用云函数保存
- 链接保存：自动识别 `http://` / `https://` 链接并保存为 link 记录
- 语音保存：调用微信录音管理器，停止后上传云存储并保存 voice 记录
- 绑定页：生成、复制、刷新绑定码
- 云函数：
  - `createInboxRecord`
  - `createBindCode`
  - `listInboxRecords`
  - `markInboxRecordSynced`

## 项目结构

```text
miniprogram/
  pages/index/              小程序首页和绑定页
  services/inbox-service.js 小程序云端调用封装
  images/obsidian/          UI 图标资源

cloudfunctions/
  quickstartFunctions/
    index.js                云函数入口
    inbox-core.js           收集箱数据结构纯逻辑

tests/                      Node 侧纯逻辑测试
```

## 云开发配置

1. 用微信开发者工具打开本目录。
2. 点击工具顶部“云开发”，创建或选择云开发环境。
3. 打开 `miniprogram/app.js`。
4. 把 `env` 改成你的云开发环境 ID：

```js
env: "你的环境ID",
```

5. 在微信开发者工具中右键：

```text
cloudfunctions/quickstartFunctions
```

选择：

```text
上传并部署：云端安装依赖
```

## 数据集合

云函数会按需创建两个集合：

- `inbox_records`：保存文字、链接、语音记录
- `bind_codes`：保存小程序和 Obsidian 插件的绑定码

记录结构示例：

```js
{
  openid: "用户 openid",
  type: "text | link | voice",
  content: "原始内容或语音标题",
  status: "pending",
  source: "wechat-miniprogram",
  createdAt: "2026-05-08T12:00:00.000Z",
  syncedAt: null,
  metadata: {}
}
```

## 本地验证

在项目根目录运行：

```powershell
node tests\inbox-utils.test.js
node tests\inbox-core.test.js
node tests\inbox-service.test.js
node --check miniprogram\pages\index\index.js
node --check cloudfunctions\quickstartFunctions\index.js
```

## 电脑端同步助手

当前已提供一个 Node 版同步助手，用来把收集记录 JSON 写入 Obsidian vault。

### 本地 JSON 模式

示例命令：

```powershell
node desktop-sync\sync-cli.js --vault "D:\你的ObsidianVault" --records desktop-sync\sample-records.json --inbox "临时收集"
```

执行后会生成：

```text
D:\你的ObsidianVault\
  临时收集\
    2026-05-08\
      文字-001.md
      链接-001.md
      语音-001.md
```

### 远程 API 模式

项目还提供了一个独立云函数：

```text
cloudfunctions/syncApi
```

它用于给电脑端同步助手或 Obsidian 插件访问云端收集箱。需要在微信开发者工具中单独上传部署，并在云开发控制台配置 HTTP 访问方式。

远程 API 合同：

```text
GET  /records?status=pending
POST /records/:recordId/synced
Authorization: Bearer <绑定码>
```

电脑端命令：

```powershell
node desktop-sync\sync-cli.js --vault "D:\你的ObsidianVault" --api-base "https://你的HTTP访问地址" --token "小程序绑定码" --inbox "临时收集"
```

当前 MVP 中，`--token` 使用小程序绑定页生成的绑定码。后续产品化时应升级为更安全的设备 token。

这个同步核心后续可以被 Obsidian 插件复用。

## 下一阶段

## Obsidian 插件手动安装

当前已经提供一个可手动安装的 Obsidian 插件目录：

```text
obsidian-plugin/wechat-obsidian-inbox
```

手动安装步骤：

1. 打开你的 Obsidian vault 文件夹。
2. 进入或创建目录：

```text
.obsidian/plugins/
```

3. 将整个插件目录复制进去，最终结构类似：

```text
你的Vault/
  .obsidian/
    plugins/
      wechat-obsidian-inbox/
        manifest.json
        main.js
        styles.css
        plugin-core.js
        sync-core.js
        cloud-client.js
```

4. 重启 Obsidian。
5. 打开“设置 -> 第三方插件”，关闭安全模式并启用“微信 Obsidian 收集箱”。
6. 在插件设置里填写：
   - 同步 API 地址：`syncApi` 云函数的 HTTP 访问地址
   - 小程序绑定码：小程序绑定页生成的绑定码
   - 保存根目录：默认 `临时收集`
7. 点击“同步”，插件会把云端 pending 记录写入当前 vault。

插件同步目标：

```text
临时收集/YYYY-MM-DD/文字-001.md
临时收集/YYYY-MM-DD/链接-001.md
临时收集/YYYY-MM-DD/语音-001.md
```

## 后续增强

后续还需要继续增强：

- 将绑定码升级为独立设备 token
- 下载并保存云端语音附件原文件
- 接入语音 AI 转写和摘要
- 接入链接标题和正文快照抓取
- 把插件打包成正式社区插件结构
