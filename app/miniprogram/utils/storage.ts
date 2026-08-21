// utils/storage.ts
// 本地存储封装：所有页面读写数据都走这里，禁止页面里直接 wx.getStorageSync

import { genId, pickCoverColor, isValidDate } from './util'
import { getBuiltInTemplates } from './built-in-templates'
import { CardStyle, SegmentStyle } from './design-tokens'
import { moveToTrash } from './trash'
import { loadPreferences, updatePreferences } from './preferences'
import { resolveCategory } from './category-meta'
import { markDirty } from './data-dirty'

export type ItemType = 'book' | 'film'

/** 成就分量/稀有度（预留，当前未启用）。参考 PSN 铜银金分级。
 *  启用方式：用户在添加时可手动选「普通/特别/重大」，或在生成里程碑徽章时由系统赋值。
 *  当前所有成就读出来都是 undefined，UI 渲染时一律按「普通」处理，零迁移成本。 */
export type AchievementTier = 'bronze' | 'silver' | 'gold'

/** 进度型成就的进度数据（预留，当前未启用）。参考 Steam/Xbox 的 current/target 进度模型。
 *  适用场景：读 100 本的「书虫」徽章（current=已读本数, target=100）；连续打卡 30 天等。
 *  当前成就都是「事件型」（达成即记录），不携带进度字段。 */
export interface AchievementProgress {
  current: number
  target: number
}

/** 三态状态机（P1-5）：每条 Item 的生命周期状态。
 *  - done      完成（缺省值，向后兼容老数据）：finishedDate = 完成日。
 *  - reading   在读/在看：已开始未完成，finishedDate = 加入在读的日期（语义复用为「开读日」）。
 *  - abandoned 搁置：主动放弃，finishedDate = 搁置日。
 *  注：不设 pending（待读）态——「想读 someday」由独立的 wishlist 覆盖，不进 Item。
 *  注：聚合器（stats/wrapped/personality/连胜）只统计 done；过滤统一在 loadAchievements* 读取层做。 */
export type ItemStatus = 'reading' | 'done' | 'abandoned'

export interface Item {
  id: string
  type: ItemType           // 保留兼容老数据；新数据默认 'book'。reading/film 的二级标识。
  category?: string        // 成就分类（reading/film/skill/game/travel/exam/first/自定义）。成就系统主轴字段；老数据迁移补默认值。
  title: string
  author: string
  genre: string
  rating: number           // 0.5 - 5，步进 0.5
  finishedDate: string     // 'YYYY-MM-DD'
  note: string             // 短评（≤200 字）
  coverColor: string
  createdAt: number
  // === R1 新增字段（均可选） ===
  readingPlace?: string    // 阅读地点（祁连山/飞机上/杭州...）
  readingContext?: string  // 情境心境（旅行时/深夜/与某书为伴）
  understanding?: string   // 对书的理解（长文，≤1000 字）
  quotes?: string[]        // 金句摘录（多条）
  startDate?: string       // 开读日期（可选）
  status?: ItemStatus      // 三态：reading 在读 / done 完成（缺省）/ abandoned 搁置。
                           //   finishedDate 语义随 status 变：done=完成日 / reading=加入日 / abandoned=搁置日。
  // === 成就系统字段（均可选） ===
  tier?: AchievementTier          // 分量/稀有度（铜银金）。预留未启用。
  progress?: AchievementProgress  // 进度型成就的 current/target。已启用：edit 页可录入，index 页展示进度。
  tags?: string[]                 // 自由标签（情感/五感词 + 自定义）。已启用：edit 页完整 CRUD；EMOTION_TAGS 词表见 tag-presets.ts。
  milestone?: boolean             // 是否为里程碑/元成就。预留未启用。
  // === 成就图片（v5 新增，均可选） ===
  image?: string                  // 成就图片标识：内置预设 id（'achv-watercolor-sunset'）/ 包内相对路径（'/assets/xxx.png'）/ saveFile 永久路径（'wxfile://store_xxx'）
                                  //   多语义字符串，与 CardStyle.bgImage 的设计一致；显示时由 UI 根据 imageType 决定怎么渲染
  imageType?: AchievementImageType // 图片源类型，驱动 UI 渲染逻辑 + 预留扩展位
  // === 愿望关联（v6 新增，可选）===
  wishId?: string                 // 本成就由哪条愿望转化而来（反向关联）。愿望侧用 Wish.achievementId 正向关联，两边互查。
                                  //   删除成就时不联动删愿望（愿望仍可作为「待重试」保留）；删除愿望时不联动删成就。
  // === 本次重构新增（v8，均可选；字段先声明，迁移在 migrateToV8 注册）===
  mood?: string                   // 瞬时心境单选（与 tags 多选持久属性语义分离）。候选词见 tag-presets.ts 的 MOOD_OPTIONS。
                                  //   语义：记录「读/做完那一刻的主导心境」，用于年度心境分布与心境联动文案。
  quoteNotes?: { [quoteText: string]: string }  // 金句上下文：按金句正文（trim 后）索引来源页码/章节/一句话感想。
                                  //   不改 quotes: string[] 类型（5+ 消费点高风险），用并行 map 存附加信息。
                                  //   edit 页保存时若金句正文被编辑，需同步更新这里的 key（见 edit 页 save 逻辑）。
}

/** 成就图片源类型（驱动显示方式）*/
export type AchievementImageType = 'none' | 'preset' | 'custom' | 'builtin'

/* ============================================================
 * 愿望清单（独立存储，不进 book_film_data）
 * 设计要点：
 *  - addItem 强校验 finishedDate 并用它定位年份桶；愿望无完成日期，故不能复用 Item 存储。
 *  - 独立扁平数组 CRUD，照 report_instances 模式（loadXxx/saveXxx/deleteXxx）。
 *  - 与成就通过 wishId ↔ achievementId 双向可选字段关联；两边独立删除，不联动。
 *  - 轻量字段集：只保留「想做什么」所需，不含 rating/finishedDate/图片等完成态字段。
 * ============================================================ */
export interface Wish {
  id: string
  title: string              // 想读/想做的事物名（必填）
  category?: string          // 期望分类（reading/skill/...）；可选，预填成就时带入
  author?: string            // 期望作者/品牌（书/游戏等）；可选
  genre?: string             // 期望类型；可选
  note?: string              // 为什么想（动机备注）；可选
  tags?: string[]            // 标签；可选（沿用 Item.tags 词表）
  coverColor: string         // 列表色块（沿用 Item.coverColor 取色逻辑）
  createdAt: number          // 添加时间（用于列表倒序）
  achievementId?: string     // 已转化成的成就 id；非空表示该愿望已完成（list 页据此灰显）
}

