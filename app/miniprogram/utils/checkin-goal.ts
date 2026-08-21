// utils/checkin-goal.ts
// 打卡频率目标与完成率计算（第二批功能 1）。
//
// 设计：
//   - 不动 Checkin 记录层（纯记录，不含目标）；目标存偏好层 checkinGoals。
//   - 连胜口径完全不动（calcCurrentStreakLenient 仍按「连续多少天有打卡记录」）；
//     这里只算「当前周期窗口内实际打卡条数 vs 计划条数」的完成率。
//   - 周期窗口定义：
//       daily   = 今天（1 天窗口）
//       weekly  = 本周一到今天（按 ISO 周一为首日；窗口宽度 = 今天在本周的第几天）
//       monthly = 本月 1 号到今天
//   - 计划数（planned）按窗口宽度等比缩放，避免「月初第一天就显示 0/30」的挫败感：
//       daily planned = timesPerPeriod
//       weekly planned = round(timesPerPeriod * 已过天数 / 7)
//       monthly planned = round(timesPerPeriod * 已过天数 / 当月天数)
//     planned 夹到 [0, timesPerPeriod]，保证不超过整周期目标。
//
// 单独建文件（不进 stats.ts）的原因：stats.ts 受 lint:agg 守护（禁用 loadAllItems 等），
// 而本模块需要读 loadCheckins，与成就聚合无关，独立放避免误触 lint。

import { Checkin } from './storage'
import { AppPreferences, loadPreferences } from './preferences'
import { formatDate } from './util'

/** 打卡频率口径 */
export type CheckinFrequency = 'daily' | 'weekly' | 'monthly'

/** 单分类的打卡目标：多久打几次 */
export interface CheckinGoal {
  frequency: CheckinFrequency
  timesPerPeriod: number
}

/** 周期完成进度（给今日打卡行展示用） */
export interface CheckinProgress {
  periodLabel: string    // 「本周」「本月」「今日」
  planned: number        // 本周期计划打卡次数（按已过天数等比缩放）
  actual: number         // 本周期实际已打卡次数
  rate: number           // 完成率 0-1（planned=0 时为 0）
  isComplete: boolean    // 本周期是否已达整目标（actual >= timesPerPeriod）
  timesPerPeriod: number // 整周期目标次数（原始值，给进度文案「X/Y」用，Y 是整目标）
  progressText: string   // 「本周 3/5」格式化文案；无目标时为空串
}

/** 终身统计（给「总记录」卡 + 升级入口用） */
export interface LifetimeStats {
  firstDate: string      // 首次打卡日期 'YYYY-MM-DD'（无记录时空串）
  lastDate: string       // 最近一次打卡日期（无记录时空串）
  total: number          // 该分类累计打卡条数（含同日多分类，每条算 1）
  totalDays: number      // 该分类累计打卡天数（去重日期数）
}

/** 取某分类的目标；无目标返回 null（行为同现在，不展示进度）。 */
export function getGoalForCategory(catId: string, prefs?: AppPreferences): CheckinGoal | null {
  const p = prefs || loadPreferences()
  const goals = p.checkinGoals
  if (!goals) return null
  const g = goals[catId]
  if (!g || typeof g !== 'object') return null
  if (g.frequency !== 'daily' && g.frequency !== 'weekly' && g.frequency !== 'monthly') return null
  if (typeof g.timesPerPeriod !== 'number' || isNaN(g.timesPerPeriod) || g.timesPerPeriod <= 0) return null
  return { frequency: g.frequency, timesPerPeriod: Math.floor(g.timesPerPeriod) }
}

/** 算某分类在当前周期窗口内的完成进度。 */
export function calcPeriodProgress(
  goal: CheckinGoal,
  allCheckins: Checkin[],
  category: string,
  now?: Date,
): CheckinProgress {
  const today = now || new Date()
  const todayStr = formatDate(today)
  const { startStr, elapsedDays, totalDays, periodLabel } = periodWindow(goal.frequency, today)

  // 实际打卡条数：窗口起始到今天，该分类的打卡条数（复合唯一保证一天一条，
  // 但窗口可能跨多天，所以直接 count 即可）
  let actual = 0
  for (const c of allCheckins) {
    if (c.category !== category) continue
    if (c.date >= startStr && c.date <= todayStr) actual++
  }

  // 计划数：按已过天数等比缩放（避免月初/周初就显示 0/N 的挫败感）
  let planned: number
  if (goal.frequency === 'daily') {
    planned = goal.timesPerPeriod
  } else {
    const ratio = elapsedDays / totalDays
    planned = Math.round(goal.timesPerPeriod * ratio)
  }
  // 夹到 [0, timesPerPeriod]
  if (planned < 0) planned = 0
  if (planned > goal.timesPerPeriod) planned = goal.timesPerPeriod

  const rate = planned > 0 ? actual / planned : 0
  const isComplete = actual >= goal.timesPerPeriod
  const progressText = periodLabel + ' ' + String(actual) + '/' + String(goal.timesPerPeriod)

  return {
    periodLabel,
    planned,
    actual,
    rate: Math.max(0, rate),
    isComplete,
    timesPerPeriod: goal.timesPerPeriod,
    progressText,
  }
}

/** 算某分类的终身统计。 */
export function calcLifetimeStats(allCheckins: Checkin[], category: string): LifetimeStats {
  const catCheckins = allCheckins.filter(c => c.category === category)
  if (catCheckins.length === 0) {
    return { firstDate: '', lastDate: '', total: 0, totalDays: 0 }
  }
  const dates = catCheckins.map(c => c.date).sort()
  const uniqueDays = new Set(dates)
  return {
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    total: catCheckins.length,
    totalDays: uniqueDays.size,
  }
}

/** 算周期窗口的起始日期 + 已过天数 + 总天数 + 标签。
 *  周窗口按 ISO 周一为首日（周日=7）。 */
function periodWindow(
  frequency: CheckinFrequency,
  today: Date,
): { startStr: string; elapsedDays: number; totalDays: number; periodLabel: string } {
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()

  if (frequency === 'daily') {
    return {
      startStr: formatDate(today),
      elapsedDays: 1,
      totalDays: 1,
      periodLabel: '今日',
    }
  }

  if (frequency === 'weekly') {
    // ISO 周一为首日：周日 getDay()=0 → 7
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay()
    const monday = new Date(y, m, d - (dayOfWeek - 1), 12, 0, 0, 0)
    return {
      startStr: formatDate(monday),
      elapsedDays: dayOfWeek,          // 周一=1 ... 周日=7
      totalDays: 7,
      periodLabel: '本周',
    }
  }

  // monthly
  const firstOfMonth = new Date(y, m, 1, 12, 0, 0, 0)
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  return {
    startStr: formatDate(firstOfMonth),
    elapsedDays: d,
    totalDays: daysInMonth,
    periodLabel: '本月',
  }
}
