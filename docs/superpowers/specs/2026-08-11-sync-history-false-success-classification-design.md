# History 假成功分类修复设计

日期：2026-08-11

## 问题与证据

插件当前以“Markdown 文件是否写入”为成功依据。`writeRecord` 即使写入的是失败收据、原始链接占位或网页壳内容，也会返回 `committed: true`，随后 `syncBinding` 无条件向 History 上报完成。

真实样本证明存在两类失败：

1. 插件没有生成文件并弹出失败提示。这类异常已经进入 `catch` 并回传失败。
2. 插件生成了文件，但文件只有失败说明、原始链接、微信打开引导页或未成功提取的附件。这类目前被误报成功。

视频号样本带有 `conversionStatus=link_saved` 与 `transcriptionStatus=failed`；公众号样本的 Markdown 包含“微信扫一扫可打开此内容 / 使用完整服务”等打开引导壳，但被写成 `conversionStatus=success`。

## 成功定义

只有插件得到可交付内容并完成 Obsidian 笔记写入，才回传 `synced`。下列任一条件成立时必须在写 Markdown 笔记前抛出安全分类错误，由现有生命周期捕获逻辑回传 `failed`：

- `conversionStatus` 为 `failed`、`link_saved` 或 `wechat_captcha`。
- `transcriptionStatus` 为 `failed` 且没有成功转写正文。
- PDF 最终为 `attachment_saved`，表示二进制文件保存成功但文本提取失败。
- 公众号 URL 的 Markdown 命中微信打开引导壳特征，例如“微信扫一扫可打开此内容”。

未生成文件且抛异常的现有路径保持不变，同样回传失败。

## 错误分类

- 视频号 `weixin.qq.com/sph/` 的 `link_saved/failed`：`UNSUPPORTED_PLATFORM`，展示“暂不支持此平台”，不提供无效重试。
- 转写失败：`TRANSCRIPTION_FAILED`。
- PDF、网页、公众号验证或网页壳：`EXTRACTION_FAILED`。
- 其他无法分类的失败继续使用现有 `SYNC_FAILED`。

History 只接收错误码，不接收正文、URL、本地路径或原始异常详情。

## 重试与文件边界

- 失败判定发生在 Markdown 笔记写入前，因此不会再新建“看似成功”的失败笔记。
- PDF 二进制附件可能已经下载到本地；History 仍标记失败。后续重试允许覆盖同一路径附件，但不会把附件保存误认为正文提取成功。
- 可重试失败继续使用现有“重新上传”接口；状态回到 `pending` 后由插件重新处理。
- 不给所有已完成项增加“重新上传”。已完成 History 仅保留最小事实，原始正文可能已从收件箱删除，无法可靠重建任务；对真正成功项开放按钮还会造成误导或重复处理。
- 已被旧版本误报成功并删除云端原记录的历史项不会自动回溯修正，需要用户重新分享原始内容。修复对升级后的新处理生效。

## 测试

- 视频号失败收据返回 `UNSUPPORTED_PLATFORM`。
- 公众号打开引导壳即使标记 `conversionStatus=success`，也返回 `EXTRACTION_FAILED`。
- PDF `attachment_saved` 返回 `EXTRACTION_FAILED`。
- 普通成功正文不产生失败分类。
- `writeRecord` 在输出计划与 Markdown 写入前调用分类门禁。
- 现有无文件异常生命周期测试继续通过。
- 构建插件，并运行 History、公众号图片本地化、PDF 提取、主插件与本地候选回归。

## 非目标

- 不修改云函数、数据库或小程序重试接口。
- 不读取或回填线上历史记录。
- 不删除已经生成的旧失败笔记或附件。
- 不发布插件市场版本。
