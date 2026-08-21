// utils/dashboard.ts
// 首页仪表盘的「数据装配层」：把跨实体的加载 + 跨页面可能复用的聚合收口到一个入口，
// 让 pages/index 的 refresh() 只关心「怎么把数据摆进 UI」，不再关心「数据从哪几个 storage key 拼来」。
//
// 设计动机（重构前的问题）：
//   - index.refresh() 是 150 行的大函数，里面同时干三件事：
//     ① 加载 8 个 storage key（成就/愿望/灵感/打卡/报告/偏好/勋章状态…）
//     ② 算跨域聚合（overview / countByCategory / calcQuotes / calcCurrentStreakLenient / annualKeyword）
//     ③ 把聚合结果摆成首页 UI 视图（wallItems / rings / capsule / wrapped 入口…）
//   - 新人很难一眼看出哪些是「跨页面可能共享的聚合」（②）哪些是「首页专属的 UI」。
//   - stats / wrapped / list 也各自重算自己的那份 overview/countByCategory——口径容易漂移。
//
// 本文件承担 ① + ②，返回 DashboardSnapshot；首页只做 ③。
// 后续如果 stats/wrapped 页也想复用同一份累计聚合，可以直接读 snapshot.xxx，不必各自重算。
//
// 单一数据源约定：
//   - 勋章走 medal-config 的 loadMedalRows（已是单一真相源），这里只是透传不再重算。
//   - 心境、人格等更高阶的聚合目前没进快照（只有 wrapped 页用，首页不需要）。

import {
  Item,
  Checkin,
  Wish,
  ReportInstance,
  loadAllAchievements,
  loadCheckins,
  loadCheckinsByDate,
  loadWishes,
  loadInspirations,
  loadReports,
  loadYears,
} from './storage'
import { AppPreferences, loadPreferences, updatePreferences } from './preferences'
import { calcOverview, OverviewStats, countByCategory, calcCurrentStreakLenient, calcQuotes, QuoteEntry, calcAnnualKeywords } from './stats'
import { buildMedalRows, MedalView } from './medal-config'
import { formatDate } from './util'

/** 跨实体计数：入口卡片显示「N 个愿望 / M 条灵感 / K 份报告」用 */
export interface CountsSnapshot {
  wishTotal: number
  wishPending: number       // achievementId 为空的愿望数
  inspiration: number
  report: number
}

/** 打卡聚合：胶囊条 🔥 + 三环「今日打卡」+ 打卡页跳转入口都用 */
export interface CheckinSnapshot {
  checkins: Checkin[]
  streak: number            // 当前连续天数（calcCurrentStreakLenient 的宽容口径：今天没打但昨天打了也算）
  todayChecked: boolean
  todayCheckins: Checkin[]  // 今日全部打卡（多分类可能多条）
}

/** 仪表盘一次性快照：包含首页渲染需要的全部跨域聚合。
 *  首页 refresh() 拿到这个对象后只做 UI 视图构造，不再调任何 storage/stats 函数。 */
export interface DashboardSnapshot {
  year: number              // 当前年份（有数据取最新完成年份，否则取今年）
  years: number[]           // 有完成成就的年份列表（降序）
  prefs: AppPreferences
  allAchievements: Item[]   // 跨年累计已完成成就
  wishes: Wish[]
  reports: ReportInstance[]
  counts: CountsSnapshot
  checkin: CheckinSnapshot
  overview: OverviewStats   // 累计 overview（与 stats 页的「按年 overview」不同）
  categoryCounts: { [cat: string]: number }
  medalRows: MedalView[]    // 勋章（已含首次达成的 unlockedAt 写回副作用，与 loadMedalRows 同源）
  quotes: QuoteEntry[]      // 跨年累计金句（calcQuotes）
  annualKeyword: string     // 解析后的年度关键词（用户手写优先；空则算法推导并已回写 prefs）
  today: string             // 今日 'YYYY-MM-DD'（首页三环判定用）
}

/**
 * 一次性装配首页仪表盘需要的全部数据 + 跨域聚合。
 * 这是首页 refresh 的唯一数据入口——刷新时只调它一次，拿 Snapshot 去 setData。
 *
 * 副作用：
 *   - buildMedalRows 会写回首次达成的 unlockedAt（与 loadMedalRows 同款）。
 *   - annualKeyword 算法推导时会回写 prefs.annualKeyword/annualKeywordYear（与原 refresh 同款）。
 */
export function loadDashboardSnapshot(): DashboardSnapshot {
  const years = loadYears()
  const year = years.length > 0 ? years[0] : new Date().getFullYear()
  const allAchievements = loadAllAchievements()
  const prefs = loadPreferences()

  // 跨实体计数
  const wishes = loadWishes()
  const reports = loadReports()
  const counts: CountsSnapshot = {
    wishTotal: wishes.length,
    wishPending: wishes.filter(w => !w.achievementId).length,
    inspiration: loadInspirations().length,
    report: reports.length,
  }

  // 打卡聚合
  const checkins = loadCheckins()
  const today = formatDate(new Date())
  const todayCheckins = loadCheckinsByDate(today)
  const checkin: CheckinSnapshot = {
    checkins,
    streak: calcCurrentStreakLenient(checkins.map(c => c.date)),
    todayChecked: todayCheckins.length > 0,
    todayCheckins,
  }

  // 聚合派生
  const overview = calcOverview(allAchievements)
  const categoryCounts = countByCategory(allAchievements)
  const medalRows = buildMedalRows(
    prefs,
    allAchievements,
    checkins.map(c => c.date),
    checkins,
  )
  const quotes = calcQuotes(allAchievements)
  const annualKeyword = resolveAnnualKeyword(prefs, allAchievements, year)

  return {
    year,
    years,
    prefs,
    allAchievements,
    wishes,
    reports,
    counts,
    checkin,
    overview,
    categoryCounts,
    medalRows,
    quotes,
    annualKeyword,
    today,
  }
}

/** 解析年度关键词：用户手写且年份匹配 → 直接用；
 *  否则算法推导并回写偏好（持久化，避免每次 refresh 都算）。
 *  数据不足（<3 条）→ 返回空串（hero 区隐藏关键词行）。
 *  注意：即使推导出空串也回写，标记当年已尝试过，避免反复算。 */
function resolveAnnualKeyword(
  prefs: AppPreferences,
  allAchievements: Item[],
  year: number,
): string {
  if (prefs.annualKeyword && prefs.annualKeywordYear === year) {
    return prefs.annualKeyword
  }
  const candidates = calcAnnualKeywords(allAchievements)
  const picked = candidates.length > 0 ? candidates[0] : ''
  updatePreferences({ annualKeyword: picked, annualKeywordYear: year })
  return picked
}
