// pages/checkin/checkin.ts
// 每日打卡（v7 多分类）：一天可分别打卡多个分类（如运动+阅读），同一分类同一天只能一条。
// 核心价值仍是连续天数的仪式感，但拆成两层：
//   - 全局总连胜（任意分类打卡算进）
//   - 分类连胜（选定某分类的连续天数，用于分类成就）
// 可通过"升级为成就"入口跳到 edit 页把某条打卡升级为一条成就（传该条 id）。

import {
  loadCheckins,
  addCheckin,
  updateCheckin,
  deleteCheckin,
  loadCheckinsByDate,
  Checkin,
} from '../../utils/storage'
import {
  CHECKIN_CATEGORIES,
  DEFAULT_CHECKIN_CATEGORY,
  findCheckinCategory,
  getAllCheckinCategories,
} from '../../utils/checkin-presets'
import {
  CheckinGoal,
  getGoalForCategory,
  calcPeriodProgress,
  calcLifetimeStats,
} from '../../utils/checkin-goal'
import { calcCurrentStreakLenient, calcLongestStreak } from '../../utils/stats'
import { SYSTEM_MEDALS } from '../../utils/medal-config'
import { loadPreferences, updatePreferences } from '../../utils/preferences'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { designTokens } from '../../utils/design-tokens'
import { formatDate } from '../../utils/util'
import {
  refreshFreebies,
  getFreebies,
  calcHabitScore,
  habitScoreLevel,
  freebieStatusText,
  isProtectionEnabled,
  mergeProtectedDates,
  GLOBAL_SCOPE,
} from '../../utils/streak-protection'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

interface CategoryOption {
  id: string
  label: string
  icon: string
  custom: boolean   // 是否用户自定义（用于 chip 行末尾的删除入口预留）
}

/** 今日打卡行：某分类今日是否已打卡（用于今日多分类打卡区渲染） */
interface TodayCatRow {
  id: string
  label: string
  icon: string
  checked: boolean      // 该分类今日是否已打卡
  checkinId: string     // 该分类今日那条打卡的 id（空串=未打卡）
  note: string          // 该分类今日的一句话（未打卡则空）
  streak: number        // P2-C：该分类的当前连续天数（独立口径，按 category 过滤所有打卡日期算）
  streakText: string    // P2-C：「连续 N 天」文案；0 天时为空串（wxml 用它判定是否显示）
  goalText: string      // 第二批功能 1：目标完成进度文案「本周 3/5」；无目标时空串
  goalDone: boolean     // 是否已达成整周期目标（达成时绿色高亮）
}

/** 总记录卡视图（第二批功能 3） */
interface TotalRecordView {
  totalCount: number       // 总打卡次数（含同日多分类，= loadCheckins().length）
  totalDays: number        // 总打卡天数（去重日期数）
  longestStreak: number    // 历史最长连胜
  firstDate: string        // 首次打卡日期 'YYYY-MM-DD'（无记录时空串）
  lastDate: string         // 最近打卡日期
  hasRecord: boolean       // 是否有任何打卡记录
}

/** 打卡列表项视图：补分类元信息 + 友好日期文案 */
interface CheckinView {
  id: string
  date: string
  category: string
  categoryLabel: string
  categoryIcon: string
  note: string
  dateLabel: string   // 友好日期（今天/昨天/YYYY-MM-DD）
  isToday: boolean
}

/** 已解锁的连续打卡勋章（用于页顶勋章条展示） */
interface StreakMedalView {
  id: string
  icon: string
  label: string
  unlocked: boolean
  // A5：未解锁时携带进度，给 chip 渲染角标「current/target」
  progressText: string
}

/** 本月日历单元格视图 */
interface CalendarCell {
  date: string       // 'YYYY-MM-DD'（本月所有日期；上下月的占位用空串）
  day: number        // 日期数字（1-31）；占位为 0
  isToday: boolean
  checkedCats: string[]        // 该日已打卡的分类图标列表（完整数组；cell 高亮 + 点击 data-cats 用）
  checkedCatsTop: string[]     // 渲染用：前 3 个图标（避免分类多时挤）
  checkedCatsOverflow: number  // 渲染用：超出 3 个的个数（>0 时追加「+N」）
  inMonth: boolean   // 是否本月（用于淡化上下月占位）
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    // 连续天数卡（全局口径）
    currentStreak: 0,      // 全局当前连续天数（任意分类打卡算进）
    longestStreak: 0,      // 全局历史最长
    totalDays: 0,          // 全局累计打卡天数（去重日期数）
    streakMedals: [] as StreakMedalView[],   // 连续打卡勋章（已解锁的亮显）
    // 衰减式 Habit Score + 保护券状态
    habitScore: 0,
    habitScoreLabel: '',
    habitScoreColor: '#D97A4A',
    freebieCount: 0,
    freebieText: '',
    protectionOn: true,

