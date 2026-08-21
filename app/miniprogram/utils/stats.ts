// utils/stats.ts
// 统计计算：所有聚合/分布/趋势的纯函数
// 不依赖 wx，方便单元测试和海报页复用

import { Item } from './storage'
import { resolveCategory } from './category-meta'

/** 基础概览统计 */
export interface OverviewStats {
  total: number
  bookCount: number
  filmCount: number
  avgRating: number       // 已评分条目（rating>0）的平均分；未评分不计入。浮点。
  avgRatingText: string   // 字符串，如 "4.2"；无评分数据时为 "0.0"。
  uniqueDays: number      // 去重完成日期数
  longestStreak: number   // 最长连续记录天数
}

export function calcOverview(items: Item[]): OverviewStats {
  if (items.length === 0) {
    return {
      total: 0, bookCount: 0, filmCount: 0,
      avgRating: 0, avgRatingText: '0.0',
      uniqueDays: 0, longestStreak: 0,
    }
  }
  const bookCount = items.filter(it => it.type === 'book').length
  const filmCount = items.filter(it => it.type === 'film').length
  // 平均分只算已评分条目（rating > 0），与 calcAuthorStats 同口径。
  // 非 reading/film 成就（skill/game/travel 等）rating 恒为 0（edit.ts 强制），在读/搁置态也可为 0；
  // 若计入会显著拉低均分，且与作者聚合口径打架（见 calcAuthorStats:315-317）。
  const rated = items.filter(it => it.rating > 0)
  const avgRating = rated.length > 0 ? rated.reduce((s, it) => s + it.rating, 0) / rated.length : 0
  const uniqueDays = new Set(items.map(it => it.finishedDate)).size
  const longestStreak = calcLongestStreak(items.map(it => it.finishedDate))

  return {
    total: items.length,
    bookCount,
    filmCount,
    avgRating,
    avgRatingText: avgRating.toFixed(1),
    uniqueDays,
    longestStreak,
  }
}

/**
 * 最长连续记录天数（按日期字符串排序后数最长连续段）
 * 同一天记录多条只算 1 天
 *
 * 关键细节：用本地正午构造 Date（与 shiftDays 同款），而非 new Date('YYYY-MM-DD')
 * 后者按 UTC 午夜解析，在 UTC 之后 的时区（如美洲）会把相邻两天的差算成 23 或 25 小时，
 * 经过 Math.round(/86400000) 可能错判成 0 或 2 天，导致连胜段断/错。
 */
export function calcLongestStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...new Set(dates)].sort()
  if (sorted.length === 1) return 1
  let longest = 1
  let cur = 1
  for (let i = 1; i < sorted.length; i++) {
    const diff = daysBetweenLocal(sorted[i - 1], sorted[i])
    if (diff === 1) {
      cur++
      if (cur > longest) longest = cur
    } else if (diff > 1) {
      cur = 1
    }
    // diff === 0（同一天）不应出现（已去重），保守处理：跳过
  }
  return longest
}

/**
 * 当前连续天数（从今天往回数到第一个断档）。
 * 与 calcLongestStreak 的区别：那个数历史最长段（可能早已中断），这个数"截至今天还在延续的段"。
 *
 * 口径分裂说明（2026-08 重构）：
 *   历史版本只有一个 calcCurrentStreak，内部硬编码了「昨天也算连续」的打卡宽容规则——
 *   今天还没打卡但昨天打了，streak 仍算 1，给用户一天补打卡的余地。这对打卡页是对的，
 *   但同一个函数如果被复用到「成就连续天数」语义上就会误导（成就没打卡那种"明天还能补"的语境）。
 *   现拆成两个语义明确的函数；调用方按场景挑：
 *     - 打卡连续 → calcCurrentStreakLenient（容忍今天还没打）
 *     - 其它场景 → calcCurrentStreakStrict（今天没记录就归 0）
 */

/** 严格版：今天不在 dates 里 → 直接返回 0；否则从今天起往回数连续命中天数。 */
export function calcCurrentStreakStrict(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const today = formatDateForStreak(new Date())
  if (!set.has(today)) return 0
  let cursor = today
  let streak = 0
  while (set.has(cursor)) {
    streak++
    cursor = shiftDays(cursor, -1)
  }
  return streak
}

