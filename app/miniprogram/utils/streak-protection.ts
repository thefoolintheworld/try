// utils/streak-protection.ts
// 连胜保护系统：每月发券 + 断了自动消耗 + 衰减式 Habit Score。
//
// 设计哲学：
//  - 纯脆性 streak（"断一天归零"）违反人性 —— 用户出差/生病一天就丢掉 100 天连胜，挫败感劝退。
//  - 双管齐下解决：
//    ① 连胜保护券（借鉴 Duolingo Streak Freeze）：每月自动发 1 张，上限 3 张，
//       断了一天自动消耗 1 张，连胜天数不归零（只标记"用了 1 张保护"）。
//    ② 衰减式 Habit Score（借鉴 uhabits Habit Score）：不算脆性连续，按"最近 60 天打卡频率"算 0-100 分，
//       错过几天只是分数下降，不会一刀归零。
//  - 两个指标共存：streak 给"瞬时反馈"（大数字冲击），score 给"长期健康度"（不容易劝退）。
//
// 注意：
//  - 发券 / 消耗券都涉及 preferences 读写，是有副作用的；与纯计算的 stats.ts 分开放。
//  - 调用方约定：在打卡页 onShow 时调 refreshFreebies()（可能发新券）；
//    在用户看到"昨天没打卡但还有券"的场景调 applyProtectionIfBroken()（消耗券保护连胜）。

import { loadPreferences, updatePreferences, AppPreferences, ProtectedDateEntry } from './preferences'
import { calcCurrentStreakLenient } from './stats'
import { Checkin } from './storage'

/** 保护券上限（最多囤 3 张，避免老用户囤一年刷通关） */
const MAX_FREEBIES = 3

/** 取当前月份字符串 'YYYY-MM'（本地时区） */
function currentMonth(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return y + '-' + m
}

/** 检查并发放本月保护券（每月最多发 1 次；超过 MAX_FREEBIES 不再叠加）。
 *  幂等：同月重复调用只发一次（依据 lastFreebieMonth）。返回发放后的券数。 */
export function refreshFreebies(): number {
  const prefs = loadPreferences()
  if (prefs.streakProtectionEnabled === false) return 0   // 用户关闭了功能
  const month = currentMonth()
  if (prefs.lastFreebieMonth === month) {
    return prefs.streakFreebies || 0   // 本月已发过
  }
  // 新的一月：发券
  const current = prefs.streakFreebies || 0
  const next = Math.min(MAX_FREEBIES, current + 1)
  updatePreferences({
    streakFreebies: next,
    lastFreebieMonth: month,
  })
  return next
}

/** 取当前券数（无副作用，纯读） */
export function getFreebies(): number {
  const prefs = loadPreferences()
  if (prefs.streakProtectionEnabled === false) return 0
  return prefs.streakFreebies || 0
}

/** 功能是否启用（默认 true；用户没设过也算启用） */
export function isProtectionEnabled(): boolean {
  return loadPreferences().streakProtectionEnabled !== false
}

/** 设置功能开关 */
export function setProtectionEnabled(enabled: boolean): void {
  updatePreferences({ streakProtectionEnabled: enabled })
}

/* ============================================================
 * 衰减式 Habit Score（借鉴 uhabits）
 * 算法：遍历最近 N 天的打卡记录，每天打卡加分，越近的加分权重越高；
 * 错过几天只是少加分，不会一刀清零。返回 0-100 整数。
 * ============================================================ */

/** 计算衰减式习惯强度分（0-100）。
 *  dates 是打卡日期字符串数组（'YYYY-MM-DD'）；windowDays 是回看窗口，默认 60 天。
 *  参考 uhabits 的"指数衰减"思路：今天打卡得 1 分，昨天得 0.99 分，前天 0.98 ... 越早权重越低。
 *  分数 = 累计权重 / 窗口天数 × 100（百分比形式的"习惯强度"）。 */
export function calcHabitScore(dates: string[], windowDays: number = 60): number {
  if (!dates || dates.length === 0) return 0
  const set = new Set(dates)   // 同一天多条算 1 条
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const DAY_MS = 24 * 60 * 60 * 1000
  let weightedSum = 0
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today.getTime() - i * DAY_MS)
    const dateStr = formatYMD(d)
    if (set.has(dateStr)) {
      // 指数衰减：今天=1，昨天≈0.985，一周前≈0.9，一个月前≈0.6，两个月前≈0.36
      // 用 Math.exp(-i / 50)：i=0→1, i=50→e^-1≈0.37, i=100→e^-2≈0.13
      weightedSum += Math.exp(-i / 50)
    }
  }
  // 完美打卡（每天打）的累计权重≈∑e^(-i/50) for i=0..59 ≈ 39.5（积分近似）
  // 用 39.5 归一化到 0-100；实际算一下精确积分避免硬编码
  const fullSum = sumExpWeights(windowDays)
  const ratio = weightedSum / fullSum
  const score = Math.round(ratio * 100)
  return Math.min(100, Math.max(0, score))
}