/** 灵感记录：自由记录的闪念想法（带分类标签的轻量笔记）。
 *  与愿望清单隔离——愿望是「待达成的事」（可转化成成就），灵感是「记录下来的想法」（纯笔记，无转化）。 */
export interface Inspiration {
  id: string
  content: string            // 灵感正文（必填，≤500 字）
  category: string           // 分类标签（inspiration-presets 里的预设 id，如 writing/idea/memo，或用户自定义 id）
  createdAt: number          // 记录时间（用于列表倒序）
  // === P2-A：标签字段（可选；自由标签，给「xx 领域的灵感」这类横向归类用）===
  tags?: string[]            // 用户自填标签数组（如 ['写作', '产品']）；不限词表，纯文本
}

/** 每日打卡：一天一条的轻量记录（可选分类 + 可选一句话）。
 *  与成就/愿望/灵感都隔离——打卡的核心价值是「连续天数」带来的仪式感，
 *  不是完成某个具体事物（那是成就）。可通过 edit 页升级为成就（checkinId 反向关联）。
 *  v7 起：约束放宽为「(date, category) 复合唯一」——同一天可分别打卡多个分类（如运动+阅读），
 *  但同一分类同一天只能一条（addCheckin 会校验）。 */
export interface Checkin {
  id: string
  date: string               // 打卡日期 'YYYY-MM-DD'（与 category 共同唯一；同一天可多条不同分类）
  category: string           // 打卡分类（checkin-presets 里的预设 id，或用户自定义 id）
  note?: string              // 可选一句话（≤100 字）；空表示纯打卡无记录
  createdAt: number          // 创建时间戳（用于列表倒序）
}

// 全部数据：按年份组织
export type AllData = Record<number, Item[]>

// === R1 新增：报告卡片 ===
export type CardType =
  | 'cover'      // 封面
  | 'overview'   // 总览
  | 'footprint'  // 足迹
  | 'favorite'   // 最爱
  | 'theme'      // 主题
  | 'quote'      // 金句
  | 'journey'    // 旅程
  | 'ending'     // 落款

/** 段落（富文本）：正文按 \n 切段后的单元，每段可带独立文字样式
 *  image 字段非空时表示「图片段」：独占行的图片，text 通常为空 */
export interface TextSegment {
  text: string
  style?: SegmentStyle
  image?: string   // 正文插图：存路径（内置纹理 id 或用户本地路径）；非空表示图片段
}

export interface ReportCard {
  type: CardType
  title: string            // 卡片标题
  content: string          // 卡片正文（占位符代入后的最终文案；用户可改）
  bookRef?: string         // 关联的书 id（用于单本书卡片）
  style?: CardStyle        // S2 新增：卡片级样式覆盖（优先级最高）
  segments?: TextSegment[] // 段落级富文本：存在则渲染按段（每段可独立文字样式）；否则回落 content
}

// === R1 新增：报告实例 ===
export interface ReportInstance {
  id: string
  title: string            // 报告标题（如"2026 我的旅行阅读"）
  templateId: string       // 用的模板 id
  bookIds: string[]        // 包含哪些书
  cards: ReportCard[]      // 卡片数据（用户可改）
  createdAt: number
  updatedAt: number
  exportedAt?: number      // S1 新增：最近一次导出时间（用于历史页标记"已导出"）
  globalStyle?: CardStyle  // S2 新增：报告级全局样式（所有卡片继承；优先级低于卡片自身 style）
}

// === R1 新增：模板定义 ===
export interface TemplateCardDef {
  type: CardType
  titleTemplate: string    // 卡片标题模板（含 {变量}）
  contentTemplate: string  // 卡片正文模板（含 {变量}）
  style?: CardStyle        // S2 新增：模板级样式预设（优先级低于报告 globalStyle 和卡片 style）
}

export interface ReportTemplate {
  id: string
  name: string             // 模板名
  description: string
  isBuiltIn: boolean       // 是否内置（内置不可删）
  cards: TemplateCardDef[]
}

const STORAGE_KEY = 'book_film_data'
const REPORT_KEY = 'report_instances'
const TEMPLATE_KEY = 'report_templates'
const MIGRATION_KEY = 'schema_version'
const WISH_KEY = 'wishlist'   // 愿望清单：独立扁平数组，与 book_film_data 完全隔离
const INSPIRATION_KEY = 'inspirations'   // 灵感抽屉：自由记录的闪念，独立扁平数组
const CHECKIN_KEY = 'checkins'   // 每日打卡：扁平数组，v7 起 (date,category) 复合唯一（一天可多条不同分类）

/** 迁移短路标记：模块级，进程内只跑一次迁移。
 *  小程序冷启动后模块重新加载，标记重置为 false，迁移在新 session 会再跑一次（正好幂等）。
 *  migrateIfNeeded 内部所有版本升级 + ensureBuiltInTemplates 都是幂等写，且 schema 已到 v8 后两者都是 no-op；
 *  把它们挡在每次 loadAll() 之外（loadAll 每次刷新被聚合器/页面调用数十次），避免无谓的 storage 读 + 数组遍历。 */
let migrationDone = false

/** 重置迁移短路标记 —— 仅供 Node 测试套件在 _reset() 清空 storage 后调用，
 *  让下一场景能重跑迁移。正式运行的小程序从不调用此函数（冷启动已天然重置）。 */
export function _resetMigrationCache(): void {
  migrationDone = false
}

/** 安全写入：捕获 wx.setStorageSync 的异常（配额超限/IO 失败等），避免抛错冒泡到调用方。
 *  返回是否写入成功；失败时记录一条 console.warn 便于调试。
 *  所有用户数据写路径都走这里，让调用方能拿到失败信号并提示用户，而不是静默丢数据。 */
function safeSetSync(key: string, value: unknown): boolean {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    console.warn('[storage] 写入失败 key=' + key + '：', e)
    return false
  }
}

/** 按完成日期降序（相等返回 0，保证稳定排序） */
function byFinishedDateDesc(a: Item, b: Item): number {
  if (a.finishedDate < b.finishedDate) return 1
  if (a.finishedDate > b.finishedDate) return -1
  return 0
}

/* ============================================================
 * 数据迁移：老数据补默认值
 * ============================================================ */
