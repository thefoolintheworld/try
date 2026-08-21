# 「阅观年度」小程序优化报告 V2 —— 把每个功能打磨到「独立 App 级」

> 基于 3 轮并行调研（① 当前小程序深度审计 ② 成就/报告系统市调 ③ 生产力 App + GitHub 开源项目市调）综合产出。
> 所有建议遵守当前约束：**个人主体、纯本地存储、无 AI、无社交、无支付、`es6:false`（无 `?.` / `??`）**。
> 与上一版 `OPTIMIZATION_REPORT.md` 并存：V1 解决"算了不用 / 首页过载 / 无备份"等结构性问题；V2 聚焦"每个功能像独立软件一样完善"。

---

## 〇、执行摘要（TL;DR）

当前小程序 **16 个页面 / 8 个功能模块**，整体完成度 **3.4 / 5 星**——骨架完整、范式统一（CRUD 扁平数组 + medal-config + 主题系统），但每个模块都停在"能用"，离"想用"差一层"完成度打磨"。

**最严重的 5 个系统性短板**（来自审计）：
1. **零全局搜索** —— 跨成就/愿望/灵感/打卡无一处可搜
2. **零撤销/重做** —— 删除即消失，本地存储场景下这是伦理级问题
3. **零长按/滑动** —— 微信生态最自然的微交互全部缺失
4. **零分页/虚拟化** —— 1000+ 成就时列表会卡
5. **空/错/载 三态覆盖不全** —— 只有 poster 页勉强有，其它页面"硬编码假设数据存在"

**最高 ROI 的 5 个借鉴功能**（来自市调）：
1. **GitHub 式热力图**（uhabits / GitHub）—— 把全年打卡/成就压成一张图，零 AI 即可实现
2. **On This Day 往年今日**（Day One）—— 几乎零额外数据成本的"情感钩子"
3. **状态机三态**（jelu / Movary：想读-在读-读完 / 想看-在看-看完）—— 把"成就"升级为"读物生命周期"
4. **多视图切换**（Notion：Table / Gallery 封面 / Board 状态列 / Calendar）—— 同一份数据多种看法
5. **年度 Wrapped**（Spotify + WeRead）—— 五幕叙事 + 人格标签 + 竖版海报，是这类 App 的灵魂功能

详见下方"路线图"与"借鉴表"。

---

## 一、三轮调研综合

### A. 现状审计结论（来自子代理 1）

#### 页面完成度评分（1-5 星）

| 页面 | 功能 | 完成度 | 主要短板 |
|---|---|:---:|---|
| `index` | 首页（Hero + 胶囊条 + 成就墙 + 三入口） | 4★ | 胶囊条尚可，但无快捷搜索/快捷录入入口 |
| `edit` | 成就录入 | **5★** | 项目里最完善的页面（字段齐、校验全、支持 wish/checkin 预填） |
| `list` | 成就墙（年份/分类/星级筛选） | 3★ | 无搜索、无排序切换、无批量操作、无长按删除 |
| `stats` | 数据回顾 | 3★ | 9 个统计函数只展示了 3-4 个；无热力图、无雷达图、无人格标签 |
| `report` / `report-edit` | 报告生成 | 4★ | 编辑器完善，但变量插入是"追加"而非"光标处" |
| `poster` | 海报导出 | 4★ | 唯一有完整 三态（载/空/错）的页面 |
| `templates` / `template-edit` | 模板管理 | 3★ | 内置模板少；变量网格扁平、无分组 |
| `wishlist` | 许愿星 | 3★ | CRUD 完整，但无优先级、无预估完成日、无"分解为步骤" |
| `inspiration` | 灵感抽屉 | 3★ | CRUD 完整，但无搜索、无分类筛选、无关联到成就 |
| `checkin` | 每日打卡（本轮新增） | 4★ | 连续天数 + 日历 + 勋章齐全，但日历无跨月导航 |
| `settings` | 设置 | 4★ | 主题/字体/目标/勋章/备份齐全 |
| `about` | 关于 | 2★ | 3 条特性介绍、版本号硬编码、无更新日志 |
| `privacy` | 隐私说明 | 2★ | 文本存在但无交互（无开关、无导出入口） |

