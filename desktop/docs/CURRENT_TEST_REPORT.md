# Matheca Windows 验证说明

桌面版的当前验证入口是 `npm run verify` 与 `npm run test:portable`。Android 的构建和验证独立进行，不能用本文件替代 Android 检查。

## 自动检查

- `npm run verify`：TypeScript 与 Vitest；当前共有 140 项测试。
- `npm run make:portable`：生成新的 Windows x64 完整便携目录、ZIP 与 SHA256 校验值。
- `npm run test:portable`：使用实际打包 EXE 执行核心验收，覆盖手动录题、主题、任务跳转、题目编辑、手机导入、导出、导航、知识点、题集、选择器、恢复、侧栏和浮动入口。
- `npm run test:portable:full`：扩展验收集合；不应把只执行核心集合表述为执行了完整集合。

验证生成独立的 `test-output/` 子目录，不读取或修改正常用户题库。每次运行的 `REPORT.md` 记录被测 EXE、哈希、各脚本退出状态、日志和证据目录。

## 验证边界

本地模拟识别服务与 Chrome 手机尺寸测试可以检查流程，不能证明真实服务的识别质量或 Android／iPhone 相机、实际局域网和防火墙行为。DOCX／PDF 自动检查也不能替代 Word／WPS 的完整编辑、分页与打印验证。

发布时请同时查看对应 GitHub Release 的说明与校验文件。历史版本验证记录保留在本目录其他文档中，其中旧名称、旧版本、测试数量和本机路径不代表当前发布。
