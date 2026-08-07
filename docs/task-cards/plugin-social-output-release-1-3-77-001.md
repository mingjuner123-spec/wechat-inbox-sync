# 插件社媒输出、重复提取与 OCR 修复 1.3.77 发布任务卡

- 任务 ID：`plugin-social-output-release-1-3-77-001`
- 创建日期：2026-08-07
- 状态：进行中
- 风险等级：L3
- 分支：`codex/plugin-social-output-1.3.77`
- Worktree：`.worktrees/plugin-social-output-1.3.77`
- 权威仓库：`https://github.com/mingjuner123-spec/wechat-inbox-sync`
- 目标版本：`1.3.77`
- 外部动作：长环境静态托管 CDN、本插件 GitHub main/tag/Release；不修改短环境业务数据

## 用户授权

用户于 2026-08-07 明确要求“打包发布 CDN 和插件，插件把之前我们的更新也一起发布”，授权在完成审查和门禁后执行上述发布动作。

## 发布内容

1. 保留 1.3.76 正式版的重复音视频转写能力。
2. 发布已本地测试的插件模块化整理与笔记输出边界，不改变用户配置文件。
3. 统一抖音、小红书、B 站、小宇宙等社媒音视频的标题、正文、标签、封面、转写和数据属性输出。
4. 修复小红书重复提取、本地旧笔记去重和评论分页上限链路。
5. 修复 Windows OCR 安装时固定 `venv-staging` 被占用导致永久失败的问题；使用唯一暂存目录并兼容旧切换标记。

## 允许修改路径

- `.github/workflows/`
- `docs/`
- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/`
- `scripts/`
- `tests/`

## 执行顺序

1. 合入当前远端 `main` 的 1.3.76 正式基线，禁止覆盖或回退线上功能。
2. 独立审查完整候选范围，修复 P0/P1/P2 后重新审查。
3. 版本递增到 1.3.77，构建、准备并晋升不可变候选，运行完整发布前回归。
4. 通过受控部署器向长环境 CDN 发布 OCR 不可变对象、兼容别名和 committed manifest，并逐字节回读。
5. 推送分支，通过受保护分支 PR/CI 合并；从干净且等于远端 `main` 的工作区创建 annotated tag `1.3.77`。
6. 推送 tag，验证 GitHub Release 精确五项资产、ZIP 与 loose assets、远端 tag 和主分支身份一致。

## 回退与停止条件

- 任一构建、测试、审查、候选身份、CDN 哈希、CI 或 Release 身份失败，立即停止下一步。
- CDN 不可变对象失败时不更新别名和 manifest；别名已切换后的回退只能通过受控回退提交执行。
- tag 推送后禁止移动、覆盖或重建；修复必须递增版本。
- 不修改或读取短环境绑定、权益、支付、同步记录和真实用户数据。

## 验收标准

- 独立审查 P0/P1/P2 均为 0；插件核心、目标功能、市场包、候选、发布治理与语法检查通过。
- CDN 新 OCR 安装器的不可变对象、兼容别名与公开 manifest 哈希一致。
- `origin/main`、annotated tag peeled commit、Release 和五项资产身份一致。
- 根目录四镜像由脚本生成并与 `obsidian-plugin/wechat-inbox-sync/` 逐字节一致。