#### 功能模块完成度（按"独立 App 级"标准打分）

| 模块 | 当前 | 对标"独立 App"差距 | 优先级 |
|---|:---:|---|:---:|
| 成就录入 | 5★ | 已达标 | — |
| 成就墙 | 3★ | 缺搜索/排序/批量/长按 | **高** |
| 报告生成 | 4★ | 缺光标处插入变量、模板分组 | 中 |
| 许愿星 | 3★ | 缺优先级/截止日/分解步骤 | 中 |
| 灵感抽屉 | 3★ | 缺搜索/分类/关联成就 | 中 |
| 每日打卡 | 4★ | 缺跨月导航/补打卡/连胜保护 | 中 |
| 数据回顾 | 3★ | 缺热力图/雷达图/人格标签 | **高** |
| 设置 | 4★ | 已达标 | — |
| 主题系统 | **5★** | 已达标（项目最大亮点） | — |

#### 代码层隐患（来自审计）

- **6 处重复代码簇**：CRUD 模式在 wishes/inspirations/checkins 三处几乎一致 → 可抽 `createFlatArrayStore(key)` 工厂
- **`any` 用法 7 处**：全部在 wx API 边界，属合理使用
- **4 个未使用的 storage 导出**：可清理
- **`bookIds` / `bookRef` 悬空引用风险**：删除书时未级联清理引用
- **`chooseImage` vs `chooseMedia` 不一致**：不同页面用了不同 API
- **零自动化测试**：尽管注释里多处说"纯函数好测"

---

### B. 成就 + 报告系统市调结论（来自子代理 2）

#### 招牌功能借鉴（按"可搬到读书/观影 App"评分）

| 借鉴源 | 招牌功能 | 搬到本 App 的形态 | ROI |
|---|---|---|:---:|
| **Duolingo** | Streak Flame + Streak Freeze | 连续打卡火焰图标 + 「连胜保护券」（断了用券挡一刀） | **极高** |
| **Duolingo** | 里程碑变身动画（Fire Duo 凤凰） | 100/365 天解锁专属纪念动画 + 证书 | 高 |
| **PSN Trophies** | Bronze/Silver/Gold/Platinum 四档 | 每本书一套：读完 Bronze、写笔记 Silver、深度书评 Gold、读完该作者全部作品 Platinum | **高** |
| **PSN Trophies** | Ultra Rare 稀有度标签 | "全球仅 0.8% 读者拿到"（注：纯本地无真实数据，可做"达成难度星级"替代） | 中 |
| **Steam** | Profile Showcase 陈列柜 | 个人页可自定义展示位（精选 6 本书 / 6 部片 / 6 枚徽章） | 高 |
| **Apple Rings** | 三色同心环 | 今日三环：红=读完 X 页 / 绿=写 1 条笔记 / 蓝=标 1 部想看 | **高** |
| **Apple Rings** | 限量版节日 Awards | 4·23 世界读书日 / 电影节限定绝版徽章 | 高 |
| **Apple Rings** | Monthly Challenge | 每月根据历史数据派发定制挑战 | 中 |
| **Habitica** | Pet Egg → Pet → Mount 养成链 | 读完一本书掉蛋，孵化主题宠物（科幻→宇宙狐） | 中 |
| **Habitica** | 四职业系统 | 「读书人格职业」：学者 / 评论家 / 收藏家 / 探险家 | 中 |
| **GitHub** | Contribution Heatmap 绿格子墙 | 全年阅读/观影热力图（深浅按当日条数） | **极高** |
| **GitHub** | Achievement Badges（行为人格） | 「读者人格徽章」：速读派 / 深读派 / 笔记狂（自动按行为颁发） | **高** |
| **WeRead** | 阅读时长为核心数字 | 「你这个月读了 N 小时」常驻胶囊条 | 高 |
| **Spotify Wrapped** | Music Evolution（年度阶段） | 「你今年经历了 3 个阅读阶段」 | **高** |
| **Spotify Wrapped** | Top Listeners 百分比 | "你是村上春树全球前 0.1% 的读者"（本地用"占总阅读量比例"模拟） | 高 |
| **Spotify Wrapped** | Listening Personality 16 型 | "深读派 / 速食派 / 跨界派 / 复读派" | **极高** |
| **Spotify Wrapped** | 分享按钮注入 Wrapped 元数据 | 每本书点分享 → "这本书你读了 3 次 / 写了 12 条笔记" | 高 |
| **Apple Music Replay** | 常驻 vs 年度限时双线 | 提供全年可看的统计页 + 年底限时人格报告 | 高 |
| **微信小程序通用** | 竖版长图海报分享 | 年度报告一键生成竖版长图 + 末尾小程序码引流 | **极高** |

