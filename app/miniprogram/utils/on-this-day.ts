// utils/on-this-day.ts
// 「往年今日」聚合：找出历史上今天（同月同日，但早于今年）发生的所有记录。
// 覆盖四类实体：成就（按 finishedDate）/ 打卡（按 date）/ 灵感（按 createdAt）/ 愿望（按 createdAt）。
//
// 设计要点：
//  - 纯函数 + 单点入口 collectOnThisDay(today: Date): MemoryEntry[]
//  - "今天"的定义：同月同日，且年份严格小于今年（今年的事不算"往年今日"）
//  - 返回统一视图 MemoryEntry，UI 不关心来自哪张表
//  - 按年份降序（最近的往年排最上），同年内按 createdAt 降序
//  - 空数据/无匹配 → 返回空数组（调用方据此显示空状态）

import {
  loadAllAchievements,
  loadCheckins,
  loadInspirations,
  loadWishes,
  Item,
  Checkin,
  Inspiration,
  Wish,
} from './storage'
import { getCategoryMeta, resolveCategory } from './category-meta'
import { getInspirationCategoryMeta } from './inspiration-presets'
import { getCheckinCategoryMeta } from './checkin-presets'

/** 实体类型（与渲染分组一致） */
export type MemoryType = 'achievement' | 'checkin' | 'inspiration' | 'wish'

/** 统一视图：UI 只看这个结构 */
export interface MemoryEntry {
  id: string
  type: MemoryType
  yearsAgo: number       // 距今几年（用于"3 年前"文案）
  year: number           // 该条记录的年份（显示用）
  title: string          // 主标题
  subtitle: string       // 副标题（分类 + 日期）
  icon: string           // emoji
  /** 时间戳（用于同年内排序） */
  ts: number
  /** P3-1 往年今日增强：成就类条目可选携带金句预览（最多 1 条，超长截断）*/
  quotePreview?: string
  /** P3-1 往年今日增强：成就类条目可选携带心境/标签预览（拼接字符串，如"意难平 · 治愈温暖"）*/
  moodPreview?: string
}

/** 给定今天，返回所有"往年今日"记录（按年份降序、同年内按时间倒序） */
export function collectOnThisDay(today: Date): MemoryEntry[] {
  const month = today.getMonth() + 1   // 1-12
  const day = today.getDate()          // 1-31
  const thisYear = today.getFullYear()

  const out: MemoryEntry[] = []
  pushAchievementEntries(out, month, day, thisYear)
  pushCheckinEntries(out, month, day, thisYear)
  pushInspirationEntries(out, month, day, thisYear)
  pushWishEntries(out, month, day, thisYear)

  // 排序：年份降序（最近的往年最在上），同年内按 ts 降序
  out.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year
    return b.ts - a.ts
  })
  return out
}

/* ============ 成就 ============ */
function pushAchievementEntries(out: MemoryEntry[], month: number, day: number, thisYear: number): void {
  let items: Item[] = []
  try {
    items = loadAllAchievements()
  } catch (e) {
    return
  }
  for (const it of items) {
    if (!isValidDateStr(it.finishedDate)) continue
    const [y, m, d] = it.finishedDate.split('-').map(Number)
    if (m !== month || d !== day) continue
    if (y >= thisYear) continue   // 今年的不算"往年今日"
    const meta = getCategoryMeta(resolveCategory(it.category, it.type))
    const entry: MemoryEntry = {
      id: it.id,
      type: 'achievement',
      yearsAgo: thisYear - y,
      year: y,
      title: it.title,
      subtitle: meta.label + ' · ' + it.finishedDate + ratingSuffix(it.rating),
      icon: meta.icon,
      ts: it.createdAt,
    }
    // P3-1 金句预览：取第一条金句，截断到 30 字
    if (it.quotes && it.quotes.length > 0) {
      const first = (it.quotes[0] || '').trim()
      if (first) entry.quotePreview = truncate('「' + first + '」', 32)
    }
    // P3-1 心境 + 标签预览：mood 单选 + tags 多选拼接（最多 3 个标签）
    const moodParts: string[] = []
    if (it.mood) moodParts.push(it.mood)
    if (it.tags && it.tags.length > 0) {
      moodParts.push(...it.tags.slice(0, 3))
    }
    if (moodParts.length > 0) entry.moodPreview = moodParts.join(' · ')
    out.push(entry)
  }
}

function ratingSuffix(rating: number): string {
  if (!rating || rating <= 0) return ''
  return ' · ★' + rating
}

