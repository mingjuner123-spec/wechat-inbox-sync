# 公众号文章图片本地化实施计划

> 基于已验证的 `1.3.79` 架构候选 `f6d399b32c7e73316fec56d250733f1bd9f82ba1`，只做本地候选，不发布、不部署。

1. 新增普通公众号路径的回归测试，先验证现状为 RED。
2. 复用 `saveMarkdownRemoteImageAssets`，增加公众号请求头并在普通公众号抓取后调用。
3. 写入 `imageLocalizationFailedCount`、`imageLocalizationError` 和 `conversionNote`，失败时保留原 URL。
4. 运行新增测试、插件语法、构建一致性及相关现有回归。
5. 形成干净本地提交；Obsidian 完全退出后，使用安全替换器更新本地测试插件并验证 `data.json` 三项身份不变。