/** 计算 windowDays 天里"每天打卡"的累计权重（用于归一化）。
 *  ∑_{i=0}^{n-1} e^(-i/50) = 50 × (1 - e^(-n/50))（等比数列求和） */
function sumExpWeights(n: number): number {
  const k = 50
  return k * (1 - Math.exp(-n / k))
}

/** Date → 'YYYY-MM-DD'（本地时区） */
function formatYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

/* ============================================================
 * 把分数转成"等级文案"（打卡页用）
 * ============================================================ */
export function habitScoreLevel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: '习惯大师', color: '#D97A4A' }
  if (score >= 70) return { label: '稳定保持', color: '#6B8E5A' }
  if (score >= 40) return { label: '渐入佳境', color: '#E8A33D' }
  if (score >= 10) return { label: '初养成', color: '#8B7D6E' }
  return { label: '待加油', color: '#C05650' }
}

/** 给 UI 显示当前保护券状态文案（打卡页用） */
export function freebieStatusText(): string {
  if (!isProtectionEnabled()) return '已关闭连胜保护'
  const n = getFreebies()
  if (n === 0) return '本月保护券已用完'
  return '剩余保护券 ' + n + ' 张'
}

/* ============================================================
 * 手动用券保护连胜（补上从未实现的消耗路径）
 *
 * 设计：连胜天数是纯计算（calcCurrentStreakLenient），不存盘、对券零感知。
 * 用券保住连胜 = 把断档那天作为"虚拟打卡日"记进 protectedCheckinDates，
 * 算连胜前合并进真实 dates（mergeProtectedDates）。算法函数本身零改动。
 * 全局连胜和分类连胜共享同一券池（streakFreebies），由 scope 区分保护记录。
 * ============================================================ */

/** 全局连胜的 scope 标识（分类连胜用分类 id 作 scope）。 */
export const GLOBAL_SCOPE = '__global__'

/** 某 scope 的连胜状态（设置页 sheet 渲染用）。 */
export interface StreakStatus {
  scope: string       // GLOBAL_SCOPE 或分类 id
  label: string       // 显示名（"全局连胜" / "阅读"）
  streak: number      // 保住后的连续天数（已合并保护日期后算）
  isBroken: boolean   // 是否断了（保住前的真实口径 streak === 0）
  brokenDate: string  // 断档那天 'YYYY-MM-DD'（没断则空）
  canProtect: boolean // 能否用券（isBroken && freebies > 0 && protectionOn && !hasProtected）
  hasProtected: boolean // 该 scope 该断档日是否已用券保护过（避免重复花券）
  protectedStreak: number // 若已保护，保住的天数（= streak）；用于文案区分
}

/** 取某 scope 已用券保护过的日期列表。 */
export function getProtectedDates(scope: string): ProtectedDateEntry[] {
  const all = loadPreferences().protectedCheckinDates || []
  return all.filter(e => e.scope === scope)
}

/** 把某 scope 的保护日期合并进真实 dates（去重），返回新数组。
 *  保护关闭时返回原数组（不合并）。给 calcCurrentStreakLenient 用，不改算法函数。 */
export function mergeProtectedDates(realDates: string[], scope: string): string[] {
  if (!isProtectionEnabled()) return realDates
  const protectedDates = getProtectedDates(scope).map(e => e.date)
  if (protectedDates.length === 0) return realDates
  return [...new Set([...realDates, ...protectedDates])]
}

/** 手动用券保护连胜（唯一会减券的函数）。
 *  @param scope GLOBAL_SCOPE 或分类 id
 *  @param brokenDate 断档的那天 'YYYY-MM-DD'
 *  @returns true = 成功消耗 1 张券并记录；false = 券不够/已保护过/保护关闭/无效日期 */