#### Spotify Wrapped 五幕叙事结构（已被全网验证可直接搬）

```
1. 开场数字大字    → "你今年读了 87 小时 / 24 本书"
2. Top 5 堆叠揭晓  → Top 5 作者 / 类型 / 高分作品
3. 人格 / 小镇洞察  → "你的读者人格：深读派" / "你的灵魂书友城市：京都"
4. 百分比稀有度    → "全球前 0.3% 的科幻读者"（本地用占比模拟）
5. 汇总卡 + 一键分享 → 多套配色卡片 + 末尾小程序码
```

#### 微信小程序海报设计范式（关键 3 点）

1. **数据卡用「大数字 + 单位 + 图标 + 配色」四件套** —— 不要堆图表（朋友圈缩略图看不清）
2. **海报末尾永远放小程序码 + 引流文案** —— 把"看别人的报告"转化为"我也要生成"
3. **报告生成路径 ≤ 3 次点击** —— 进入小程序 → 一键生成 → 一键保存 → 一键分享

---

### C. 生产力 App + GitHub 开源项目市调结论（来自子代理 3）

#### 同赛道直接对标（最重要）

| 项目 | Stars | 招牌功能 | 对本 App 的意义 |
|---|:---:|---|---|
| **jelu**（自托管 Goodreads） | 726 | 想读/在读/读完 **三态状态机** + ISBN 扫码入库 + tag→shelf + 作者页（自动抓 Wikipedia） + 单文件 SQLite | **数据模型蓝本** —— 这就是"读书成就记录"的开源原典 |
| **Movary**（自托管观影追踪） | 765 | 观影历史 + 详细统计（最爱演员/导演/类型/语言/年份）+ Trakt/Letterboxd 导入导出 | **观影维度统计蓝本** |
| **Yu-Core/SwashbucklerDiary** | 1,572 | 纯本地、跨平台日记（支持 Android/Win/macOS/Web/Linux） | **纯本地数据模型参考** —— 与本 App "纯本地"诉求高度同构 |
| **Actual Budget** | 28,059 | local-first + 同步（TypeScript 同栈）| **本地优先数据层参考实现** |
| **iSoron/uhabits** | 10,114 | Habit Score **衰减公式**（不是脆性 streak）+ Flexible schedule + 热力图 | **打卡算法 + 可视化蓝本** |

#### 高 ROI 借鉴功能清单

| 功能（术语） | 来源 | 价值 | 实现难度 |
|---|---|:---:|:---:|
| **三态状态机**（想读/在读/读完、想看/在看/看完，含弃读/弃看） | jelu、Movary、Things(Someday/Logbook) | **高** | 中 |
| **GitHub 式热力图** | uhabits、GitHub | **高** | 中 |
| **年度回看 / Wrapped**（亮点提炼 + 卡片分享） | Day One、Letterboxd、Spotify | **高** | 中 |
| **多视图切换**（Table / Gallery 封面 / Board 状态列 / Calendar） | Notion、Movary | **高** | 中 |
| **On This Day 往年今日** | Day One | **高** | **低** |
| **衰减式 Score**（非脆性 streak） | uhabits Habit Score | **高** | **低** |
| **快捷输入**（一行自然语言解析 / 扫码入库） | jelu 扫 ISBN、Todoist NLP、pomoday 键盘流 | **高** | 中 |
| **Insight 卡片 / 月报**（规则引擎生成文案，非 AI） | Copilot、Firefly III Rules | 中 | 中 |
| **作者/导演聚合页 + Rollup 汇总** | jelu 作者页、Notion Rollup | 中 | 中 |
| **目标设定**（年度目标 + 月度分解 + 进度） | YNAB Goals、TickTick | 中 | **低** |
| **关联图谱**（导演↔演员↔影片↔书） | Obsidian 双链/图谱 | 中 | 高 |
| **每日 planning/shutdown 仪式页** | Sunsama、My Day | 中 | 低 |
| **Prompt 引导式短评** | Day One Prompts、Daily_You | 中 | **低** |
| **自动元数据**（日期/星期/时段/心情） | Day One | 中 | **低** |
| **RPG / 徽章成就系统**（经验/等级/解锁，单机） | Habitica | 中 | 中 |
| **Rules Engine**（评分≥8 自动标星） | Firefly III | 低 | 高 |
| **复式记账数据模型** | Firefly III、Bagels | 低 | — |
| **Pomodoro 内嵌**（阅读计时） | TickTick、super-productivity | 低 | 中 |

