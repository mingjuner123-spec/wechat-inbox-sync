# 本地转写方案

这个目录用于准备“无 API、本地转写”的 Windows/macOS 方案。插件会把音频/视频先下载到本机临时目录，再调用本地 Whisper 转写，转写完成后删除临时文件。

## Windows 一键安装

在 PowerShell 里运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-local-asr.ps1
```

安装脚本会下载：

- whisper.cpp Windows 版本
- ffmpeg
- Whisper small 模型

默认安装到：

```text
%USERPROFILE%\.wechat-inbox-local-asr
```

插件默认命令：

```text
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.wechat-inbox-local-asr\transcribe.ps1" -InputPath {input} -OutputPath {output}
```

## macOS 一键安装

在终端里运行：

```bash
/bin/bash ./install-local-asr-macos.sh
```

安装脚本会通过 Homebrew 安装：

- whisper-cpp
- ffmpeg
- Whisper small 模型

默认安装到：

```text
$HOME/.wechat-inbox-local-asr
```

插件默认命令：

```text
/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}
```

如果电脑没有 Homebrew，脚本会提示先安装 Homebrew。苹果芯片和 Intel Mac 都走同一套安装逻辑。

## 适用范围

- 适合不想配置腾讯云、阿里云、豆包 API 的用户。
- 对 30 分钟以上音频会比较吃电脑性能，首次运行也会更慢。
- 识别质量和速度取决于电脑性能、模型大小和原始音频质量。
