// utils/medal-config.ts
// 系统勋章定义：内置若干枚进度型勋章（读 N 本书 / 观 N 部影…），随成就录入自动推进。
// 与成就墙完全独立——勋章是「累计/年度聚合」的派生视图，本身不存条目数据。
//
// 设计：
//   - 勋章定义是常量（这里导出），目标值可由用户改（存进 preferences.systemMedals）。
//   - scope='cumulative' 表示跨年累计计数；'yearly' 用于「连续 N 天打卡」类（按当前/最长连续天数判定）。
//   - 默认做阅读/观影计数 + 连续打卡勋章（用户确认）；其它分类的勋章后续可往 SYSTEM_MEDALS 里加。

import { Item, Checkin } from './storage'
import { countByCategory, calcLongestStreak } from './stats'
import { AppPreferences, loadPreferences, updatePreferences } from './preferences'
import { getAllCheckinCategories } from './checkin-presets'

export type MedalScope = 'cumulative' | 'yearly'

/** P2-6 节日限量徽章解锁窗口（MM-DD 格式，如 '04-23' 表示 4 月 23 日）。
 *  支持跨年窗口（startMD > endMD 表示从今年某日到次年某日，如 '12-20' → '01-10' 冬季节）*/
export interface UnlockWindow {
  startMD: string   // 'MM-DD' 起始（含）
  endMD: string     // 'MM-DD' 结束（含）
}

export interface SystemMedal {
  id: string            // 唯一标识（存进 preferences.systemMedals 的 key）
  label: string         // 用户可见名称（如「阅读 50 本」）
  icon: string          // emoji 图标
  category: string      // 计数源：与 Item.category 对齐（reading/film/...）
  defaultTarget: number // 默认目标值（用户未改时用这个）
  scope: MedalScope     // cumulative=跨年累计 / yearly=按年（预留）
  desc: string          // 一句话描述（设置页/解锁提示用）
  // === P2-6 节日限量徽章（可选）===
  limitedEdition?: boolean       // 标记为限量徽章（UI 会特殊处理：角标、限时提示）
  unlockWindow?: UnlockWindow    // 解锁窗口：仅在窗口期内才能解锁；窗口外不显示或不解锁
}

/**
 * 判断当前日期是否在解锁窗口内。
 *  - 普通窗口（startMD ≤ endMD）：同一公历年内判断包含关系。
 *  - 跨年窗口（startMD > endMD，如 '12-20' → '01-10'）：判定「≥startMD 或 ≤endMD」。
 *  入参可选；为空（普通勋章）一律返回 true。
 *  日期串格式 'MM-DD'，长度严格 5。
 */
export function isInUnlockWindow(now: Date, window?: UnlockWindow): boolean {
  if (!window || !window.startMD || !window.endMD) return true
  const todayMD = mdOf(now)
  const { startMD, endMD } = window
  if (startMD <= endMD) {
    return todayMD >= startMD && todayMD <= endMD
  }
  // 跨年窗口：今冬 → 明春
  return todayMD >= startMD || todayMD <= endMD
}

/** 取一个 Date 的 'MM-DD'（本地时区，两位补零）。 */
function mdOf(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return mm + '-' + dd
}

/**
 * 判断某条 'YYYY-MM-DD' 日期串的月日是否落在解锁窗口内（用于限量勋章计数）。
 *  - 与 isInUnlockWindow 同款窗口语义（含跨年窗口），但比较的是「成就完成日的月日」而不是「今天」。
 *  - 非法日期格式返回 false（保守不计数）。
 *
 *  这是限量勋章计数的关键：节日勋章应该统计「在窗口期内录入」的成就，
 *  而不是「全年累计」——否则一个今年读了 50 本的用户在 4·23 当天会被立刻解锁
 *  「世界读书日」勋章，即使 ta 在 4·23 当天根本没录入任何东西，违背仪式感设计。
 */
