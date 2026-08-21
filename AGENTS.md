# AGENTS.md — 给 AI 编程助手的开发约定

> **这个文件会被 AI 编程助手自动读取。** 每次开工前请先读本文件，遵守这里的约定。
> 这是项目最新决策来源，与 `README.md` 互补。

---

## 项目身份

- **产品**：**文学化读书报告生成器**（小程序）——记录读过的书，生成可编辑、可分享的叙事式读书报告
- **平台**：微信小程序（个人主体）
- **语言**：TypeScript（strict + noUnusedLocals + noUnusedParameters）
- **样式**：LESS（编译为 WXSS；写 `.less` 文件）
- **渲染引擎**：WebView（已关闭 Skyline，求稳）
- **导航栏**：自定义（保留 `components/navigation-bar/` WeUI 组件，不要重写）
- **目标**：做出一个能跑通"开发→审核→上线→有陌生人用"完整链路的小程序

---

## 实际目录结构（已对照真实项目，2026-08 更新）

```
D:\code\vibecoding\3\
├── AGENTS.md               本文件
├── README.md               项目文档
└── app\                    微信开发者工具项目
    ├── tsconfig.json        TS 严格配置
    ├── typings\index.d.ts   全局类型声明（含 CanvasRenderingContext2D 最小桩）
    └── miniprogram\
        ├── app.ts/json/less
        ├── components\navigation-bar\
        ├── pages\                   （23 个页面，全部在 app.json 注册）
        │   ├── index\           首页（成就墙 + 三环 + 各入口枢纽）
        │   ├── list\            成就墙（年份/分类/状态筛选 + 视图切换 list/grid/gallery）
        │   ├── edit\            录入/编辑成就（含 tags/progress/图片/金句/短评 Prompt）
        │   ├── stats\           数据回顾页（洞察 + 图谱入口）
        │   ├── profile\         个人陈列柜（复用 pinnedAchievements，只读）
        │   ├── author\          作者聚合页（calcAuthorStats）
        │   ├── graph\           关系图谱（canvas 静态同心环图）
        │   ├── wrapped\         年度回顾（Spotify Wrapped 风，五幕）
        │   ├── report\          报告组装器（★ P5 顶部 Tab：从记录生成 / 从文案导入）
        │   ├── report-edit\     报告编辑器（segments 富文本段落；★ P6 卡片拖拽排序 + 段拖拽 + 段点选编辑 + 缩略图导航）
        │   ├── reports\         报告历史列表
        │   ├── poster\          导出页（长图/单张 + 存相册；★ P6 长图导出前 splitOverflowCards 拆超长卡）
        │   ├── templates\       模板管理
        │   ├── template-edit\   模板编辑器
        │   ├── wishlist\        许愿星
        │   ├── inspiration\     灵感抽屉（带搜索 + 日期筛选）
        │   ├── checkin\         每日打卡（v7 多分类 + Habit Score + 保护券 + ★ P4 频率目标/总记录卡/升级入口；★ P7 refresh 合并保护日期算连胜）
        │   ├── search\          跨实体搜索（成就/愿望/灵感/打卡）
        │   ├── on-this-day\     往年今日
        │   ├── trash\           回收站（软删除 + 30 天清理）
        │   ├── settings\        设置（主题/字体/勋章/目标/备份）
        │   ├── about\ / privacy\
        └── utils\                     （25 个工具模块）
            ├── storage.ts           数据层（成就/愿望/灵感/打卡 CRUD + 迁移 v1~v7）
            ├── backup.ts            数据备份/恢复（JSON 导出导入，schema 版本校验）
            ├── trash.ts             回收站（软删除 + 30 天自动清理）
            ├── stats.ts             统计算法（overview/streak/genre/author/quotes/keywords）
            ├── insights.ts          自动元数据洞察（基于 createdAt，零字段改动）
            ├── personality.ts       读者人格（8 类，4 维度，纯算法无 AI）
            ├── wrapped.ts           年度回顾聚合（五幕 WrappedData）
            ├── on-this-day.ts       往年今日聚合（四类实体）
            ├── streak-protection.ts 连胜保护（发券 + ★ P7 手动用券消耗 + 衰减 Habit Score；useFreebie/mergeProtectedDates/getStreakStatus/buildStreakStatuses）
            ├── checkin-goal.ts      ★ P4 打卡频率目标（CheckinGoal + calcPeriodProgress 完成率 + calcLifetimeStats 首末次/总次）；连胜口径不动
            ├── medal-config.ts      勋章定义（系统 + 连胜 + 限量 + 动态分类）
            ├── note-prompts.ts      短评引导 Prompt（15 条 + 随机抽取）
            ├── search.ts            跨实体全文搜索（纯函数）
            ├── template-engine.ts   模板引擎（fillPlaceholders + extractVars + generateReport；★ P5/P6 条件块 `{?var}` + 循环块 `{#list}`）
            ├── built-in-templates.ts 内置模板（8 套；★ P6 引用/旅程卡改用循环块，有几条渲染几条）
            ├── poster.ts            卡片 canvas 绘制（drawCard + 富文本段落 + 纹理 + 长图拼接；★ P6 splitOverflowCards 超长拆卡；★ P9 drawSegments 加 rotate/skew transform 包裹 + ctx.letterSpacing + fontFamilyToCanvasFont）
            ├── report-import.ts     ★ P5 报告文案导入 + 粗排启发式（parseImportedText：按空行切卡 + 类型推断）
            ├── achievement-presets.ts 成就图片预设（8 张程序化 canvas 抽象图，含 draw 函数）
            ├── image-store.ts       成就图片持久化（临时图 → savedFilePath）
            ├── design-tokens.ts     设计令牌（颜色/字号/卡片样式/艺术字/主题/背景）
            ├── theme.ts             主题接线工具（buildThemeClasses + buildNavColors）
            ├── preferences.ts       用户偏好持久化（主题/字体/pinned/listViewMode/自定义分类）
            ├── category-meta.ts     成就分类元数据（预设标签/图标/配色 + 自定义派色）
            ├── checkin-presets.ts   打卡分类预设（6 预设 + 自定义合并）
            ├── inspiration-presets.ts 灵感分类预设（独立词表）
            ├── tag-presets.ts       情绪与五感标签预设（EMOTION_TAGS 12 词 + MOOD_OPTIONS 10 词单选）
            ├── wrapped-poster.ts    ★ P3 Wrapped 海报导出（wrappedToReport：五幕 → 五张卡片）
            ├── reading-guide.ts     ★ P3 共读问题模板（按分类/心境动态选问题）
            └── util.ts              通用函数
```

> **字段/页面新增纪律**：新增 utils 必须在文件头写职责注释；新增页面必须在 `app.json` 的 `pages` 数组注册，且复用 `navigation-bar` 组件。

---

## 核心数据模型（2026-08 更新，已对照 storage.ts 实际代码）

> **纪律**：字段名严格按下表，不要加同义字段。新增字段必须同步更新本块 + 相关聚合函数 + 消费页面。

```typescript
// utils/storage.ts 定义并导出

export type ItemType = 'book' | 'film'  // 保留兼容老数据；新数据固定 'book'

export type ItemStatus = 'reading' | 'done' | 'abandoned'  // 三态状态机

export type AchievementTier = 'bronze' | 'silver' | 'gold'  // 预留（当前未启用）

export interface AchievementProgress { current: number; target: number }  // 已启用

export type AchievementImageType = 'none' | 'preset' | 'custom' | 'builtin'

export interface Item {
  id: string
  type: ItemType                 // 保留兼容老数据；新数据默认 'book'
  category?: string              // 成就分类（reading/film/skill/game/travel/exam/first/自定义）—— 成就系统主轴字段；老数据迁移补默认值
  title: string
  author: string
  genre: string
  rating: number                 // 0.5 - 5，步进 0.5
  finishedDate: string           // 'YYYY-MM-DD'；语义随 status 变（done=完成日 / reading=加入日 / abandoned=搁置日）
  note: string                   // 短评（≤200 字）
  coverColor: string
  createdAt: number
  // === R1 字段（可选）===
  readingPlace?: string          // 阅读地点
  readingContext?: string        // 情境心境
  understanding?: string         // 对书的理解（长文，≤1000 字）
  quotes?: string[]              // 金句摘录（多条，纯字符串数组）
  startDate?: string             // 开读日期（可选，当前未广泛使用）
  status?: ItemStatus            // 三态：缺省视为 'done'
  // === 成就系统字段 ===
  tier?: AchievementTier         // 预留未启用（铜银金稀有度）
  progress?: AchievementProgress // 已启用：进度型成就 current/target（edit 页可录入，index 页展示进度）
  tags?: string[]                // 已启用：自由标签（EMOTION_TAGS 情绪 + 五感词 + 自定义）；edit 页完整 CRUD
  milestone?: boolean            // 预留未启用（里程碑/元成就标记）
  // === 成就图片（v5，已启用）===
  image?: string                 // 预设 id（'achv-watercolor-sunset'）/ 包内路径 / savedFilePath
  imageType?: AchievementImageType
  // === 愿望关联（v6，已启用）===
  wishId?: string                // 本成就由哪条愿望转化而来（与 Wish.achievementId 双向关联）
  // === 本次重构新增（v8，可选）===
  mood?: string                  // 瞬时心境单选（与 tags 多选持久属性语义分离；MOOD_OPTIONS 候选词）
  quoteNotes?: { [quoteText: string]: string }  // 金句上下文（按金句文本索引来源页码/章节/感想）
}

// === 愿望清单（独立存储 key: wishlist，不进 book_film_data）===
export interface Wish {
  id: string
  title: string                  // 想读/想做的事物名（必填）
  category?: string              // 期望分类
  author?: string                // 期望作者/品牌
  genre?: string                 // 期望类型
  note?: string                  // 动机备注
  tags?: string[]                // 标签（沿用 Item.tags 词表）
  coverColor: string
  createdAt: number
  achievementId?: string         // 已转化成的成就 id；非空表示该愿望已完成
}

// === 灵感记录（独立存储 key: inspirations）===
export interface Inspiration {
  id: string
  content: string                // 灵感正文（必填，≤500 字）
  category: string               // inspiration-presets 的预设 id
  createdAt: number
}

// === 每日打卡（独立存储 key: checkins；v7 起 (date,category) 复合唯一）===
export interface Checkin {
  id: string
  date: string                   // 'YYYY-MM-DD'（与 category 共同唯一；同一天可多条不同分类）
  category: string               // checkin-presets 的预设 id 或自定义 id
  note?: string                  // 可选一句话（≤100 字）
  createdAt: number
}

// === 报告卡片富文本（段落级）===
export interface TextSegment {
  text: string                   // 段落正文（按 \n 切段后的单元）
  style?: SegmentStyle            // 段落级样式（字号/颜色/对齐/艺术字/旋转/倾斜/字体档/字间距，见 design-tokens.ts）
  image?: string                 // 正文插图路径（非空表示图片段，text 通常为空）
}

// SegmentStyle（在 design-tokens.ts 定义）新增 P9 四字段（均可选，缺省回退，老报告零迁移）：
//   rotate?: number              // 旋转角度（度，-180~180；正=顺时针；0/不填=不转）
//   skew?: number                // 倾斜变形角度（度，-45~45；skewX 平行四边形错切；0/不填=不倾斜）
//   fontFamily?: 'sans'|'serif'|'kai'|'mono'  // 字体档；kai 楷体依赖设备系统字体，不同机型渲染可能不完全一致
//   letterSpacing?: number       // 字间距倍数（0.6~2.0；1=正常；仅视觉间距不强制换行）
// 沿用既有 dual-render 模式：WXSS 内联 transform/font-family/letter-spacing ↔ canvas ctx.rotate/transform skew/ctx.letterSpacing
// ★ P10 新增三字段（均可选，缺省=流式堆叠不改老报告；归一化小数坐标 0~1，相对卡片正文区）：
//   boxX?: number                // 段落盒水平位置（0=最左 1=最右；不填=流式堆叠）
//   boxY?: number                // 段落盒垂直位置（0=最上 1=最下；不填=流式堆叠）
//   boxW?: number                // 段落盒宽度（0~1；不填=撑满内容区；高度始终跟内容走不裁字）
// 任一非缺省即该段进入「自由定位」模式：从流式栈抽出独立绝对定位，用户可在卡片预览区直接拖位置 / 拖右下角手柄改宽。
// 坐标存小数（非 rpx/px）规避预览 1:1 与导出 3:4 比例不一致——两边各自乘以自己的正文区尺寸，所见即所得。

export type CardType =
  | 'cover' | 'overview' | 'footprint' | 'favorite'
  | 'theme' | 'quote' | 'journey' | 'ending'

export interface ReportCard {
  type: CardType
  title: string
  content: string                // 卡片正文（占位符代入后的最终文案；用户可改）
  bookRef?: string               // 关联的书 id
  style?: CardStyle              // 卡片级样式覆盖（优先级最高；见 design-tokens.ts）
  segments?: TextSegment[]       // 段落级富文本：存在则渲染按段（每段独立样式），否则回落 content
}

export interface ReportInstance {
  id: string
  title: string
  templateId: string
  bookIds: string[]
  cards: ReportCard[]
  createdAt: number
  updatedAt: number
  exportedAt?: number            // 最近一次导出时间
  globalStyle?: CardStyle        // 报告级全局样式（所有卡片继承；优先级低于卡片自身 style）
}

export interface TemplateCardDef {
  type: CardType
  titleTemplate: string          // 含 {变量} 占位符
  contentTemplate: string
  style?: CardStyle              // 模板级样式预设（优先级最低）
}

export interface ReportTemplate {
  id: string
  name: string
  description: string
  isBuiltIn: boolean             // 内置不可删
  cards: TemplateCardDef[]
}
```

**存储键**：
- `book_film_data`（成就 Item，按年份组织 Record<number, Item[]>）
- `wishlist`（愿望）/ `inspirations`（灵感）/ `checkins`（打卡）
- `report_instances`（报告）/ `report_templates`（模板）
- `app_preferences`（用户偏好：主题/字体/pinned/listViewMode/自定义分类/`checkinGoals` 打卡频率目标/`disabledCheckinCategories` 隐藏的打卡分类/`streakFreebies` 保护券库存/`protectedCheckinDates` 保护券虚拟填上的打卡日期 等）
- `schema_version`（迁移版本，当前 v7；本次重构将升至 v8）
- 回收站软删除项随各实体一起存（trash.ts 管理 30 天清理）

**纪律**：
- 所有页面读写数据都走 `utils/storage.ts` 的封装函数
- 字段名严格按上面，不要加同义字段
- 数据迁移走 `schema_version` 机制（`migrateIfNeeded`），不要破坏老数据
- **三态状态机的读取层过滤约定**：
  - `loadAchievements*`（`loadAllAchievements` / `loadAchievementsByYear`）只返回 `status==='done'` 的 Item —— 给所有聚合器用（stats/wrapped/personality/连胜/勋章/目标计数/热力图）。
  - `loadItems*`（`loadAllItems` / `loadItemsByYear` / `loadByYear`）返回全量（含在读/搁置）—— 给列表页状态筛选、搜索用（用户需要看到/搜到非完成态的书）。
  - 写聚合代码时默认用 `loadAchievements*`；只有当确实要展示非完成态（list 页、search）才用 `loadItems*`。
  - **本约定已有自动守护**：`app/test/lint-aggregator-inputs.js` 静态扫描所有 utils 聚合器（stats/personality/wrapped/insights/medal-config/on-this-day/...），发现 `loadAllItems` / `loadItemsByYear` / `loadByYear` / `loadByCategoryAndYear` 的调用或 import 即报错退出。豁免：行尾加 `// lint-aggregator-inputs: allow`。跑法：`cd app && npm run lint:agg`（或 `npm run lint` 一次跑两条 lint）。详见下文「构建期 lint」段。
- **聚合层与各模块的约定**（详见各 utils 文件头注释）：
  - `utils/note-prompts.ts`：短评引导 Prompt 列表 + `pickRandom<T>` 随机抽取 + `pickContextualNotePrompt(opts)`（★ P3 按心境 > 分类 > 通用 三级优先选）；录入页 onLoad 随机抽一条，点 ✨ 换一条，用户可无视。
  - `utils/insights.ts`：自动元数据洞察，**零字段改动**——直接从 `Item.createdAt` 推导时段/星期（深夜阅读/最活跃星期/夜猫子认证 等），数据量 <5 不出洞察。★ P3 加心境洞察（主导心境占比 ≥40% + 心境×深夜交叉）。
  - `utils/medal-config.ts`：`SystemMedal` 可选 `limitedEdition` + `unlockWindow`（'MM-DD' 格式，支持跨年窗口）；`isInUnlockWindow(now, window)` 判断；`category='__any__'` 表示对任意成就计数（限量勋章专用）。★ P3：`buildMedalRows(prefs, achievements, checkinDates, checkins)` + `loadMedalRows()` 已提取为本文件单一真相源（index/settings/medals 页共享），`MedalView` 接口在此导出。`buildMedalRows` 对限量勋章在窗口外不解锁但仍显示进度。
  - `utils/checkin-goal.ts`（★ P4）：打卡频率目标与完成率，**连胜口径不动**（`calcCurrentStreakLenient` 仍按「连续多少天有打卡记录」）。导出 `CheckinGoal { frequency: 'daily'|'weekly'|'monthly'; timesPerPeriod }`、`getGoalForCategory(catId, prefs)`、`calcPeriodProgress(goal, allCheckins, category, now)` 返回 `{ periodLabel, planned, actual, rate, isComplete, progressText }`（计划数按已过天数等比缩放，避免月初/周初就显示 0/N）、`calcLifetimeStats(allCheckins, category)` 返回 `{ firstDate, lastDate, total, totalDays }`（给「总记录」卡 + 升级入口用）。单独建文件不进 stats.ts 以免触 lint:agg。目标存偏好 `checkinGoals`；隐藏分类存偏好 `disabledCheckinCategories`（`getAllCheckinCategories(custom, disabled)` 过滤）。
  - `utils/streak-protection.ts`（★ P7）：连胜保护券**手动消耗**。原来「只发不消耗」（`refreshFreebies` 每月发 1 张上限 3 张，但从未有扣券路径）。新增导出：`useFreebie(scope, brokenDate): boolean`（唯一减券函数；幂等：同 scope 同 date 重复返回 false 不扣；券>0 + 保护开 + 未保护过才成功，成功则 `streakFreebies -1` + `protectedCheckinDates` push 一条）、`mergeProtectedDates(realDates, scope): string[]`（保护开时把该 scope 的保护日期合并进真实 dates 去重，给 `calcCurrentStreakLenient` 用；保护关返回原数组）、`getStreakStatus(scope, realDates, label): StreakStatus`（返回 `{ scope, label, streak, isBroken, brokenDate, canProtect, hasProtected, protectedStreak }`；断了 = 保住前的真实口径 streak===0）、`buildStreakStatuses(allCheckins, categories): StreakStatus[]`（全局 + 各分类状态；断了且能保护的排在前；从未打卡的分类不显示）。`GLOBAL_SCOPE='__global__'`。**关键设计**：连胜是纯计算（`calcCurrentStreakLenient` 不存盘、对券零感知），所以保住连胜 = 把断档日虚拟填进 `protectedCheckinDates`，**算连胜前合并**（在 `calcCurrentStreakLenient` 的「昨天也没→返回 0」早退之前合并），算法函数本身零改动。**只合并进 `calcCurrentStreakLenient`**，不合并进 `calcLongestStreak`/`totalDays`（券只保护当前连胜，不计入历史最长/总天数——Duolingo 语义）。券池全局共享（`streakFreebies`），全局连胜和分类连胜从同一池扣，由 scope 区分保护记录。手动触发（设置页详情 sheet），不做自动弹窗。
  - `utils/stats.ts`：`calcAuthorStats(items)` / `calcSingleAuthor(items, author)` 按 `author` 聚合（count + avgRating + 作品按完成日降序），给作者聚合页用。作者区分大小写、不做 normalize。`calcQuotes(items)` 返回 `QuoteEntry[]`（纯文本聚合；上下文走并行字段 `Item.quoteNotes`，不在本函数）。`calcAnnualKeywords(items)` 用分类气质词 + **Item.tags 加权（P3 已修）** + 评注切词三段。★ P3：`calcMoodStats(items)` 返回 `MoodStat[]`（心境频次+占比）+ `topMood(items)` 取主导心境。
  - `utils/personality.ts`：8 类人格（deep-reader/speed-reader/cross-bound/rewatcher/note-fanatic/explorer/focused/observer），4 维度（depth/breadth/speed/rewatch），纯算法无 AI。`analyzePersonality(items)` 串行短路分类。★ P3：`PERSONALITY_META` 加 `emotionalCopy` 文学化情感文案字段（给 Wrapped 第三幕 + 报告人格卡用）。
  - `utils/wrapped.ts`：`loadWrapped(year)` → `WrappedData`（五幕：opening/topLists/personality/rarity/summary）。★ P3：`ActSummary` 加 `topMood` + `moodStats`（年度心境分布）。`buildRarity` 纯本地稀有度模拟。当前年份仅在 12 月解锁，历史年份始终可看。
  - `utils/achievement-presets.ts`：8 张程序化 canvas 抽象图（水彩/几何/纸纹/星辉）。**注意：当前只用了 `cssPreview`（CSS 近似预览），8 个 `draw` 函数是悬空的现成 canvas 资产，尚未接入任何 canvas 节点**——本次重构养成树将首次接入。
  - `pages/author/author`：作者聚合页，从 list 页点击作者 chip 进入（`?author=URL编码`），纯只读展示。
  - `pages/index/index` Hero 下方三色同心环：`rings = { checkin, newAchv, wroteNote, allDone }`，三环全亮显示祝贺文案；样式走嵌套 view + 边框色切换（不用 canvas/SVG）。主行动区 4 按钮：继续记录（primary）/ 生成报告（`onTapReport` → records 流程）/ ★ P7 文案海报（`onTapPosterFromText` → `/pages/report/report?mode=import` 直达文案导入标签）/ 我的报告。
  - `pages/profile/profile`（个人陈列柜）：**直接复用 `preferences.pinnedAchievements`**（与首页成就墙共享数据源），不引入 `profileSlots` 新字段。只读展示页，编辑跳回首页 pin 流程。
  - `pages/list/list` 视图切换：`preferences.listViewMode: 'list' | 'grid' | 'gallery'`；切换控件在筛选条下方 segmented control；改时写回偏好。ItemView 加 `imageKind` + `presetCss` 供 gallery 渲染封面。
  - `pages/graph/graph`（关系图谱）：**静态同心环布局**（中心=总成就 / 内环=分类 / 外环=作者 Top 12），不做力导向动画。canvas 2D 一次性绘制，复用 poster.ts 的 bootstrap 模式。点击节点走命中检测 + toast。数据 <5 显示空态。
  - `pages/poster/poster`（导出页）：支持报告 id 模式 + wrappedYear 模式。wrappedYear 分支调用 `loadWrappedReport(year)`（来自 wrapped-poster.ts），走与普通报告完全相同的长图拼接 + 存相册流程。★ P6：长图导出（`saveLong`）前调 `splitOverflowCards(report.cards)` 把超长卡（循环块展开后段数 > `SEGMENT_BUDGET_PER_CARD`=6）拆成多张同类型卡，避免 `drawSegments` 的 `curY>=maxH` 截断丢字；封面/落款卡不拆，单张导出（`saveSingle`）不拆。
  - `pages/report/report`（★ P5 报告组装器）：顶部 Tab 切「从记录生成」（原流程）/「从文案导入」（新流程）。导入分支调 `parseImportedText(text, title)`（report-import.ts）按空行切卡 + 类型推断，生成 ReportInstance（`templateId='__import__'`、`bookIds=[]`）后 redirectTo report-edit。纯本地字符串处理，不调 AI（守合规边界）。★ P7：`onLoad` 支持 `?mode=import` 参数，让首页「文案海报」入口直达文案导入标签（默认仍是 records，其它入口不受影响）。
  - `pages/report-edit/report-edit`（★ P6 报告编辑器 PPT 化）：（a）卡片排序——顺序弹层内长按 `≡` 手柄进入拖拽态，`catchtouchmove` 按 clientY 落点实时调 `swapCards`（自动交换，复用既有方法），↑↓ 按钮保留作微调；（b）段排序——段落预览区长按 `≡` 手柄拖动，`swapSegments` 经纯函数 `swapCardSegments` 实现（已抽离可单测）；（c）段点选编辑——点段文本直接弹段样式器（去掉 ✎ 按钮），图片段保留 ✕ 删图；（d）缩略图导航——swiper 下方横向滚动条，点缩略图跳转（复用 `onJumpToCard`），`cardViews[i]` 带 `thumbIcon`/`thumbLabel`/`cardStyleCssBgOnly`。拖拽态字段 `orderDragIndex`/`orderDropIndex`/`segDragIndex`/`segDropIndex`（-1=未拖动）。★ P9 段样式器扩展：段样式弹层加「字体档」（无衬线/衬线/楷体/等宽 chip）/「字间距」（连续 slider 0.6~2.0）/「旋转」（slider -180~180° + 重置）/「倾斜」（slider -45~45° + 重置）4 组控件；段落字号滑块由原 5 档离散改连续（0.6~2.0，步进 0.05）；新状态字段 `editSegRotate`/`editSegSkew`/`editSegFontFamily`/`editSegLetterSpacing`；新 handler `onSegRotateChange`/`onSegSkewChange`/`onResetSegRotate`/`onResetSegSkew`/`onSwitchSegFontFamily`/`onSegLetterSpacingChange`；`buildSegmentViews` 与 `fontFamilyToCss` 已导出供 `test/report-edit-transform` 单测。dual-render 同源纪律见下「SegmentStyle 扩展」。★ P10 自由布局：段样式器加「自由布局」开关（`onToggleSegFreePos`）；开启给该段写默认几何 `{boxX:0.1,boxY:0.1,boxW:0.6}` 进入自由定位模式（从流式栈抽出独立绝对定位）；关闭需专门 `clearSegBoxPos` 显式 `delete` 三字段（`mergeSegmentStyle` 跳过 undefined 不会删）。开启后该段在卡片预览区渲染拖拽手柄：拖本体改位置（`onSegBoxDragStart/Move/End`）、拖右下角手柄改宽（`onSegBoxResizeStart/Move`）。坐标存归一化小数（0~1 相对正文区）规避预览 1:1 与导出 3:4 比例差——两边各自乘以自己的正文区尺寸。高度跟内容走不裁字（不存 height 字段）。新状态字段 `editSegFreePos`/`boxDragSegIndex`/`boxIsResize`/`boxDragOffsetX/Y`/`boxCardRectW/H/L/T`；存盘节奏：拖动中只 `setData` 实时预览（`_freePosUpdatePreview`），`touchend` 才 `applySegmentStylePatch` 一次写盘（避免每帧写存储）。
  - `pages/quotes/quotes`（★ P3 金句墙）：跨年份聚合所有金句，3 种排序（最近/按书/随机洗牌），展示金句上下文（来自 `Item.quoteNotes`）。入口在 stats 页底部 + index 页次要入口。
  - `pages/medals/medals`（★ P3 勋章墙）：集中展示所有勋章（已解锁高亮 + 未解锁带进度），分两组展示。调用 `medal-config.ts` 的 `loadMedalRows()`（与 index/settings 同源）。入口在 stats 页 + index 胶囊条。
  - `pages/tree/tree`（★ P3 养成树）：静态垂直树布局（中心=总成就星辉底 / 分支=分类 / 叶子=具体成就 Top N）。canvas 2D 绘制，复用 graph.ts 的 bootstrap 模式。里程碑成就金环高亮。数据 <5 显示空态。入口在 stats 页底部。
  - `pages/reading-guide/reading-guide`（★ P3 共读引导）：选一本书 → 展示推荐问题（按分类/心境动态选，来自 `reading-guide.ts`）→ 用户回答写进 `Item.understanding`（复用现有字段）。纯本地单用户自问自答，无用户间交互。入口在 edit 页（编辑模式下显示「共读引导」按钮）。
  - `pages/checkin/checkin`（★ P7 连胜接线）：`refresh()` 算连胜前先合并保护日期——全局连胜用 `mergeProtectedDates(realDates, GLOBAL_SCOPE)`、分类连胜用 `mergeProtectedDates(catRealDates, 分类id)`，再传给 `calcCurrentStreakLenient`。`longestStreak`/`totalDays` 仍用真实 dates（不合并保护日期，守 Duolingo 语义）。打卡页本身不显示用券入口（入口在设置页），只让连胜数字自然反映保护结果。
  - `pages/settings/settings`（★ P7 连胜保护详情 sheet）：习惯保护卡片开保护时，卡片下方显示「连胜保护详情」入口行（`protectionEnabled` false 时整行隐藏）。点入弹底部 sheet，列出 `buildStreakStatuses` 返回的全局 + 各分类状态：没断的显示「连续 N 天 ✓」、断了的显示「断了！」+「🛡️ 用券保住」按钮（`onUseFreebie` 接 `data-scope`，调 `useFreebie` 后 `syncFromStorage` 刷新 + toast）。券=0 时按钮灰显「券已用完」。复用通用 sheet 样式（`.sheet-mask`/`.sheet-title`/`.sheet-btn-row`），新增 `.protection-status-row`/`.protection-use-btn` 等少量样式。


---

## 模板引擎约定

`utils/template-engine.ts` 提供：
- `fillPlaceholders(text, vars)` — 三种语法（向后兼容，老模板的单值占位符仍工作）：
  - 单值 `{varName}` — 替换；★ P7 起找不到/空值/数组的占位符**删除**（不留字面 `{varName}`，避免报告出现裸花括号）。模板想让整段连同前缀文案一起消失的，用条件块包裹。
  - ★ P6 条件块 `{?varName}...{/}` — varName 为空/未定义时整块删除；否则渲染块内（块内普通 `{x}` 仍替换）。**不支持同类型嵌套**（`{?a}...{?b}...{/}{/}` 会错配最近的 `{/}`），要并列写 `{?a}...{/}{?b}...{/}`。
  - ★ P6 循环块 `{#listVar}...{field}...{/}` — listVar 是数组变量（命名约定 `__list__<name>`），循环渲染，块内 `{字段}` 取数组元素属性，找不到的字段回落到全局 vars。空数组 → 整块删除（不留字面占位符）。
- `extractVars(books, title, year)` — 从书提取变量，共 20 个单值：
  `reportTitle` `year` `bookCount` `avgRating` `topGenre` `places` `topPlace` `topPlaceCount` `topBook` `topBookNote` `themeGenre` `themeBook` `place1` `book1` `place2` `book2` `quote1` `quoteBook1` `quote2` `quoteBook2`
  + ★ P6 三个数组变量（给循环块用）：`__list__quoteList`（全部金句 `{text, book}`）、`__list__journeyList`（全部带地点的书 `{place, book}`）、`__list__topBooks`（评分降序 `{title, author, note}`）
- `cardHasData(def, vars)` — ★ P7 按卡片类型判断是否有数据支撑。叙事骨架卡（`cover`/`overview`/`theme`/`ending`）永远 `true`；数据增强卡按依赖判断：`footprint` 看 `placeCount > 0`、`quote` 看 `__list__quoteList` 非空、`journey` 看 `__list__journeyList` 非空、`favorite` 看 `topBook` 或 `milestone1` 非空。纯消费 `extractVars` 已有变量，不新增变量。
- `generateReport(template, books, title, year)` — 生成 ReportInstance；★ P7 起先用 `cardHasData` **过滤掉缺数据的卡**（无地点的足迹卡、无金句的金句卡、无旅程的旅程卡、无年度之书/里程碑的年度卡都不生成），报告按真实记录伸缩。跳过的卡用户仍可在 report-edit 里用 `onAddCardByType` 手动加回。

**纪律**：模板文案只能用上面 20+3 个变量；新增变量要同步更新 `extractVars` 和 `built-in-templates`。循环块生成的卡可能段数很多，导出时由 `poster.ts` 的 `splitOverflowCards` 自动拆卡（见下）。

---

## 设计令牌（配色/字号统一来源）

```typescript
// utils/design-tokens.ts
color: {
  bg: '#FAF6F0', card: '#FFFFFF',
  textPrimary: '#3D3530', textSecondary: '#8B7D6E',
  accent: '#D97A4A', book: '#6B8E5A', film: '#8B6F9C',
  star: '#E8A33D', divider: '#E8E0D5',
}
coverPalette: ['#D97A4A', '#6B8E5A', '#8B6F9C', '#5B8FA8', '#C26B6B', '#A88B5C']
```

LESS 变量映射在 `app.less` 顶部（`@color-bg` / `@color-accent` 等）。

**纪律**：不要硬编码 hex；改配色只改 `design-tokens.ts` 和 `app.less`。

### LESS 颜色函数硬纪律（重要！）

`app.less` 顶部所有 `@color-*` LESS 变量都是 **CSS 变量别名**（`@color-accent: var(--color-accent)`），目的是让主题切换在运行时跟随。这带来一条强制纪律：

- ❌ **禁用 LESS 编译期颜色函数**：`fade()` / `lighten()` / `darken()` / `spin()` / `mix()` / `saturate()` 等。它们在编译期运行，拿到 `var(--color-accent)` 解析不出颜色，会抛 `Argument cannot be evaluated to a color` 运行时错误（真机白屏）。2026-08 已因此 bug 改过一轮（reading-guide/edit/medals 的 5 处 `fade()`）。
- ✅ **透明色叠加用 `color-mix`**：`color-mix(in srgb, @color-accent 10%, transparent)` 在运行时解析 CSS 变量，主题切换自动跟随。项目里 ~15 处都在用，是唯一正确惯用法。
- ✅ **次要例外**：`filter: saturate(1.2)` 这种纯滤镜无颜色变量参，可用。

### Canvas 页面的字面色（走 canvasColors 单一真相源）

Canvas 无法读 CSS 变量，只能用字面 hex。2026-08 已把 canvas 页的字面色统一接入 `design-tokens.ts` 的 **`canvasColors`** 导出（nav/pageFill/starGold/categoryPalette/authorPalette 等）。改主题色时**只改 `design-tokens.ts` 一处**，所有 canvas 页自动跟随——不再需要手动同步多个文件。canvasColors 与 app.less 的 CSS 变量保持同源（都是字面 hex，手动对齐）。

**双主题（light/dark）**：`design-tokens.ts` 同时导出 `canvasColorsDark`（暗色版配色）+ `getCanvasColors(theme)` 选择器。有 canvas 绘制的页（tree/graph）在 `refresh()` 开头调一次 `getCanvasColors(resolveTheme(themeMode))` 存进 `_colors` 实例字段，绘制时读 `this._colors.X`。这样切主题回到本页时（onShow → refresh）canvas 自动换色，与 CSS 主题切换一致。无 canvas 的页（如 wrapped，用 WXML 渐变）不需此机制。

### 构建期 lint（防御回归）

项目有三条构建期 lint，都用 Node 直跑、零依赖，提审前必跑（一起跑：`npm run lint`）：

1. **`app/test/lint-less.js`** ——LESS 颜色函数 lint。扫所有 .less 文件，发现 `fade()`/`lighten()`/`mix()` 等 LESS 编译期颜色函数调用即报错退出（仅豁免 `filter: saturate()` 这种 CSS 原生滤镜）。防御 2026-08 的 fade() 真机白屏 bug。

   ```bash
   cd app && npm run lint:less     # 或直接 node test/lint-less.js
   ```

   改任何 .less 文件后建议跑一遍。

2. **`app/test/lint-aggregator-inputs.js`** —— 聚合器数据源 lint。扫所有 utils 聚合器（stats/personality/wrapped/insights/medal-config/on-this-day/category-meta/design-tokens/template-engine/note-prompts），发现对 `loadAllItems` / `loadItemsByYear` / `loadByYear` / `loadByCategoryAndYear` 的调用或 import 即报错退出。防御「聚合器误吃在读/搁置态 Item 导致年度计数/金句/人格失真」类 bug（见上文「三态状态机的读取层过滤约定」）。

   ```bash
   cd app && npm run lint:agg      # 或直接 node test/lint-aggregator-inputs.js
   ```

   改任何 utils 聚合器后建议跑一遍。豁免出口：行尾加 `// lint-aggregator-inputs: allow`（目前无豁免点）。

3. **`app/test/lint-wxml-handlers.js`** —— WXML 事件处理器绑定 lint（★ P6）。扫所有页面的 `.wxml`，抽出全部 `bind*`/`catch*`/`mut-bind*` 的处理器名，到同目录同名 `.ts` 里找定义；任一找不到即报错退出。防御「wxml 写 `bindtap="onFoo"` 但 ts 没有该方法」的真机静默失效（平台不报错、tsc 看不到 wxml 字符串）。改任何页面交互（加按钮/手势/输入框）后建议跑一遍。

   ```bash
   cd app && npm run lint:wxml     # 或直接 node test/lint-wxml-handlers.js
   ```

   豁免：跨页面复用组件自带事件（navigation-bar 的 `onBack`）在 `SKIP_HANDLERS` 显式排除；动态绑定 `{{cond?'a':'b'}}` 自动跳过（项目目前无此用法）；文件级豁免在该 .wxml 行尾加 `// lint-wxml-handlers: allow`（目前无豁免文件）。

```bash
cd app && npm run lint            # 一次跑上面三条
```

三条 lint 都设计成「白名单 + 误报豁免」：禁单是显式枚举的，不会误伤正当场景；豁免注释提供逃生口，便于未来确有正当需求时局部放开。

---

## 自定义导航栏使用约定

每个页面 `.json` 注册组件，`.wxml` 顶部引入：
```xml
<navigation-bar title="页面标题" back="{{true}}" color="#3D3530" background="#FAF6F0" bindback="onBack"></navigation-bar>
```
不要重写该组件。

---

## 合规边界（绝对不可破）

✅ 允许：用户自己录入数据存本地；用户自己生成报告保存相册（点对点分享）；统计用户自己的数据。

❌ 禁止：用户间互相看到数据；书籍资源播放/下载；**调用 AI 大模型生成文案**（触发"深度合成"类目）；抓取豆瓣等平台数据；任何电商/付费/广告。

**判断原则**：所有文案靠模板拼装 + 用户手填，不调用任何外部 AI 服务。

---

## 平台 API 白名单

| 用途 | API |
|---|---|
| 本地存储 | `wx.setStorageSync` / `wx.getStorageSync`（走 storage.ts） |
| Canvas | `<canvas type="2d">` + `wx.createSelectorQuery` |
| 保存相册 | `wx.canvasToTempFilePath` → `wx.saveImageToPhotosAlbum` |
| 日期选择 | `<picker mode="date">` |
| 反馈 | `wx.showToast` / `wx.showModal` |
| 设备信息 | `wx.getWindowInfo`（fallback `wx.getSystemInfoSync`）取 dpr |
| 分享 | `onShareAppMessage` + `button open-type="share"`（点对点） |

**不要用**：云开发、登录、用户信息、支付、订阅消息。

---

## Canvas 绘制硬纪律

1. 必须用 canvas 2D 模式：`<canvas type="2d">`
2. 绘制前等节点就绪：`query.select('#id').fields({ node: true, size: true }).exec(...)`
3. **dpr 必须处理**：`canvas.width = cssW * dpr` + `ctx.scale(dpr, dpr)`
4. 卡片绘制统一走 `utils/poster.ts` 的 `drawCard(ctx, w, h, card)`
5. 长图拼接：用一个隐藏 offCanvas，高度 = 单卡高 × N，循环 drawCard + clip 隔离每张
6. 全局类型声明在 `typings/index.d.ts`（`CanvasRenderingContext2D` 最小桩 + Canvas.getContext 签名；★ P9 加 `letterSpacing` 属性 + `transform(a,b,c,d,e,f)` 方法声明）
7. **★ P9 段落级 transform dual-render 纪律**：`SegmentStyle` 的 rotate/skew/fontFamily/letterSpacing 任一新效果，WXSS 预览侧（`buildSegmentViews` 产 `transformCss`/`fontFamilyCss`/`letterSpacingCss`，wxml 内联 style 拼）与 canvas 导出侧（`drawSegments` 用 `ctx.save/translate/rotate/transform skew/restore` 包裹 + `ctx.letterSpacing` + `fontFamilyToCanvasFont` 选 font）必须**同源实现**，否则预览与导出不一致。新增段落视觉效果时两边都要改，并加 `test/report-edit-transform` 断言。
8. **★ P10 自由定位 dual-render + 不拆纪律**：`SegmentStyle` 的 boxX/boxY/boxW（归一化小数 0~1）任一非缺省即该段进入自由定位模式：
   - **WXSS 侧**：`buildSegmentViews` 产 `boxCss`（`position:absolute;left/top/width 百分比`）+ `isFreePositioned` 标志，wxml 三处段落渲染（封面/落款/通用）按标志分支：自由段渲染拖拽手柄（`onSegBoxDragStart/Move/End` 拖位置、`onSegBoxResizeStart/Move` 拖右下角改宽），流式段走原渲染零变化。段样式器有「自由布局」开关（`onToggleSegFreePos`；关需专门 `clearSegBoxPos` 显式 `delete` 三字段——`mergeSegmentStyle` 跳过 undefined 不会删）。
   - **canvas 导出侧**：`drawSegments` 对自由定位段走绝对路径（`boxLeft=x+boxX*maxW, boxTop=y+boxY*maxH, boxWidth=boxW*maxW`，`ctx.rect().clip()` 裁盒，不参与 curY 堆叠），与流式段共用抽出的 `drawSegmentTextBlock`（含 P9 transform 包裹）。`measureTotalHeight` 排除自由定位段（不参与栈高）。
   - **坐标用小数不用 rpx/px**：规避预览 1:1 与导出 3:4 比例不一致——两边各自乘以自己的正文区尺寸。
   - **有自由定位段的卡不进 splitOverflowCards**（`splitCardIfOverflow` 开头判断 `segs.some(s => s.style.boxX !== undefined) → return [card]`）：绝对坐标在拆分卡里会错位，自由布局本质是用户接管排版，不再自动兜底拆卡。

---

## 开发里程碑（R 系列 + P 优化系列 + 重构三梯队）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| R1 | 数据层扩展 + 录入页多字段 + storage CRUD + 迁移 | ✅ |
| R2 | 模板引擎 + 第一套模板 + templates 列表页 | ✅ |
| R3 | 报告组装器 + 报告编辑器 + 首页/列表/录入适配 | ✅ |
| R4 | 导出页（长图/单张）+ 模板编辑器 + 文案收尾 | ✅ |
| P1 | 高 ROI 差异化：年度 Wrapped + 读者人格 + 三态状态机 + 各聚合页 | ✅ |
| P2 | 锦上添花：三环 + 陈列柜 + 短评 Prompt + 作者页 + 节律洞察 + 限量勋章 + 视图切换 + 关系图谱 | ✅ |
| P3-0 | 同步 AGENTS.md 数据模型/目录结构/存储键到代码现状 | ✅ |
| P3-1 | 梯队 1：搜索/关键词质量缺口 + 金句墙 + Wrapped 海报导出管线 + 人格情感文案 + 往年今日增强 | ✅ |
| P3-2 | 梯队 2：schema v8 + Item.mood/quoteNotes + 聚合层吃 mood + 摘抄辅助 + 三段式卡片 + 勋章墙 + Prompt 升级 | ✅ |
| P3-3 | 梯队 3：养成树可视化 + 共读问题模板 | ✅ |
| P4 | 打卡组：频率目标/完成率 + 隐藏式删分类 + 总记录卡 + 升级入口移位 | ✅ |
| P5 | 报告文案导入 + 粗排启发式（report-import.ts + 组装器顶部 Tab） | ✅ |
| P6 | 报告编辑器 PPT 化（卡片拖拽排序 + 段拖拽 + 段点选编辑 + 缩略图导航）+ 模板引擎条件块/循环块 + poster 超长拆卡 | ✅ |
| P7 | 连胜保护券手动使用（preferences 加 protectedCheckinDates；streak-protection 加 useFreebie/mergeProtectedDates/getStreakStatus/buildStreakStatuses；checkin refresh 合并保护日期；设置页连胜保护详情 sheet） | ✅ |
| P8 | 报告生成按真实记录伸缩（fillPlaceholders 找不到的占位符删除不留字面量；generateReport 用 cardHasData 跳过空数据卡——无地点的足迹卡/无金句的金句卡/无旅程的旅程卡/无年度之书的年度卡不生成）；首页加「文案海报」入口直达文案导入（report 页 onLoad 支持 ?mode=import） | ✅ |
| P9 | 报告编辑器 PPT 化段落样式扩展：SegmentStyle 加 rotate/skew/fontFamily/letterSpacing 四字段（可选，缺省回退不改老报告）；段落字号滑块改连续档（0.6~2.0）；段样式器加字体档/字间距/旋转/倾斜 4 组控件；WXSS 预览（transform/font-family/letter-spacing 内联 style）与 canvas 导出（drawSegments 用 ctx.save/translate/rotate/transform skew 包裹 + ctx.letterSpacing）dual-render 同源；楷体/等宽档依赖设备系统字体 | ✅ |
| P10 | 报告编辑器 PPT 化段落自由布局：SegmentStyle 加 boxX/boxY/boxW 三字段（可选，归一化小数 0~1 相对正文区，缺省=流式堆叠不改老报告）；任一非缺省即该段进入自由定位模式从流式栈抽出独立绝对定位；段样式器加「自由布局」开关（onToggleSegFreePos；关需专门 clearSegBoxPos 显式 delete 因 mergeSegmentStyle 跳过 undefined）；开启后卡片预览区该段渲染拖拽手柄——拖本体改位置（onSegBoxDragStart/Move/End）、拖右下角手柄改宽（onSegBoxResizeStart/Move）；高度跟内容走不裁字不存 height；坐标存小数规避预览 1:1 与导出 3:4 比例差；存盘节奏拖动中只 setData 预览 touchend 才一次写盘；canvas drawSegments 加自由定位绝对路径（不参与 curY 堆叠，measureTotalHeight 排除）+ splitCardIfOverflow 跳过有自由段的卡（绝对坐标在拆分卡错位）；test/report-edit-transform 加 5 个 P10 场景 | ✅ |

---

## vibecoding 护栏

1. **数据模型以「核心数据模型」段为准**（Item / Wish / Inspiration / Checkin / ReportCard / ReportInstance / ReportTemplate）；新增字段必须同步更新该段 + 聚合函数 + 消费页面，不改已有字段语义（如不改 `Item.quotes: string[]` 类型）
2. **设计令牌统一来源**，不要硬编码颜色；**LESS 颜色函数纪律**：`@color-*` 是 `var()` 别名，禁用 `fade()`/`lighten()`/`mix()` 等 LESS 编译期函数（会炸），透明叠加只用 `color-mix(in srgb, @x N%, transparent)`——详见「设计令牌」段
3. **合规边界不可破**（无 AI 生成、无用户间数据流通、无豆瓣抓取、无 OCR、无电商付费）
4. **平台 API 只用白名单内**
5. **canvas 严守硬纪律**（dpr、2D、节点就绪）
6. **样式用 LESS**，单位用 rpx
7. **保留复用 `navigation-bar`**，不要重写
8. **类型严格**：tsc 零错误（已知第三方 `lib.wx.app.d.ts` 声明错误除外）
9. **编译目标钉死 ES2019**：`tsconfig.json` 的 `target`/`lib` 必须是 `ES2019`，**不可升到 ES2020+**。原因：微信开发者工具的 `setting.es6=false`（见 `project.config.json`）不做 ES 转译，tsc 直接输出什么真机就跑什么；ES2020 的**可选链 `?.` / 空值合并 `??`** 在旧基础库真机上会抛 `SyntaxError: Unexpected token .`（2026-08 已因此报错一轮，`report-edit.ts` 的 `cardViews[i]?.segmentViews` 触发）。写代码时**不要用 `?.`/`??`**，用 `(x && x.y) || ''` 这类兼容写法。需要取 ES2020 库类型（如 `Array.flat`）时也只动 `lib` 不动 `target`——但本仓目前零依赖 ES2020 库类型。

---

## 与 README 的关系

- `README.md`：项目文档（产品形态、上手、结构、提审清单），给人看
- `AGENTS.md`（本文件）：开发约定（数据模型、纪律、API 白名单），给 AI 看
- 冲突时以本文件为准
