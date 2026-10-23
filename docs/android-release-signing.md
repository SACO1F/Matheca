# Android 正式签名与发布

应用包名为 `com.matheca.app`。Release 默认关闭调试，启用 R8 混淆与资源压缩。

签名配置从本机 `signing/release.properties` 读取，包含 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`。该目录已被 Git 忽略，不应上传到代码仓库或应用商店。缺少本机配置时不会应用正式签名，不能将生成的 unsigned APK 用于发布。

本机密钥为 `signing/matheca-release.jks`，别名 `matheca`，RSA 3072 位。签名备份为 `signing/backup/Matheca-release-signing-backup.zip`，包含密钥及密码配置，应复制到可靠的私人备份位置。ZIP 本身没有加密，不能公开分享。

构建与检查（需要 JDK 17 或更新版本及项目对应 Android SDK）：

```powershell
.\gradlew.bat :app:assembleRelease :app:testDebugUnitTest :app:lintRelease --console=plain
```

输出为 `app/build/outputs/apk/release/app-release.apk`。上传前使用 Android SDK 的 `apksigner verify --verbose --print-certs` 检查签名，并检查包名及非调试状态。保留每次构建的 `app/build/outputs/mapping/release/mapping.txt`，用于定位混淆后的崩溃。

当前发布的版本为 `0.1.0`，`versionCode=30`。以后发布更新必须递增 `versionCode`，并继续使用同一正式签名密钥。Debug 签名的相同包名应用不能直接被正式包覆盖；先导出题库，再卸载测试版、安装正式版并导入备份。

正式签名及本机验证不代表商店审核通过；商店资料、隐私政策及真实设备兼容性仍需独立核对。
