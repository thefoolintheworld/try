// utils/wrapped.ts
// 年度 Wrapped：把一年的成就数据聚合为"五幕叙事"所需的数据结构。
//
// 五幕（与 Spotify Wrapped / WeRead 年度报告同款节奏）：
//   Act 1 开场大数字    → "你今年完成了 N 个成就"
//   Act 2 Top 5 堆叠    → 最爱的类型 / 最高分的几条 / 出现最多的作者
//   Act 3 读者人格      → 调用 personality.ts 算出一枚人格徽章
//   Act 4 百分比稀有度  → 用本机占比模拟"你是全球前 X% 的 XX 派"
//   Act 5 汇总海报      → 整年浓缩成一张可分享的长图（复用 poster 管线）
//
// 设计：
//  - 纯函数（输入 year + items，输出 WrappedData），不读 storage、无副作用。
//  - 调用方（pages/wrapped/wrapped.ts）负责取数据 + 渲染 + 导出。
//  - 数据不足（<MIN_WRAPPED_ITEMS）返回 sufficient=false，页面显示"明年再来"占位。

import { Item, loadAchievementsByYear } from './storage'
import {
  calcOverview,
  calcGenreStats,
  calcMonthlyStats,
  calcTypeRatio,
  calcTopItems,
  countByCategory,
  calcMoodStats,
  MonthStat,
  OverviewStats,
} from './stats'
import { analyzePersonality, PersonalityResult } from './personality'
import { getCategoryMeta, CategoryMeta } from './category-meta'

/** 触发完整 Wrapped 所需的最低数据门槛（少于这个数只显示简化版）*/
export const MIN_WRAPPED_ITEMS = 3

/* ============================================================
 * 数据类型定义（与五幕一一对应）
 * ============================================================ */

/** Act 1：开场大数字 */
export interface ActOpening {
  year: number
  /** 一年总成就数（核心大数字）*/
  total: number
  /** 书 vs 影 vs 其它的拆分（驱动副标题"读了 X 本 · 看了 Y 部"）*/
  bookCount: number
  filmCount: number
  otherCount: number
  /** 平均评分（0-5）*/
  avgRatingText: string
  /** 最长连续记录天数 */
  longestStreak: number
  /** 涉及的不同天数 */
  uniqueDays: number
}

/** Act 2：Top 5 堆叠（三个小榜单）*/
export interface ActTopLists {
  /** 最常出现的类型（前 3）*/
  topCategories: CategoryRank[]
  /** 评分最高的 5 条成就 */
  topRated: Item[]
  /** 月度分布（哪个月最拼）*/
  monthly: MonthStat[]
  /** 最活跃的月份（月数 + 该月完成数）*/
  peakMonth: { month: number; count: number } | null
}

export interface CategoryRank {
  id: string
  label: string
  icon: string
  color: string
  count: number
  /** 占总数的百分比（驱动条形宽度）*/
  percent: number
}

/** Act 3：读者人格（直接复用 personality.ts 的结果）*/
export type ActPersonality = PersonalityResult

/** Act 4：百分比稀有度（用本机占比模拟"前 X%"）*/
export interface ActRarity {
  /** "你是全球前 X% 的 {人格}" 中的 X */
  topPercent: number
  /** 文案里的人格标签（如"深读派"）*/
  label: string
  /** 一句话文案（驱动页面展示）*/
  sentence: string
  /** 与同期用户相比的稀有度等级（用条数推算，纯本地估算）*/
  tier: 'common' | 'rare' | 'epic' | 'legendary'
}

/** Act 5：汇总海报用的精简数据 */
export interface ActSummary {
  /** 全年成就的标题拼接（用于海报文字云）*/
  titlesConcat: string
  /** 年度关键词（复用 calcAnnualKeywords 推导）*/
  keywords: string[]
  /** 最高频的类型名（海报主标语）*/
  mainCategoryLabel: string
  /** 最具代表性的一条（评分最高 + 笔记最长）*/
  highlight: Item | null
  /** 年度主导心境（频次最高的 mood；无数据为 null）*/
  topMood: { mood: string; count: number; ratio: number } | null
  /** 心境分布前 3（频次降序；用于总结幕小字陈列）*/
  moodStats: { mood: string; count: number; ratio: number }[]
}