export function dateInWindow(dateStr: string, window?: UnlockWindow): boolean {
  if (!window || !window.startMD || !window.endMD) return true
  if (typeof dateStr !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return false
  const md = m[2] + '-' + m[3]
  const { startMD, endMD } = window
  if (startMD <= endMD) {
    return md >= startMD && md <= endMD
  }
  return md >= startMD || md <= endMD
}

/**
 * 统计 finishedDate 落在解锁窗口内的条目数（限量勋章计数用）。
 *  入参 window 为空（非限量勋章）时返回 items.length（与「__any__ 全量」语义一致）。
 *  finishedDate 缺失或格式非法的条目不计入（保守）。
 */
export function countItemsInWindow(items: Item[], window?: UnlockWindow): number {
  if (!window) return items.length
  let n = 0
  for (const it of items) {
    if (it.finishedDate && dateInWindow(it.finishedDate, window)) n++
  }
  return n
}

/** 连续打卡勋章的三档天数（与内置 category='checkin' 的三枚一致）。 */
export const STREAK_MEDAL_DAYS = [7, 30, 100] as const

/**
 * 为某个打卡分类动态生成「连续 N 天」三档勋章（v7 多分类）。
 *  与内置的 category='checkin'（全局任意分类连胜）不同，这里每枚绑定一个具体打卡分类，
 *  计数源是该分类的 dates 数组算出的最长连胜。
 *
 * 关键约束：
 *  - id 形如 `medal-streak-7-exercise`（天数-分类id），稳定可复现（同一分类每次生成都同 id），
 *    保证 unlockedAt 持久化不丢。
 *  - category 用一个特殊前缀 `checkin:{分类id}` 区别于全局 'checkin' 与成就分类，
 *    buildMedalRows 据此分流到该分类的连胜计算。
 *  - 排除预设的 'other'（语义太泛，不单独建勋章）。
 *  - 用户自定义分类也会生成勋章（id 用其 custom_xxx，同样稳定）。
 */
export function buildCheckinCategoryMedals(catId: string, catLabel: string, catIcon: string): SystemMedal[] {
  if (catId === 'other') return []
  return STREAK_MEDAL_DAYS.map((days) => ({
    id: 'medal-streak-' + String(days) + '-' + catId,
    label: '连续' + catLabel + ' ' + String(days) + ' 天',
    icon: catIcon,
    category: 'checkin:' + catId,   // 特殊前缀，buildMedalRows 据此分流
    defaultTarget: days,
    scope: 'yearly',
    desc: '连续' + catLabel + '打卡满 ' + String(days) + ' 天',
  }))
}

/**
 * 内置系统勋章。
 * 两类：
 *   - 阅读观影计数（cumulative scope，跨年累计，入门/进阶两档）
 *   - 连续打卡（yearly scope，按历史最长连续天数判定；category='checkin' 触发 buildMedalRows 走 streak 分支）
 * 用户可在设置页改 target；改完存进 preferences.systemMedals[id].target。
 */
export const SYSTEM_MEDALS: SystemMedal[] = [
  {
    id: 'medal-reading-50',
    label: '阅读 50 本',
    icon: '📖',
    category: 'reading',
    defaultTarget: 50,
    scope: 'cumulative',
    desc: '累计读满 50 本书',
  },
  {
    id: 'medal-reading-100',
    label: '阅读 100 本',
    icon: '📚',
    category: 'reading',
    defaultTarget: 100,
    scope: 'cumulative',
    desc: '累计读满 100 本书',
  },
  {
    id: 'medal-film-24',
    label: '观影 24 部',
    icon: '🎬',
    category: 'film',
    defaultTarget: 24,
    scope: 'cumulative',
    desc: '累计看满 24 部电影',
  },
  {
    id: 'medal-film-50',
    label: '观影 50 部',
    icon: '🎞️',
    category: 'film',
    defaultTarget: 50,
    scope: 'cumulative',
    desc: '累计看满 50 部电影',
  },
  // 连续打卡勋章：scope='yearly'，category='checkin' 是一个专用值（不与 reading/film 冲突），
  // buildMedalRows 会据此分流到 streak 计数（用 calcLongestStreak 算历史最长连续天数）。
  {
    id: 'medal-streak-7',
    label: '连续打卡 7 天',
    icon: '🔥',
    category: 'checkin',
    defaultTarget: 7,
    scope: 'yearly',
    desc: '连续打卡满 7 天',
  },
  {
    id: 'medal-streak-30',
    label: '连续打卡 30 天',
    icon: '🌟',
    category: 'checkin',
    defaultTarget: 30,
    scope: 'yearly',
    desc: '连续打卡满 30 天',
  },
  {
    id: 'medal-streak-100',
    label: '连续打卡 100 天',
    icon: '🏆',
    category: 'checkin',
    defaultTarget: 100,
    scope: 'yearly',
    desc: '连续打卡满 100 天',
  },
  // === P2-6 节日限量徽章 ===
  // 语义：在解锁窗口内录入 ≥N 条对应分类成就即解锁。
  //   计数走 countItemsInWindow(allAchievements, unlockWindow)——只统计 finishedDate
  //   月日落在窗口内的条目（不是全年累计），保证仪式感（必须窗口期内真录了才算）。
  //   category 仍是该勋章的分类语义（reading），与计数口径解耦。
  // 窗口外不显示进度推进（但仍可在勋章墙看到灰态卡片，营造"等待来年"的仪式感）。
  // 窗口跨年的话用 startMD > endMD 表示（isInUnlockWindow 会判定跨年）。
  {
    id: 'medal-world-book-day',
    label: '世界读书日',
    icon: '🌹',
    category: 'reading',
    defaultTarget: 1,
    scope: 'cumulative',
    desc: '4·23 世界读书日当天录入一本书',
    limitedEdition: true,
    unlockWindow: { startMD: '04-23', endMD: '04-23' },
  },
  {
    id: 'medal-new-year-read',
    label: '新年开卷',
    icon: '🎆',
    category: 'reading',
    defaultTarget: 1,
    scope: 'cumulative',
    desc: '元旦假期（1.1–1.3）录入今年第一本书',
    limitedEdition: true,
    unlockWindow: { startMD: '01-01', endMD: '01-03' },
  },
  {
    id: 'medal-national-read-month',
    label: '全民阅读月',
    icon: '🌿',
    category: 'reading',
    defaultTarget: 3,
    scope: 'cumulative',
    desc: '4 月「全民阅读月」累计录入 3 条阅读成就',
    limitedEdition: true,
    unlockWindow: { startMD: '04-01', endMD: '04-30' },
  },
]

const MEDAL_MAP: { [id: string]: SystemMedal } = SYSTEM_MEDALS.reduce(
  (m, md) => { m[md.id] = md; return m },
  {} as { [id: string]: SystemMedal },
)

/** 按 id 取勋章定义；未知 id 返回 null（兼容老配置/被删除的勋章） */
export function getMedalById(id: string): SystemMedal | null {
  return MEDAL_MAP[id] || null
}

/* ============================================================
 * 勋章墙视图构造（单一真相源）
 * ------------------------------------------------------------
 * 历史：buildMedalRows 原本只在 pages/index/index.ts 里，后来 settings.ts
 * 又复制了一份计数逻辑。P3 把它提到这里，让 index / settings / 新的 medals 页
 * 共用同一份计数 + 解锁写回逻辑，避免三处实现漂移。
 * ============================================================ */

/** 勋章墙单行视图：把 SystemMedal + 当前计数 + 用户目标 解析成渲染数据 */
export interface MedalView {
  id: string
  label: string
  icon: string
  current: number      // 已累计条数（cumulative 跨年；yearly 仅今年——当前只用 cumulative）
  target: number       // 用户改过的目标（缺省取 defaultTarget）
  percent: number      // 0-100（current>=target 钳到 100）
  unlocked: boolean    // current >= target 且在窗口内
  desc: string
  // === P2-6 节日限量徽章视图字段 ===
  limitedEdition: boolean      // 是否限量勋章（驱动角标/限时标签样式）
  inWindow: boolean            // 当前是否在解锁窗口内（窗口外灰显进度但不解锁）
  windowHint: string           // 窗口期文案（如「已解锁」「窗口期外」）
  // === 进度条字段（未解锁时显示 current/target 进度条；解锁后为 null）===
  progress: { current: number; target: number; percent: number } | null
}

/** 构造系统勋章墙视图：遍历内置 SYSTEM_MEDALS + 动态生成的「按分类连续打卡」勋章，
 *  按 scope 分流计数：
 *    - scope='cumulative'（阅读/观影）：用 countByCategory 算累计条数
 *    - scope='yearly' 且 category='checkin'（连续打卡）：用 calcLongestStreak 算历史最长连续天数
 *    - scope='yearly' 且 category='checkin:xxx'（分类连续打卡）：用该分类的最长连续天数
 *    - category='__any__'：用全量条数
 *
 *  副作用：首次解锁时把 unlockedAt 时间戳写回 preferences.systemMedals（持久化解锁时刻）。
 *  入参 prefs 会被就地修改（与原 index.ts 行为一致），调用方传入 loadPreferences() 结果即可。 */
export function buildMedalRows(
  prefs: AppPreferences,
  allAchievements: Item[],
  checkinDates: string[],
  checkins: Checkin[],
): MedalView[] {
  const counts = countByCategory(allAchievements)
  const checkinLongestStreak = calcLongestStreak(checkinDates)
  let dirty = false   // 是否有新解锁需要写回偏好

  // v7：按打卡分类分组的连胜天数（给「连续某分类 N 天」动态勋章用）
  // 每个出现过打卡的分类 → 该分类的最长连续天数
  const checkinCats = getAllCheckinCategories(prefs.customCheckinCategories)
  const streakByCat: { [catId: string]: number } = {}
  for (const cat of checkinCats) {
    const catDates = checkins.filter(c => c.category === cat.id).map(c => c.date)
    if (catDates.length > 0) {
      streakByCat[cat.id] = calcLongestStreak(catDates)
    }
  }

  // 合并内置勋章 + 动态生成的「按分类连续打卡」勋章
  const dynamicMedals: SystemMedal[] = []
  for (const cat of checkinCats) {
    // 只为「确实有打卡记录的」分类生成勋章（避免空分类刷一堆灰勋章）
    if (streakByCat[cat.id] !== undefined && cat.id !== 'other') {
      dynamicMedals.push(...buildCheckinCategoryMedals(cat.id, cat.label, cat.icon))
    }
  }
  const allMedals: SystemMedal[] = [...SYSTEM_MEDALS, ...dynamicMedals]

  const rows: MedalView[] = allMedals.map((md: SystemMedal) => {
    const saved = prefs.systemMedals[md.id]
    const target = (saved && saved.target > 0) ? saved.target : md.defaultTarget
    // P2-6 窗口判断：限量徽章在窗口外不解锁（但仍显示进度，让用户知道"差多少"）
    const now = new Date()
    const inWindow = isInUnlockWindow(now, md.unlockWindow)
    // scope 分流：全局打卡勋章用全局连胜；分类打卡勋章（'checkin:xxx'）用该分类连胜；
    //   __any__ 用全量条数；其它用分类计数
    // 计数分流（限量勋章优先：用窗口内录入数，而非全年累计，符合仪式感设计）：
    //   - limitedEdition + unlockWindow：统计 finishedDate 落在窗口内的条目数
    //   - 全局打卡勋章用全局连胜；分类打卡勋章（'checkin:xxx'）用该分类连胜；
    //   - __any__ 用全量条数；其它用分类计数
    let current: number
    if (md.limitedEdition && md.unlockWindow) {
      current = countItemsInWindow(allAchievements, md.unlockWindow)
    } else if (md.scope === 'yearly' && md.category === 'checkin') {
      current = checkinLongestStreak
    } else if (md.scope === 'yearly' && md.category.indexOf('checkin:') === 0) {
      const catId = md.category.slice('checkin:'.length)
      current = streakByCat[catId] || 0
    } else if (md.category === '__any__') {
      current = allAchievements.length
    } else {
      current = counts[md.category] || 0
    }
    const unlocked = inWindow && current >= target && target > 0
    // 首次解锁写回时间戳
    if (unlocked && saved && !saved.unlockedAt) {
      saved.unlockedAt = now.getTime()
      dirty = true
    } else if (unlocked && !saved) {
      prefs.systemMedals[md.id] = { target, unlockedAt: now.getTime() }
      dirty = true
    }
    const percent = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0
    // 进度条数据：未解锁时提供 current/target + 百分比，解锁后归零（不再显示进度条）
    const progress = !unlocked && target > 0
      ? { current, target, percent: Math.min(100, Math.round(current / target * 100)) }
      : null
    // P2-6 窗口提示文案
    const limitedEdition = !!md.limitedEdition
    let windowHint = ''
    if (limitedEdition && md.unlockWindow) {
      if (unlocked) {
        windowHint = '已解锁'
      } else if (inWindow) {
        windowHint = '解锁窗口期'
      } else {
        windowHint = '窗口期外'
      }
    }
    return {
      id: md.id,
      label: md.label,
      icon: md.icon,
      current,
      target,
      percent,
      unlocked,
      desc: md.desc,
      limitedEdition,
      inWindow,
      windowHint,
      progress,
    }
  })

  if (dirty) {
    updatePreferences({ systemMedals: prefs.systemMedals })
  }
  return rows
}

/** 便捷封装：自动加载偏好 + 成就 + 打卡数据并构造勋章墙视图。
 *  给不需要细粒度控制数据源的页面用（如新的 medals 页）。 */
export function loadMedalRows(): MedalView[] {
  const prefs = loadPreferences()
  const checkins = loadCheckins()
  return buildMedalRows(
    prefs,
    loadAllAchievements(),
    checkins.map(c => c.date),
    checkins,
  )
}

// 存储层函数，延迟导入避免循环（storage.ts 不依赖本文件，安全）
import { loadAllAchievements, loadCheckins } from './storage'

