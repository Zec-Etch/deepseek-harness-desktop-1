# DeepSeek Harness Desktop 4.0.0 macOS arm64 Preview

这是与 Windows 正式版分开的 Apple Silicon 测试包，用于验证 DeepSeek Harness Desktop 4.0.0 在真实 macOS 环境中的兼容性。

## 适用范围

- 仅支持 Apple Silicon（M1、M2、M3、M4 及后续 arm64 芯片），不支持 Intel Mac。
- 本包未使用 Apple Developer ID 签名，也未公证，不属于 macOS 正式发行版。
- macOS 端暂不提供应用内自动更新，新版本需要从 GitHub Releases 手动下载。
- macOS 使用系统 Git，不内置 Windows 版的 MinGit。

## 安装

下载 `.dmg` 或 `.zip`，将 `DeepSeek Harness Desktop.app` 放入 `/Applications`，然后在终端执行：

```bash
xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness Desktop.app"
```

若仍被系统拦截，请打开“系统设置 -> 隐私与安全性”，在对应记录处选择“仍要打开”。

## 验证范围

该资产由 GitHub Actions 的 Apple Silicon runner 原生构建，流水线会检查 arm64 架构、应用 Bundle、Info.plist、终端原生依赖、插件 Runtime 启动、隔离用户目录和 SHA-256。CI 冒烟通过不等同于所有真实 Mac 机型与系统版本均已验收，请将问题反馈到 GitHub Issues，并附芯片型号、macOS 版本、复现步骤和脱敏诊断信息。

---

This is a separate Apple Silicon test package for validating DeepSeek Harness Desktop 4.0.0 on macOS. It is arm64-only, unsigned, not notarized, and has no in-app updates. macOS uses the system Git. Verify the downloaded file against `SHA256SUMS-macos.txt` before installation.