---

## 二、现状对标差距分析

把审计结论与市调标杆做交叉，得出本 App 离"独立 App 级"的具体差距：

### 差距 1：成就生命周期不完整 —— 只有"完成态"，没有"进行态"

**现状**：`edit` 页录入即"完成"；`wishlist` 是"想做"，转化为成就后立即"完成"。整个 App 缺少"在读 / 在看"这个中间态。

**对标**：jelu 三态（想读/在读/读完）、Movary（在看/看完）、Things 3（Today/Upcoming/Anytime/Someday 四桶）、Day One（多日记本）。

**差距代价**：用户读一本书可能跨数周，期间无任何可视化进度，体验断层。

### 差距 2：可视化种类贫乏 —— 只有文字数字，没有"图形记忆点"

**现状**：`stats` 页只有计数 + 文字描述；首页胶囊条只有 4 个数字；成就墙只是网格。

**对标**：GitHub 热力图、Apple 三环、Spotify 人格标签卡、Strava 发光轨迹、WeRead 时段柱状图、uhabits 月历热力。

**差距代价**：用户记住一个 App 往往靠"那一张图"。本 App 当前没有"招牌可视化"。

### 差距 3：连胜系统太脆 —— "断一天归零"违反人性

**现状**：`calcCurrentStreak` 是严格连续（今天未打卡且昨天打卡时宽限返回 1，已是改进）；`calcLongestStreak` 是历史最长；勋章用最长连胜。

**对标**：uhabits Habit Score 用衰减公式（错过几天不归零，只是分数下降）；Duolingo Streak Freeze（用券挡一刀）；Apple Activity 的"完美周"宽容。

**差距代价**：用户出差/生病一天就丢掉 100 天连胜，挫败感直接劝退。

### 差距 4：年度报告叙事单薄 —— 只有"数据"，没有"故事"

**现状**：`report` 页基于模板生成文本报告；`stats` 页是统计数字；无 Wrapped 式沉浸式叙事。

**对标**：Spotify Wrapped 五幕叙事、WeRead 年度报告章节结构、Day One Year-in-review、Strava Year in Sport。

**差距代价**：年度报告是这类 App 的"社交货币"和"留存高潮"，本 App 当前完全没有这个产品线。

### 差距 5：交互层缺失微动作 —— 无长按、无滑动、无拖拽

**现状**：所有删除都是"点删除按钮 → 二次确认"。无一处使用 `wx` 长按/滑动 API。

**对标**：Things 3 完成态划线动画、iOS 系统左滑删除、Notion 长按拖拽排序。

**差距代价**：交互"老气"，与 2025 年用户预期脱节。

### 差距 6：搜索能力为零

**现状**：16 个页面无一处搜索框。

**对标**：Todoist 全局搜索 + Filter 语法、Notion 跨库搜索、Day One 全文检索、Obsidian 双链搜索。

**差距代价**：录入 100+ 条后，找一条特定记录只能滚动。

### 差距 7：撤销/重做完全缺失

**现状**：所有删除立即生效，仅靠二次确认 toast。

**对标**：Gmail 撤销发送、Things 3 Logbook 软删除、Notion 30 天回收站。

**差距代价**：纯本地无云备份场景下，误删一条 100 天连胜的打卡记录是不可恢复灾难。

