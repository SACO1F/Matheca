# 手机联动界面完善（Android 0.25.0）

日期：2026-10-21。基于统一后的 `D:/AI/Matheca`，保留用户 Mathector 的原生主题和业务能力。本轮使用 impeccable 的 polish 流程与 ui-ux-pro-max 的针对性 UX／Compose／React 指引，沿用既有设计，不更换视觉体系。

## 完成清单

- [x] 桌面手机联动沿用工作台中性色、四套强调色、任务页页签、按钮与键盘焦点反馈。
- [x] 桌面联动中的题集选择沿用题集行；题目选择沿用题卡、数学公式及题干／选项图片渲染。
- [x] 桌面题库、题集与资料选择共用 `question-content.tsx` 的正文渲染，长题完整显示，通过滚动阅读全部内容。
- [x] 桌面选择数量与发送按钮固定在弹窗底部，阅读长题后仍可直接发送。照片识别仍在照片相关页签中明确触发。
- [x] 桌面每批显示 100 个题目／题集，可继续加载并保留已选项，避免直接渲染整个大题库的公式。
- [x] 手机连接页沿用原生卡片、间距、主题与地址输入框规格；页签继承主导航的按压、着色及页面切换参数。
- [x] 手机题库、题集、选题和联动选择共用完整题卡，移除数学预览的 98px 裁切。题干图片行可换行，保留完整图像。
- [x] 手机资料选择复用 `QuestionSummaryCard` 与 `CollectionSummaryCard`，包含题干、公式、题干及选项图片、分类及校对状态、题集名称及题数。
- [x] 手机选择数量、ZIP 导出和加入队列固定在列表之外，长题滚动不遮住底部操作；大字体时操作区域允许换行。
- [x] 手机题集卡在大字体下将导出／删除移至下方，给完整标题保留可用宽度。
- [x] 数学正文只应用一次系统字体缩放，避免 CSS 与 WebView 重复叠加；PDF／Word 的独立公式渲染路径不改动。
- [x] 原有连接、配对、队列、双向增量、接收预览、冲突处理和本地导出语义保持不变。

## 主要实现

- Android：`QuestionSummaryCard.kt`、`CollectionSummaryCard.kt`、`MathRenderer.kt`、`QuestionFigureEditor.kt`、`DesktopLinkScreen.kt`、`DesktopLinkComponents.kt`。
- 桌面：`question-content.tsx`、`main.tsx`、`library-exchange.tsx`、`mobile-import.tsx`、`mobile-import.css`。
- 原有 `DESIGN.md` 与 `.impeccable/design.json` 保留；本轮边界记录于 `.impeccable/surfaces/mobile-link-polish.md`。

## 验证

- 桌面类型检查及 151 项测试通过：`desktop/test-output/link-polish-verify.log`。
- 最终 Windows EXE 使用隔离数据完成四组界面回归：手机联动、核心端到端、题集、任务关联。报告：`desktop/test-output/validation-2026-10-21T06-36-55-037Z-55088/REPORT.md`。
- 最终 EXE 的长题专项通过：题库、题集、资料选择均含末尾条件；资料选择可勾选，1024×700 窗口与减少动态效果均验证。证据：`desktop/test-output/link-polish-1792564607663/`。
- 桌面变更目标的检测结果为零发现：`desktop/test-output/link-polish-detect.log`。Android 按原生组件和实际设备截图检查，不运行 HTML／CSS 检测器。
- Android 应用与测试 APK 构建、51 项 JVM 测试及 Lint 通过；Lint 0 错误、24 警告。记录：`app/build/diagnostics/link-polish-build.log`。
- 42 项设备回归完成、0 失败，覆盖迁移、原生图片／备份／PDF／Word、主题、题集、编辑器、数学渲染与完整题卡。该次 ADB 输出通道中断，已保留原始输出及设备 TestRunner 的完整完成记录：`app/build/diagnostics/link-polish-device-final42.log`、`link-polish-device-final42-recovered.log`（PID 10427，`42 tests, 0 failed`）。随后针对单次字体缩放做最终专项复核。
- 最终字体修正后的 200% 字体专项通过（1 项）：`app/build/diagnostics/link-polish-large-type-final.log`；横屏专项通过（1 项）：`link-polish-landscape-final.log`；普通竖屏数学、题集卡、原生图片桥接及完整题卡复核通过（4 项）：`link-polish-math-final.log`。
- 最终原生截图：`desktop/test-output/link-polish-native/final-portrait/`、`final-landscape/` 直属 PNG，以及 `final-large-type/link-polish/`。已检查浅色／深色、完整末尾条件和固定操作区。APK v2 签名与发布目录 EXE、ZIP、APK 的 SHA-256 均已核对。

- 最终真实跨端 UI 回归通过：`desktop/test-output/android-exchange-1792569753580/RESULT.md`，原始日志 `desktop/test-output/link-polish-cross-final.log`。覆盖记住电脑、重连、接收预览、变更资料、照片／题库队列、双向传输、冲突策略、图片／试卷排版／解答及 64 位时间戳，无 AI 任务启动。前几次自动点击受到短暂 Snackbar 遮挡；测试补充等待提示结束并在断开后重新滚动定位按钮，最终完整执行通过。

原有测试中补充了对悬浮导航遮挡区域的滚动／点击定位，编辑器检查等待实际显示；公式测试使用与 App 一致的自动标题，避免用改题后失效的解答作为渲染样本。测试断言仍覆盖原有备份、取消、编辑器固定标题和解答渲染行为。

所有运行验证使用专属模拟器及隔离桌面数据，不修改正常题库，不终止用户应用。跨端 TCP 经 ADB 转发，物理 Wi-Fi／真实相机扫码与不同厂商权限未因此视为已验证。

## 发布位置

`D:/AI/Matheca/desktop/releases/v0.1.0/2026-10-21-14-32-57-1792564377747/`：

- `Matheca-win32-x64/Matheca.exe`，与同目录运行资源一起保留。
- `make/zip/win32/x64/Matheca-win32-x64-0.1.0.zip`。
- `android/Matheca-android-0.25.0-debug.apk`，原包名、debug 签名，versionCode 26，数据库 schema 9。
- `SHA256SUMS.txt`。最新路径索引：`desktop/releases/latest.txt` 与 `app/releases/latest.txt`。
