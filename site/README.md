# Matheca 介绍页

Matheca 的公开介绍页：一个不依赖构建的静态单页，双击 `index.html` 即可看。产品事实以 `../README.md` 为准。

```text
index.html        页面结构
styles.css        设计令牌与全部样式
main.js           顶栏描边、移动端导航、校对示意、滚动渐显
assets/           LOGO 位图（Matheca-rounded.png，顶栏标记与 favicon 同源）
```

## 部署

线上是 Cloudflare **Workers 静态资源**（不是 Pages），接 GitHub `SACO1F/Matheca` 的 `main` 分支，推送即重建。配置分两处，改任何一处都要跟另一处对得上：

- 仓库里：根目录的 `wrangler.jsonc`。`name` 必须和 Cloudflare 上的项目同名（`matheca`），`assets.directory` 指向 `./dist`。
- Cloudflare 后台「部署 / 构建设置」：

| 项 | 值 |
| --- | --- |
| 根目录 | `/`（**不能填 `site`**，否则 `wrangler deploy` 在 `site/` 里找不到根层的 `wrangler.jsonc`） |
| 构建命令 | `mkdir -p dist && cp -r site/index.html site/styles.css site/main.js site/assets dist/` |
| 部署命令 | `npx wrangler deploy`（默认值，不用改） |
| 构建输出 | `dist/`，由构建命令生成，不进版本库 |

发布面是**白名单**：只有上面 `cp` 点名的文件会上线。新增页面级资源（比如再拆一个 css）必须同时改这条构建命令，否则线上 404；`assets/` 是整目录拷贝，往里加文件不用改。

为什么用 `dist/` 而不是让 `assets.directory` 直接指 `./site`：`assets` 目录是整目录上传，`site/README.md` 会一起变成公开的 `/README.md`。`.assetsignore` 这条路走不通——wrangler 4.151 实测对它不生效（加了这个文件，上传数反而只多不少），所以白名单交给构建命令。

`DESIGN.md`、`PRODUCT.md`、`.impeccable/`、`.workbuddy/` 已被 `.gitignore` 挡在仓库外，既不进版本库也不进构建产物。


## 视觉方向：批改现场

不复刻桌面端界面的中性灰工作台，而是把产品最核心的一刻做成视觉母题——**机器先写，老师用红笔定稿**。

- 底：冷白 `#f6f7f8` 铺一层 56px / 280px 两级图纸网格（`--grid-fine` 3.5%、`--grid-major` 4.5% 墨色）。它只提供质感，不参与信息层级；白面章节（能力清单、结尾）不带网格，形成「灰底有纹、白面干净」的章节对比。
- 字：`Segoe UI / Microsoft YaHei`，正文 16px 起；数学用 `Cambria Math` 一类数学衬线真排版，不截图。
- 色：石墨 `#15181c` 承担主体，朱红 `#b32f24` 只用于红笔、批注、主行动。整页只有这一个彩色；这个红是在灰底上校准过 4.5:1 之后的深度，别再调浅。
- 形：4 / 8 / 12 / 16 圆角梯度，细线 `#e5e8eb` 分隔；静止面平，浮起的面（卡片、仓库块）才有投影。
- 动：100–700ms，只动 `transform` 与 `opacity`；`prefers-reduced-motion` 时全部落到终态。全页只有首屏校对卡这一个「作者时刻」，其余入场是 480ms 的轻渐显，按列错开。

页面顺序：Hero（可点的校对卡）→ 写给谁 → 三段流程 → 能力清单 → 五步开始 → 深色「边界」→ 仓库卡片 → 页脚。

两个刻意的结构选择，改动时别退化回去：

- 区块标题前不放小标、不放 01/02 编号，标题自己承担层级。步骤里的 01–05 保留，那是真正的顺序。
- 功能不摆卡片墙：九项排成细线分隔的索引，没有图标、没有边框、没有悬停位移——它们不可点，就不该有可点的样子。

首屏那张卡片是插图不是控件：错字划线、朱红改正、盖章都已排好，首次进入 2.4 秒后「已校对」章自己落下（`prefers-reduced-motion` 时直接给终态）。卡上没有按钮——校对这一步的真实操作在应用里，页面只演示「改完的样子」。

## 事实边界

只写仓库里能核对的内容。改动前先回 `../README.md` 顶部表格确认：

- 版本 v0.1.0，Windows x64 与 Android 8.0+；安装包以 GitHub Releases 实际标注为准，仓库不放构建产物。
- 离线可做：录入、整理、校对、组卷、导出、备份。需要自备接口：图片与 PDF 识别、AI 解题（会产生服务费）。
- 手机联动只走同一局域网，配对凭证 15 分钟有效，一次一台手机，没有账户云同步与后台自动同步。
- 界面示意中的题目取自应用内置示例，不声称是已发布截图。
- 不写用户数、效率提升、识别准确率等未经验证的数字。

## 改哪里

- 颜色、间距、圆角、动效时长：`styles.css` 顶部 `:root`。
- 文案：`index.html`，各区块有注释分隔。
- 首屏校对演示的初始文案与状态：`main.js` 里的 `renderProof()`。
