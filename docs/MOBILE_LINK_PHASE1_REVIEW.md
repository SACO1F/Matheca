# 手机联动第一阶段：界面与交付证据记录

日期：2026-10-20。工作模式：Operate，既有中性桌面系统的功能扩展。此记录描述实际实现与已提供的验证证据，不是新设计系统，也不扩展产品承诺。

## 结论与审阅边界

独立 finish reviewer 的结论为 **ship**，未发现需要修复的实质问题。其范围为逐一打开六张最终截图、检查视觉系统一致性，并抽查手机联动界面及服务端授权实现；未独立阅读 `main.tsx` 或 UI 自动验证脚本，也未亲自执行构建及测试。构建与测试结果由主执行者验证。本记录的文档审阅另行检查了下列源文件、系统文档及报告。没有 QUALITY BAR 卡片；本次沿用已建立的代码主导界面，没有获批的栅格设计稿可作像素比对。

本次 documenter 只新增此文件。`DESIGN.md` 与 `.impeccable/design.json` 保留原状；不将局部差异提升为全局设计规则，不修改应用源码或发布包内文档。

## 证据与来源

已读取产品与系统约束：`PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`、`.impeccable/surfaces/desktop-workspace.md`，以及 [第一阶段功能与限制](MOBILE_LINK_PHASE1.md)。遵循 Impeccable documenter 合约及 `reference/document.md` 的普通扩展保留既有系统要求。

已检查实现：`desktop/src/renderer/mobile-import.tsx`、`mobile-import.css`，`desktop/src/main/phone-page.html`；抽查 `desktop/src/renderer/main.tsx` 的导出完成、最近导出文件状态、手机联动面板与“发送到手机”入口。另抽查原有 `style.css` 与 `workbench-theme.css` 中的题目排版规则以确认已记录的历史字号差异。本次文档审阅未重新执行构建、单元测试或 UI 专项。

以下六张最终截图均已实际打开检查，来自同一 [截图目录](../desktop/test-output/mobile-import-1792480183315/)：

| 截图 | 看到的实际状态与检查要点 |
| --- | --- |
| [desktop.png](../desktop/test-output/mobile-import-1792480183315/desktop.png) | 已连接、两张照片、顺序编号、独立移除操作、明确的桌面“开始识别”；配对区与照片区分栏，主操作易辨认。 |
| [desktop-compact.png](../desktop/test-output/mobile-import-1792480183315/desktop-compact.png) | 1024 × 700 桌面窗口；缺少识别接口配置的错误提示、保留照片与可滚动配对区；底部动作仍可见。此截图是本轮实测几何，不改写系统文档较早的 1024 × 720 证据。 |
| [desktop-files.png](../desktop/test-output/mobile-import-1792480183315/desktop-files.png) | 发往手机页签、最近导出的 Word、PDF／Word 两份文件的“已传到手机浏览器”状态，以及桌面导出完成提示。 |
| [phone-390.png](../desktop/test-output/mobile-import-1792480183315/phone-390.png) | 390px 宽浏览器页面；拍摄／相册、两张已发送照片、排序与移除禁用态、电脑待识别与发送状态，文本正常换行。 |
| [phone-landscape.png](../desktop/test-output/mobile-import-1792480183315/phone-landscape.png) | 横向窄高浏览器的完整页面捕获；居中内容与固定发送栏。全页截图中固定栏跨过滚动内容，不代表该截图一次呈现的真实手机屏幕；没有由此声称完成真机横屏验收。 |
| [phone-results.png](../desktop/test-output/mobile-import-1792480183315/phone-results.png) | 本次识别完成、PDF／Word 已下载到浏览器、重新下载与保存／打开入口；“传到浏览器”与实际系统保存分开表述。 |

## 既有系统的一致性

界面沿用灰色外壳、白色容器、石墨文字与深色主动作。桌面面板继续使用既有语义变量，薄边界、圆角与中性页签维持原有层级；照片预览和移除操作不会取代显式识别动作。错误提示使用语义红色及可读文字，连接、识别与下载均有明确状态文本。

手机页面保持同一中性世界，按触屏使用扩大控件：正文为本机系统字体 16px／1.6，标题 25px，分区标题 18px，名称 14px，提示 12–13px；常规按钮最小高度 46px，照片工具为 44px。内容最大宽度 620px，窄屏自然换行；底部固定发送栏配有内容底部留白及安全区域内边距。手机采用系统字体是本机浏览器适配，不新增品牌展示字体。

