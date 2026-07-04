# 2026-07-05 绑定码与 Pro 权限恢复存档

## 当前结论

绑定码、兑换码、Pro 权限链路已经恢复。

本次线上问题的直接原因是 `syncApi` 读写的数据环境被改到了长环境，而小程序端绑定码、兑换码、Pro 权益仍然在短数据环境中。插件调用 `/bind`、刷新 Pro 权限、同步权限校验时，云端查错数据库环境，导致真实绑定码也被判断为未绑定或已失效。

## 正确环境约定

- 小程序绑定码、兑换码、用户权益、同步记录的数据环境：`he02-d8gebzv050ed6c4ef`
- `syncApi` 函数所在命名空间：`he02-d8gebzv050ed6c4ef-d350b93bf`
- `quickstartFunctions` 函数所在命名空间：`he02-d8gebzv050ed6c4ef-d350b93bf`
- 普通插件同步 API：`https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync`
- 飞书 OAuth 专用 HTTP 域名可以使用长环境域名，但不能因此把业务数据环境改成长环境。

关键规则：函数可以部署在长环境命名空间里，但业务数据库仍然必须显式指向短数据环境。

## 本次最小修复

修复文件：

- `cloudfunctions/syncApi/index.js`
- `cloudfunctions/syncApi/admin-handler.js`

修复点：

- `syncApi` 的 `PRODUCTION_WECHAT_DATA_ENV` 恢复为 `he02-d8gebzv050ed6c4ef`
- `getCloudDataEnv()` 恢复为优先读 `WECHAT_DATA_ENV`，未配置时兜底短数据环境
- 旧 API 迁移兜底判断改为看实际数据环境，避免部署在长命名空间时误判
- `admin-handler` 与 `syncApi` 保持同一数据环境规则

没有修改：

- 插件市场包
- 小程序页面
- 飞书解析逻辑
- 本地转写组件
- 兑换码业务规则

## 线上部署状态

`syncApi` 已重新部署。

- 函数名：`syncApi`
- Runtime：`Nodejs18.15`
- Handler：`index.main`
- 状态：`Active`
- 命名空间：`he02-d8gebzv050ed6c4ef-d350b93bf`
- 部署时间：`2026-07-05 07:03:31`
- 代码大小：`10689876`

相关函数参考：

- `quickstartFunctions`
- Runtime：`Nodejs18.15`
- Handler：`index.main`
- 状态：`Active`
- 命名空间：`he02-d8gebzv050ed6c4ef-d350b93bf`
- 部署时间：`2026-07-05 04:29:45`
- 代码大小：`10676563`

## 验证结果

使用本地已绑定的真实绑定码做线上验证，绑定码和客户端 ID 已脱敏。

- 绑定码：`TT7***L6`
- 客户端 ID：`obs***ad`
- `/bind` HTTP 状态：`200`
- `/bind` 结果：`success: true`
- 绑定状态：`bound`
- Pro 权限接口 HTTP 状态：`200`
- Pro 权限接口结果：`success: true`
- `hasAccess: true`
- `plan: local_transcription_beta`
- `expiresAt: 2037-09-05T00:00:00.000Z`

## 本地校验

已执行：

- `node --check cloudfunctions/syncApi/index.js`
- `node --check cloudfunctions/syncApi/admin-handler.js`
- `node tests/sync-api-core.test.js`
- `node tests/feishu-oauth-core.test.js`
- `node tests/regression-contracts.test.js`
- `node tests/hardening.test.js`
- `node tests/redeem-code-core.test.js`
- `node tests/sync-bind-limit.test.js`
- `node tests/plugin-core.test.js`

以上均通过。

## 后续注意事项

1. 不要再把 `syncApi` 的业务数据环境兜底改成长环境。
2. 飞书 OAuth 回调域名和业务数据库环境是两件事，不能混在一起改。
3. 以后如果出现“绑定码未绑定或已失效”“Pro 未开通或已过期”，优先检查：
   - 插件保存的 API 是否是普通同步短域名
   - `syncApi` 的 `getCloudDataEnv()` 实际返回是否为短数据环境
   - 小程序显示的绑定码是否是正常绑定码，而不是飞书 OAuth 临时码
4. 如果用户插件里保留了错误版本写入的旧绑定码，让用户回小程序重新复制绑定码，再点击立即绑定。

## 当前 Git 状态说明

当前仓库工作区仍然包含较多历史未提交改动。本次恢复只确认并部署了 `syncApi` 数据环境修复。后续若要发布插件或继续飞书功能，应单独分支、单独验证，避免把绑定权限链路再次牵连进去。
