/**
 * 打卡多分类 数据层验证脚本（Node 环境，非 wx）
 *
 * 验证目标（对应 A1/A4 改动）：
 *   1. addCheckin 的 (date, category) 复合唯一——同日同分类拒重；同日不同分类可并存。
 *   2. loadCheckinsByDate 返回当日全部打卡（多条）；loadCheckinByDate 兼容返回首条。
 *   3. loadCheckinById 按 id 精确查。
 *   4. updateCheckin 改 date/category 时的新 (date,category) 冲突校验。
 *   5. deleteCheckin 删除生效。
 *   6. 按分类 filter 后 calcLongestStreak 各自独立——多分类不互相污染连胜。
 *   7. buildCheckinCategoryMedals 生成的动态勋章 id 稳定（同分类每次相同）+ 结构合法。
 *
 * 运行：tsc 转译后 `node run.js`（见 run.ts）。
 */
import {
  addCheckin,
  updateCheckin,
  deleteCheckin,
  loadCheckins,
  loadCheckinsByDate,
  loadCheckinByDate,
  loadCheckinById,
  Checkin,
  _resetMigrationCache,
} from '../../miniprogram/utils/storage'
import { calcLongestStreak, calcCurrentStreakLenient } from '../../miniprogram/utils/stats'
import {
  buildCheckinCategoryMedals,
  STREAK_MEDAL_DAYS,
  SystemMedal,
} from '../../miniprogram/utils/medal-config'
import {
  getGoalForCategory,
  calcPeriodProgress,
  calcLifetimeStats,
  CheckinGoal,
} from '../../miniprogram/utils/checkin-goal'
import { updatePreferences, loadPreferences } from '../../miniprogram/utils/preferences'
import {
  useFreebie,
  mergeProtectedDates,
  getStreakStatus,
  buildStreakStatuses,
  GLOBAL_SCOPE,
  StreakStatus,
} from '../../miniprogram/utils/streak-protection'

let pass = 0
let fail = 0

function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

function resetStore() {
  // @ts-ignore mock
  wx._reset()
  _resetMigrationCache()   // 让短路标记回到 false，否则跨场景迁移被跳过
}

/** 造一条 addCheckin 入参（最小必填）。 */
function mk(date: string, category: string, note = '') {
  return { date, category, note }
}

/** 往某分类连续 N 天打卡（从 startDate 起，含 startDate）。 */
function seedStreak(category: string, startDate: string, days: number) {
  const base = new Date(startDate)
  for (let i = 0; i < days; i++) {
    const d = new Date(base.getTime() + i * 86400000)
    const iso = d.toISOString().slice(0, 10)
    const r = addCheckin(mk(iso, category))
    if (!r.ok) throw new Error('seedStreak 失败 @ ' + iso + ': ' + r.msg)
  }
}

/** 往某分类连续 N 天打卡（用本地日期构造，避免 toISOString 的 UTC 偏移）。
 *  P4 场景 8 用——calcPeriodProgress 内部用本地正午构造窗口，测试造数要对齐。 */
function seedStreakAbs(category: string, startDate: string, days: number) {
  const [y, m, d] = startDate.split('-').map(s => parseInt(s, 10))
  for (let i = 0; i < days; i++) {
    const dt = new Date(y, m - 1, d + i, 12, 0, 0, 0)
    const yyyy = dt.getFullYear()
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    const iso = yyyy + '-' + mm + '-' + dd
    const r = addCheckin(mk(iso, category))
    if (!r.ok) throw new Error('seedStreakAbs 失败 @ ' + iso + ': ' + r.msg)
  }
}

/** 本地时区的"今天" 'YYYY-MM-DD'（与 stats.formatDateForStreak / protection.formatYMD 同口径）。 */
function localTodayStr(): string {
  const d = new Date()
  const pad = (n: number) => (n < 10 ? '0' + String(n) : String(n))
  return String(d.getFullYear()) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 本地时区的某日期加减 N 天，返回 'YYYY-MM-DD'（正午构造避免跨日漂移）。 */
function localShiftDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10))
  const base = new Date(y, m - 1, d, 12, 0, 0, 0)
  base.setDate(base.getDate() + delta)
  const pad = (n: number) => (n < 10 ? '0' + String(n) : String(n))
  return String(base.getFullYear()) + '-' + pad(base.getMonth() + 1) + '-' + pad(base.getDate())
}