桌面弹层为 820px 最大宽、720px 最大高，使用 250px 配对列和弹性内容列，随视口收缩；内部可滚动区域与固定头尾保持操作入口。面板的 16px 圆角及柔和阴影符合既有浮层语义，不把这次弹层的具体尺寸写成所有窗口的通用约束。手机下载链接的蓝色与下划线用于可打开文件入口，不引入新视觉身份。

源码可见原生 dialog、可访问名称、状态／错误播报角色、页签方向键与 Home／End 操作、可见键盘焦点及减少动态效果处理。这是实现证据，不能据此声称完整无障碍认证。

## 未固化或修复的差异

既有 `DESIGN.md` 已明确记录通用题目 15px 与旧 `.masonry-grid .card-preview` 13px 的选择器差异，以及部分 10–13px 元数据和控件。源码仍有该 13px 规则；这是历史漂移，本次未修复，也不作为新增阅读内容缩小字号的依据。旧 surface brief 的“数学 15px”意图不等同于所有上下文已实现 15px。

原手机页面及桌面手机导入样式保留局部字面量颜色和尺寸，例如桌面错误背景 `#fff0f2` 与系统错误表面 token `#fbecef` 不同，手机错误色与圆角也并非逐项复用桌面 token。其语义及中性外观与既有世界一致；本轮未以文档修改追认成新的全局 token，也未进行无关的系统迁移。`design.json` 的早期生成日期与预览内容不代表本次新增功能已被自动抽取。

## 功能与验证证据

功能范围为电脑确认六位核对码后授权的同局域网浏览器连接；照片排序、上传／失败重试、回执去重及刷新恢复；桌面明确发起识别、仅本次连接的识别状态；实际 PDF／Word 导出后的明确发送与下载；15 分钟有效期、结束连接撤销旧链接。收起面板与结束连接的文案、行为分别呈现，未识别照片可在电脑保留。限制与数据边界以功能文档为准。

主执行者验证 TypeScript 检查和 9 个测试文件的 144 项 Vitest 测试通过。最终 [便携版验证报告](../desktop/test-output/validation-2026-10-20T07-09-42-814Z-14848/REPORT.md) 记录实际打包 EXE 的 `mobile-import-ui`、`e2e`、`collections-ui`、`task-links-ui` 四组脚本全部退出码 0，使用隔离测试数据。专项覆盖照片重试、恢复、显式识别、任务状态、真实 UI 导出、下载失败重试及 PDF／Word 字节一致性。变更手机表面的 detector 报告无 findings；该结果不替代人工与真机检查。

最终发布根目录为 `desktop/releases/v0.1.0/2026-10-20-15-08-26-1792480106509/`。完整应用目录与 ZIP 同处该发布树，运行需要保留全部资源：

- [Matheca.exe](../desktop/releases/v0.1.0/2026-10-20-15-08-26-1792480106509/Matheca-win32-x64/Matheca.exe)
- [便携版 ZIP](../desktop/releases/v0.1.0/2026-10-20-15-08-26-1792480106509/make/zip/win32/x64/Matheca-win32-x64-0.1.0.zip)
- [SHA256SUMS.txt](../desktop/releases/v0.1.0/2026-10-20-15-08-26-1792480106509/SHA256SUMS.txt)

主执行者已核对 EXE／ZIP 校验值及完整运行资源。最终报告的 EXE SHA256 为 `32d4cffe66293253e26d8d9b421b38735886b3d0dad5a8e53daa3938a173338a`，`app.asar` SHA256 为 `b0621189a8425650f504e950b797516e6feec26cbee9752afd39562e86198ed0`。首次在线构建因网络下载失败，随后验证本机 Electron 44.7.0 缓存并成功完成便携版构建；早先失败不冒充最终通过。

尚未验证 Android／iPhone 真机扫码、系统相机／相册、实际 Wi-Fi 与防火墙、系统保存／分享、Word／WPS 打开文件。已完成的是 Chrome 手机尺寸浏览器与隔离数据、模拟识别服务验证，不证明真实识别准确率，也不证明文件已保存到手机或被其他软件成功打开。