/** 完整五幕数据 */
export interface WrappedData {
  year: number
  /** 数据是否充足（< MIN_WRAPPED_ITEMS 时为 false，页面显示占位）*/
  sufficient: boolean
  /** 一年原始条数（即使 sufficient=false 也有，便于显示"才 N 条"）*/
  total: number
  opening: ActOpening
  topLists: ActTopLists
  personality: ActPersonality
  rarity: ActRarity
  summary: ActSummary
}

/* ============================================================
 * 主入口
 * ============================================================ */

/**
 * 从 storage 加载某年数据并聚合出 Wrapped 五幕。
 * 这是页面唯一需要调的入口（页面不需要知道 stats/personality 的细节）。
 */
export function loadWrapped(year: number): WrappedData {
  const items = loadAchievementsByYear(year)
  return buildWrapped(year, items)
}

/**
 * 纯函数版（页面测试 / 预览时可传任意 items）。
 * 所有聚合都基于这个函数。
 */
export function buildWrapped(year: number, items: Item[]): WrappedData {
  const total = items.length
  const sufficient = total >= MIN_WRAPPED_ITEMS

  const overview = calcOverview(items)
  const personality = analyzePersonality(items)
  const rarity = buildRarity(personality)
  const summary = buildSummary(items)

  return {
    year,
    sufficient,
    total,
    opening: buildOpening(year, items, overview),
    topLists: buildTopLists(items),
    personality,
    rarity,
    summary,
  }
}

/* ============================================================
 * 各幕构造器
 * ============================================================ */

function buildOpening(year: number, items: Item[], overview: OverviewStats): ActOpening {
  void year   // 暂未直接用 year；保留参数便于未来加"与去年对比"
  const ratio = calcTypeRatio(items)
  return {
    year,
    total: overview.total,
    bookCount: ratio.bookCount,
    filmCount: ratio.filmCount,
    otherCount: overview.total - ratio.bookCount - ratio.filmCount,
    avgRatingText: overview.avgRatingText,
    longestStreak: overview.longestStreak,
    uniqueDays: overview.uniqueDays,
  }
}

function buildTopLists(items: Item[]): ActTopLists {
  // 类型榜：countByCategory → 取前 3 → 拼 CategoryMeta
  const catCounts = countByCategory(items)
  const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
  const total = items.length || 1
  const topCategories: CategoryRank[] = catEntries.slice(0, 3).map(([id, count]) => {
    const meta: CategoryMeta = getCategoryMeta(id)
    return {
      id,
      label: meta.label,
      icon: meta.icon,
      color: meta.color,
      count,
      percent: Math.round((count / total) * 100),
    }
  })

  // 评分榜：复用 calcTopItems（按 rating 降序）
  const topRated: Item[] = calcTopItems(items, 5)

  // 月度：复用 calcMonthlyStats
  const monthly: MonthStat[] = calcMonthlyStats(items)
  const peakEntry = monthly.length > 0
    ? monthly.reduce((acc, m) => (m.count > acc.count ? m : acc), monthly[0])
    : null
  const peakMonth = peakEntry ? { month: peakEntry.month, count: peakEntry.count } : null

  return { topCategories, topRated, monthly, peakMonth }
}

function buildRarity(personality: PersonalityResult): ActRarity {
  // 稀有度模拟：人格越稀有 + 数据越多 → topPercent 越小（越稀有）
  // 用本机占比近似（无云端数据，但能制造"独一份"的仪式感）。
  const PERSONALITY_BASELINE: Record<string, number> = {
    // 每种人格的"基础占比"（百分比，越小越稀有）
    'deep-reader': 18,
    'speed-reader': 15,
    'cross-bound': 12,
    'rewatcher': 10,
    'note-fanatic': 5,    // 最稀有（行为门槛高）
    'explorer': 14,
    'focused': 16,
    'observer': 30,       // 最常见（数据不足的兜底）
  }
  const base = PERSONALITY_BASELINE[personality.type] || 20

  // 数据越多越能精确定位 → 把 topPercent 微调（每多 10 条 -1%，封顶 -5%）
  const bonus = Math.min(5, Math.floor(personality.total / 10))
  const topPercent = Math.max(1, base - bonus)

  const label = personality.meta.label
  const sentence = buildRaritySentence(topPercent, label, personality.type)

  // 稀有度档位（驱动页面配色 + 文案强度）
  let tier: ActRarity['tier'] = 'common'
  if (topPercent <= 3) tier = 'legendary'
  else if (topPercent <= 8) tier = 'epic'
  else if (topPercent <= 15) tier = 'rare'

  return { topPercent, label, sentence, tier }
}

