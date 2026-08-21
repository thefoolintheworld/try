// utils/search.ts
// 跨实体全文搜索（成就 / 愿望 / 灵感 / 打卡）：纯函数，无副作用，无 IO。
// 设计要点：
//  - 单点入口 searchAll(keyword)：一次调用返回四类聚合结果（按 type 分组）
//  - 每条结果带 type/id/title/subtitle/icon 五个渲染字段，UI 不用关心数据源差异
//  - 大小写不敏感、全角半角空格归一、trim 后空关键词返回空（避免误命中全部）
//  - 搜索字段：标题/作者/类型/笔记/金句/内容等"用户可能找的字段"，排除 id/createdAt/coverColor 这类内部字段
//  - 结果稳定排序：按匹配字段优先级（title > author > note > 其它）+ 同优先级按时间倒序

import {
  loadAllItems,
  loadWishes,
  loadInspirations,
  loadCheckins,
  Item,
  Wish,
  Inspiration,
  Checkin,
} from './storage'
import { getInspirationCategoryMeta } from './inspiration-presets'
import { getCheckinCategoryMeta } from './checkin-presets'
import { formatDate } from './util'
import { resolveCategory, getCategoryMeta } from './category-meta'

/** 实体类型枚举（与结果分组一一对应） */
export type SearchResultType = 'achievement' | 'wish' | 'inspiration' | 'checkin'

/** 统一渲染视图：UI 只看这个结构，不关心来自哪张表 */
export interface SearchResult {
  id: string
  type: SearchResultType
  title: string        // 主标题（书名/愿望/灵感前 N 字/打卡分类）
  subtitle: string     // 副标题（作者+日期 / 创建日期 / 分类 / 打卡日期）
  icon: string         // emoji 图标（分类标识）
  /** 匹配字段优先级（用于稳定排序；数字越小越靠前） */
  rank: number
  /** 时间戳（用于同优先级内的倒序排序） */
  ts: number
}

/** 把任意字符串归一成"可比较的搜索关键词"：trim + 全角空格 → 半角 + 连续空格压成一个 + 小写 */
export function normalizeKeyword(kw: string): string {
  return kw
    .replace(/\u3000/g, ' ')        // 全角空格 → 半角
    .replace(/\s+/g, ' ')            // 连续空白压成一个
    .trim()
    .toLowerCase()
}

/** 在 hay 中找 needle（已归一化）的首现位置；找不到返回 -1 */
function findMatch(hay: string, needle: string): number {
  if (!hay) return -1
  return hay.toLowerCase().indexOf(needle)
}

/**
 * 跨实体搜索主入口。
 * 关键词为空（trim 后）→ 返回空数组（不命中任何记录，避免"列出全部"造成的混淆）。
 * 否则返回所有命中的记录，按 type 隐式分组（UI 用 type 字段归类展示）。
 */
export function searchAll(rawKeyword: string): SearchResult[] {
  const kw = normalizeKeyword(rawKeyword)
  if (!kw) return []

  const results: SearchResult[] = []
  // 四类实体的搜索结果合并到同一数组；排序时同优先级按 ts 倒序。
  pushAchievementResults(kw, results)
  pushWishResults(kw, results)
  pushInspirationResults(kw, results)
  pushCheckinResults(kw, results)

  // 稳定排序：rank 升序，同 rank 按 ts 降序
  results.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    return b.ts - a.ts
  })
  return results
}

/* ============ 成就（Item）搜索 ============ */
// 注：用 loadAllItems（全量）而非 loadAllAchievements（只 done）——
// 用户会想搜「我搁置的那本书」「我在读的某本」，在读/搁置态必须可被搜到。
function pushAchievementResults(kw: string, out: SearchResult[]): void {
  let items: Item[] = []
  try {
    items = loadAllItems()
  } catch (e) {
    return
  }
  for (const it of items) {
    const titleHit = findMatch(it.title, kw)
    const authorHit = findMatch(it.author, kw)
    const genreHit = findMatch(it.genre, kw)
    const noteHit = findMatch(it.note, kw)
    const contextHit = findMatch(it.readingContext || '', kw)
    const placeHit = findMatch(it.readingPlace || '', kw)
    const understandingHit = findMatch(it.understanding || '', kw)
    const quotesHit = (it.quotes || []).some(q => findMatch(q, kw) >= 0)
    // tags 已启用（edit 页完整 CRUD），用户会按情感标签搜书（如「意难平」「治愈」）
    const tagsHit = (it.tags || []).some(t => findMatch(t, kw) >= 0)

    if (titleHit < 0 && authorHit < 0 && genreHit < 0 && noteHit < 0 &&
        contextHit < 0 && placeHit < 0 && understandingHit < 0 && !quotesHit && !tagsHit) {
      continue
    }

    // rank：title=0（最优先）→ author=1 → note/quotes/tags=2 → genre/context/place/understanding=3
    // tags 是用户主动打的情感标签，语义权重高于自由文本（genre/context），与 note/quotes 同级
    let rank = 3
    if (titleHit >= 0) rank = 0
    else if (authorHit >= 0) rank = 1
    else if (noteHit >= 0 || quotesHit || tagsHit) rank = 2

    out.push({
      id: it.id,
      type: 'achievement',
      title: it.title,
      subtitle: buildAchievementSubtitle(it),
      // 用 category-meta 的单一真相源取图标，自定义分类也正确（旧版硬编码 7 个预设会回落成 🏆）。
      icon: getCategoryMeta(resolveCategory(it.category, it.type)).icon,
      rank,
      ts: it.createdAt,
    })
  }
}

