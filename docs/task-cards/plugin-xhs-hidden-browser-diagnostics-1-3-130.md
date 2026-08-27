<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-xhs-hidden-browser-diagnostics-1-3-130
- 标题：小红书隐藏窗口、无 Cookie 评论跳过与诊断修复
- 创建日期：2026-08-27
- 类型：修复
- 状态：已完成
- 风险等级：L2
- 所属阶段：插件本地候选准备
- 是否当前主线：否
- 所属支线：plugin-xhs-hidden-browser-diagnostics
- 父主线：H2-002
- 分支：codex/xhs-hidden-browser-diagnostics-1.3.130
- Worktree：D:/内容创作系统/ob内容同步助手 小程序/.worktrees/public-plugin-xhs-hidden-browser-1.3.130
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/main.js；tests/plugin-main-ai.test.js；docs/task-cards/plugin-xhs-hidden-browser-diagnostics-1-3-130.md；docs/WORKLOG.md
- 环境或发布链路占用：无
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

自动小红书提取窗口始终隐藏；无 `web_session` Cookie 时不启动登录探测页面且不提取评论；同步诊断可说明小红书访问阶段、Cookie 有无、窗口拦截和 `300011` 安全限制。

## 非目标

不增加 `300011` 熔断，不改变重试策略，不新增评论开关或退出登录入口，不发布、不推送、不替换本机插件。

## 前置事实与证据

公开权威仓库 `mingjuner123-spec/wechat-inbox-sync` 的 `main@2fd500b8` 为 1.3.129。现有代码在每次评论能力判断时调用隐藏页面登录探测；小红书隐藏窗口缺少旧 Electron 子窗口兜底和 `show`/`ready-to-show` 重新隐藏；成功同步不会保存中途弹窗诊断。

## 禁止动作

禁止访问真实用户数据、Cookie 内容、CloudBase、发布链路和本机 Obsidian `data.json`；禁止推送、合并、打 tag 或创建 Release。

## 分支与 Worktree

只在本卡声明的权威仓库分支和 Worktree 修改 allowedPaths。

## 作者、审稿与验证

主 Agent 实现并测试；独立 Agent 复核窗口边界、无 Cookie 零页面访问、诊断脱敏和测试充分性。

## 验收

`node tests/plugin-main-ai.test.js`、`node tests/plugin-xiaohongshu-login-window.test.js`、`node tests/plugin-sync-record-diagnostic.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 与 `node obsidian-plugin/wechat-inbox-sync/build-plugin.js --check` 通过；定向测试覆盖现代/旧 Electron 窗口事件、无 Cookie 运行时早返回与 `300011` 识别；独立复核无阻断问题。

## 纠偏记录

首次差异审阅发现媒体渲染函数中的小红书窗口标记作用域错误，已在测试前修正并重建。独立审查随后发现评论渲染边界可绕过 hydrate 的 Cookie 门禁，已将 `web_session` 检查下沉到评论函数的 BrowserWindow 创建之前，并增加运行时早返回测试；复核确认闭环。

## 已知风险

正文提取仍必须访问用户提交的小红书内容页，因此平台风控仍可能发生；本修复只消除无 Cookie 时的评论登录探测访问并防止窗口外露。

## 唯一下一步

等待负责人另行决定是否提交、发布和安装本地候选；本任务不执行这些外部动作。

## 是否需要负责人决定

否；后续发布需另行取得明确授权。