function migrateIfNeeded(): void {
  // 进程内只跑一次：schema 已到 v8 后，下面的版本判断与 ensureBuiltInTemplates 都是 no-op 但仍要读 storage。
  // loadAll() 每次刷新被多个聚合器/页面调用，挡住重复迁移可显著减少 storage 读次数。
  if (migrationDone) return
  const version = wx.getStorageSync(MIGRATION_KEY) as number || 0
  if (version < 1) {
    migrateToV1()
    wx.setStorageSync(MIGRATION_KEY, 1)
  }
  if (version < 2) {
    migrateToV2()
    wx.setStorageSync(MIGRATION_KEY, 2)
  }
  if (version < 3) {
    migrateToV3()
    wx.setStorageSync(MIGRATION_KEY, 3)
  }
  if (version < 4) {
    migrateToV4()
    wx.setStorageSync(MIGRATION_KEY, 4)
  }
  if (version < 5) {
    migrateToV5()
    wx.setStorageSync(MIGRATION_KEY, 5)
  }
  if (version < 6) {
    migrateToV6()
    wx.setStorageSync(MIGRATION_KEY, 6)
  }
  if (version < 7) {
    migrateToV7()
    wx.setStorageSync(MIGRATION_KEY, 7)
  }
  if (version < 8) {
    migrateToV8()
    wx.setStorageSync(MIGRATION_KEY, 8)
  }
  // 模板初始化幂等检查：不论 version 多少，只要模板为空就补上内置模板
  // 这样即便用户之前跑过异步版本（模板没写入），升级后也能自动修复
  ensureBuiltInTemplates()
  migrationDone = true   // 本次 session 不再重复迁移（冷启动模块重载会重置）
}

/** 确保内置模板存在（幂等）
 * 模板为空 → 直接写入内置模板列表
 * 模板已存在但缺某些内置 id（如老版本写入后未升级）→ 增量补齐
 */
function ensureBuiltInTemplates(): void {
  const existing = wx.getStorageSync(TEMPLATE_KEY)
  const builtin = getBuiltInTemplates()
  if (!existing || !Array.isArray(existing) || existing.length === 0) {
    wx.setStorageSync(TEMPLATE_KEY, builtin)
    markDirty('templates')
    return
  }
  const existingIds = new Set(existing.map((t: ReportTemplate) => t.id))
  const missing = builtin.filter(bt => !existingIds.has(bt.id))
  if (missing.length > 0) {
    wx.setStorageSync(TEMPLATE_KEY, [...existing, ...missing])
    markDirty('templates')
  }
}

/** v0 → v1：给老 Item 补新字段默认值；内置模板初始化交给 ensureBuiltInTemplates */
function migrateToV1(): void {
  console.log('[storage] 执行 v1 迁移')
  const raw = wx.getStorageSync(STORAGE_KEY)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const all = raw as AllData
    Object.keys(all).forEach(yearKey => {
      const year = Number(yearKey)
      if (Array.isArray(all[year])) {
        all[year] = all[year].map(item => ({
          readingPlace: '',
          readingContext: '',
          understanding: '',
          quotes: [] as string[],
          ...item,  // 老字段覆盖默认值；新字段在老数据没有时用上面默认值
        }))
      }
    })
    wx.setStorageSync(STORAGE_KEY, all)
  }
}

/** v1 → v2：报告实例加 exportedAt 可选字段（实际无需补值，留作未来样式字段的迁移锚点） */
function migrateToV2(): void {
  console.log('[storage] 执行 v2 迁移')
  // exportedAt 是可选字段，老报告读出来自然是 undefined，无需补默认值。
  // 这里保留迁移函数作为后续 S2 样式字段迁移的锚点。
  // 若未来要给老报告补 globalStyle 等字段，在这里加逻辑。
}

/** v2 → v3：同步内置模板列表
 * 老版本只写入了 1 个内置模板；新增模板后需要刷新。
 * 策略：保留用户自建模板（isBuiltIn !== true），用代码中最新的内置模板替换内置部分。
 * 同时为防「用户改过内置模板」丢失，仅按 id 增量补齐缺失的内置模板，不覆盖已存在的。
 */
function migrateToV3(): void {
  console.log('[storage] 执行 v3 迁移：同步内置模板')
  const existing = wx.getStorageSync(TEMPLATE_KEY)
  const builtin = getBuiltInTemplates()
  if (!Array.isArray(existing)) {
    wx.setStorageSync(TEMPLATE_KEY, builtin)
    markDirty('templates')
    return
  }
  const existingIds = new Set(existing.map((t: ReportTemplate) => t.id))
  const merged: ReportTemplate[] = [...existing]
  let added = false
  for (const bt of builtin) {
    if (!existingIds.has(bt.id)) {
      merged.push(bt)
      added = true
    }
  }
  if (added) {
    wx.setStorageSync(TEMPLATE_KEY, merged)
    markDirty('templates')
  }
}

/** v3 → v4：成就系统主轴改造 —— 给老 Item 补 category 字段。
 *  老数据没有 category；按二级标识 type 派生：type='film' → 'film'，其余 → 'reading'。
 *  幂等：已有 category 的不覆盖。
 */
function migrateToV4(): void {
  console.log('[storage] 执行 v4 迁移：补 category 字段')
  const raw = wx.getStorageSync(STORAGE_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const all = raw as AllData
  let changed = false
  Object.keys(all).forEach(yearKey => {
    const year = Number(yearKey)
    if (!Array.isArray(all[year])) return
    all[year] = all[year].map(item => {
      if (item.category) return item  // 已有则不覆盖
      changed = true
      return {
        ...item,
        category: item.type === 'film' ? 'film' : 'reading',
      }
    })
  })
  if (changed) wx.setStorageSync(STORAGE_KEY, all)
}

/** v4 → v5：成就图片功能 —— 预留 image/imageType 字段。
 *  这两个字段都是可选的，老 Item 读出来自然 undefined，当前无需补值。
 *  此函数作为空操作锚点，留作日后需要回填老数据图片时的扩展位。 */
function migrateToV5(): void {
  console.log('[storage] 执行 v5 迁移：成就图片字段预留（无数据变更）')
  // image/imageType 可选字段，老数据零影响，无需遍历回填
}

/** v6 迁移：引入每日打卡（checkins）独立存储。
 *  打卡数据用独立 storage key（CHECKIN_KEY='checkins'），扁平数组结构，与成就/愿望/灵感隔离。
 *  老用户没有打卡数据 → loadCheckins 自然返回空数组，无需回填任何字段。
 *  此函数作为空操作锚点，标记版本号到位即可；真正的写入由 addCheckin 触发。 */
function migrateToV6(): void {
  console.log('[storage] 执行 v6 迁移：每日打卡存储预留（无数据变更）')
  // checkins 是可选 storage key，老用户不存在时 loadCheckins 返回 []，无需初始化
}

/** v7 迁移：打卡多分类——约束从「一天一条 date 唯一」放宽为「(date, category) 复合唯一」。
 *  这是纯语义变更，无数据结构改动：
 *  - 老 Checkin 记录本就有 category 字段（v6 起必填），一天一条天然兼容「一天多条」。
 *  - addCheckin 的唯一性校验改成按 (date, category)，老数据不会违反（老数据每天最多一条，category 唯一）。
 *  - 此函数仅作版本锚点，无需遍历回填。 */
function migrateToV7(): void {
  console.log('[storage] 执行 v7 迁移：打卡多分类约束放宽（无数据变更）')
  // 打卡记录结构未变；唯一性约束改动在 addCheckin 里，老数据自动满足新约束
}

/** v8 迁移：新增 Item.mood（瞬时心境单选）+ Item.quoteNotes（金句上下文 map）。
 *  两个字段都是可选的，老数据读出来是 undefined，UI 自然回落到「无心境/无上下文」状态。
 *  此函数是 no-op anchor：只升版本号，不遍历回填（避免无谓 IO）。
 *  与 v7 同属「语义扩展型」迁移——新能力 opt-in，不影响已有数据。 */
function migrateToV8(): void {
  console.log('[storage] 执行 v8 迁移：新增 mood/quoteNotes 字段（无数据变更，新字段可选）')
  // 字段声明已在 Item 接口；老数据读取时 undefined，编辑页保存时才写入
}

/* ============================================================
 * 书数据 CRUD（沿用旧接口）
 * ============================================================ */

export function loadAll(): AllData {
  migrateIfNeeded()
  const raw = wx.getStorageSync(STORAGE_KEY)
  if (!raw) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn('[storage] 数据格式异常，已重置')
    return {}
  }
  return raw as AllData
}