    // 今日打卡区（多分类）
    todayDate: '',
    todayCatRows: [] as TodayCatRow[],   // 每个分类一行，独立打卡
    todayDoneCount: 0,                    // 今日已打卡分类数（0=全未打）
    inputNote: '',                        // 当前选中分类的一句话输入
    noteTargetCategory: '',               // 当前正在编辑 note 的分类 id

    // 今日新增分类输入态（点未打卡分类的 chip → 进入该分类的输入态）
    activeNewCategory: '',                // 当前选中的「待打卡分类」id（用于 note 输入）

    // 本月日历
    calYear: 0,
    calMonth: 0,
    calMonthLabel: '',
    calWeekdays: ['一', '二', '三', '四', '五', '六', '日'],
    calCells: [] as CalendarCell[],

    // 历史打卡列表（最近 30 条）
    recentList: [] as CheckinView[],
    hasMore: false,

    // 分类选项（预设 + 自定义合并）
    categoryOptions: [] as CategoryOption[],

    // 第二批功能 3：总记录卡（打卡天数/次数/最长连胜/首次末次）
    totalRecord: {
      totalCount: 0, totalDays: 0, longestStreak: 0,
      firstDate: '', lastDate: '', hasRecord: false,
    } as TotalRecordView,
    // 第二批功能 3：「升级打卡为成就」分类选择 sheet
    showUpgradeSheet: false,
    upgradeCatRows: [] as { id: string; label: string; icon: string; meta: string }[],

    // 第二批功能 1/2：分类菜单 sheet（点「⋯」打开，含「设置目标」「隐藏」）
    showCatMenuSheet: false,
    menuTargetCategory: '',        // 当前打开菜单的分类 id
    menuTargetLabel: '',           // 当前打开菜单的分类名（给 sheet 标题用）

    // 第二批功能 1：目标设置 sheet（频率 + 次数）
    showGoalSheet: false,
    goalCatId: '',                 // 正在设置目标的分类 id
    goalCatLabel: '',
    goalFrequency: 'daily' as 'daily' | 'weekly' | 'monthly',
    goalTimes: 1,                  // 次数 stepper 当前值
    frequencyOptions: [
      { value: 'daily', label: '每日' },
      { value: 'weekly', label: '每周' },
      { value: 'monthly', label: '每月' },
    ],

    // 新建分类弹窗
    showNewCatSheet: false,
    newCatLabel: '',
    newCatIcon: '✦',
    newCatIconOptions: ['📖', '🏃', '🧘', '🎯', '🎬', '✍️', '🌱', '💧', '☀️', '🌙', '🎨', '💪', '🍎', '✦'],

    // 编辑 sheet 临时态（编辑某条打卡的内容）
    showEditSheet: false,
    editingId: '',
    editDate: '',
    editCategory: DEFAULT_CHECKIN_CATEGORY,
    editNote: '',

