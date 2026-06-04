# 本地转写方案

这个目录用于准备“无 API、本地转写”的 Windows 方案。它会把音频/视频先下载到本机临时目录，再调用本地 Whisper 转写，转写完成后插件会删除临时文件。

## 一键安装

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

## 插件里填写的命令

在 Obsidian 插件设置里把“语音转写”选择为“本地转写命令”，然后点击“填入默认命令”，或手动填写：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.wechat-inbox-local-asr\transcribe.ps1" -InputPath {input} -OutputPath {output}
```

## 适用范围

- 适合不想配置腾讯云、阿里云、豆包 API 的用户。
- 对 30 分钟以上音频会比较吃电脑性能，首次运行也会更慢。
- 识别质量取决于电脑性能、模型大小和原始音频质量。