---

## 三、优化路线图（按优先级 + ROI 排序）

> 命名约定：**P0 = 必做（修复体验硬伤）**，**P1 = 高 ROI（建立差异化）**，**P2 = 锦上添花**。
> 成本估算：**S = 半天内**，**M = 1-2 天**，**L = 3+ 天**（按当前代码范式估算）。

### 🔴 P0 —— 修复体验硬伤（系统级，跨所有页面）

#### P0-1 全局撤销（软删除 + 回收站）— 成本 M，价值极高
- 新增 `utils/trash.ts`：所有 deleteXxx 改为"标记 deletedAt + 30 天后真删"
- 新增 `pages/trash/trash`：回收站页面，列出待恢复项 + 一键还原
- 覆盖：成就、愿望、灵感、打卡、报告、模板
- **借鉴**：Notion 30 天回收站、Things 3 Logbook

#### P0-2 全局搜索 — 成本 M，价值极高
- 新增 `pages/search/search`：跨成就/愿望/灵感/打卡/报告全文搜索
- 首页加搜索入口（放大镜图标）
- 支持分类 tab 切换 + 高亮匹配
- **借鉴**：Todoist 全局搜索、Day One 全文检索

#### P0-3 长/空/错 三态补齐 — 成本 S/M，价值高
- 全部列表页加 `loading` / `empty` / `error` 三态视图
- 抽公共组件 `components/state-view/state-view`（图标 + 文案 + CTA）
- 覆盖：list / wishlist / inspiration / checkin / reports / templates / stats

#### P0-4 长按/滑动删除微交互 — 成本 M，价值高
- 抽 `components/swipe-cell/swipe-cell`：左滑露出删除按钮
- 抽 `components/long-press-menu/long-press-menu`：长按弹操作菜单
- 覆盖：成就墙、愿望列表、灵感列表、打卡历史、报告列表

### 🟠 P1 —— 建立"招牌可视化 + 灵魂功能"

#### P1-1 GitHub 式热力图（全年贡献墙）— 成本 M，价值极高
- 新增 `components/heatmap/heatmap`：53 周 × 7 天格子墙
- 数据源：成就 + 打卡合并按日期聚合
- 放在 `stats` 页顶部和首页"数据回顾"入口预览
- **借鉴**：GitHub Contribution Graph、uhabits 月历热力

#### P1-2 年度 Wrapped（五幕叙事 + 海报）— 成本 L，价值极高
- 新增 `pages/wrapped/wrapped`：每年 12 月解锁入口
- 五幕：开场大数字 → Top 5 堆叠 → 读者人格 → 百分比稀有度 → 汇总海报
- 复用 `poster` 页导出能力生成竖版长图
- **借鉴**：Spotify Wrapped、WeRead 年度报告

#### P1-3 读者人格徽章（行为自动颁发）— 成本 M，价值高
- 新增 `utils/personality.ts`：基于阅读行为算 16 型人格
- 维度：深度（平均笔记字数）/ 广度（类型多样性）/ 速度（读完用时）/ 复读率
- 标签：「深读派 / 速食派 / 跨界派 / 复读派 / 笔记狂 / 猎奇派」
- **借鉴**：Spotify Listening Personality、GitHub Achievement Badges

#### P1-4 On This Day 往年今日 — 成本 S，价值高
- 新增 `pages/on-this-day/on-this-day`：展示"历史上今天"完成的成就/写下的灵感/打的卡
- 首页加"往年今日"卡片入口（仅当天有历史数据时显示）
- **借鉴**：Day One On This Day

#### P1-5 三态状态机（在读/在看 中间态）— 成本 M，价值高
- 扩展 `Item` schema：加 `status: 'pending' | 'reading' | 'done' | 'abandoned'` 字段
- `edit` 页加状态选择；`list` 页加状态筛选 tab
- 新增 `pages/reading-now/reading-now`：当前在读/在看列表（中间态专属视图）
- 迁移：v7，老数据默认 `status: 'done'`（保持兼容）
- **借鉴**：jelu 三态、Movary、Things 四桶