function buildAchievementSubtitle(it: Item): string {
  const parts: string[] = []
  // 三态标记前置显示：让搜索结果里一眼区分在读/搁置的书（用户常为了找它们而搜）
  const status = it.status || 'done'
  if (status === 'reading') parts.push('📖 在读')
  else if (status === 'abandoned') parts.push('🗂️ 搁置')
  if (it.author) parts.push(it.author)
  // finishedDate 语义随 status 变（done=完成日 / reading=加入日 / abandoned=搁置日）。
  // 直接显示日期会让读者误读为完成日，故对非 done 态加状态词缀消歧。
  if (status === 'reading' && it.finishedDate) {
    parts.push('加入 ' + it.finishedDate)
  } else if (status === 'abandoned' && it.finishedDate) {
    parts.push('搁置 ' + it.finishedDate)
  } else if (it.finishedDate) {
    parts.push(it.finishedDate)
  }
  if (it.rating > 0) parts.push('★' + String(it.rating))
  return parts.join(' · ')
}

/* ============ 愿望（Wish）搜索 ============ */
function pushWishResults(kw: string, out: SearchResult[]): void {
  let list: Wish[] = []
  try {
    list = loadWishes()
  } catch (e) {
    return
  }
  for (const w of list) {
    const titleHit = findMatch(w.title, kw)
    const authorHit = findMatch(w.author || '', kw)
    const genreHit = findMatch(w.genre || '', kw)
    const noteHit = findMatch(w.note || '', kw)
    const tagHit = (w.tags || []).some(t => findMatch(t, kw) >= 0)

    if (titleHit < 0 && authorHit < 0 && genreHit < 0 && noteHit < 0 && !tagHit) continue

    let rank = 2
    if (titleHit >= 0) rank = 0
    else if (authorHit >= 0) rank = 1

    const done = w.achievementId ? ' · 已完成' : ''
    out.push({
      id: w.id,
      type: 'wish',
      title: w.title,
      subtitle: '愿望 · ' + formatDate(w.createdAt) + done,
      icon: '⭐',
      rank,
      ts: w.createdAt,
    })
  }
}

/* ============ 灵感（Inspiration）搜索 ============ */
function pushInspirationResults(kw: string, out: SearchResult[]): void {
  let list: Inspiration[] = []
  try {
    list = loadInspirations()
  } catch (e) {
    return
  }
  for (const n of list) {
    const contentHit = findMatch(n.content, kw)
    if (contentHit < 0) continue
    const meta = getInspirationCategoryMeta(n.category)
    out.push({
      id: n.id,
      type: 'inspiration',
      title: truncate(n.content, 40),
      subtitle: meta.icon + ' ' + meta.label + ' · ' + formatDate(n.createdAt),
      icon: meta.icon,
      rank: contentHit === 0 ? 0 : 1,   // 前缀命中优先
      ts: n.createdAt,
    })
  }
}

/* ============ 打卡（Checkin）搜索 ============ */
function pushCheckinResults(kw: string, out: SearchResult[]): void {
  let list: Checkin[] = []
  try {
    list = loadCheckins()
  } catch (e) {
    return
  }
  for (const c of list) {
    const noteHit = findMatch(c.note || '', kw)
    const meta = getCheckinCategoryMeta(c.category)
    const categoryLabelHit = findMatch(meta.label, kw)
    if (noteHit < 0 && categoryLabelHit < 0) continue

    out.push({
      id: c.id,
      type: 'checkin',
      title: c.note ? truncate(c.note, 40) : (meta.label + '打卡'),
      subtitle: '🔥 ' + c.date,
      icon: meta.icon,
      rank: noteHit === 0 ? 1 : 2,
      ts: c.createdAt,
    })
  }
}

/* ============ 小工具 ============ */

/** 截断字符串到 maxLen 字（按字符数，不区分中英） */
function truncate(s: string, maxLen: number): string {
  if (!s) return ''
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

/** 取每个 type 的命中条数（用于搜索页 tab 显示计数） */
export function countByType(results: SearchResult[]): { [type: string]: number } {
  const counts: { [type: string]: number } = {
    achievement: 0,
    wish: 0,
    inspiration: 0,
    checkin: 0,
  }
  for (const r of results) {
    counts[r.type] = (counts[r.type] || 0) + 1
  }
  return counts
}