/* ============ 打卡 ============ */
function pushCheckinEntries(out: MemoryEntry[], month: number, day: number, thisYear: number): void {
  let list: Checkin[] = []
  try {
    list = loadCheckins()
  } catch (e) {
    return
  }
  for (const c of list) {
    if (!isValidDateStr(c.date)) continue
    const [y, m, d] = c.date.split('-').map(Number)
    if (m !== month || d !== day) continue
    if (y >= thisYear) continue
    const meta = getCheckinCategoryMeta(c.category)
    out.push({
      id: c.id,
      type: 'checkin',
      yearsAgo: thisYear - y,
      year: y,
      title: c.note ? c.note : (meta.label + '打卡'),
      subtitle: '🔥 ' + c.date,
      icon: meta.icon,
      ts: c.createdAt,
    })
  }
}

/* ============ 灵感 ============ */
function pushInspirationEntries(out: MemoryEntry[], month: number, day: number, thisYear: number): void {
  let list: Inspiration[] = []
  try {
    list = loadInspirations()
  } catch (e) {
    return
  }
  for (const n of list) {
    const dt = new Date(n.createdAt)
    if (dt.getMonth() + 1 !== month || dt.getDate() !== day) continue
    if (dt.getFullYear() >= thisYear) continue
    const meta = getInspirationCategoryMeta(n.category)
    const y = dt.getFullYear()
    const dateStr = formatTsDate(n.createdAt)
    out.push({
      id: n.id,
      type: 'inspiration',
      yearsAgo: thisYear - y,
      year: y,
      title: truncate(n.content, 50),
      subtitle: meta.icon + ' ' + meta.label + ' · ' + dateStr,
      icon: meta.icon,
      ts: n.createdAt,
    })
  }
}

/* ============ 愿望 ============ */
function pushWishEntries(out: MemoryEntry[], month: number, day: number, thisYear: number): void {
  let list: Wish[] = []
  try {
    list = loadWishes()
  } catch (e) {
    return
  }
  for (const w of list) {
    const dt = new Date(w.createdAt)
    if (dt.getMonth() + 1 !== month || dt.getDate() !== day) continue
    if (dt.getFullYear() >= thisYear) continue
    const meta = getCategoryMeta(resolveCategory(w.category))
    const y = dt.getFullYear()
    const dateStr = formatTsDate(w.createdAt)
    const doneSuffix = w.achievementId ? ' · 已完成' : ''
    out.push({
      id: w.id,
      type: 'wish',
      yearsAgo: thisYear - y,
      year: y,
      title: w.title,
      subtitle: '⭐ ' + meta.label + ' · ' + dateStr + doneSuffix,
      icon: '⭐',
      ts: w.createdAt,
    })
  }
}

/* ============ 小工具 ============ */

/** 校验 YYYY-MM-DD */
function isValidDateStr(s: string): boolean {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** 时间戳转 YYYY-MM-DD */
function formatTsDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

/** 截断字符串到 maxLen 字 */
function truncate(s: string, maxLen: number): string {
  if (!s) return ''
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

/** 把 MemoryEntry 按年份分组成渲染视图（每年一个分组） */
export interface MemoryYearGroup {
  year: number
  yearsAgoText: string   // "3 年前" / "2 年前"
  entries: MemoryEntry[]
}

export function groupByYear(entries: MemoryEntry[]): MemoryYearGroup[] {
  const map: { [year: number]: MemoryEntry[] } = {}
  for (const e of entries) {
    if (!map[e.year]) map[e.year] = []
    map[e.year].push(e)
  }
  const years = Object.keys(map).map(Number).sort((a, b) => b - a)
  return years.map(y => ({
    year: y,
    yearsAgoText: yearsAgoText(y, new Date().getFullYear()),
    entries: map[y],
  }))
}

/** "3 年前" / "1 年前" / "去年"（1 年前可读性更好） */
function yearsAgoText(year: number, thisYear: number): string {
  const diff = thisYear - year
  if (diff === 1) return '去年'
  if (diff === 2) return '前年'
  return diff + ' 年前'
}

/** 给每个 type 的中文标签（用于分组内/卡片描述） */
export function memoryTypeLabel(type: MemoryType): string {
  switch (type) {
    case 'achievement': return '成就'
    case 'checkin':     return '打卡'
    case 'inspiration': return '灵感'
    case 'wish':        return '愿望'
  }
}