#### P1-6 连胜保护券 + 衰减式 Score — 成本 S，价值高
- `stats.ts` 新增 `calcHabitScore(dates)`：基于衰减公式（不是脆性 streak）
- 新增「连胜保护券」道具：每月自动发 1 张，断了自动消耗挡一刀
- 设置页加"连胜保护"开关
- **借鉴**：uhabits Habit Score、Duolingo Streak Freeze

### 🟡 P2 —— 锦上添花（差异化亮点）

#### P2-1 Apple 三环（今日三目标）— 成本 M，价值中
- 首页 Hero 下方加三色同心环组件
- 三环定义：红=今日打卡 / 绿=今日新增成就 / 蓝=今日写笔记
- **借鉴**：Apple Activity Rings

#### P2-2 Profile Showcase 个人陈列柜 — 成本 M，价值中
- 新增 `pages/profile/profile`：用户个人主页
- 可自定义展示 6 个槽位（书/片/徽章/愿望/灵感任选）
- **借鉴**：Steam Profile Showcase、Duolingo 奖杯陈列架

#### P2-3 Prompt 引导式短评 — 成本 S，价值中
- `edit` 页笔记框上方加随机 Prompt：「这本书最打动你的一句话？」「如果只能推荐给一个人，会是谁？」
- **借鉴**：Day One Prompts、Daily_You

#### P2-4 作者/导演聚合页 — 成本 M，价值中
- 新增 `pages/author/author`：点作者名进入聚合页
- 展示：共读 X 本 / 平均分 Y / 时间线 / 全部作品
- **借鉴**：jelu 作者页、Notion Rollup

#### P2-5 自动元数据 — 成本 S，价值中
- `edit` 录入时自动记录：星期、时段（早/午/晚/夜）、心情（emoji 选择）
- `stats` 页加"你最常在深夜阅读"洞察
- **借鉴**：Day One 自动元数据

#### P2-6 节日限量徽章 — 成本 M，价值中
- `medal-config.ts` 加 `limitedEdition: true` + `unlockWindow: [startDate, endDate]`
- 4·23 世界读书日 / 电影节 / 读书周限定
- **借鉴**：Apple Rings Limited Edition Awards

#### P2-7 多视图切换（成就墙）— 成本 M，价值中
- `list` 页加视图切换：网格 / 表格 / 封面 Gallery / 状态看板 / 日历
- **借鉴**：Notion Database 多视图

#### P2-8 关联图谱（高级）— 成本 L，价值中
- 新增 `pages/graph/graph`：可视化书↔作者↔类型↔评分关系网
- **借鉴**：Obsidian Graph

---

## 四、每个功能的"独立 App 级"打磨清单

> 对照审计给出的"短板"，把每个模块从"能用"打磨到"想用"。

### 成就墙（list 页）—— 3★ → 5★

- [ ] 顶部加搜索框（标题/笔记全文搜索）
- [ ] 加排序切换：最新 / 最早 / 评分高→低 / 评分低→高 / 标题
- [ ] 加批量操作：长按进入多选，批量删除/批量导出
- [ ] 加视图切换：网格（当前）/ 列表（含完整笔记）/ 封面墙（只看封面）
- [ ] 加状态筛选 tab：全部 / 在读 / 读完 / 弃读
- [ ] 加长按操作菜单：编辑/复制/删除/导出/转化为愿望
- [ ] 加滑动删除（左滑露出红色删除按钮）
- [ ] 加空状态插画 + "添加第一条成就" CTA
- [ ] 大数据量虚拟渲染（wx `recycle-view` 或自实现）

### 数据回顾（stats 页）—— 3★ → 5★

- [ ] 顶部加热力图（GitHub 式全年格子墙）
- [ ] 加雷达图：阅读五维（深度/广度/速度/笔记/复读）
- [ ] 加人格标签卡：「你的读者人格：深读派」
- [ ] 加时段柱状图：24 小时分布（你最常在深夜读）
- [ ] 加类型词云：你最爱的类型 Top 10
- [ ] 加月度趋势折线：每月成就数
- [ ] 加 Top 5 卡片：最高分作者/导演/类型
- [ ] 加"亮点洞察"卡片：本月 vs 上月对比文案
- [ ] 加"导出全年数据为海报"入口

