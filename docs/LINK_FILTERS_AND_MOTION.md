# 连接电脑页签与共用筛选器（Android 0.27.0）

日期：2026-10-21。基于统一项目 `D:/AI/Matheca`，只修改移动端界面；versionCode 28，数据库 schema 9 不变。

## 完成清单

- [x] 连接与待传、选择资料、接收题库采用同一固定视口内的 300ms 水平平移；向后切换反向退出，页签栏保持位置，遵循系统动画时长设置。
- [x] 每个联动页签单独保留列表滚动状态，快速切换以最新选择为准。
- [x] 知识点分类标题 15sp 加粗，具体子项 14sp 并缩进，分类标记为可访问标题、不参与选择。
- [x] 分类与子项随字体和换行自然增高，子项不省略正文；高亮跟随真实行位置与高度，不再累加固定行高；未选择时不高亮分类或首项。
- [x] 题库与选择资料共用 QuestionCategoryFilters、QuestionKnowledgeFilter、QuestionFilterState，包含年级、题型、难度、知识点；沿用相同分类、知识点可用范围、组合匹配和重置。
- [x] 筛选只改变题目显示，不清空已选题目／题集；无匹配时有空状态，选择数量与发送操作仍保持可用。
- [x] 切换联动页签保留筛选及选择状态，完整题卡沿用原有题干、公式、题干图片及选项图片。

## 主要实现

- `ui/DesktopLinkComponents.kt`：固定视口的页面平移。
- `ui/DesktopLinkScreen.kt`：页签状态保留、共用筛选及空状态。
- `ui/QuestionFilterControls.kt`：题库与联动共用的筛选状态、分类及下拉组件。
- `ui/MathectorApp.kt`：题库使用共用筛选组件。
- `ui/GlideSelect.kt`：菜单分类层级、文字换行、按实际布局定位高亮。

## 验证与交付

- 应用与测试 APK 构建、51 项 JVM 测试、Lint 通过：`app/build/diagnostics/link-filters-release-build.log`。Lint 0 错误、25 警告。
- 实际动画帧检查覆盖 0→1→2、2→1→0、快速改选后的最终页面；组合筛选、无匹配、重置、隐藏选择保留、页签滚动恢复及原有弹层操作共 8 项通过：`app/build/diagnostics/link-filters-confirm.log`。
- 130% 系统字体、深色、关闭动画下，四项筛选及状态恢复通过：`link-filters-large-custom.log` 中 LinkQuestionFilterTest。该日志中的旧自定义知识点测试定位失败，后续按现有固定标题按钮和可访问动作更新测试，单独重测通过：`link-filters-custom-confirm.log`。
- 真实系统字体 200% 的菜单专项通过：`link-filters-system-200.log`。核对分类与子项字体层级、所有文字的逐行可见边界及末尾字符、可变行高与高亮对齐；浅色／深色截图在 `desktop/test-output/link-filters-native-final/knowledge-2.0-light.png`、`knowledge-2.0-dark.png`。
- 资料选择截图：`desktop/test-output/link-filters-native/filtered-selected.png`，130% 字体截图：`desktop/test-output/link-filters-native-large/filtered-selected.png`。按实际原生截图检查；本轮未修改桌面界面，不执行 HTML 检测。
- 初次设备测试因 ADB 短暂断开未成功安装应用，重装并核实 versionCode 28 / versionName 0.27.0 后执行上述最终检查。专用模拟器 emulator-5580 使用隔离测试数据，未操作物理手机及正常题库。
- 最终 APK 的 v2 签名、包名与版本、SHA-256 校验通过。

交付：`D:/AI/Matheca/app/releases/0.27.0/2026-10-21-17-27-05/Matheca-android-0.27.0-debug.apk`，同目录提供 `SHA256SUMS.txt`。最新 APK 索引：`app/releases/latest.txt`。保留原包名、签名与数据库版本，支持覆盖安装。
