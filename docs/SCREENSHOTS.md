# 截图采集指引

> 用于采集 README 首页截图墙的素材。采集后放进 `docs/screenshots/`，到 README 里取消注释并替换文件名即可。

## 准备

1. 微信开发者工具打开项目，模拟器选 **iPhone 14 Pro** 或类似尺寸（390×844 逻辑像素，主流全面屏）
2. **先录入至少 6-8 条成就数据**（不同分类、不同评分、带金句和地点），让截图有内容、不显空
3. 模拟器右上角截图按钮（或快捷键），保存 PNG
4. 命名严格按下表，README 的引用才能对得上

## 采集清单（6 张核心）

| 文件名 | 页面路径 | 操作 | 想呈现什么 |
|---|---|---|---|
| `report-edit.png` | `pages/report-edit/` | 打开一份已生成的报告，停在有多段富文本的卡片，最好开了一个段的自由布局 | PPT 化编辑器 + 段落自由布局（核心卖点）|
| `wrapped.png` | `pages/wrapped/` | 进年度回顾，停在「人格」或「稀有度」那一幕 | Wrapped 风叙事回顾（差异化亮点）|
| `tree.png` | `pages/tree/` | 养成树页面，数据 ≥6 时 | 可视化回顾之一 |
| `graph.png` | `pages/graph/` | 关系图谱页面，数据 ≥6 时 | 可视化回顾之二（同心环）|
| `achievements.png` | `pages/list/` | 成就墙，切到 gallery 视图 | 成就系统的视觉呈现 |
| `checkin.png` | `pages/checkin/` | 打卡页，有连胜记录时 | 习惯养成 |

## 可选加分截图

| 文件名 | 页面 | 说明 |
|---|---|---|
| `poster-export.png` | `pages/poster/` | 导出页，展示长图海报效果 |
| `quotes-wall.png` | `pages/quotes/` | 金句墙 |
| `medals.png` | `pages/medals/` | 勋章墙 |
| `home.png` | `pages/index/` | 首页（三环 + 成就墙入口）|

## 截图后处理

- **统一尺寸**：用任意图片工具裁成相同宽（建议 1080px 宽，保持设备比例）
- **不要带状态栏**：微信开发者工具截图默认不带，真机截图记得裁掉顶部状态栏
- **文件别太大**：单张控制在 300KB 以内（GitHub 渲染快），可用 png 压缩工具过一遍
- **命名小写连字符**：`report-edit.png` 不是 `ReportEdit.png` 或 `report_edit.png`

## 放进 README

采集完，打开 `README.md`，找到 `<!-- 截图墙模板` 那段注释，取消注释并替换文件名。模板已经写好 HTML `<table>` 布局，2 列 × 3 行，每张图下方有中文标题。

## 想偷懒的话

如果只想先填两张撑场面，优先 `report-edit.png` 和 `wrapped.png`——这两张最能传达「这个应用和普通读书打卡有什么不同」。
