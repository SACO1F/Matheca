# Matheca 同仓库开发说明

项目统一使用 Matheca 名称，GitHub 仓库为 `SACO1F/Matheca`。Windows 与 Android 的当前产品版本统一为 v0.1.0；Git 提交历史保留。

## 平台与边界

| 内容 | Android App | Windows 桌面版 |
| --- | --- | --- |
| 源码入口 | `app/src/main/` | `desktop/src/` |
| 界面 | Kotlin / Jetpack Compose | React / TypeScript / Electron |
| 本地存储 | Room / SQLite | SQLite |
| 构建入口 | 根目录 Gradle Wrapper | `desktop/package.json` |
| 测试 | `app/src/test/`、`app/src/androidTest/` | `desktop/tests/`、`desktop/scripts/` |
| 交付 | APK | 完整 Windows x64 便携目录、ZIP |

同仓库便于统一命名、追踪问题和发布，但不会让两端自动同步数据库或拥有完全相同的功能。桌面手机扫码上传通过局域网浏览器完成，不依赖 Android App。Android App 与桌面使用桌面标准 ZIP 手动交换题目与题集，接收前预览并确认冲突；本地完整备份使用各自对应的备份入口。

## 构建

Android：使用 Android Studio 内置 JBR、Android SDK 37，在根目录运行：

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest
```

输出 APK：`app/build/outputs/apk/debug/app-debug.apk`。设备测试和 lint 需另行运行，不能用单元测试替代。

Windows：使用 Node.js 24，在 `desktop/` 运行：

```powershell
npm ci
npm run verify
npm run make:portable
npm run test:portable
```

发布脚本每次使用新目录，避免覆盖正在运行的程序。界面验收使用独立测试数据，不操作正常题库。

## 名称与数据兼容

项目名称、Gradle 根项目、窗口、页面和新发布文件使用 Matheca。Android 的 `com.mathector.app` 包 ID、旧类名以及旧备份／数据目录标识作为兼容协议保留，避免覆盖安装时失去旧数据；它们不代表另一个项目。不要仅为拼写一致就修改数据库位置或 Android 包 ID。

## 提交与发布

源码、测试、构建脚本、必要资源和第三方许可提交到本仓库。`node_modules`、Gradle 缓存、APK、EXE、ZIP、题库、密钥、机器配置、测试数据和个人助手记忆不提交。两个平台的安装文件统一放在本仓库 Releases 中。

同一发布可以同时附带两个平台文件，但需分别标明各自版本、验证范围与签名类型；不要以一个平台的测试结果代替另一个平台的验证。