export function runAll(): boolean {
  console.log('\n=== 场景 1：(date, category) 复合唯一 ===')
  resetStore()
  {
    // 同一天同分类第二条应被拒
    const r1 = addCheckin(mk('2026-08-13', 'reading'))
    const r2 = addCheckin(mk('2026-08-13', 'reading'))
    assert(r1.ok === true, '同日同分类首条应成功')
    assert(r2.ok === false && r2.msg.indexOf('已打卡') >= 0, '同日同分类第二条应被拒（msg 含「已打卡」）')

    // 同一天不同分类可并存
    const r3 = addCheckin(mk('2026-08-13', 'exercise'))
    const r4 = addCheckin(mk('2026-08-13', 'meditation'))
    assert(r3.ok === true && r4.ok === true, '同日不同分类可并存')

    // 当日应有 3 条
    const list = loadCheckinsByDate('2026-08-13')
    assert(list.length === 3, 'loadCheckinsByDate 返回当日全部（3 条）')
    const cats = list.map(c => c.category).sort()
    assert(JSON.stringify(cats) === JSON.stringify(['exercise', 'meditation', 'reading']),
      '当日分类集合 = [exercise, meditation, reading]')

    // loadCheckinByDate 兼容返回首条（非空）
    const head = loadCheckinByDate('2026-08-13')
    assert(head !== null && typeof head.id === 'string', 'loadCheckinByDate 返回首条（非空）')

    // 全局总数 3
    assert(loadCheckins().length === 3, 'loadCheckins 全局总数 = 3')
  }

  console.log('\n=== 场景 2：loadCheckinById 按 id 精确查 ===')
  resetStore()
  {
    const r = addCheckin(mk('2026-08-13', 'reading'))
    const id = r.checkin!.id
    const found = loadCheckinById(id)
    assert(found !== null && found!.id === id, '按 id 命中')
    const miss = loadCheckinById('not-exist')
    assert(miss === null, '不存在 id 返回 null')
  }

  console.log('\n=== 场景 3：updateCheckin 新 (date,category) 冲突校验 ===')
  resetStore()
  {
    const a = addCheckin(mk('2026-08-13', 'reading')).checkin!
    const b = addCheckin(mk('2026-08-13', 'exercise')).checkin!
    // 把 b 改成与 a 同 (date, category) → 冲突，应返回 false 且不影响原数据
    const clash = updateCheckin(b.id, { category: 'reading' })
    assert(clash === false, '改成已占用的 (date, category) 应被拒')
    const bAfter = loadCheckinById(b.id)
    assert(bAfter !== null && bAfter!.category === 'exercise', '被拒后原记录未被污染')

    // 把 b 改成不冲突的 (date, category) → 成功
    const ok2 = updateCheckin(b.id, { date: '2026-08-14', category: 'meditation' })
    assert(ok2 === true, '改成空闲 (date, category) 应成功')
    const bMoved = loadCheckinById(b.id)
    assert(bMoved!.date === '2026-08-14' && bMoved!.category === 'meditation', '移动后字段正确')

    // 只改 note（不触发冲突校验）应成功
    const ok3 = updateCheckin(a.id, { note: '加了备注' })
    assert(ok3 === true, '只改 note 应成功（不触发冲突校验）')
    const aNote = loadCheckinById(a.id)
    assert(aNote!.note === '加了备注', '备注写入正确')
  }

  console.log('\n=== 场景 4：deleteCheckin 删除生效 ===')
  resetStore()
  {
    const a = addCheckin(mk('2026-08-13', 'reading')).checkin!
    assert(loadCheckins().length === 1, '删前 1 条')
    const ok = deleteCheckin(a.id)
    assert(ok === true, 'deleteCheckin 返回 true')
    assert(loadCheckins().length === 0, '删后 0 条')
    const miss = deleteCheckin('not-exist')
    assert(miss === false, '删不存在 id 返回 false')
  }

  console.log('\n=== 场景 5：按分类独立连胜（不互相污染）===')
  resetStore()
  {
    // reading 连续 5 天（8/9-8/13）
    seedStreak('reading', '2026-08-09', 5)
    // exercise 连续 2 天（8/12-8/13），中间断档
    seedStreak('exercise', '2026-08-12', 2)
    // meditation 单点 8/13
    seedStreak('meditation', '2026-08-13', 1)

    const all = loadCheckins()
    const readingDates = all.filter(c => c.category === 'reading').map(c => c.date)
    const exerciseDates = all.filter(c => c.category === 'exercise').map(c => c.date)
    const mediDates = all.filter(c => c.category === 'meditation').map(c => c.date)

    assert(calcLongestStreak(readingDates) === 5, 'reading 最长连胜 = 5')
    assert(calcLongestStreak(exerciseDates) === 2, 'exercise 最长连胜 = 2')
    assert(calcLongestStreak(mediDates) === 1, 'meditation 最长连胜 = 1')

    // 全量 dates（合并所有分类）的最长连胜——8/9-8/13 连续 5 天（每天至少一条）
    const allDates = all.map(c => c.date)
    assert(calcLongestStreak(allDates) === 5, '全局合并连胜 = 5（8/9-8/13 每天有打卡）')

    // 多分类独立：往 exercise 多打一天（8/14）不应提升 reading 的连胜
    addCheckin(mk('2026-08-14', 'exercise'))
    const readingAfter = loadCheckins().filter(c => c.category === 'reading').map(c => c.date)
    assert(calcLongestStreak(readingAfter) === 5, 'exercise 加打卡后 reading 连胜仍 = 5（分类隔离）')
  }

  console.log('\n=== 场景 6：buildCheckinCategoryMedals 动态勋章 ===')
  {
    const readingMedals = buildCheckinCategoryMedals('reading', '阅读', '📖')
    assert(readingMedals.length === STREAK_MEDAL_DAYS.length, '生成分档数 = STREAK_MEDAL_DAYS 长度（3）')

    // id 稳定性：同分类每次生成相同 id
    const again = buildCheckinCategoryMedals('reading', '阅读', '📖')
    assert(readingMedals.every((m, i) => m.id === again[i].id), '同分类每次生成的勋章 id 稳定')

    // id 形如 medal-streak-{days}-{catId}
    const expectedIds = ['medal-streak-7-reading', 'medal-streak-30-reading', 'medal-streak-100-reading']
    assert(readingMedals.every((m, i) => m.id === expectedIds[i]), 'id 形如 medal-streak-{N}-{cat}')

    // category 前缀为 'checkin:' + catId（给 buildMedalRows 分流用）
    assert(readingMedals.every(m => m.category === 'checkin:reading'),
      'category = checkin:reading（分流前缀）')

    // 每枚结构合法：有 label/icon/desc/defaultTarget
    assert(readingMedals.every(m => !!m.label && !!m.icon && !!m.desc && m.defaultTarget > 0),
      '每枚结构完整（label/icon/desc/defaultTarget）')

    // 不同分类的 id 不冲突
    const exMedals = buildCheckinCategoryMedals('exercise', '运动', '🏃')
    const overlap = readingMedals.some(r => exMedals.some(e => e.id === r.id))
    assert(overlap === false, '不同分类的勋章 id 不重叠')

    // 'other' 分类不生成（按设计）
    const otherMedals = buildCheckinCategoryMedals('other', '其它', '✦')
    assert(otherMedals.length === 0, "'other' 分类不生成动态勋章")
  }

  console.log('\n=== 场景 7：v7 迁移兼容老数据（一天一条天然兼容）===')
  resetStore()
  {
    // 模拟老数据：一天一条，各自带 category
    // @ts-ignore mock
    wx._rawSet('checkins', [
      { id: 'old-1', date: '2026-08-12', category: 'reading', createdAt: 1 },
      { id: 'old-2', date: '2026-08-13', category: 'reading', createdAt: 2 },
    ])
    // 不应触发任何数据转换；老数据按既有读法应可读出
    const list = loadCheckins()
    assert(list.length === 2, '老数据 2 条可读')
    // 新增打卡不会因老数据冲突
    const r = addCheckin(mk('2026-08-13', 'exercise'))
    assert(r.ok === true, '老数据存在时新分类打卡成功（不同分类不冲突）')
    // 但同分类同日会冲突
    const r2 = addCheckin(mk('2026-08-13', 'reading'))
    assert(r2.ok === false, '老数据同日同分类新打卡被拒（唯一约束生效于老数据）')
  }

  console.log('\n=== 场景 8：打卡频率目标 + 完成率 + 终身统计（P4）===')
  resetStore()
  {
    // —— 8a. getGoalForCategory：无目标返回 null；设目标后正确读回 ——
    const prefs0 = loadPreferences()
    assert(getGoalForCategory('reading', prefs0) === null, '未设目标的分类返回 null（行为同现在）')
    const goal: CheckinGoal = { frequency: 'weekly', timesPerPeriod: 3 }
    updatePreferences({ checkinGoals: { reading: goal } })
    const g1 = getGoalForCategory('reading', loadPreferences())
    assert(!!g1 && g1!.frequency === 'weekly' && g1!.timesPerPeriod === 3, '设目标后 getGoalForCategory 正确读回')
    // 非法目标被清洗函数剔除（frequency 枚举外 / timesPerPeriod < 1）
    // @ts-ignore mock 直接写脏数据
    wx._rawSet('app_preferences', { checkinGoals: { reading: { frequency: 'xxx', timesPerPeriod: 3 } } })
    assert(getGoalForCategory('reading', loadPreferences()) === null, '非法 frequency 被清洗剔除')
    // @ts-ignore mock
    wx._rawSet('app_preferences', { checkinGoals: { reading: { frequency: 'daily', timesPerPeriod: 0 } } })
    assert(getGoalForCategory('reading', loadPreferences()) === null, 'timesPerPeriod < 1 被清洗剔除')

    // —— 8b. calcPeriodProgress weekly：周三时窗口=周一到周三，计划数按 3/7 等比缩放 ——
    resetStore()
    updatePreferences({ checkinGoals: { exercise: { frequency: 'weekly', timesPerPeriod: 7 } } })
    // 固定 now = 2026-08-12（周三；8-10 周一）
    const wed = new Date(2026, 7, 12, 15, 0, 0, 0)
    seedStreakAbs('exercise', '2026-08-10', 1)   // 周一打了
    seedStreakAbs('exercise', '2026-08-12', 1)   // 周三打了
    const all = loadCheckins()
    const prog = calcPeriodProgress(
      { frequency: 'weekly', timesPerPeriod: 7 }, all, 'exercise', wed,
    )
    assert(prog.periodLabel === '本周', 'weekly 窗口标签 = 本周')
    assert(prog.actual === 2, 'weekly 实际打卡 = 2（周一+周三）')
    // 计划数 = round(7 * 3/7) = 3（周三 = 已过 3 天）
    assert(prog.planned === 3, 'weekly 计划数按已过天数等比缩放：round(7 * 3/7) = 3')
    assert(prog.isComplete === false, '未达整目标 7 次 → isComplete = false')
    assert(prog.progressText === '本周 2/7', 'progressText 格式 = 本周 actual/timesPerPeriod')

    // —— 8c. calcPeriodProgress monthly：15 号时计划数按 15/31 缩放 ——
    resetStore()
    const aug15 = new Date(2026, 7, 15, 15, 0, 0, 0)   // 8 月有 31 天
    seedStreakAbs('reading', '2026-08-01', 10)          // 1-10 号每天打
    const prog2 = calcPeriodProgress(
      { frequency: 'monthly', timesPerPeriod: 31 }, loadCheckins(), 'reading', aug15,
    )
    assert(prog2.periodLabel === '本月', 'monthly 窗口标签 = 本月')
    assert(prog2.actual === 10, 'monthly 实际打卡 = 10（1-10 号）')
    // 计划数 = round(31 * 15/31) = 15
    assert(prog2.planned === 15, 'monthly 计划数按已过天数等比缩放：round(31 * 15/31) = 15')
    assert(prog2.isComplete === false, '未达整目标 31 次 → isComplete = false')

    // —— 8d. 达成整目标时 isComplete = true ——
    resetStore()
    const today2 = new Date(2026, 7, 12, 15, 0, 0, 0)
    seedStreakAbs('meditation', '2026-08-10', 3)   // 周一到周三每天打 = 3 次
    const prog3 = calcPeriodProgress(
      { frequency: 'weekly', timesPerPeriod: 3 }, loadCheckins(), 'meditation', today2,
    )
    assert(prog3.isComplete === true, '实际 3 >= 整目标 3 → isComplete = true')

    // —— 8e. calcPeriodProgress daily：计划数恒等于 timesPerPeriod（不缩放）——
    resetStore()
    const prog4 = calcPeriodProgress(
      { frequency: 'daily', timesPerPeriod: 1 }, [], 'reading', wed,
    )
    assert(prog4.planned === 1, 'daily 计划数恒 = timesPerPeriod（不缩放）')
    assert(prog4.periodLabel === '今日', 'daily 窗口标签 = 今日')

    // —— 8f. calcLifetimeStats：首末次 + 总次 + 总天数 ——
    resetStore()
    seedStreakAbs('reading', '2026-08-01', 5)    // 8-01 ~ 8-05
    seedStreakAbs('reading', '2026-08-10', 2)    // 8-10, 8-11
    const lt = calcLifetimeStats(loadCheckins(), 'reading')
    assert(lt.total === 7, 'lifetime total = 7（5+2 条）')
    assert(lt.totalDays === 7, 'lifetime totalDays = 7（去重日期数）')
    assert(lt.firstDate === '2026-08-01', 'lifetime firstDate = 2026-08-01')
    assert(lt.lastDate === '2026-08-11', 'lifetime lastDate = 2026-08-11')
    // 空分类
    const lt2 = calcLifetimeStats(loadCheckins(), 'exercise')
    assert(lt2.total === 0 && lt2.firstDate === '' && lt2.lastDate === '', '无记录的分类 lifetime 全空/0')
  }

  console.log('\n=== 场景 9：连胜保护券手动使用 ===')

  // —— 9a. useFreebie：券足够 → 扣 1 + 记保护日期 ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 2 })
    const ok = useFreebie(GLOBAL_SCOPE, '2026-08-18')
    const prefs = loadPreferences()
    assert(ok === true, 'useFreebie 券足够应返回 true')
    assert(prefs.streakFreebies === 1, '用券后 streakFreebies 应 -1 = 1')
    const entries = prefs.protectedCheckinDates || []
    assert(entries.length === 1 && entries[0].scope === GLOBAL_SCOPE && entries[0].date === '2026-08-18',
      '应记一条 protectedCheckinDates { scope=global, date=08-18 }')
  }

  // —— 9b. useFreebie 幂等：同 scope 同 date 重复 → 返回 false 不重复扣券 ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 3 })
    const ok1 = useFreebie('reading', '2026-08-18')
    const ok2 = useFreebie('reading', '2026-08-18')
    const prefs = loadPreferences()
    assert(ok1 === true && ok2 === false, '同 scope 同 date 第二次用券应被拒（幂等）')
    assert(prefs.streakFreebies === 2, '幂等拒绝后只扣 1 张（= 2）')
    assert((prefs.protectedCheckinDates || []).length === 1, '幂等拒绝后只记 1 条保护日期')
  }

  // —— 9c. useFreebie 券不够 → 返回 false 不扣 ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 0 })
    const ok = useFreebie('reading', '2026-08-18')
    const prefs = loadPreferences()
    assert(ok === false, '券 = 0 时 useFreebie 应返回 false')
    assert(prefs.streakFreebies === 0, '券不够不应改变 streakFreebies')
    assert((prefs.protectedCheckinDates || []).length === 0, '券不够不应记保护日期')
  }

  // —— 9d. useFreebie 无效输入 → 返回 false ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 3 })
    assert(useFreebie('', '2026-08-18') === false, '空 scope 应被拒')
    assert(useFreebie('reading', '2026/08/18') === false, '非 YYYY-MM-DD 日期应被拒')
    assert(loadPreferences().streakFreebies === 3, '无效输入不应扣券')
  }

  // —— 9e. mergeProtectedDates：保护日期合并进真实 dates 去重；scope 过滤 ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 3 })
    useFreebie(GLOBAL_SCOPE, '2026-08-15')   // 全局保护 08-15
    useFreebie('reading', '2026-08-16')      // 阅读保护 08-16
    const mergedGlobal = mergeProtectedDates(['2026-08-14', '2026-08-15', '2026-08-17'], GLOBAL_SCOPE)
    assert(mergedGlobal.indexOf('2026-08-15') >= 0, '全局 merge 应包含全局保护日 08-15')
    assert(mergedGlobal.indexOf('2026-08-16') < 0, '全局 merge 不应包含阅读专属保护日 08-16')
    assert(mergedGlobal.indexOf('2026-08-17') >= 0, '全局 merge 应保留真实日 08-17')
    // 去重：08-15 真实已有 + 保护也有 → 合并后只 1 个
    const uniq = mergedGlobal.filter(x => x === '2026-08-15')
    assert(uniq.length === 1, 'merge 去重：真实+保护同一天只保留 1 个')
    const mergedReading = mergeProtectedDates(['2026-08-20'], 'reading')
    assert(mergedReading.indexOf('2026-08-16') >= 0, '阅读 merge 应包含阅读保护日 08-16')
    assert(mergedReading.indexOf('2026-08-15') < 0, '阅读 merge 不应包含全局专属保护日 08-15')
  }

  // —— 9f. mergeProtectedDates 无保护日期 → 返回原数组（长度不变）——
  resetStore()
  {
    const real = ['2026-08-10', '2026-08-11']
    const merged = mergeProtectedDates(real, 'reading')
    assert(merged.length === 2, '无保护日期时 merge 返回原数组（长度不变）')
  }

  // —— 9g. getStreakStatus：断了（昨天前都没打卡）→ isBroken=true + canProtect=true ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 2 })
    const today = localTodayStr()
    const dayBeforeYesterday = localShiftDays(today, -3)   // 3 天前（确保今天和昨天都没打卡 → 真断）
    // 只在 3 天前打卡，今天/昨天/前天都没打 → 真断了
    seedStreakAbs('reading', localShiftDays(today, -5), 3)  // -5,-4,-3 天打满 → 最后一天是 dayBeforeYesterday
    const realDates = loadCheckins().map(c => c.date)
    const st = getStreakStatus('reading', realDates, '阅读')
    assert(st.isBroken === true, '今天和昨天都没打卡 → isBroken=true')
    assert(st.brokenDate !== '', '断了应有 brokenDate')
    assert(st.canProtect === true, '断了 + 券>0 + 保护开 → canProtect=true')
    assert(st.hasProtected === false, '还没用券 → hasProtected=false')
  }

  // —— 9h. getStreakStatus：没断（今天或昨天打卡了）→ isBroken=false ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 2 })
    const today = localTodayStr()
    seedStreakAbs('reading', localShiftDays(today, -3), 4)  // -3,-2,-1,0(今天) 连续 4 天含今天
    const realDates = loadCheckins().map(c => c.date)
    const st = getStreakStatus('reading', realDates, '阅读')
    assert(st.isBroken === false, '今天有打卡 → isBroken=false')
    assert(st.brokenDate === '', '没断 → brokenDate 空')
    assert(st.streak >= 1, '没断 → streak >= 1')
  }

  // —— 9i. getStreakStatus：已用券保护过断档日 → hasProtected=true ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 2 })
    const today = localTodayStr()
    seedStreakAbs('reading', localShiftDays(today, -5), 3)  // -5,-4,-3 打卡；-2,-1,0 没打
    const realDates = loadCheckins().map(c => c.date)
    // 先看断态
    const st1 = getStreakStatus('reading', realDates, '阅读')
    assert(st1.isBroken === true, '保护前应判定为断')
    // 用券保住断档日
    useFreebie('reading', st1.brokenDate)
    const st2 = getStreakStatus('reading', realDates, '阅读')
    assert(st2.hasProtected === true, '用券保护过断档日 → hasProtected=true')
    assert(st2.canProtect === false, '已保护过 → canProtect=false')
    assert(st2.protectedStreak >= 1, '已保护 → protectedStreak >= 1（保住后连胜）')
  }

  // —— 9j. buildStreakStatuses：全局 + 多分类混合断态；断了且能保护的排在前 ——
  resetStore()
  {
    updatePreferences({ streakFreebies: 3 })
    const today = localTodayStr()
    // reading 断了（只在 3 天前打卡）；exercise 没断（今天打了）
    seedStreakAbs('reading', localShiftDays(today, -5), 3)
    seedStreakAbs('exercise', localShiftDays(today, -3), 4)  // 含今天
    const cats = [
      { id: 'reading', label: '阅读' },
      { id: 'exercise', label: '运动' },
      { id: 'meditation', label: '冥想' },  // 从未打卡 → 不应出现在结果里
    ]
    const statuses = buildStreakStatuses(loadCheckins(), cats)
    const scopes = statuses.map(s => s.scope)
    assert(scopes.indexOf(GLOBAL_SCOPE) >= 0, 'buildStreakStatuses 应含全局 scope')
    assert(scopes.indexOf('reading') >= 0, '应含 reading scope（有打卡）')
    assert(scopes.indexOf('exercise') >= 0, '应含 exercise scope（有打卡）')
    assert(scopes.indexOf('meditation') < 0, '不应含从未打卡的 meditation scope')
    // 断了的 reading 的 canProtect 应比没断的 exercise 排在前
    const readingIdx = scopes.indexOf('reading')
    const exerciseIdx = scopes.indexOf('exercise')
    assert(readingIdx < exerciseIdx, '断了且能保护的 scope 应排在没断的 scope 之前')
    const reading = statuses.find(s => s.scope === 'reading') as StreakStatus
    assert(reading.isBroken === true && reading.canProtect === true, 'reading 应判定为断且能保护')
  }

  // —— 9k. 算法边界：用券保住后，calcCurrentStreakLenient 从断档日往回数（保护只合并 lenient 口径）——
  resetStore()
  {
    updatePreferences({ streakFreebies: 2 })
    const today = localTodayStr()
    // 连续打 4 天：-6,-5,-4,-3；然后 -2,-1,0 没打 → 断在 -2（昨天的前一天）
    seedStreakAbs('reading', localShiftDays(today, -6), 4)
    const realDates = loadCheckins().map(c => c.date)
    const realStreak = calcCurrentStreakLenient(realDates)
    assert(realStreak === 0, '保护前：今天和昨天都没打卡 → calcCurrentStreakLenient = 0')
    // 用券保住断档日
    const st = getStreakStatus('reading', realDates, '阅读')
    assert(st.brokenDate !== '', '应识别出断档日')
    useFreebie('reading', st.brokenDate)
    // 保护后合并日期再算
    const merged = mergeProtectedDates(realDates, 'reading')
    const protectedStreak = calcCurrentStreakLenient(merged)
    assert(protectedStreak >= 1, '保护后：断档日被虚拟填上 → calcCurrentStreakLenient >= 1（连胜接上了）')
  }

  // —— 9l. 保护日期不影响 longestStreak / totalDays（只合并进 lenient 口径，不污染历史）——
  resetStore()
  {
    updatePreferences({ streakFreebies: 2 })
    const today = localTodayStr()
    seedStreakAbs('reading', localShiftDays(today, -6), 4)
    const realDates = loadCheckins().map(c => c.date)
    const realLongest = calcLongestStreak(realDates)
    const realDays = realDates.length
    // 用券
    const st = getStreakStatus('reading', realDates, '阅读')
    useFreebie('reading', st.brokenDate)
    // 保护后 longestStreak / totalDays 仍用真实 dates → 不变
    const afterLongest = calcLongestStreak(realDates)
    const afterDays = realDates.length
    assert(afterLongest === realLongest, '保护日期不应影响 calcLongestStreak（仍用真实 dates）')
    assert(afterDays === realDays, '保护日期不应影响 totalDays（仍用真实 dates）')
  }

  console.log('\n=== 总结 ===')
  console.log('通过 ' + pass + ' / 失败 ' + fail)
  return fail === 0
}
