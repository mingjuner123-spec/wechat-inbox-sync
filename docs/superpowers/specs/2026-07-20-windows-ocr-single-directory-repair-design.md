# Windows OCR 单目录自动修复设计

## 目标

修复 Windows 用户在安装或修复本地 OCR 时，因旧虚拟环境残留、文件占用或重复安装而出现的 `Permission denied: ...\venv\Scripts\python.exe`。用户只需更新插件并点击一次“修复本地组件”；极端文件占用场景最多提示重启一次 Obsidian，不要求用户打开任务管理器、结束 Python 进程或手动改目录。

## 根因

当前 Windows OCR 安装器直接删除并重建正式目录 `~/.wechat-inbox-local-ocr/venv`。多处删除使用 `-ErrorAction SilentlyContinue`，即使旧目录未被完整删除，安装仍会继续。后续创建虚拟环境或执行探针便可能命中残留、损坏或仍被占用的 `venv\Scripts\python.exe`，最终将底层的访问拒绝包装成“Pinned Python 3.12 failed to create the OCR virtual environment”。

这是共性安装器缺陷，但只在旧环境残留、OCR 子进程未退出、重复点击安装或安全软件短暂占用文件时触发。

## 方案

永久只保留一个正式环境目录 `venv`。每次需要新装或修复时：

1. 插件侧使用单实例安装锁，拒绝并行启动第二个 OCR 安装任务。
2. 安装器清理上次遗留的 `venv-staging`，确认清理成功后再继续。
3. 在 `venv-staging` 中创建全新虚拟环境、安装依赖并执行真实导入探针。
4. staging 验证通过后，将现有 `venv` 临时移动为 `venv-backup`，再把 staging 移动为正式 `venv`。
5. 正式环境再次验证成功后删除 backup；若验证失败则自动回滚。
6. 若正式目录因外部进程占用而无法切换，保留已经验证通过的 staging，并写入待切换标记。
7. 插件下次启动、OCR 尚未运行时自动执行待切换；成功后清理 staging、backup 和标记。
8. 安装或切换结束后重新读取 OCR 状态，让设置页从“需修复”刷新为“可用”。

安装成功后的稳定目录仍为：

```text
.wechat-inbox-local-ocr/
├─ venv/
├─ ocr_image.py
└─ install.log
```

`venv-staging`、`venv-backup` 和待切换标记都只是事务过程文件，不形成长期多版本目录。

## 错误处理

- staging 创建失败：不触碰现有正式 `venv`，清理不完整 staging，并显示具体安装阶段。
- staging 无法清理：停止安装并记录占用错误，不能在残留目录上继续创建。
- 正式目录无法切换：不要求用户手工处理；提示“修复已准备完成，重启 Obsidian 后自动完成”。
- 切换后健康检查失败：恢复 backup，保留原有可用环境。
- 并行安装：第二次点击直接复用正在进行的任务或给出“正在修复”，不启动第二个 PowerShell。
- 安全软件持续阻止新 Python：保留原环境并给出安全软件/系统策略提示，不把它误报成权限或绑定问题。

## 兼容性与影响

- 仅修改 Windows OCR 安装与插件调度；macOS OCR、Windows/macOS ASR、云函数、绑定码和 Pro 权益不变。
- 已经可用且无需升级的 OCR 环境不会被重建。
- 旧版单目录 `venv` 无需迁移；修复时把它视为当前正式环境。
- 不长期保留多个 OCR 版本，不增加持续磁盘占用。
- 下载安装仍需用户主动点击，避免在后台未经同意下载较大依赖；点击之后全自动。

## 验收标准

1. 旧 `venv` 删除失败时，安装器不会继续执行残留的 `python.exe`。
2. 新环境只在 staging 中创建并验证，成功后才切换。
3. 切换失败时旧环境不被破坏，并能在重启 Obsidian 后自动重试。
4. 任意结束状态下不长期留下多个正式版本。
5. 重复点击不会并行安装。
6. 成功后设置页重新检测并显示 OCR“可用”。
7. Windows OCR 安装、插件主回归、市场发布包和 JavaScript 语法检查通过。