/** 判断一条 Item 是否「已完成成就」（聚合器只统计这些）。
 *  status 缺省视为 done（向后兼容老数据）；reading/abandoned 不计入任何统计。 */
function isDoneItem(it: Item): boolean {
  return (it.status || 'done') === 'done'
}

/** 写回全量成就数据。返回是否写入成功（配额满/IO 失败时为 false）。
 *  调用方据此决定是否给用户「保存失败」提示，而不是误报「已保存」。 */
function saveAll(data: AllData): boolean {
  return safeSetSync(STORAGE_KEY, data)
}

/** 按年份取**全量** Item（含在读/搁置，按 finishedDate 降序）。
 *  ⚠️ 仅列表页 / 搜索页用——用户需要看到非完成态的书。聚合器（stats/wrapped/personality/
 *  insights/medal-config 等）**禁止调用本函数**：未完成态的 finishedDate/createdAt 会污染
 *  年度计数、金句聚合、人格判断。聚合口径请用 {@link loadAchievementsByYear}（只返 status===done）。
 *  本函数已被 test/lint-aggregator-inputs.js 静态拦截列入聚合器禁单。 */
export function loadByYear(year: number): Item[] {
  const all = loadAll()
  const items = all[year] || []
  return [...items].sort(byFinishedDateDesc)
}

export function loadYears(): number[] {
  const all = loadAll()
  return Object.keys(all)
    .map(Number)
    // 只要有 ≥1 条已完成成就的年份才算（只有在读/搁置的年份不进年份列表，避免污染统计页/Wrapped）
    .filter(y => !isNaN(y) && (all[y] || []).some(isDoneItem))
    .sort((a, b) => b - a)
}

/** 全部 Item 的年份列表（含在读/搁置的年份），降序。
 *  列表页用：用户需要能看到/管理「只有在读项的年份」（统计页/首页仍用 loadYears 只看完成年份）。
 *  与 loadYears 的区别：loadYears 过滤掉只有非完成态的年份（聚合口径）；本函数不过滤（管理口径）。 */
export function loadItemYears(): number[] {
  const all = loadAll()
  return Object.keys(all)
    .map(Number)
    .filter(y => !isNaN(y) && (all[y] || []).length > 0)
    .sort((a, b) => b - a)
}

export function loadRecent(limit: number): Item[] {
  const all = loadAll()
  const flat: Item[] = []
  Object.values(all).forEach(items => flat.push(...items))
  return flat.sort(byFinishedDateDesc).slice(0, limit)
}

/** 跨年份取全部书的扁平数组（按完成日期降序） */
export function loadAllBooks(): Item[] {
  return loadRecent(Number.MAX_SAFE_INTEGER)
}

/** 按 ids 取书（顺序按 ids 数组） */
export function loadByIds(ids: string[]): Item[] {
  const all = loadAllBooks()
  const map = new Map(all.map(it => [it.id, it]))
  return ids.map(id => map.get(id)).filter((it): it is Item => !!it)
}

export function loadById(id: string): Item | null {
  const all = loadAllBooks()
  return all.find(it => it.id === id) || null
}

export function addItem(input: Omit<Item, 'id' | 'coverColor' | 'createdAt'>): Item | null {
  if (!isValidDate(input.finishedDate)) {
    console.error('[storage] 无效的 finishedDate:', input.finishedDate)
    return null
  }
  const all = loadAll()
  const year = Number(input.finishedDate.slice(0, 4))
  const items = all[year] || []

  const newItem: Item = {
    quotes: [],
    ...input,
    type: input.type || 'book',  // input 已带 type，这里兜底防 undefined
    category: resolveCategory(input.category, input.type),  // 成就系统主轴：缺省按 type 派发（film→film / 其它→reading）
    status: input.status || 'done',  // 三态缺省 done（向后兼容）；录入页可传 'reading'/'abandoned'
    id: genId(),
    coverColor: pickCoverColor(items.length),
    createdAt: Date.now(),
  }

  all[year] = [...items, newItem]
  if (!saveAll(all)) return null  // 写入失败（配额满/IO 错）：返回 null，让调用方提示用户
  markDirty('achievements')
  return newItem
}

export function updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'createdAt'>>): boolean {
  if (patch.finishedDate !== undefined && !isValidDate(patch.finishedDate)) {
    console.error('[storage] 无效的 finishedDate:', patch.finishedDate)
    return false
  }
  const all = loadAll()
  let oldItem: Item | null = null
  let oldYear = 0
  for (const y of Object.keys(all)) {
    const items = all[Number(y)]
    const idx = items.findIndex(it => it.id === id)
    if (idx >= 0) {
      oldItem = items[idx]
      oldYear = Number(y)
      break
    }
  }
  if (!oldItem) return false

  const merged: Item = { ...oldItem, ...patch, id: oldItem.id, createdAt: oldItem.createdAt }
  if (!merged.coverColor) {
    const sameYearCount = (all[oldYear] || []).filter(it => it.id !== id).length
    merged.coverColor = pickCoverColor(sameYearCount)
  }
  if (!merged.quotes) merged.quotes = oldItem.quotes || []

  const newYear = Number(merged.finishedDate.slice(0, 4))

  if (newYear === oldYear) {
    all[oldYear] = all[oldYear].map(it => (it.id === id ? merged : it))
  } else {
    all[oldYear] = all[oldYear].filter(it => it.id !== id)
    if (all[oldYear].length === 0) delete all[oldYear]
    all[newYear] = [...(all[newYear] || []), merged]
  }
  if (!saveAll(all)) return false  // 写入失败：告诉调用方保存未成功
  markDirty('achievements')
  return true
}

