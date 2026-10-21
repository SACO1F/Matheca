# 联动按钮平移与版本同步

日期：2026-10-21。移动端版本名统一为 0.1.0，与桌面版一致；Android 内部 versionCode 从 28 增加到 29，以支持覆盖安装此前的 0.27.0。

- [x] 顶部“连接与待传／选择资料／接收题库”使用一个连续移动的选中底块，切换时沿水平方向滑动。
- [x] 沿用主导航弹簧参数（阻尼 .84，刚度 420），保留按钮按压反馈和文字着色过渡。
- [x] 底块按三个等宽按钮及其间距定位，高度跟随实际按钮行，兼容大字体换行；快速切换以最后一次选择为准。
- [x] 保留原有页面平移、筛选、滚动与勾选状态。
- [x] 设置页和备份元数据从 BuildConfig.VERSION_NAME 读取版本，避免写死的版本文字与安装包不一致。

本轮仅修改移动端；数据库和备份格式版本保持不变。

## 验证

- 最终应用／测试 APK、51 项 JVM 测试和 Lint 通过：`app/build/diagnostics/tab-buttons-release-build.log`。
- 按钮选中底块的真实中间帧检查通过，覆盖三个按钮双向滑动、跨按钮切换、快速切换后最终定位和与按钮尺寸对齐。页面过渡、四项筛选、状态保留及设置页版本显示也通过，共 3 项设备检查：`tab-buttons-device.log`。
- 200% 系统字体、深色下按钮滑动与尺寸对齐专项通过：`tab-buttons-large.log`。截图：`desktop/test-output/tab-buttons-native-large/buttons-2.0-dark.png`。
- 普通字体浅色按钮截图：`desktop/test-output/tab-buttons-native/buttons-1.0-light.png`；设置页显示 0.1.0 的截图：`desktop/test-output/tab-buttons-settings/version.png`。
- 在专用模拟器先安装 0.27.0 并写入测试文件，再直接覆盖安装 0.1.0，核对 versionCode 29、versionName 0.1.0，确认应用私有目录中的测试文件仍在。没有使用降级安装参数，也未卸载重装。
- 最终 APK v2 签名、包名、版本及 SHA-256 已校验；测试使用隔离模拟器，未修改用户正常题库或物理手机。

## 交付

`D:/AI/Matheca/app/releases/0.1.0/2026-10-21-19-26-41/Matheca-android-0.1.0-debug.apk`。同目录提供 `SHA256SUMS.txt`，最新索引为 `app/releases/latest.txt`。桌面版现有版本名为 0.1.0。