    // P3 全打卡彩蛋：今天所有分类都打过卡时触发的全屏庆祝动画
    showAllCheckedEgg: false,
  },

  onLoad() {
    applyThemeToPage(this)
    const today = formatDate(new Date())
    this.setData({ todayDate: today })
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    refreshFreebies()
    // 打卡 + 偏好都可能影响本页（自定义分类、保护券开关）；只在两者有变动时才重算
    const watched: DirtyField[] = ['checkins', 'preferences']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  /** 主刷新：重算所有派生数据（连胜/今日打卡态/日历/历史/勋章）。
   *  v7 多分类：今日打卡从「单条」改为「按分类集合」；连胜分全局 + 分类两层。 */
  refresh() {
    const prefs = loadPreferences()
    const disabled = prefs.disabledCheckinCategories || []
    const categoryOptions: CategoryOption[] = getAllCheckinCategories(
      prefs.customCheckinCategories, disabled,
    ).map(c => {
      const preset = CHECKIN_CATEGORIES.find(p => p.id === c.id)
      return { id: c.id, label: c.label, icon: c.icon, custom: !preset }
    })

    const all = loadCheckins()
    const today = this.data.todayDate || formatDate(new Date())

    // 全局连胜：任意分类打卡算进（用所有 dates 去重）。合并保护券虚拟日期后再算连胜口径。
    const realDates = [...new Set(all.map(c => c.date))]
    const allDates = mergeProtectedDates(realDates, GLOBAL_SCOPE)
    const currentStreak = calcCurrentStreakLenient(allDates)
    const longestStreak = calcLongestStreak(realDates)
    const totalDays = realDates.length

    // 第二批功能 3：总记录卡（首次/末次/总次数/总天数/最长连胜）
    const sortedDates = allDates.slice().sort()
    const totalRecord: TotalRecordView = {
      totalCount: all.length,
      totalDays,
      longestStreak,
      firstDate: sortedDates[0] || '',
      lastDate: sortedDates[sortedDates.length - 1] || '',
      hasRecord: all.length > 0,
    }

    // 今日打卡态：每个分类一行
    const todayCheckins = loadCheckinsByDate(today)
    const todayDoneCount = todayCheckins.length
    const todayCatRows: TodayCatRow[] = categoryOptions.map(opt => {
      const hit = todayCheckins.find(c => c.category === opt.id)
      // P2-C：该分类独立连胜——过滤出本分类所有打卡日期去重后合并保护券日期再跑 Lenient 算法
      const catRealDates = [...new Set(all.filter(c => c.category === opt.id).map(c => c.date))]
      const catDates = mergeProtectedDates(catRealDates, opt.id)
      const streak = calcCurrentStreakLenient(catDates)
      // 第二批功能 1：目标完成进度（无目标时 goalText 空串，wxml 不渲染）
      let goalText = ''
      let goalDone = false
      const goal = getGoalForCategory(opt.id, prefs)
      if (goal) {
        const prog = calcPeriodProgress(goal, all, opt.id)
        goalText = prog.progressText
        goalDone = prog.isComplete
      }
      return {
        id: opt.id,
        label: opt.label,
        icon: opt.icon,
        checked: !!hit,
        checkinId: hit ? hit.id : '',
        note: hit && hit.note ? hit.note : '',
        streak,
        streakText: streak > 0 ? ('连续 ' + String(streak) + ' 天') : '',
        goalText,
        goalDone,
      }
    })

    // 连续打卡勋章（全局口径，category='checkin' 的内置勋章）
    const streakMedals = this.buildStreakMedals(longestStreak)

    // 本月日历
    const now = new Date()
    const calYear = now.getFullYear()
    const calMonth = now.getMonth() + 1
    const calCells = this.buildCalendar(calYear, calMonth, all)
    const calMonthLabel = String(calYear) + '年' + String(calMonth) + '月'

    // 历史列表（最近 30 条；多分类后一天可能多条，按 createdAt 降序天然合理）
    const recentRaw = all.slice(0, 30)
    const recentList: CheckinView[] = recentRaw.map(c => this.toView(c, today))
    const hasMore = all.length > 30

    // Habit Score + 保护券
    const habitScore = calcHabitScore(allDates)
    const scoreLevel = habitScoreLevel(habitScore)
    const protectionOn = isProtectionEnabled()
    const freebieCount = getFreebies()
    const freebieText = freebieStatusText()

    this.setData({
      categoryOptions,
      currentStreak,
      longestStreak,
      totalDays,
      totalRecord,
      streakMedals,
      habitScore,
      habitScoreLabel: scoreLevel.label,
      habitScoreColor: scoreLevel.color,
      freebieCount,
      freebieText,
      protectionOn,
      todayCatRows,
      todayDoneCount,
      calYear,
      calMonth,
      calMonthLabel,
      calCells,
      recentList,
      hasMore,
    })
  },

  /** 构造连续打卡勋章视图：从 SYSTEM_MEDALS 筛 category==='checkin'，
   *  按用户改过的目标（缺省取 defaultTarget）与全局历史最长连续天数比对判定解锁。 */
  buildStreakMedals(longestStreak: number): StreakMedalView[] {
    const prefs = loadPreferences()
    return SYSTEM_MEDALS
      .filter(md => md.category === 'checkin')
      .map(md => {
        const saved = prefs.systemMedals[md.id]
        const target = (saved && saved.target > 0) ? saved.target : md.defaultTarget
        const unlocked = longestStreak >= target && target > 0
        // A5：未解锁时显示「已连续 N/目标」让用户知道差多少
        const safeCurrent = Math.min(longestStreak, target)
        const progressText = unlocked ? '' : (String(safeCurrent) + '/' + String(target))
        return { id: md.id, icon: md.icon, label: md.label, unlocked, progressText }
      })
  },

  /** 构造本月日历单元格数组（按周一起排版，7 列）。
   *  v7：每个 cell 记录该日已打卡的分类图标数组（多分类标记），不再只是布尔。 */
  buildCalendar(year: number, month: number, allCheckins: Checkin[]): CalendarCell[] {
    // 按 date 分组：{ date: 分类图标数组 }
    const byDate: { [date: string]: string[] } = {}
    const prefs = loadPreferences()
    for (const c of allCheckins) {
      const meta = findCheckinCategory(c.category, prefs.customCheckinCategories)
      if (!byDate[c.date]) byDate[c.date] = []
      // 同一天同分类去重（理论上 addCheckin 已保证，这里防御）
      if (!byDate[c.date].includes(meta.icon)) byDate[c.date].push(meta.icon)
    }
    const today = formatDate(new Date())
    const firstDay = new Date(year, month - 1, 1)
    let firstWeekday = firstDay.getDay()
    firstWeekday = firstWeekday === 0 ? 6 : firstWeekday - 1
    const daysInMonth = new Date(year, month, 0).getDate()
    // 把图标数组转成 cell 的渲染字段：checkedCatsTop（前 3 个）+ checkedCatsOverflow（超出数）。
    // checkedCats 原数组保留，给 cell 高亮判定 + 点击 data-cats 用（不动数据，只加渲染派生）。
    const CAL_ICON_CAP = 3
    const toCellView = (cats: string[]): { checkedCatsTop: string[]; checkedCatsOverflow: number } => ({
      checkedCatsTop: cats.slice(0, CAL_ICON_CAP),
      checkedCatsOverflow: cats.length > CAL_ICON_CAP ? cats.length - CAL_ICON_CAP : 0,
    })
    const cells: CalendarCell[] = []
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ date: '', day: 0, isToday: false, checkedCats: [], checkedCatsTop: [], checkedCatsOverflow: 0, inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0')
      const cats = byDate[dateStr] || []
      const view = toCellView(cats)
      cells.push({
        date: dateStr,
        day: d,
        isToday: dateStr === today,
        checkedCats: cats,
        checkedCatsTop: view.checkedCatsTop,
        checkedCatsOverflow: view.checkedCatsOverflow,
        inMonth: true,
      })
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: '', day: 0, isToday: false, checkedCats: [], checkedCatsTop: [], checkedCatsOverflow: 0, inMonth: false })
    }
    return cells
  },

  /** 把 Checkin 转成列表视图（补分类元信息 + 友好日期） */
  toView(c: Checkin, today: string): CheckinView {
    const prefs = loadPreferences()
    const meta = findCheckinCategory(c.category, prefs.customCheckinCategories)
    const yesterday = this.shiftDateStr(today, -1)
    let dateLabel = c.date
    if (c.date === today) dateLabel = '今天'
    else if (c.date === yesterday) dateLabel = '昨天'
    return {
      id: c.id,
      date: c.date,
      category: meta.id,
      categoryLabel: meta.label,
      categoryIcon: meta.icon,
      note: c.note || '',
      dateLabel,
      isToday: c.date === today,
    }
  },

  /** 工具：把 'YYYY-MM-DD' 加减若干天 */
  shiftDateStr(dateStr: string, delta: number): string {
    const [y, m, d] = dateStr.split('-').map(s => parseInt(s, 10))
    const base = new Date(y, m - 1, d, 12, 0, 0, 0)
    base.setDate(base.getDate() + delta)
    return formatDate(base)
  },

  /* === 今日多分类打卡 === */

  /** 点今日某分类 chip：
   *  - 已打卡 → 弹确认是否撤销（删除该条）
   *  - 未打卡 → 进入该分类的输入态（选中 activeNewCategory，准备打卡） */
  onTapTodayCat(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const row = this.data.todayCatRows.find(r => r.id === id)
    if (!row) return
    if (row.checked) {
      // 已打卡 → 确认撤销
      wx.showModal({
        title: '撤销今日「' + row.label + '」打卡？',
        content: '删除后该分类连胜会重新计算',
        confirmColor: designTokens.color.danger,
        success: (res) => {
          if (res.confirm) {
            deleteCheckin(row.checkinId)
            this.refresh()
            wx.showToast({ title: '已撤销', icon: 'none' })
          }
        },
      })
      return
    }
    // 未打卡 → 进入输入态
    this.setData({ activeNewCategory: id, inputNote: '', noteTargetCategory: id })
  },

  onNoteInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ inputNote: e.detail.value })
  },

  /** 确认打卡当前选中分类（activeNewCategory）。 */
  onCheckinSelectedCat() {
    const cat = this.data.activeNewCategory
    if (!cat) return
    const note = this.data.inputNote.trim()
    const result = addCheckin({
      date: this.data.todayDate,
      category: cat,
      note: note || undefined,
    })
    if (!result.ok) {
      wx.showToast({ title: result.msg, icon: 'none' })
      return
    }
    // 检查是否新解锁连续勋章
    const before = this.data.longestStreak
    const beforeDoneCount = this.data.todayDoneCount
    this.refresh()
    const after = this.data.longestStreak
    if (after > before) {
      const newlyUnlocked = this.data.streakMedals.find(m => m.unlocked && !this.wasMedalUnlockedBefore(m.id, before))
      if (newlyUnlocked) {
        wx.showToast({ title: '🎉 解锁 ' + newlyUnlocked.label, icon: 'none', duration: 2500 })
      } else {
        wx.showToast({ title: '打卡成功 🔥' + String(after) + '天', icon: 'none' })
      }
    } else {
      wx.showToast({ title: '已打卡', icon: 'success' })
    }

    // P3 全打卡彩蛋：本次打卡前未全完成、现在全完成了 → 触发全屏庆祝动画
    // 条件：分类数 ≥2（单分类无意义）+ 刚好本次打卡让 todayDoneCount 追平 categoryOptions 总数
    const totalCats = this.data.categoryOptions.length
    const nowDone = this.data.todayDoneCount
    if (totalCats >= 2 && nowDone >= totalCats && beforeDoneCount < totalCats) {
      this.triggerAllCheckedEgg()
    }
    this.setData({ inputNote: '', activeNewCategory: '', noteTargetCategory: '' })
  },

  /** 触发全打卡彩蛋：显示全屏动画 3 秒后自动收起。
   *  纯 CSS 动效（wxss keyframes + 礼花 emoji 散落），无新数据、无外部依赖。 */
  triggerAllCheckedEgg() {
    this.setData({ showAllCheckedEgg: true })
    setTimeout(() => {
      this.setData({ showAllCheckedEgg: false })
    }, 3200)
  },

  /** 手动关闭彩蛋（点遮罩提前关闭） */
  triggerAllCheckedEggClose() {
    this.setData({ showAllCheckedEgg: false })
  },

  /** 取消当前选中分类的输入态。 */
  onCancelSelectedCat() {
    this.setData({ inputNote: '', activeNewCategory: '', noteTargetCategory: '' })
  },

  /** 辅助：判断某枚勋章在"before 天数"时是否已解锁 */
  wasMedalUnlockedBefore(medalId: string, beforeStreak: number): boolean {
    const md = SYSTEM_MEDALS.find(m => m.id === medalId)
    if (!md) return false
    const prefs = loadPreferences()
    const saved = prefs.systemMedals[medalId]
    const target = (saved && saved.target > 0) ? saved.target : md.defaultTarget
    return beforeStreak >= target && target > 0
  },

  /* === 编辑某条打卡 === */

  onEditCheckin(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    this.openEditSheet(id)
  },

  /** 打开编辑 sheet：找到该条打卡，预填 edit 临时态 */
  openEditSheet(id: string) {
    const found = loadCheckins().find(c => c.id === id)
    if (!found) return
    this.setData({
      showEditSheet: true,
      editingId: id,
      editDate: found.date,
      editCategory: found.category,
      editNote: found.note || '',
    })
  },

  onPickEditCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ editCategory: e.currentTarget.dataset.id as string })
  },

  onEditNoteInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ editNote: e.detail.value })
  },

  onCloseEditSheet() {
    this.setData({ showEditSheet: false, editingId: '', editDate: '' })
  },

  /** 保存编辑：写回 category/note（不改 date）。冲突时 updateCheckin 返回 false。 */
  onSaveEditCheckin() {
    const id = this.data.editingId
    if (!id) return
    const note = this.data.editNote.trim()
    const ok = updateCheckin(id, {
      category: this.data.editCategory,
      note: note || undefined,
    })
    if (!ok) {
      wx.showToast({ title: '该分类此日已打卡', icon: 'none' })
      return
    }
    this.setData({ showEditSheet: false, editingId: '', editDate: '' })
    this.refresh()
    wx.showToast({ title: '已更新', icon: 'success' })
  },

  /* === 删除 / 转化 === */

  /** 删除某条打卡（二次确认） */
  onDeleteCheckin(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    wx.showModal({
      title: '删除这条打卡？',
      content: '删除后连胜会重新计算；30 天内可在回收站恢复',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (res.confirm) {
          const ok = deleteCheckin(id)
          if (!ok) {
            wx.showToast({ title: '删除失败，请重试', icon: 'none' })
            return
          }
          this.refresh()
          wx.showToast({ title: '已删除', icon: 'none' })
        }
      },
    })
  },

  /** 把某条打卡升级为成就：跳 edit 页，带 checkinId（=该打卡的真实 id）。
   *  v7：一天多条后必须传具体 id（不再传 date）；edit 页按 id 反查。 */
  onConvertToAchievement(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    wx.navigateTo({ url: '/pages/edit/edit?checkinId=' + id })
  },

  /** 日历单元格点击：点已打卡的日子 → 若只有一条直接编辑，多条则提示去历史列表选；
   *  点未打卡的日子提示（不做补打卡）。 */
  onTapCalendarCell(e: WechatMiniprogram.TouchEvent) {
    const date = e.currentTarget.dataset.date as string
    if (!date) return
    const cats = e.currentTarget.dataset.cats as string[]
    if (!cats || cats.length === 0) {
      wx.showToast({ title: '这一天未打卡', icon: 'none' })
      return
    }
    const dayCheckins = loadCheckinsByDate(date)
    if (dayCheckins.length === 1) {
      this.openEditSheet(dayCheckins[0].id)
    } else {
      // 多条：提示去历史列表编辑（避免弹选择菜单的复杂交互）
      const labels = dayCheckins.map(c => findCheckinCategory(c.category, loadPreferences().customCheckinCategories).label).join('、')
      wx.showToast({ title: '当日有 ' + dayCheckins.length + ' 条：' + labels, icon: 'none', duration: 2500 })
    }
  },

  /* === 新建自定义分类 === */

  /** 打开新建分类弹窗 */
  onOpenNewCatSheet() {
    this.setData({ showNewCatSheet: true, newCatLabel: '', newCatIcon: '✦' })
  },

  onNewCatLabelInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ newCatLabel: e.detail.value })
  },

  onPickNewCatIcon(e: WechatMiniprogram.TouchEvent) {
    this.setData({ newCatIcon: e.currentTarget.dataset.icon as string })
  },

  onCloseNewCatSheet() {
    this.setData({ showNewCatSheet: false })
  },

  /** 保存新分类：生成稳定 id（基于 label 拼音化简单处理：用 label + 随机后缀避免冲突），
   *  存进 preferences.customCheckinCategories。 */
  onSaveNewCat() {
    const label = this.data.newCatLabel.trim()
    const icon = this.data.newCatIcon
    if (!label) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' })
      return
    }
    if (label.length > 8) {
      wx.showToast({ title: '名称最多 8 字', icon: 'none' })
      return
    }
    const prefs = loadPreferences()
    const existing = getAllCheckinCategories(prefs.customCheckinCategories)
    // 重名校验（预设 + 自定义里都不许重名）
    if (existing.some(c => c.label === label)) {
      wx.showToast({ title: '该分类已存在', icon: 'none' })
      return
    }
    // id 用 'custom_' + 时间戳后 4 位，保证稳定且不与预设冲突
    const id = 'custom_' + String(Date.now()).slice(-6)
    const custom = (prefs.customCheckinCategories || []).slice()
    custom.push({ id, label, icon })
    updatePreferences({ customCheckinCategories: custom })
    this.setData({ showNewCatSheet: false, newCatLabel: '', newCatIcon: '✦' })
    this.refresh()
    wx.showToast({ title: '已添加「' + label + '」', icon: 'success' })
  },

  /** 删除自定义分类（仅自定义的可删；预设不可删）。
   *  注意：删除分类不会删除已存在的该分类打卡记录（保留历史），但 chip 行不再显示该分类入口。 */
  onDeleteCustomCat(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id || id.indexOf('custom_') !== 0) return
    const prefs = loadPreferences()
    const custom = (prefs.customCheckinCategories || []).filter(c => c.id !== id)
    wx.showModal({
      title: '删除这个分类？',
      content: '已记录的该分类打卡会保留，但不再显示新打卡入口',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (res.confirm) {
          updatePreferences({ customCheckinCategories: custom })
          this.refresh()
          wx.showToast({ title: '已删除', icon: 'none' })
        }
      },
    })
  },

  /* === 第二批功能 1/2：分类菜单 sheet（设置目标 + 隐藏分类）=== */

  /** 点今日打卡行尾「⋯」按钮：打开该分类的菜单 sheet。
   *  注意：要在 wxml 里用 catchtap 阻止冒泡（避免触发 onTapTodayCat）。 */
  onOpenCatMenu(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const row = this.data.todayCatRows.find(r => r.id === id)
    const label = row ? row.label : id
    this.setData({
      showCatMenuSheet: true,
      menuTargetCategory: id,
      menuTargetLabel: label,
    })
  },

  onCloseCatMenu() {
    this.setData({ showCatMenuSheet: false, menuTargetCategory: '', menuTargetLabel: '' })
  },

  /** 打开目标设置 sheet：预填该分类当前目标（无则默认每日 1 次）。 */
  onOpenGoalSheet() {
    const id = this.data.menuTargetCategory
    if (!id) return
    const prefs = loadPreferences()
    const current = getGoalForCategory(id, prefs)
    this.setData({
      showCatMenuSheet: false,
      showGoalSheet: true,
      goalCatId: id,
      goalCatLabel: this.data.menuTargetLabel,
      goalFrequency: current ? current.frequency : 'daily',
      goalTimes: current ? current.timesPerPeriod : 1,
    })
  },

  onPickFrequency(e: WechatMiniprogram.TouchEvent) {
    this.setData({ goalFrequency: e.currentTarget.dataset.value as 'daily' | 'weekly' | 'monthly' })
  },

  onGoalTimesMinus() {
    const n = this.data.goalTimes
    if (n <= 1) return
    this.setData({ goalTimes: n - 1 })
  },

  onGoalTimesPlus() {
    const n = this.data.goalTimes
    if (n >= 30) return   // 单分类周期目标上限 30 次（足够，避免误输超大值）
    this.setData({ goalTimes: n + 1 })
  },

  /** 清除该分类的目标（取消目标设置）。 */
  onClearGoal() {
    const id = this.data.goalCatId
    if (!id) return
    const prefs = loadPreferences()
    const goals = { ...(prefs.checkinGoals || {}) }
    delete goals[id]
    updatePreferences({ checkinGoals: goals })
    this.setData({ showGoalSheet: false, goalCatId: '', goalCatLabel: '' })
    this.refresh()
    wx.showToast({ title: '已清除目标', icon: 'none' })
  },

  /** 保存目标设置。 */
  onSaveGoal() {
    const id = this.data.goalCatId
    if (!id) return
    const goal: CheckinGoal = {
      frequency: this.data.goalFrequency,
      timesPerPeriod: this.data.goalTimes,
    }
    const prefs = loadPreferences()
    const goals = { ...(prefs.checkinGoals || {}) }
    goals[id] = goal
    updatePreferences({ checkinGoals: goals })
    this.setData({ showGoalSheet: false, goalCatId: '', goalCatLabel: '' })
    this.refresh()
    const freqLabel = goal.frequency === 'daily' ? '每日' : goal.frequency === 'weekly' ? '每周' : '每月'
    wx.showToast({ title: '已设：' + freqLabel + ' ' + String(goal.timesPerPeriod) + ' 次', icon: 'none' })
  },

  onCloseGoalSheet() {
    this.setData({ showGoalSheet: false, goalCatId: '', goalCatLabel: '' })
  },

  /* === 第二批功能 2：隐藏分类（预设+自定义统一隐藏式删除）=== */

  /** 隐藏当前菜单分类（加入 disabledCheckinCategories）。
   *  预设和自定义都可隐藏；已有打卡记录保留显示（历史列表/日历靠兜底）。
   *  自定义分类隐藏后若用户想彻底删除，仍可在设置页「打卡管理」里操作。 */
  onHideCategory() {
    const id = this.data.menuTargetCategory
    if (!id) return
    const label = this.data.menuTargetLabel
    wx.showModal({
      title: '隐藏「' + label + '」？',
      content: '将从今日打卡列表移除，已有记录保留。可在「设置 · 打卡管理」恢复',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (!res.confirm) return
        const prefs = loadPreferences()
        const disabled = (prefs.disabledCheckinCategories || []).slice()
        if (!disabled.includes(id)) disabled.push(id)
        updatePreferences({ disabledCheckinCategories: disabled })
        this.setData({ showCatMenuSheet: false, menuTargetCategory: '', menuTargetLabel: '' })
        this.refresh()
        wx.showToast({ title: '已隐藏', icon: 'none' })
      },
    })
  },

  /* === 第二批功能 3：升级打卡为成就（汇总入口，分类选择）=== */

  /** 打开「升级打卡为成就」分类选择 sheet：列出有打卡记录的分类。 */
  onOpenUpgradeSheet() {
    const all = loadCheckins()
    if (all.length === 0) {
      wx.showToast({ title: '还没有打卡记录', icon: 'none' })
      return
    }
    const prefs = loadPreferences()
    // 统计每个分类的打卡天数 + 总次数（含被隐藏的分类——升级用的是历史坚持度）
    const statsByCat: { [cat: string]: { days: number; total: number } } = {}
    for (const c of all) {
      if (!statsByCat[c.category]) statsByCat[c.category] = { days: 0, total: 0 }
      statsByCat[c.category].total++
    }
    // 算每个分类的去重天数
    for (const cat of Object.keys(statsByCat)) {
      const lt = calcLifetimeStats(all, cat)
      statsByCat[cat].days = lt.totalDays
    }
    const rows = Object.keys(statsByCat).map(cat => {
      const meta = findCheckinCategory(cat, prefs.customCheckinCategories)
      const s = statsByCat[cat]
      return {
        id: cat,
        label: meta.label,
        icon: meta.icon,
        meta: '坚持 ' + String(s.days) + ' 天 · 共 ' + String(s.total) + ' 次',
      }
    }).sort((a, b) => parseInt((b.meta.match(/(\d+) 天/) || ['0', '0'])[1], 10)
      - parseInt((a.meta.match(/(\d+) 天/) || ['0', '0'])[1], 10))
    this.setData({ showUpgradeSheet: true, upgradeCatRows: rows })
  },

  onCloseUpgradeSheet() {
    this.setData({ showUpgradeSheet: false })
  },

  /** 选某分类 → 跳 edit 页升级为成就，预填该分类汇总信息（标题/短评）。 */
  onUpgradePickCat(e: WechatMiniprogram.TouchEvent) {
    const cat = e.currentTarget.dataset.id as string
    if (!cat) return
    const prefs = loadPreferences()
    const meta = findCheckinCategory(cat, prefs.customCheckinCategories)
    const all = loadCheckins()
    const lt = calcLifetimeStats(all, cat)
    // 用 query 携带预填信息（edit 页按 checkinCategory=xxx 读取；扩展 edit 页支持新参数）
    const params = [
      'checkinCategory=' + encodeURIComponent(cat),
      'title=' + encodeURIComponent(meta.label + '打卡'),
      'days=' + String(lt.totalDays),
      'total=' + String(lt.total),
    ].join('&')
    this.setData({ showUpgradeSheet: false })
    wx.navigateTo({ url: '/pages/edit/edit?' + params })
  },
})