/** 删除成就。
 *  除了从主表移除 + 进回收站，还清理两处反向引用：
 *   1. 若该成就由愿望转化而来（item.wishId），清除对应 Wish.achievementId，
 *      否则该愿望会永远灰显、再也无法重新转化。
 *   2. 把 id 从 app_preferences.pinnedAchievements 里移除，避免遗留幽灵 id（永不展示也无法清理）。
 *  写入失败（配额满/IO 错）时返回 false，让调用方提示用户。 */
export function deleteItem(id: string): boolean {
  const all = loadAll()
  for (const y of Object.keys(all)) {
    const year = Number(y)
    const before = all[year].length
    // 删除前先取快照（如果存在），交给回收站软删除缓冲
    const snapshot = all[year].find(it => it.id === id)
    if (snapshot) {
      moveToTrash('item', id, snapshot)
      // 反向引用清理：成就即将被删除，只清愿望侧的 achievementId（成就侧 wishId 随删除一起消失）。
      // 不走 linkWishAchievement——后者会调 updateItem 找这条即将删除的成就，多余且容易踩时序。
      // 这里只清愿望侧即可；list 页据此不再灰显该愿望，可重新转化。
      if (snapshot.wishId) {
        updateWish(snapshot.wishId, { achievementId: undefined })
      }
    }
    all[year] = all[year].filter(it => it.id !== id)
    if (all[year].length < before) {
      if (all[year].length === 0) delete all[year]
      // 清理置顶偏好里的幽灵 id（删了还在 prefs 里就会永远残留）
      const prefs = loadPreferences()
      if (prefs.pinnedAchievements.indexOf(id) >= 0) {
        updatePreferences({
          pinnedAchievements: prefs.pinnedAchievements.filter(pid => pid !== id),
        })
      }
      if (!saveAll(all)) return false  // 写入失败：告诉调用方删除未持久化
      markDirty('achievements')
      return true
    }
  }
  return false
}

/** 一键切换 Item 的三态状态（list 页长按流转用；避免走完整 updateItem 那么重）。
 *  会同时更新 finishedDate（重新切桶）以匹配新状态的日期语义：
 *    - 切到 done      → 用 finishedDate（完成日；若调用方没传，保持原值）
 *    - 切到 reading   → finishedDate 当作「加入在读日」（调用方传新日期或保持原值）
 *    - 切到 abandoned → finishedDate 当作「搁置日」（同上）
 *  返回是否成功；找不到 id 或日期非法时返回 false。
 *  设计：让调用方决定新日期（list 页弹日期选择器或直接用今天），本函数只做持久化 + 桶重定位。 */
export function updateItemStatus(id: string, status: ItemStatus, newDate?: string): boolean {
  if (!['reading', 'done', 'abandoned'].includes(status)) {
    console.warn('[storage] updateItemStatus: 非法 status', status)
    return false
  }
  const all = loadAll()
  for (const y of Object.keys(all)) {
    const year = Number(y)
    const idx = all[year].findIndex(it => it.id === id)
    if (idx < 0) continue
    const old = all[year][idx]
    const finishedDate = (newDate && isValidDate(newDate)) ? newDate : old.finishedDate
    const merged: Item = { ...old, status, finishedDate }
    // 桶可能随 finishedDate 变化而移动（和 updateItem 同款逻辑）
    const newYear = Number(finishedDate.slice(0, 4))
    if (newYear === year) {
      all[year] = all[year].map(it => (it.id === id ? merged : it))
    } else {
      all[year] = all[year].filter(it => it.id !== id)
      if (all[year].length === 0) delete all[year]
      all[newYear] = [...(all[newYear] || []), merged]
    }
    if (!saveAll(all)) return false  // 写入失败：状态切换未持久化
    markDirty('achievements')
    return true
  }
  return false
}

export function clearAll(): void {
  wx.removeStorageSync(STORAGE_KEY)
}

/** 编辑某条成就里的一条金句正文，并把挂在该金句上的上下文注释一并迁移到新文本。
 *
 * 为什么需要这个入口（设计债对冲）：
 *   quoteNotes 用「金句正文 trim 后」当 key（不改 quotes: string[] 类型以避免 5+ 消费点高风险）。
 *   这意味着如果某条金句正文被改了，对应的上下文注释 key 就会变成孤儿——
 *   quotes 数组里没那条了，但 quoteNotes 里还留着它的注释，永不显示也永不清理。
 *   目前 edit 页只能「加/删」金句（没有改正文入口），加上 save 时跑 pruneQuoteNotes 兜底，
 *   还没出现真正的孤儿；但只要哪天加了「改金句正文」入口（修错字等），就必须走本函数，
 *   否则会静默丢注释。提前提供这个单一真相源入口，避免未来调用方各自手写迁移漏掉 key。
 *
 * 行为：
 *   - quotes 数组里把首个匹配 oldText（精确匹配，区分大小写）的元素换成 newText。
 *   - quoteNotes 里若存在 oldText 这个 key，把它整体迁移到 newText（覆盖已有同 key）。
 *   - oldText 在 quotes 里找不到 → 返回 false（用户并发改了或传错），不报错。
 *   - newText 与 oldText 相同 → 视作幂等 no-op，返回 true。
 *
 * ⚠️ 已知局限（重复金句场景）：本函数用 indexOf 只命中**第一条**匹配。若用户录了两条完全
 *   一样的金句、只改其中一条，本函数会改错那条。项目允许重复金句（splitBulkQuotes 注释明确
 *   「保留顺序与重复」）。**有重复金句需求的调用方请用 {@link editQuoteTextByIndex}**（按 index
 *   定位，且能正确处理「同文本金句的共享 quoteNotes key」——只在没有其它金句仍是旧文本时才迁移 key）。
 *
 * 返回是否写入成功（找不到 / 写入失败都返回 false，让调用方提示用户）。 */
export function editQuoteText(itemId: string, oldText: string, newText: string): boolean {
  const oldTrim = oldText.trim()
  const newTrim = newText.trim()
  if (!newTrim) return false          // 新文本空串不允许（金句不能为空）
  if (oldTrim === newTrim) return true // 幂等 no-op
  const item = loadById(itemId)
  if (!item) return false
  const quotes = (item.quotes || []).slice()
  const idx = quotes.indexOf(oldTrim)
  if (idx < 0) return false           // 老文本不在 quotes 里：可能并发改过，不强行写入
  quotes[idx] = newTrim
  const notes = item.quoteNotes ? { ...item.quoteNotes } : undefined
  if (notes && notes[oldTrim] !== undefined) {
    notes[newTrim] = notes[oldTrim]
    delete notes[oldTrim]
  }
  return updateItem(itemId, { quotes, quoteNotes: notes })
}

