# Matheca 同仓库整合与发布验证

日期：2026-10-19。

原 `SACO1F/Mathector` 仓库更名为 [SACO1F/Matheca](https://github.com/SACO1F/Matheca)，保留提交历史与旧发布。Android 源码位于 `app/`，Windows 桌面源码位于 `desktop/`。本次发布入口为 [matheca-2026.10.19](https://github.com/SACO1F/Matheca/releases/tag/matheca-2026.10.19)。

## 构建与验证结果

| 平台 | 执行项 | 结果 |
| --- | --- | --- |
| Windows 0.1.0 | `npm run verify` | TypeScript 检查通过；9 个测试文件、140 项测试通过 |
| Windows 0.1.0 | `npm run make:portable` | Windows x64 完整便携目录与 ZIP 构建成功 |
| Windows 0.1.0 | `npm run test:portable` | 新打包 EXE 的 15 项核心界面脚本全部通过，使用独立测试数据 |
| Windows 0.1.0 | ZIP 结构检查 | EXE、app.asar、ICU 与 Windows x64 SQLite 原生模块齐全 |
| Android 0.21.0 | `:app:assembleDebug :app:testDebugUnitTest --offline` | 构建成功，39 项单元测试通过，0 失败、0 错误 |
| Android 0.21.0 | APK badging / `apksigner verify` | 安装显示名为 Matheca 数学题集；签名验证通过 |
| 源码 | 暂存区检查 | 差异空白检查通过；未提交构建产物、个人题库或密钥文件 |

Windows 核心界面检查覆盖手动录题保存／放弃／取消、主题切换、成功任务跳转、编辑操作、手机导入、SQLite 持久化、校对、题集、导出、备份恢复、导航、侧栏与悬浮快捷入口。

本次未执行 Windows 扩展完整套件、Android 设备测试或 Android lint。识别接口使用测试替身，手机上传通过浏览器自动化验证；这些结果不代表真实服务商、手机相机、真实局域网或 Word / WPS 的设备验收。

## 发布文件

Windows ZIP SHA256：

```text
48d63b72008e32b790e5b6934eadd446eebb9e7f6e7ebb666e2f8318a5279bb7  Matheca-win32-x64-0.1.0.zip
```

Android APK SHA256：

```text
98b36a25a7e501b3db05e765593d88ad5bad3f188fb1dbddafbcefe9b76cdbb6  Matheca-android-0.21.0-debug.apk
```

Android APK 使用 Debug 签名。Windows 请完整解压 ZIP 后运行 `Matheca.exe`，不要单独移动 EXE。

两个平台仍分别保存本地数据；同仓库整合没有新增实时同步。保留旧 Android 包 ID、类名及旧备份／目录识别用于数据兼容。历史文档和历史发布中的 Mathector 记录不重写。