/** 宽容版（打卡专用）：今天没打但昨天打了仍算 1（留一天补打卡余地）；今天和昨天都没 → 0。 */
export function calcCurrentStreakLenient(dates: string[]): number {
  if (dates.length === 0) return 0
  const set = new Set(dates)
  const today = formatDateForStreak(new Date())
  // 今天或昨天任一未打卡 → 当前连续直接归 0（连宽容规则都救不了）
  if (!set.has(today)) {
    const yesterday = shiftDays(today, -1)
    if (!set.has(yesterday)) return 0
  }
  // 从今天（或昨天，取已打卡的那个）开始往回数连续天数
  let cursor = set.has(today) ? today : shiftDays(today, -1)
  let streak = 0
  while (set.has(cursor)) {
    streak++
    cursor = shiftDays(cursor, -1)
  }
  return streak
}

/** 把 Date 转成 'YYYY-MM-DD'（本地时区，不依赖 toISOString 的 UTC 偏移） */
function formatDateForStreak(d: Date): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const pad = (n: number) => (n < 10 ? '0' + String(n) : String(n))
  return String(y) + '-' + pad(m) + '-' + pad(day)
}

/** 把 'YYYY-MM-DD' 字符串加减若干天，返回新的 'YYYY-MM-DD' 字符串。
 *  通过 Date 的 UTC 构造避免本地时区跨日漂移。 */
function shiftDays(dateStr: string, deltaDays: number): string {
  // 用正午 12:00 构造，规避夏令时/跨日边界问题
  const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10))
  const base = new Date(y, m - 1, d, 12, 0, 0, 0)
  base.setDate(base.getDate() + deltaDays)
  return formatDateForStreak(base)
}

/** 算两个 'YYYY-MM-DD' 之间的天数差（b - a，向下取整）。
 *  用本地正午构造（与 shiftDays 同款），规避 new Date('YYYY-MM-DD') 按 UTC 解析的时区漂移：
 *  在 UTC 之后 的时区，UTC 午夜解析会把相邻两天的差算成 23/25 小时，导致连胜段或跨度天数错判。 */
function daysBetweenLocal(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(s => parseInt(s, 10))
  const [by, bm, bd] = b.split('-').map(s => parseInt(s, 10))
  const da = new Date(ay, am - 1, ad, 12, 0, 0, 0)
  const db = new Date(by, bm - 1, bd, 12, 0, 0, 0)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

/**
 * 按分类计数：返回 { category: 条数 } 的映射。
 * 收敛首页/勋章计算里散落的「遍历 items 累加 category」逻辑，单一数据源。
 * 缺失分类的 item 归到 'reading'（与首页 goalRows 同口径，保持一致）。
 */
export function countByCategory(items: Item[]): { [category: string]: number } {
  const counts: { [category: string]: number } = {}
  for (const it of items) {
    const c = resolveCategory(it.category, it.type)
    counts[c] = (counts[c] || 0) + 1
  }
  return counts
}

/** 类型（genre）分布，按数量降序，最多取 topN */
export interface GenreStat {
  name: string
  count: number
  percent: number  // 相对最大值的百分比（用于柱状条宽度）
}

export function calcGenreStats(items: Item[], topN = 6): GenreStat[] {
  const map = new Map<string, number>()
  items.forEach(it => {
    const g = it.genre || '未分类'
    map.set(g, (map.get(g) || 0) + 1)
  })
  const arr = Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  if (arr.length === 0) return []
  const maxCount = arr[0][1]
  return arr.slice(0, topN).map(([name, count]) => ({
    name,
    count,
    percent: Math.round((count / maxCount) * 100),
  }))
}

/** 月度分布（1-12 月，跳过没有记录的月份） */
export interface MonthStat {
  month: number
  count: number
}

export function calcMonthlyStats(items: Item[]): MonthStat[] {
  const map = new Map<number, number>()
  items.forEach(it => {
    const m = Number(it.finishedDate.slice(5, 7))
    map.set(m, (map.get(m) || 0) + 1)
  })
  const result: MonthStat[] = []
  for (let m = 1; m <= 12; m++) {
    if (map.has(m)) result.push({ month: m, count: map.get(m)! })
  }
  return result
}

/** 书影占比 */
export interface TypeRatio {
  bookCount: number
  filmCount: number
  bookPercent: number  // 0-100
  filmPercent: number
}

export function calcTypeRatio(items: Item[]): TypeRatio {
  const bookCount = items.filter(it => it.type === 'book').length
  const filmCount = items.filter(it => it.type === 'film').length
  const total = bookCount + filmCount
  if (total === 0) return { bookCount: 0, filmCount: 0, bookPercent: 0, filmPercent: 0 }
  return {
    bookCount,
    filmCount,
    bookPercent: Math.round((bookCount / total) * 100),
    filmPercent: Math.round((filmCount / total) * 100),
  }
}

/** 评分分布：每个评分档（0.5-5）的数量 */
export interface RatingDist {
  rating: number
  count: number
}

export function calcRatingDist(items: Item[]): RatingDist[] {
  const levels = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]
  return levels.map(r => ({
    rating: r,
    count: items.filter(it => it.rating === r).length,
  })).filter(d => d.count > 0)
}