/** 按下标编辑某条金句正文（edit 页「✎字」入口专用）。
 *
 * 与 {@link editQuoteText} 的区别：按 index 精确定位而非文本匹配，正确处理重复金句。
 * 重复金句场景下的 quoteNotes key 迁移规则：
 *   - quotes = ["A", "A"]，改第二条成 "B" → quotes = ["A", "B"]。
 *     此时**还有第一条仍是 "A"**，quoteNotes 的 "A" key 不迁移（注释留给第一条继续用）。
 *   - quotes = ["A", "B"]，改第一条 "A" 成 "C" → quotes = ["C", "B"]。
 *     没有其它金句仍是 "A"，把 quoteNotes 的 "A" key 迁移到 "C"（注释跟着这条走）。
 *   - quotes = ["A", "A"]，改第一条成 "B" → quotes = ["B", "A"]。
 *     还有第二条仍是 "A"，不迁移 key。
 *
 * 行为：
 *   - index 越界 → 返回 false。
 *   - newText trim 后为空 → 返回 false（金句不能为空）。
 *   - newText 与当前 quotes[index] trim 后一致 → 幂等 no-op，返回 true。
 *   - 新文本与 quotes 里**其它**已有金句重复 → 仍写入（项目允许重复金句）。
 *
 * 返回是否写入成功（找不到 item / 写入失败都返回 false）。 */
export function editQuoteTextByIndex(itemId: string, index: number, newText: string): boolean {
  const newTrim = newText.trim()
  if (!newTrim) return false
  if (!Number.isInteger(index) || index < 0) return false
  const item = loadById(itemId)
  if (!item) return false
  const quotes = (item.quotes || []).slice()
  if (index >= quotes.length) return false
  const oldTrim = quotes[index].trim()
  if (oldTrim === newTrim) return true  // 幂等 no-op
  // 除本 index 外，是否还有其它金句仍是旧文本？决定 quoteNotes key 迁不迁移。
  const hasOtherSameText = quotes.some((q, i) => i !== index && q.trim() === oldTrim)
  quotes[index] = newTrim
  let notes = item.quoteNotes ? { ...item.quoteNotes } : undefined
  if (notes && notes[oldTrim] !== undefined && !hasOtherSameText) {
    // 没有其它金句仍是旧文本：注释跟着被改的这条走，迁移 key。
    notes[newTrim] = notes[oldTrim]
    delete notes[oldTrim]
  }
  // 若 hasOtherSameText===true：旧文本 key 仍被其它金句引用，注释不动（共享语义）。
  return updateItem(itemId, { quotes, quoteNotes: notes })
}

/* ============================================================
 * 成就查询（成就系统主轴，沿用 Item 存储）
 * 语义上 Item 即「一条成就」；以下函数是面向成就视角的便捷查询，
 * 内部复用 loadAll/loadByYear，避免重复迁移逻辑。
 * ============================================================ */

/** 跨年份取全部成就（按完成日期降序）。✅ 聚合器专用：只返回已完成（status===done）的 Item。
 *  在读/搁置的 Item 不计入任何统计——它们对 stats/wrapped/personality/连胜不可见。
 *  写聚合代码（年度回顾/人格/洞察/勋章/金句墙）时默认用本函数，不要用 loadAllItems。 */
export function loadAllAchievements(): Item[] {
  return loadAllBooks().filter(isDoneItem)
}

/** 按年份取成就（沿用 loadByYear，语义别名）。✅ 聚合器专用：只返回已完成的 Item。
 *  与 {@link loadItemsByYear} 的区别：那个返全量给列表页状态筛选用，本函数只返 done 给聚合用。 */
export function loadAchievementsByYear(year: number): Item[] {
  return loadByYear(year).filter(isDoneItem)
}

/** 跨年份取**全量** Item（含在读/搁置，按日期降序）。
 *  ⚠️ 仅列表页/搜索页用。聚合器禁用——见 {@link loadByYear} 的警告；聚合口径用 {@link loadAllAchievements}。 */
export function loadAllItems(): Item[] {
  return loadAllBooks()
}

/** 按年份取**全量** Item（含在读/搁置）。列表页做状态筛选用（按 chip 切 done/reading/abandoned）。
 *  ⚠️ 聚合器禁用——见 {@link loadByYear}；聚合口径用 {@link loadAchievementsByYear}。 */
export function loadItemsByYear(year: number): Item[] {
  return loadByYear(year)
}

/** 按分类筛选成就（不限年份）；activeCategory='all' 返回全部。
 *  注意本函数走 {@link loadAllAchievements}（只 done）——是聚合安全口径。 */
export function loadByCategory(activeCategory: string): Item[] {
  const all = loadAllAchievements()
  if (activeCategory === 'all' || !activeCategory) return all
  return all.filter(it => resolveCategory(it.category, it.type) === activeCategory)
}

/** 按分类 + 年份双重筛选。⚠️ 当前实现走 {@link loadByYear}（含在读/搁置），与 {@link loadByCategory}
 *  的「只 done」口径不一致，且目前无调用方。聚合器禁用；如需聚合口径请在调用方自行 filter(isDoneItem)
 *  或改用 {@link loadAchievementsByYear} + 分类过滤。 */
export function loadByCategoryAndYear(activeCategory: string, year: number): Item[] {
  const items = loadByYear(year)
  if (activeCategory === 'all' || !activeCategory) return items
  return items.filter(it => resolveCategory(it.category, it.type) === activeCategory)
}

/** 取数据中出现过的全部分类（去重，按出现次数降序） */
export function loadCategories(): string[] {
  const all = loadAllAchievements()
  const counts: { [cat: string]: number } = {}
  for (const it of all) {
    const cat = resolveCategory(it.category, it.type)
    counts[cat] = (counts[cat] || 0) + 1
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])
}

/* ============================================================
 * 报告实例 CRUD
 * ============================================================ */

export function loadReports(): ReportInstance[] {
  const raw = wx.getStorageSync(REPORT_KEY)
  if (!raw || !Array.isArray(raw)) return []
  return raw as ReportInstance[]
}

export function loadReport(id: string): ReportInstance | null {
  return loadReports().find(r => r.id === id) || null
}

