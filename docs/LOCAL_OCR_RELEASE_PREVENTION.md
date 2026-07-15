# 本地 OCR 组件版本漂移复盘与防复发预案

## 结论

本次不是固定 Python 修复被代码回退，而是插件与腾讯云组件独立发布造成的版本漂移：插件 `1.3.31` 开始要求 PDF OCR 能力，但公网 CDN 的安装器、运行脚本和 wheelhouse 仍是图片 OCR 时代的组合。

## 证据时间线

- `2026-07-05`：公网 `local-ocr/common/ocr_image.py` 更新，仍是图片专用脚本。
- `2026-07-10`：Windows、macOS Apple Silicon、macOS Intel wheelhouse 更新，只包含图片 OCR 依赖。
- `2026-07-11`：macOS OCR 安装器更新，包含固定 Python 下载修复，但不含 PDF OCR 依赖。
- `2026-07-14`：Windows OCR 安装器更新，包含固定 Python和 VC++ 修复，但不含 PDF OCR 依赖。
- `2026-07-15`：插件加入 PDF OCR，开始强制检查 PyMuPDF、OpenCC 和新运行脚本；同次发布没有更新 CDN 组件。

因此用户看到的“Python OCR 环境未找到”只是安装前校验失败后的表象。实际失败发生在安装器执行前，所以没有生成新的 `install.log`。

## 根因

1. 插件和 CDN 组件没有共同版本号，也不是一个原子发布单元。
2. CDN 使用可覆盖的 `local-ocr/common/*` 固定路径，无法从 URL 判断组件版本。
3. GitHub Release 流程只验证仓库内文件，没有下载公网 CDN 做一致性检查。
4. 发布清单要求人工上传，但没有机器门禁；已记录的 CDN 风险没有阻止 tag 发布。
5. 失败发生在安装器启动前，诊断只显示最终缺失项，没有显示被拒绝的 URL、哈希和具体能力差异。

## 已立即落地

- PDF 不再进入 OCR；小红书长图文等图片 OCR 保留。
- Windows 与 macOS OCR 组件恢复 RapidOCR + Pillow 的图片专用依赖。
- `1.3.43` 将插件的新鲜度校验切换到当前固定 CPython `3.12.13+20260623` 安装策略，不再要求已经退役的 uv 标记；Windows/macOS 当前安装器均直接通过同一个生产校验函数的回归测试。
- GitHub tag 发布前强制运行 `node scripts/check-local-ocr-cdn.js`，从公网下载 Windows 安装器、macOS 安装器和 `ocr_image.py`，与仓库发布源的 LF 字节做 SHA-256 比对；任一不一致则禁止创建 Release。
- GitHub Release 工作流在 CDN 哈希门禁前执行插件回归测试；“当前随包安装器通过生产校验”与“公网安装器逐字节等于随包安装器”必须同时成立，才允许创建 Release。
- `.gitattributes` 固定三份 OCR 文本资产为 LF，防止 Windows 工作区上传 CRLF、GitHub Linux 检出 LF 所造成的跨平台字节漂移和 macOS shell 风险。
- 固定顺序为：测试发布源 → 上传 CDN → 公网回读校验 → 提升插件版本 → 推送 main → 推送 tag。

## 后续结构性改造

1. 将组件改为不可覆盖路径：`local-ocr/releases/<componentVersion>/...`。
2. 每个组件版本生成 `manifest.json`，记录 Git 提交、平台、文件 SHA-256、Python 版本和依赖集合。
3. 插件固定读取一个明确组件版本；升级和回滚只切换 manifest 指针，不覆盖历史文件。
4. 安装前诊断记录期望版本、实际 URL、HTTP 状态、实际 SHA-256 和拒绝原因，即使 PowerShell/Bash 尚未启动也能复制诊断。
5. 发布矩阵至少覆盖 Windows x64、macOS Apple Silicon、macOS Intel 的安装器解析与真实图片 OCR 冒烟测试。

在上述版本化路径完成前，任何修改 `local-ocr/` 的插件版本都必须通过当前公网 SHA-256 门禁。