/** 高分榜（评分降序，取前 N） */
export function calcTopItems(items: Item[], limit = 5): Item[] {
  return [...items].sort((a, b) => b.rating - a.rating).slice(0, limit)
}

/** 最近的 N 条记录（按完成日期降序，相等返回 0 保证稳定排序） */
export function calcRecent(items: Item[], limit = 3): Item[] {
  return [...items]
    .sort((a, b) => {
      if (a.finishedDate < b.finishedDate) return 1
      if (a.finishedDate > b.finishedDate) return -1
      return 0
    })
    .slice(0, limit)
}

/* ============================================================
 * R1 新增：用于文学化读书报告的统计函数
 * ============================================================ */

/** 阅读足迹：按 readingPlace 聚合，返回地点及该地点的书 */
export interface FootprintEntry {
  place: string
  count: number
  books: Item[]
}

export function calcFootprint(items: Item[]): FootprintEntry[] {
  const map = new Map<string, Item[]>()
  items.forEach(it => {
    const place = (it.readingPlace || '').trim()
    if (!place) return
    if (!map.has(place)) map.set(place, [])
    map.get(place)!.push(it)
  })
  return Array.from(map.entries())
    .map(([place, books]) => ({ place, count: books.length, books }))
    .sort((a, b) => b.count - a.count)
}

/* ============================================================
 * P2-4 作者聚合统计：按 author 聚合，给作者详情页用
 * ============================================================ */

/** 作者聚合条目：某作者的计数 + 平均分 + 全部作品（按完成日降序，最新在前） */
export interface AuthorStat {
  author: string
  count: number
  avgRating: number       // 平均分（保留 1 位小数）
  books: Item[]
}

/** 按作者聚合：跳过 author 为空的条目；返回按 count 降序、count 相同时按平均分降序。
 *  大小写/全半角敏感度：完全按字符串原样分组（不做 normalize，避免误合并不同书写习惯）。 */
export function calcAuthorStats(items: Item[]): AuthorStat[] {
  const map = new Map<string, Item[]>()
  for (const it of items) {
    const a = (it.author || '').trim()
    if (!a) continue
    if (!map.has(a)) map.set(a, [])
    map.get(a)!.push(it)
  }
  return Array.from(map.entries())
    .map(([author, books]) => {
      const ratedBooks = books.filter(b => b.rating > 0)
      const avgRating = ratedBooks.length > 0
        ? Math.round((ratedBooks.reduce((s, b) => s + b.rating, 0) / ratedBooks.length) * 10) / 10
        : 0
      // 作品按完成日降序（最新在前；同日不二次排序保持稳定）
      const sortedBooks = books.slice().sort((a, b) => {
        if (a.finishedDate > b.finishedDate) return -1
        if (a.finishedDate < b.finishedDate) return 1
        return 0
      })
      return { author, count: books.length, avgRating, books: sortedBooks }
    })
    .sort((a, b) => b.count - a.count || b.avgRating - a.avgRating)
}

/** 单作者聚合：返回该作者的全部作品统计（找不到作者返回 null） */
export function calcSingleAuthor(items: Item[], author: string): AuthorStat | null {
  if (!author) return null
  const all = calcAuthorStats(items)
  return all.find(s => s.author === author) || null
}

