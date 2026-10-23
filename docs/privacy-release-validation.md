# Matheca v0.1.0 隐私政策发布验证

日期：2026-10-22。Android 内部版本号：30。Windows x64 与 Android 对外版本均为 0.1.0。

## 本次交付

- 桌面端：设置与备份 → 隐私与数据 → 隐私政策。
- 移动端：我的 → 隐私与数据 → 隐私政策。
- 正文随安装包内置，可离线阅读；使用同一个 JSON 来源，避免两端文本分歧。
- 联系渠道采用项目现有的 SACO1F/Matheca GitHub Issues，并提醒用户不要提交个人信息、密钥或真实题库。
- 根目录 PRIVACY.md 与 docs/privacy-policy.html 由 scripts/export-privacy-policy.py 从正文生成。HTML 尚未部署为公开网址。

## 检查结果

- 桌面端 TypeScript 检查通过，151 项单元测试通过。
- 最终 Windows EXE 使用独立 MATHECA_TEST_DATA 目录验证：政策离线阅读、九个章节、四种主题色、1024×720 窗口、滚动正文、固定底部操作、Escape/按钮关闭、焦点返回和联系渠道动作通过。
- 最终 EXE 的 e2e、manual-entry-ui、close-tray-ui 回归通过。
- Windows ZIP 完整性检查通过；ZIP 中 EXE、app.asar、Windows x64 SQLite 原生模块与便携目录内容一致。
- Android assembleRelease、bundleRelease、testDebugUnitTest、lintRelease 构建通过。51 项单元测试通过，Lint 0 错误、26 个警告。
- Android 专用模拟器上，隐私政策测试在默认字体与 200% 字体各通过 1 项，覆盖设置入口、滚动、固定关闭操作、返回及重新打开。
- 最终正式签名 APK 冷启动正常，实际打开设置入口、读取政策、关闭返回通过；通过设置切换深色模式后，最终 APK 政策深色显示验证通过。
- APK Signature Scheme v2 校验通过，签名主体为 Matheca Release；AAB 的 JAR 签名验证通过，使用项目正式 Android 签名。Android 自签名证书的信任链/无时间戳提示不等于签名失败。
- APK 与 AAB 内的 privacy-policy.json 均与源码正文逐字节一致，压缩包完整性检查通过。

## 产物与证据

- Windows：desktop/releases/v0.1.0/2026-10-22-20-33-39-1792672419832/；保留完整 Matheca-win32-x64 目录及 make/zip/win32/x64/ 下 ZIP。
- Android：app/releases/0.1.0/2026-10-22-privacy/；包括 APK、AAB、R8 mapping.txt、政策副本、签名日志与 SHA256SUMS.txt。
- 桌面端政策：desktop/test-output/privacy-1792672940149/RESULT.md。
- 桌面端回归：desktop/test-output/validation-2026-10-22T12-37-40-055Z-14032/REPORT.md；关闭行为：desktop/test-output/close-choice-1792672826985/RESULT.md。
- Android：app/build/diagnostics/privacy-release-build.log、privacy-device-retry.log、privacy-device-large.log；最终包截图：privacy-screens/release-policy.png、privacy-screens/release-policy-dark.png。

## 发布边界

本次交付为可分发的发布构建，未向任何应用商店或 GitHub 上传。Windows EXE 尚无商业代码签名证书（Authenticode 状态为 NotSigned）。正式上架仍须按目标商店核对开发者主体、备案、公开政策网址、审核素材及要求的声明或授权流程；本次测试没有覆盖所有实体手机、真实付费 AI 服务和所有版本升级路径。没有修改用户正常题库或终止用户运行中的应用。