### 许愿星（wishlist 页）—— 3★ → 5★

- [ ] 加优先级（P1/P2/P3 或 高/中/低）
- [ ] 加预估完成日（"想在 2026-12-31 前完成"）
- [ ] 加分解步骤（一个愿望拆成多个里程碑，每个可单独完成）
- [ ] 加分类（读书/观影/技能/旅行/其它）
- [ ] 加排序切换：优先级 / 创建时间 / 截止日
- [ ] 加长按操作菜单：编辑/转化成就/删除/标完成
- [ ] 加过期提醒（个人主体不能用订阅消息，但可在首页提示）

### 灵感抽屉（inspiration 页）—— 3★ → 5★

- [ ] 加搜索（内容全文搜索）
- [ ] 加分类筛选 tab（已有分类字段，加筛选即可）
- [ ] 加"关联到成就"功能（一条灵感可挂到一个成就上）
- [ ] 加"转化为愿望"功能（灵感升级为愿望）
- [ ] 加长按操作菜单
- [ ] 加时间线视图（按月分组）

### 每日打卡（checkin 页）—— 4★ → 5★

- [ ] 日历加跨月导航（左右箭头切月）
- [ ] 加"补打卡"功能（昨天忘了，今天可补）
- [ ] 加连胜保护券道具（每月 1 张，断了自动消耗）
- [ ] 加衰减式 Score（除了 streak，再展示 habit score）
- [ ] 加月度报告卡片（"本月打卡 23 天，比上月多 5 天"）
- [ ] 加分类统计饼图（本月阅读几次/观影几次）

### 报告生成（report + report-edit + poster）—— 4★ → 5★

- [ ] `report-edit` 变量插入改为"光标处"而非"追加"
- [ ] `template-edit` 变量网格分组（按 实体/统计/时间 三组）
- [ ] 加更多内置模板（月报/季报/年度/书单/片单/读书会分享）
- [ ] 加模板预览（应用真实数据预渲染）
- [ ] 加海报模板切换（多种竖版长图布局）

### 模板管理（templates + template-edit）—— 3★ → 5★

- [ ] 加模板分类（年度/月度/读书会/书单/自定义）
- [ ] 加模板市场（个人主体不能联网，做"内置精选模板包"）
- [ ] 加模板复制（基于现有模板派生新模板）
- [ ] 加模板预览缩略图

### 设置（settings 页）—— 4★ → 5★

- [ ] 加"回收站"入口（P0-1 的 UI 入口）
- [ ] 加"关于本应用"完整版（替换 about 页的功能）
- [ ] 加"使用统计"卡片（你已使用 X 天，录入 X 条）
- [ ] 加"数据健康检查"（自动检测孤立引用、未使用模板等）

### 关于（about 页）—— 2★ → 4★

- [ ] 加完整功能介绍（不止 3 条）
- [ ] 加更新日志（changelog，按版本列出新增功能）
- [ ] 加"使用指南"分区（每个功能的简短说明）
- [ ] 加"反馈与建议"入口（剪贴板复制 + 跳开发者微信）

### 隐私（privacy 页）—— 2★ → 4★

- [ ] 加"立即导出全部数据"入口（复用 backup.ts）
- [ ] 加"清空全部数据"入口（带强二次确认 + 回收站缓冲）
- [ ] 加"数据存储位置说明"（强调本地、无上传）

---

## 五、明确不做（合规边界）

| 不做 | 理由 |
|---|---|
| ❌ AI 生成内容（含文案、推荐、对话） | 个人主体禁用 AI 类目 |
| ❌ 社交功能（好友、关注、分享到朋友圈动态） | 个人主体禁用社交类目 |
| ❌ 支付/电商/会员订阅 | 个人主体禁用支付类目 |
| ❌ 真实的"全球稀有度百分比" | 无服务端，无法聚合真实数据；改用"达成难度星级" |
| ❌ 真实的 Friend Streak（和朋友共享连胜） | 需社交 |
| ❌ 真实的 Leaderboards 排行榜 | 需服务端 + 社交 |
| ❌ 订阅消息推送 | 个人主体审核极难通过 |
| ❌ 实体奖牌邮寄 | 需支付 + 物流 |
| ❌ 在线模板市场 | 需服务端 |
| ✅ 留本地 + 离线 + 个人记录 | 全部合规 |

