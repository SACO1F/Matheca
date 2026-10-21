# 编辑返回与 AI 跨页识别

日期：2026-10-21。项目：`D:/AI/Matheca`，Android 0.26.0 / versionCode 27，数据库 schema 9 不变。

## 完成清单

- [x] 手机从题库进入编辑，返回后保留原筛选和滚动位置。
- [x] 手机从题集进入编辑，保存、标题栏返回和系统返回均回到原题集及原位置。
- [x] 进入编辑向左推进，返回反向退出；使用现有 260ms 标准缓动与淡入淡出，遵循系统动画时长设置。
- [x] 列表／题集状态通过 SaveableStateHolder 保留，编辑页离开后释放保存状态，防止再次打开时覆盖最新内容。
- [x] 手机 PDF 与同批连续照片由多图 AI 判断续题，按目标起始页录入；需要更多后续页时继续扩展上下文。
- [x] Windows 保留已有 PDF 跨页流程，并为同批连续照片补充同样的跨页识别。
- [x] 校验页码及 complete／needMorePages 信息，续题页不重复建题，末尾仍缺页时提示补充，不录入半题。
- [x] 跨页来源合并保留供校对，手机合成图限制位图内存；按页缓存识别结果，重试保留人工编辑。

## 使用方法与边界

跨页题的各页应放在**同一次导入**中：PDF 使用文档页序，照片按选择／传入顺序排列。程序会自动联合相邻页识别，不需要手动剪接。不同 PDF 之间、被 PDF 隔开的照片组之间不会互相拼题；已分开完成的两次导入不会自动追溯合并。

需要配置支持多图输入的多模态接口。真实模型仍可能误判题界或漏字，导入后应对照保留原图校对。本轮使用本地模拟模型响应验证请求、续页和落库行为，未使用用户密钥调用付费服务，不能据此声称真实模型识别率已验证。

## 验证

- 桌面类型检查和 151 项测试通过：`desktop/test-output/return-crosspage-verify.log`。
- `npm run make:portable` 成功：`desktop/test-output/return-crosspage-package.log`。
- 新打包 EXE 使用隔离数据启动；PDF／照片三页续题、续题页去重、合并原图、末尾不完整拒绝、重试保留人工修改及题数通过：`desktop/test-output/return-crosspage-ui.log`，数据目录 `cross-page-1792572195057/`。
- 新 EXE 的题集编辑返回和导航重启回归通过：`desktop/test-output/return-collections-ui.log`、`return-navigation-ui.log`。
- Android 应用／测试 APK 构建、JVM 测试和 Lint 通过：`app/build/diagnostics/return-crosspage-build-final.log`；版本更新后的最终 APK：`return-crosspage-apk.log`。Lint 0 错误、25 警告。
- 手机跨页协议／缓存／缺页处理、编辑返回及原多模态流程 10 项设备检查通过：`app/build/diagnostics/return-crosspage-device.log`。
- 130% 字体、深色、关闭动画下的返回／编辑／题集回归共 8 项，首次有 2 项旧测试定位失败（未滚动到懒加载预览、搜索键盘使测量区域被裁切）。保留原断言，补充滚动及关闭键盘后 2 项均重测通过：`return-crosspage-ui-final.log`、`return-crosspage-ui-recheck.log`。
- 设备截图：`desktop/test-output/return-crosspage-native/`。测试只使用专用模拟器 emulator-5580，桌面使用 MATHECA_TEST_DATA，未更改正常应用数据。
- 最终 APK v2 签名、versionCode／versionName 与发布文件 SHA-256 已检查。

## 交付

`D:/AI/Matheca/desktop/releases/v0.1.0/2026-10-21-16-39-27-1792571967841/`：

- `Matheca-win32-x64/Matheca.exe` 与完整运行资源。
- `make/zip/win32/x64/Matheca-win32-x64-0.1.0.zip`。
- `android/Matheca-android-0.26.0-debug.apk`。
- `SHA256SUMS.txt`。最新路径索引在 `desktop/releases/latest.txt`、`app/releases/latest.txt`。