export function useFreebie(scope: string, brokenDate: string): boolean {
  if (!isProtectionEnabled()) return false
  if (!scope || typeof brokenDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(brokenDate)) return false
  const prefs = loadPreferences()
  const freebies = prefs.streakFreebies || 0
  if (freebies <= 0) return false
  // 幂等：同 scope 同 date 已保护过 → 不重复扣券
  const existing = prefs.protectedCheckinDates || []
  const alreadyProtected = existing.some(e => e.scope === scope && e.date === brokenDate)
  if (alreadyProtected) return false
  const nextDates = [...existing, { scope, date: brokenDate }]
  updatePreferences({
    streakFreebies: freebies - 1,
    protectedCheckinDates: nextDates,
  })
  return true
}

/** 找出断档那天：从今天往前找第一个"真实 dates 里没有"的相邻日。
 *  口径与 calcCurrentStreakLenient 一致（今天没打→看昨天；昨天也没→断）。
 *  返回断档日 'YYYY-MM-DD'；没断返回 ''。 */
function findBrokenDate(realDates: string[]): string {
  if (realDates.length === 0) return ''
  const set = new Set(realDates)
  const today = formatYMD(new Date())
  // 今天没打卡：看昨天有没有
  if (!set.has(today)) {
    const yesterday = shiftLocalDay(today, -1)
    // 昨天有打卡 → 今天还没断（有补打卡余地），断档日 = 今天（若用户想保护今天）
    // 昨天也没 → 断档日 = 昨天（真实断点）
    if (!set.has(yesterday)) return yesterday
    return today  // 今天还没打但昨天打了：还没真断，但允许保护"今天"以防万一
  }
  // 今天有打卡 → 没断
  return ''
}

/** 'YYYY-MM-DD' 加减一天（本地时区，复用 formatYMD）。 */
function shiftLocalDay(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10))
  const base = new Date(y, m - 1, d, 12, 0, 0, 0)
  base.setDate(base.getDate() + delta)
  return formatYMD(base)
}

/** 取某 scope 的连胜状态（给设置页 sheet 用）。
 *  @param scope GLOBAL_SCOPE 或分类 id
 *  @param realDates 该 scope 的真实打卡日期（去重后）
 *  @param label 显示名 */
export function getStreakStatus(scope: string, realDates: string[], label: string): StreakStatus {
  const brokenDate = findBrokenDate(realDates)
  const isBroken = brokenDate !== ''
  // 保住后的连胜：合并保护日期再算
  const merged = mergeProtectedDates(realDates, scope)
  const streak = calcCurrentStreakLenient(merged)
  const protectedEntries = getProtectedDates(scope)
  const hasProtected = isBroken && protectedEntries.some(e => e.date === brokenDate)
  const freebies = getFreebies()
  const canProtect = isBroken && !hasProtected && freebies > 0 && isProtectionEnabled()
  return {
    scope,
    label,
    streak,
    isBroken,
    brokenDate,
    canProtect,
    hasProtected,
    protectedStreak: hasProtected ? streak : 0,
  }
}

/** 分类选项的最小形态（给 buildStreakStatuses 用）。 */
export interface StreakCategoryInfo {
  id: string
  label: string
}

/** 取所有 scope 的连胜状态列表（全局 + 各分类），给设置页 sheet 用。
 *  @param allCheckins 全部打卡记录
 *  @param categories 分类列表（含 label；空数组则只返回全局）
 *  @returns 全局 + 每个分类的 StreakStatus；断了且能保护的排在前面（用户最关心） */
export function buildStreakStatuses(allCheckins: Checkin[], categories: StreakCategoryInfo[]): StreakStatus[] {
  // 全局：所有打卡日期去重
  const allDates = [...new Set(allCheckins.map(c => c.date))]
  const statuses: StreakStatus[] = [getStreakStatus(GLOBAL_SCOPE, allDates, '全局连胜')]
  // 各分类：过滤出该分类的打卡日期
  for (const cat of categories) {
    const catDates = [...new Set(allCheckins.filter(c => c.category === cat.id).map(c => c.date))]
    // 该分类从未打过卡 → 不显示（没意义的断态）
    if (catDates.length === 0) continue
    statuses.push(getStreakStatus(cat.id, catDates, cat.label))
  }
  // 排序：断了且能保护的在前，其次断了的，最后没断的
  statuses.sort((a, b) => {
    if (a.canProtect !== b.canProtect) return a.canProtect ? -1 : 1
    if (a.isBroken !== b.isBroken) return a.isBroken ? -1 : 1
    return 0
  })
  return statuses
}

/** 应用偏好（给设置页用） */
export type { AppPreferences }
