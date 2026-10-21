# Mathector 旧项目归档

日期：2026-10-21。当前唯一开发目录为 `D:/AI/Matheca`。

`D:/AI/Mathector` 已在归档验证后移入回收站，不再作为开发目录使用；未清空回收站。

## 保留的精简归档

`D:/AI/Matheca/archives/Mathector-20261021-203304/Mathector-source-and-git.zip`

- 大小：15,117,887 字节（约 14.4 MiB）。
- 包含 885 个文件：当前工作区源码、资源、测试、配置、设计上下文、必要本机／IDE 配置，以及完整 `.git`。
- 保留原有已暂存／未暂存／未跟踪状态（共 38 项）；不只保存 Git HEAD。
- 排除编译产物、旧发布包、开发依赖缓存、模拟器和测试临时数据。
- Git HEAD：`3de01c6f0bf1061498e65e6353078adb455c98ef`。
- 同目录有 `SHA256SUMS.txt`、`VALIDATED.txt` 和 `git-fsck.log`。

## 已完成验证

1. 实际解压到临时目录，对 885 个文件逐一进行 SHA-256 校验。
2. 解压后的 Git HEAD、工作区状态与原目录一致。
3. `git fsck --full` 通过。
4. 归档期间原工作区未发生内容变动，最终 ZIP 校验通过后才移走旧目录。
5. 解压验证临时目录已移入回收站；源码归档保留在 `archives/`，已加入 Git 忽略规则，避免把整个备份 ZIP 提交进源码库。

## 恢复方式

将 ZIP 解压到新的空目录，使用其中的 `Mathector/` 作为项目根目录，`.git` 同时恢复。`_ARCHIVE_META/` 保存原文件清单、逐文件哈希、Git HEAD 和工作区状态。恢复仅用于查阅或取回旧实现，日常开发继续使用 `D:/AI/Matheca`。

`archives/` 中的该 ZIP 是有意保留的恢复备份，不属于构建垃圾。