---

## 六、实施成本总览

| 优先级 | 工作量 | 备注 |
|:---:|---|---|
| **P0**（4 项硬伤修复） | ~6 天 | 撤销 + 搜索 + 三态 + 长按/滑动 |
| **P1**（6 项招牌功能） | ~12 天 | 热力图 + Wrapped + 人格 + On This Day + 三态机 + 连胜保护 |
| **P2**（8 项锦上添花） | ~14 天 | 三环 + 陈列柜 + Prompt + 作者页 + 元数据 + 节日徽章 + 多视图 + 图谱 |
| **合计** | ~32 工作日 | 按 1 人独立开发估算 |

建议执行顺序：**P0 全部 → P1-1 热力图 → P1-4 On This Day → P1-6 连胜保护 → P1-2 Wrapped → P1-3 人格 → P1-5 三态机 → P2 按需**

---

## 七、附录 A：可直接引用的设计术语表

供后续设计文档与 PRD 引用：

```
自然语言日期输入 · Natural-Language Date Parsing · Quick Add
Smart List / My Day · Filter 语法查询 · Karma 积分
Age Your Money 式单一健康指标 · Habit Score 衰减公式
Today / Upcoming / Anytime / Someday 四桶 · Logbook 归档 · Steps 步骤清单
Calendar View · Board/Kanban · Gallery 视图 · Timeblocking · Eisenhower 矩阵
Streak 连胜 · Streak Freeze 连胜保护 · Flexible Schedule · Heatmap 贡献图
Envelope Budgeting · Goals · Rules Engine · Rollup 汇总
On This Day · Prompts · Auto-metadata · Year-in-Review / Wrapped · Insight Cards
双向链接 · Graph 图谱 · Daily Note · Outline 块级条目
RPG 化 · 徽章/成就解锁 · Single-file SQLite · Local-first
三态状态机（想读-在读-读完 / 想看-在看-看完 · 含弃读弃看）· Tag→Shelf · 作者/导演聚合页
Scrobbling 自动进度追踪 · ISBN 扫码入库 · Profile Showcase 陈列柜
Trophy Cabinet 奖杯陈列架 · Hidden Trophy 隐藏成就 · 稀有度标签
Activity Rings 三色环 · Monthly Challenge · Limited Edition Awards
Sound Town 品味小镇 · Listening Personality 16 型 · Top Listeners 百分比
Music Evolution 年度阶段 · Artist Clips 艺人问候短视频
```

---

## 八、附录 B：参考资料

### 商业产品（已核实官方文档/博客原文）
- Duolingo Blog：连胜心理学、 leagues、friend streak、streak milestone 动画
- Apple Watch Activity：三环定义、限量版 Awards、7-day competition
- Spotify Wrapped 2024：Music Evolution、Top Listeners、Listening Personality、Artist Clips
- Steam Achievements：全球完成率展示、Profile Showcase
- GitHub Contribution Graph：53×7 格子墙、Longest/Current streak

### GitHub 开源项目（已核实 star 数、技术栈、招牌功能）
- jelu (726★) — 自托管 Goodreads，三态状态机 + ISBN 扫码 + 作者页
- Movary (765★) — 自托管观影追踪，详细维度统计 + 多平台导入导出
- iSoron/uhabits (10,114★) — Habit Score 衰减公式 + Flexible schedule + 热力图
- Actual Budget (28,059★) — local-first 信封预算（TypeScript 同栈）
- HabitRPG/habitica (14,048★) — RPG 化习惯养成
- Yu-Core/SwashbucklerDiary (1,572★) — 纯本地跨平台日记
- Day One / Things 3 / Notion / Todoist / TickTick — 商业标杆（公开文档化招牌功能）

---

**报告版本**：V2 · 2026-08-10
**前置报告**：`OPTIMIZATION_REPORT.md`（V1，解决结构性问题）
**下一步**：与用户确认优化方向后，按"路线图"分批落地（每个 P0/P1 项可独立成一个开发分支）