export function saveReport(report: ReportInstance): boolean {
  const list = loadReports()
  const idx = list.findIndex(r => r.id === report.id)
  const stamped = { ...report, updatedAt: Date.now() }
  if (idx >= 0) {
    list[idx] = stamped
  } else {
    list.push(stamped)
  }
  if (!safeSetSync(REPORT_KEY, list)) return false
  markDirty('reports')
  return true
}

export function deleteReport(id: string): boolean {
  const list = loadReports()
  const snapshot = list.find(r => r.id === id)
  if (snapshot) {
    moveToTrash('report', id, snapshot)
  }
  const next = list.filter(r => r.id !== id)
  if (next.length < list.length) {
    if (!safeSetSync(REPORT_KEY, next)) return false
    markDirty('reports')
    return true
  }
  return false
}

/** 标记某份报告已导出（写回 exportedAt 时间戳）。供 poster 页导出成功后调用。 */
export function markReportExported(id: string): boolean {
  const list = loadReports()
  const idx = list.findIndex(r => r.id === id)
  if (idx < 0) return false
  list[idx].exportedAt = Date.now()
  list[idx].updatedAt = Date.now()
  if (!safeSetSync(REPORT_KEY, list)) return false
  markDirty('reports')
  return true
}

/* ============================================================
 * 愿望清单 CRUD（独立存储 key 'wishlist'，扁平数组模式，照 report_instances）
 * ============================================================ */

/** 取全部愿望（按 createdAt 降序；空数据返回 []） */
export function loadWishes(): Wish[] {
  const raw = wx.getStorageSync(WISH_KEY)
  if (!raw || !Array.isArray(raw)) return []
  return (raw as Wish[]).slice().sort((a, b) => b.createdAt - a.createdAt)
}

/** 按 id 取单条愿望；不存在返回 null */
export function loadWishById(id: string): Wish | null {
  return loadWishes().find(w => w.id === id) || null
}

/** 添加愿望。input 不含 id/coverColor/createdAt（由本函数补全）。返回新建的 Wish；写入失败返回 null。 */
export function addWish(input: Omit<Wish, 'id' | 'coverColor' | 'createdAt'>): Wish | null {
  const list = loadWishes()
  const newItem: Wish = {
    tags: [],
    ...input,
    id: genId(),
    coverColor: pickCoverColor(list.length),
    createdAt: Date.now(),
  }
  if (!safeSetSync(WISH_KEY, [...list, newItem])) return null
  markDirty('wishes')
  return newItem
}

/** 局部更新某条愿望（按 id 找；patch 覆盖）。找不到或写入失败返回 false。 */
export function updateWish(id: string, patch: Partial<Omit<Wish, 'id' | 'createdAt'>>): boolean {
  const list = loadWishes()
  const idx = list.findIndex(w => w.id === id)
  if (idx < 0) return false
  list[idx] = { ...list[idx], ...patch, id: list[idx].id, createdAt: list[idx].createdAt }
  if (!safeSetSync(WISH_KEY, list)) return false
  markDirty('wishes')
  return true
}

/** 删除某条愿望。不存在返回 false。不联动删除关联成就（双向独立）。
 *  软删除：先把对象快照移入回收站，再从原表移除（30 天内可恢复）。 */
export function deleteWish(id: string): boolean {
  const list = loadWishes()
  const snapshot = list.find(w => w.id === id)
  if (snapshot) {
    moveToTrash('wish', id, snapshot)
  }
  const next = list.filter(w => w.id !== id)
  if (next.length < list.length) {
    if (!safeSetSync(WISH_KEY, next)) return false
    markDirty('wishes')
    return true
  }
  return false
}

/**
 * 建立/解除「愿望 ↔ 成就」双向关联的单一入口（所有联动写都走这里，禁止页面手写）。
 *
 * 之前的状态：约定要同时维护 Wish.achievementId（正向）和 Item.wishId（反向），
 * 但实际散在多处手工写——删除路径漏掉一边会导致愿望永久灰显或成就来源丢失。
 * 本函数把两边写入收口到一处。
 *
 * - link（achievementId 非空）：写 Wish.achievementId + Item.wishId（两边都设）。
 * - unlink（achievementId === undefined）：清 Wish.achievementId + Item.wishId（两边都清）。
 *
 * 幂等：目标值与现状一致时跳过写入。失败透传 false（调用方提示用户）。
 * 注意：成就侧写入走 updateItem，会触发桶重定位逻辑；本函数只能在两边都存在时调用。
 */
export function linkWishAchievement(wishId: string, achievementId: string | undefined): boolean {
  // 愿望侧
  const wishes = loadWishes()
  const wIdx = wishes.findIndex(w => w.id === wishId)
  if (wIdx < 0) return false
  const wishNeedsWrite = wishes[wIdx].achievementId !== achievementId
  if (wishNeedsWrite) {
    wishes[wIdx].achievementId = achievementId
    if (!safeSetSync(WISH_KEY, wishes)) return false
    markDirty('wishes')
  }
  // 成就侧：只在 link 时复核（unlink 时成就可能已不存在，跳过避免 updateItem 找不到）
  // updateItem 内部已会 markDirty('achievements')
  if (achievementId) {
    return updateItem(achievementId, { wishId })
  }
  return true
}

/* ============================================================
 * 灵感抽屉 CRUD（独立存储 key 'inspirations'，扁平数组模式，照 wishlist）
 * 灵感是纯笔记，无转化/无状态/无关联——只管增删改查。
 * ============================================================ */

/** 取全部灵感（按 createdAt 降序；空数据返回 []） */
export function loadInspirations(): Inspiration[] {
  const raw = wx.getStorageSync(INSPIRATION_KEY)
  if (!raw || !Array.isArray(raw)) return []
  return (raw as Inspiration[]).slice().sort((a, b) => b.createdAt - a.createdAt)
}

/** 添加灵感。input 不含 id/createdAt（由本函数补全）。 */
export function addInspiration(input: Omit<Inspiration, 'id' | 'createdAt'>): Inspiration | null {
  const list = loadInspirations()
  const newItem: Inspiration = {
    ...input,
    id: genId(),
    createdAt: Date.now(),
  }
  if (!safeSetSync(INSPIRATION_KEY, [...list, newItem])) return null
  markDirty('inspirations')
  return newItem
}

/** 局部更新某条灵感（按 id 找；patch 覆盖）。找不到或写入失败返回 false。 */
export function updateInspiration(id: string, patch: Partial<Omit<Inspiration, 'id' | 'createdAt'>>): boolean {
  const list = loadInspirations()
  const idx = list.findIndex(n => n.id === id)
  if (idx < 0) return false
  list[idx] = { ...list[idx], ...patch, id: list[idx].id, createdAt: list[idx].createdAt }
  if (!safeSetSync(INSPIRATION_KEY, list)) return false
  markDirty('inspirations')
  return true
}