/** 金句墙：把所有 quotes 拍平，带来源书名 */
export interface QuoteEntry {
  text: string
  bookTitle: string
  bookId: string
}

export function calcQuotes(items: Item[]): QuoteEntry[] {
  const out: QuoteEntry[] = []
  items.forEach(it => {
    if (it.quotes && it.quotes.length > 0) {
      it.quotes.forEach(q => {
        const t = q.trim()
        if (t) out.push({ text: t, bookTitle: it.title, bookId: it.id })
      })
    }
  })
  return out
}

/** 选定子集的汇总：专为"几本书的主题报告"设计 */
export interface SelectedSummary {
  bookCount: number
  avgRatingText: string
  places: string[]         // 去重的地点列表
  placeCount: number
  topGenre: string         // 选定子集中数量最多的分类
  topBook: Item | null     // 评分最高的书
  dateSpan: number         // 跨度天数（最早到最晚）
}

export function calcSelectedSummary(items: Item[]): SelectedSummary {
  if (items.length === 0) {
    return {
      bookCount: 0, avgRatingText: '0.0',
      places: [], placeCount: 0, topGenre: '—', topBook: null, dateSpan: 0,
    }
  }
  const places = Array.from(new Set(
    items.map(it => (it.readingPlace || '').trim()).filter(Boolean)
  ))
  const genreMap = new Map<string, number>()
  items.forEach(it => {
    const g = it.genre || '未分类'
    genreMap.set(g, (genreMap.get(g) || 0) + 1)
  })
  const topGenre = genreMap.size > 0
    ? Array.from(genreMap.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : '—'
  const topBook = [...items].sort((a, b) => b.rating - a.rating)[0] || null
  const dates = items.map(it => it.finishedDate).sort()
  const dateSpan = dates.length > 1
    ? daysBetweenLocal(dates[0], dates[dates.length - 1])
    : 0
  const avgRating = items.reduce((s, it) => s + it.rating, 0) / items.length

  return {
    bookCount: items.length,
    avgRatingText: avgRating.toFixed(1),
    places,
    placeCount: places.length,
    topGenre,
    topBook,
    dateSpan,
  }
}

/* ============================================================
 * 年度关键词算法（v6 新增）
 * 从成就数据里推导 3-5 个候选关键词，供首页 hero 显示 & 设置页候选。
 * 策略：分类分布 + 评注高频词 + 评分倾向 综合；返回去重后的候选数组。
 * ============================================================ */

/** 中文停用词/无意义词（短于 2 字的直接跳过；这里再过滤一批常见的） */
const STOP_WORDS: { [w: string]: boolean } = {
  '的': true, '了': true, '是': true, '在': true, '和': true, '与': true, '及': true,
  '一个': true, '一种': true, '一样': true, '这个': true, '那个': true, '一些': true,
  '可以': true, '可能': true, '应该': true, '觉得': true, '认为': true, '感觉': true,
  '不过': true, '但是': true, '虽然': true, '因为': true, '所以': true, '然后': true,
  '非常': true, '特别': true, '十分': true, '比较': true, '有点': true, '稍微': true,
  '真的': true, '其实': true, '就是': true, '还是': true, '已经': true, '一直': true,
  '什么': true, '怎么': true, '为什么': true, '这样': true, '那样': true, '这种': true,
  '自己': true, '他们': true, '我们': true, '她们': true, '它们': true,
  '一本': true, '一部': true, '一部电影': true, '这本书': true, '这部': true,
}

/** 分类 → 关键词映射（最活跃的分类对应一组气质词，供候选加权） */
const CATEGORY_KEYWORDS: { [cat: string]: string[] } = {
  reading: ['阅读', '沉静', '思辨', '积累', '深耕'],
  film: ['观影', '想象', '共情', '故事', '视野'],
  skill: ['精进', '突破', '刻意', '练习', '成长'],
  game: ['沉浸', '挑战', '通关', '专注', '体验'],
  travel: ['出发', '远方', '探索', '在路上', '足迹'],
  exam: ['冲刺', '达成', '坚持', '跨越', '里程碑'],
  first: ['突破', '勇敢', '尝试', '第一次', '打开'],
}

/**
 * 推导年度关键词候选（3-5 个）。
 * 综合：最活跃分类的气质词 + 用户主动打的 tags（结构化标签优先于切词）+ 评注里高频的 2-4 字词。
 * 数据不足（<3 条成就）返回空数组，UI 据此隐藏候选区。
 */
export function calcAnnualKeywords(items: Item[]): string[] {
  if (!items || items.length < 3) return []

  const candidates: string[] = []
  const seen: { [w: string]: boolean } = {}

  // 1. 分类分布：取最活跃的 1-2 个分类，从映射取气质词
  const catMap = new Map<string, number>()
  items.forEach(it => {
    const c = resolveCategory(it.category, it.type)
    catMap.set(c, (catMap.get(c) || 0) + 1)
  })
  const topCats = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2)
  for (const [cat] of topCats) {
    const words = CATEGORY_KEYWORDS[cat]
    if (words) {
      // 每个分类取前 2 个气质词
      for (const w of words.slice(0, 2)) {
        if (!seen[w]) {
          seen[w] = true
          candidates.push(w)
        }
      }
    }
  }

  // 2. 用户标签（tags）：结构化情感/五感词，按频次降序取前 3。
  //    tags 是用户主动打的，语义比切词精确，优先于自由文本高频词入选。
  const tagFreq = new Map<string, number>()
  items.forEach(it => {
    if (it.tags && it.tags.length > 0) {
      for (const t of it.tags) {
        const tag = (t || '').trim()
        if (tag) tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1)
      }
    }
  })
  const topTags = Array.from(tagFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w)
  for (const w of topTags) {
    if (!seen[w]) {
      seen[w] = true
      candidates.push(w)
    }
  }

  // 3. 评注/理解文高频词：粗切 2 字词（真正的滑窗），过滤停用词（兜底，前面不够才补这里）。
  //    修复历史缺陷：原实现 match 出 2-4 字连续中文段后只收 length===2 的，导致「深度思考」
  //    这类 4 字段被整段丢弃，根本没切出「深度/思考」。现在对每个连续中文段做 2 字滑窗，
  //    长段也能被切成相邻 2 字词，召回显著提升。
  const wordFreq = new Map<string, number>()
  items.forEach(it => {
    const texts = [it.note, it.understanding, it.readingContext].filter(Boolean) as string[]
    const blob = texts.join(' ')
    // 先按非中文字符切段（标点/字母/数字/空格都算分隔），每个连续中文段再做 2 字滑窗。
    const cnSegments = blob.match(/[\u4e00-\u9fa5]+/g) || []
    for (const seg of cnSegments) {
      if (seg.length < 2) continue
      for (let i = 0; i + 2 <= seg.length; i++) {
        const w = seg.slice(i, i + 2)
        if (STOP_WORDS[w]) continue
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
      }
    }
  })
  // 出现 ≥2 次的 2 字词，按频率降序取前 3
  const frequentWords = Array.from(wordFreq.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w)
  for (const w of frequentWords) {
    if (!seen[w]) {
      seen[w] = true
      candidates.push(w)
    }
  }

  // 总数控制在 5 个以内（首页 hero 与设置页候选都不宜太长）
  return candidates.slice(0, 5)
}

/** 心境分布：统计 Item.mood 的频次与占比。
 *  只统计已填 mood 的条目（空串/undefined 不计入）；用于 Wrapped/报告/陈列柜。
 *  items 应为完成态成就（loadAchievements* 出来的）；与其它聚合器同源。 */
export interface MoodStat {
  mood: string
  count: number
  ratio: number   // 占「有心境的总数」的比例，0-1
}

export function calcMoodStats(items: Item[]): MoodStat[] {
  if (!items || items.length === 0) return []
  const freq = new Map<string, number>()
  items.forEach(it => {
    const m = (it.mood || '').trim()
    if (m) freq.set(m, (freq.get(m) || 0) + 1)
  })
  const total = Array.from(freq.values()).reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return Array.from(freq.entries())
    .map(([mood, count]) => ({ mood, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count)
}

/** 取年度主导心境（频次最高的 mood）；无数据返回 null。给 Wrapped 用。 */
export function topMood(items: Item[]): MoodStat | null {
  const stats = calcMoodStats(items)
  return stats.length > 0 ? stats[0] : null
}