/** 稀有度文案生成（每种人格一句话）*/
function buildRaritySentence(topPercent: number, label: string, type: string): string {
  const prefix = '你是前 ' + topPercent + '% 的「' + label + '」'
  const SENTENCE_SUFFIX: Record<string, string> = {
    'deep-reader': '——别人追求数量，你追求深度。',
    'speed-reader': '——你的阅读速度让图书馆都紧张。',
    'cross-bound': '——跨界如呼吸，一年逛了五座博物馆。',
    'rewatcher': '——好书看三遍，每遍都读出新东西。',
    'note-fanatic': '——你的笔记比正文还长。',
    'explorer': '——永远尝鲜，从不重读。',
    'focused': '——深耕一域，一年凿到水。',
    'observer': '——记录才刚开始，明年这时候再来揭晓。',
  }
  return prefix + (SENTENCE_SUFFIX[type] || '')
}

function buildSummary(items: Item[]): ActSummary {
  // 海报文字云：所有 title 拼起来（截断到 200 字避免太长）
  const titlesConcat = items.map(it => it.title).filter(Boolean).join(' · ').slice(0, 200)

  // 年度关键词：复用 calcAnnualKeywords 的逻辑（前 3 个）
  // 但 wrapped 里我们想要更精炼的——直接取最热类型 + 评分最高的一条
  const catCounts = countByCategory(items)
  const topCatEntry = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]
  const mainCategoryLabel = topCatEntry ? getCategoryMeta(topCatEntry[0]).label : '记录'

  // 关键词：用类型名 + 高频词拼接（简化版，不调 calcAnnualKeywords 避免重逻辑）
  const keywords: string[] = [mainCategoryLabel]
  if (items.length >= 5) {
    const topGenres = calcGenreStats(items, 2).map(g => g.name)
    keywords.push(...topGenres)
  }

  // 最具代表性的一条：评分最高里挑笔记最长的
  const highlight = pickHighlight(items)

  // 年度心境分布（复用 calcMoodStats；空数组时 topMood=null）
  const moodStats = calcMoodStats(items).slice(0, 3)
  const topMood = moodStats.length > 0 ? moodStats[0] : null

  return { titlesConcat, keywords, mainCategoryLabel, highlight, topMood, moodStats }
}

/** 海报主角：从评分 ≥4 的条目里挑笔记最长的（兼顾"高质"和"有故事"）*/
function pickHighlight(items: Item[]): Item | null {
  if (items.length === 0) return null
  const candidates = items.filter(it => it.rating >= 4)
  const pool = candidates.length >= 1 ? candidates : items
  let best: Item | null = null
  let bestLen = -1
  for (const it of pool) {
    const len = (it.note || '').length + (it.understanding || '').length
    if (len > bestLen) {
      best = it
      bestLen = len
    }
  }
  return best
}

/* ============================================================
 * 工具
 * ============================================================ */

/** 列出有数据可看 Wrapped 的年份（按降序，便于页面做"历史回看"）*/
export function listWrappedYears(): number[] {
  const thisYear = new Date().getFullYear()
  const years: number[] = []
  // 从今年往回扫 5 年（够老用户回看了）；只返回有条数据的年份
  for (let y = thisYear; y >= thisYear - 5; y--) {
    const items = loadAchievementsByYear(y)
    if (items.length >= MIN_WRAPPED_ITEMS) {
      years.push(y)
    }
  }
  return years
}

/** 当年 Wrapped 是否已经解锁（12 月才能看今年；其它月份只看历史）*/
export function isYearUnlocked(year: number): boolean {
  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1
  // 历史年份：永远解锁（任何时候都能回看去年）
  // 当年：仅 12 月解锁（与 Spotify 节奏对齐；其它月份显示"敬请期待"）
  if (year < thisYear) return true
  if (year === thisYear) return thisMonth >= 12
  return false
}
