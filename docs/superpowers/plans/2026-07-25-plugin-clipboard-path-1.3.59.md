# 插件 1.3.59 实施计划

1. 在 `tests/plugin-main-ai.test.js` 添加链接提升与路径别名的失败测试，确认在 1.3.58 基线上红灯。
2. 在插件发布源 `obsidian-plugin/wechat-inbox-sync/main.js` 添加安全 URL 选择、文本记录兼容提升、Vault 路径规范化与逐级建目录。
3. 同步根目录发布镜像 `main.js`，运行插件定向回归、语法检查和市场包验证。
4. 更新四份版本元数据为 1.3.59，运行完整插件与发布身份回归。
5. 由独立安全审稿、独立测试审稿和独立最终验证分别检查失败路径、SSRF 边界、路径安全、回归充分性和发布资产身份。
6. 推送候选、通过 PR 合并到受保护 `main`；以最终 main SHA 创建 annotated tag `1.3.59`。
7. 验证 GitHub Release 精确五项资产、raw manifest、本地 ZIP 结构/字节、官方发布检查。
8. 回填 `docs/WORKLOG.md`，发送飞书完成通知。