/** 删除某条灵感。不存在返回 false。
 *  软删除：先移入回收站，再从原表移除（30 天内可恢复）。 */
export function deleteInspiration(id: string): boolean {
  const list = loadInspirations()
  const snapshot = list.find(n => n.id === id)
  if (snapshot) {
    moveToTrash('inspiration', id, snapshot)
  }
  const next = list.filter(n => n.id !== id)
  if (next.length < list.length) {
    if (!safeSetSync(INSPIRATION_KEY, next)) return false
    markDirty('inspirations')
    return true
  }
  return false
}

/* ============================================================
 * 每日打卡 CRUD（独立扁平数组，照 inspirations 模式）
 * 设计要点：
 *  - v7 起：(date, category) 复合唯一——同一天可打卡多个不同分类，但同一分类同一天只能一条。
 *    addCheckin 校验同 (date, category) 是否已存在；updateCheckin 改 date/category 时同样校验。
 *  - 与成就隔离——打卡是「连续天数」聚合，不是完成某个具体事物（那是成就）。
 *  - 可通过 edit 页升级为成就（edit 页 onLoad 读 options.checkinId 预填）。
 * ============================================================ */

/** 读全部打卡（按 createdAt 降序；老数据或空时返回 []） */
export function loadCheckins(): Checkin[] {
  const raw = wx.getStorageSync(CHECKIN_KEY)
  if (!raw || !Array.isArray(raw)) return []
  return (raw as Checkin[]).slice().sort((a, b) => b.createdAt - a.createdAt)
}

/** 按日期取打卡（首页/打卡页快速查"今天打卡了没"）。无则 null。
 *  v7 兼容：一天可能有多条（不同分类），这里返回第一条（最新一条）给老调用方；
 *  需要全部的用 loadCheckinsByDate。 */
export function loadCheckinByDate(date: string): Checkin | null {
  const list = loadCheckins()
  return list.find(c => c.date === date) || null
}

/** 按日期取当日全部打卡（v7 多分类）。可能 0/1/N 条；按 createdAt 降序。 */
export function loadCheckinsByDate(date: string): Checkin[] {
  return loadCheckins().filter(c => c.date === date)
}

/** 按 id 取某条打卡（升级为成就、编辑跳转用）。无则 null。 */
export function loadCheckinById(id: string): Checkin | null {
  return loadCheckins().find(c => c.id === id) || null
}

/** 添加打卡。
 *  v7 唯一约束：(date, category) 复合唯一——同一天同分类只能一条；不同分类可并存。
 *  成功返回 { ok:true, checkin }；违反唯一性或写入失败返回 { ok:false, msg }。 */
export function addCheckin(input: Omit<Checkin, 'id' | 'createdAt'>): { ok: boolean; checkin?: Checkin; msg: string } {
  // 唯一性校验：同一天同分类只能一条
  const sameCat = loadCheckinsByDate(input.date).find(c => c.category === input.category)
  if (sameCat) {
    return { ok: false, msg: '该分类今日已打卡' }
  }
  const list = loadCheckins()
  const newItem: Checkin = {
    ...input,
    id: genId(),
    createdAt: Date.now(),
  }
  if (!safeSetSync(CHECKIN_KEY, [...list, newItem])) {
    return { ok: false, msg: '保存失败，存储空间不足' }
  }
  markDirty('checkins')
  return { ok: true, checkin: newItem, msg: '打卡成功' }
}

/** 局部更新某条打卡（按 id 找；patch 覆盖 id/createdAt 之外的字段）。不存在返回 false。
 *  v7：若 patch 改了 date 或 category，会校验新 (date, category) 是否与其它记录冲突，冲突则拒绝（返回 false）。 */
export function updateCheckin(id: string, patch: Partial<Omit<Checkin, 'id' | 'createdAt'>>): boolean {
  const list = loadCheckins()
  const idx = list.findIndex(c => c.id === id)
  if (idx < 0) return false
  const merged: Checkin = { ...list[idx], ...patch, id: list[idx].id, createdAt: list[idx].createdAt }
  // 若 date 或 category 变了，校验新 (date, category) 不与其它记录冲突
  if (patch.date !== undefined || patch.category !== undefined) {
    const clash = list.some(c => c.id !== id && c.date === merged.date && c.category === merged.category)
    if (clash) {
      console.warn('[storage] updateCheckin: 新 (date, category) 与其它记录冲突', merged.date, merged.category)
      return false
    }
  }
  list[idx] = merged
  if (!safeSetSync(CHECKIN_KEY, list)) return false
  markDirty('checkins')
  return true
}

/** 删除某条打卡。不存在返回 false。
 *  软删除：先移入回收站，再从原表移除（30 天内可恢复）。 */
export function deleteCheckin(id: string): boolean {
  const list = loadCheckins()
  const snapshot = list.find(c => c.id === id)
  if (snapshot) {
    moveToTrash('checkin', id, snapshot)
  }
  const next = list.filter(c => c.id !== id)
  if (next.length < list.length) {
    if (!safeSetSync(CHECKIN_KEY, next)) return false
    markDirty('checkins')
    return true
  }
  return false
}

/* ============================================================
 * 模板 CRUD
 * ============================================================ */

export function loadTemplates(): ReportTemplate[] {
  const raw = wx.getStorageSync(TEMPLATE_KEY)
  if (!raw || !Array.isArray(raw)) {
    // 还没初始化，触发一次迁移
    migrateIfNeeded()
    const retry = wx.getStorageSync(TEMPLATE_KEY)
    return (retry && Array.isArray(retry)) ? retry as ReportTemplate[] : []
  }
  return raw as ReportTemplate[]
}

export function loadTemplate(id: string): ReportTemplate | null {
  return loadTemplates().find(t => t.id === id) || null
}

export function saveTemplate(template: ReportTemplate): boolean {
  const list = loadTemplates()
  const idx = list.findIndex(t => t.id === template.id)
  if (idx >= 0) {
    list[idx] = template
  } else {
    list.push(template)
  }
  if (!safeSetSync(TEMPLATE_KEY, list)) return false
  markDirty('templates')
  return true
}

export function deleteTemplate(id: string): boolean {
  const list = loadTemplates()
  const target = list.find(t => t.id === id)
  if (!target || target.isBuiltIn) return false  // 内置不可删
  // 自建模板可删；软删除：先移入回收站，再从原表移除
  moveToTrash('template', id, target)
  const next = list.filter(t => t.id !== id)
  if (next.length < list.length) {
    if (!safeSetSync(TEMPLATE_KEY, next)) return false
    markDirty('templates')
    return true
  }
  return false
}
