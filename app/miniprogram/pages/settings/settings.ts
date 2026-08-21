// pages/settings/settings.ts
// 应用设置：主题（亮/暗/跟随系统）+ 暗色子方案（中性/暖墨/OLED）+ 标题字体（无衬线/衬线）
// 改动即时生效（写入 storage + 刷新 themeCache + 本页 setData）。
// 其它页 onShow 时 applyThemeToPage 会自动读到新值。

import { AppPreferences, ThemeMode, FontTitleStyle, DarkVariant, loadPreferences, updatePreferences, resolveTheme } from '../../utils/preferences'
import { applyThemeToPage, refreshThemeCache, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { PRESET_CATEGORIES } from '../../utils/category-meta'
import { designTokens } from '../../utils/design-tokens'
import { loadAllAchievements, loadReports, loadWishes, loadInspirations, loadCheckins, Checkin } from '../../utils/storage'
import { calcAnnualKeywords, countByCategory, calcLongestStreak } from '../../utils/stats'
import { SYSTEM_MEDALS, isInUnlockWindow, buildCheckinCategoryMedals, countItemsInWindow } from '../../utils/medal-config'
import { getAllCheckinCategories } from '../../utils/checkin-presets'
import { getGoalForCategory, CheckinGoal } from '../../utils/checkin-goal'
import {
  exportAllData,
  importAllData,
  writeBackupToFile,
  buildBackupFilename,
  BackupSummary,
} from '../../utils/backup'
import { trashCount } from '../../utils/trash'
import {
  isProtectionEnabled,
  setProtectionEnabled,
  getFreebies,
  useFreebie,
  buildStreakStatuses,
  StreakStatus,
} from '../../utils/streak-protection'

interface ThemeOption {
  id: ThemeMode
  label: string
  desc: string
  icon: string
  swatch: string  // CSS 色块（横向渐变表达主题氛围）
}

interface DarkVariantOption {
  id: DarkVariant
  label: string
  desc: string
  swatch: string
}

interface FontOption {
  id: FontTitleStyle
  label: string
  desc: string
  swatch: string
  previewClass: string  // 应用到预览文字的 class（让它即时显示衬线/无衬线）
}

/** 年度目标行视图：分类 id + 展示标签 + 图标 + 当前目标数字（字符串便于 input 回显）*/
interface GoalRowView {
  id: string
  label: string
  icon: string
  value: string   // input 原生返回 string；空串表示该分类未设目标
}

/** 勋章目标行视图：勋章 id + 标签 + 图标 + 用户改过的目标（字符串便于 input 回显）+ 已解锁标记 */
interface MedalRowView {
  id: string
  label: string
  icon: string
  desc: string
  value: string   // 目标值字符串；回显用户偏好里存的目标（缺省取 defaultTarget）
  unlocked: boolean
  // === P2-6 节日限量徽章视图字段 ===
  limitedEdition: boolean   // 是否限量勋章（驱动角标显示）
  editable: boolean         // 目标值是否可改（限量勋章的目标固定不可改）
  windowHint: string        // 窗口提示文案（空=普通勋章）
  // === A5 进度条字段（未解锁时显示 current/target + 百分比）===
  progress: { current: number; target: number; percent: number } | null
}

Page({
  data: {
    // 主题接线
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    // 当前偏好（驱动选中态）
    themeMode: 'light' as ThemeMode,
    titleFont: 'sans' as FontTitleStyle,
    darkVariant: 'neutral' as DarkVariant,
    // 当前是否暗色生效（控制子方案区域是否显示）
    isDarkActive: false,

    themeOptions: [
      {
        id: 'light',
        label: '亮色',
        desc: '暖米黄底，适合白天与明亮环境',
        icon: '☀',
        swatch: 'linear-gradient(135deg, #FAF6F0 0%, #F4EEE5 100%)',
      },
      {
        id: 'dark',
        label: '暗色',
        desc: '三种暗色风格可选，护眼沉浸',
        icon: '☾',
        swatch: 'linear-gradient(135deg, #2C2C2E 0%, #1C1C1E 100%)',
      },
      {
        id: 'auto',
        label: '跟随系统',
        desc: '随系统明暗自动切换',
        icon: '◐',
        swatch: 'linear-gradient(135deg, #FAF6F0 0%, #FAF6F0 50%, #1C1C1E 50%, #1C1C1E 100%)',
      },
    ] as ThemeOption[],

    darkVariantOptions: [
      {
        id: 'neutral',
        label: '中性深灰',
        desc: '干净不发泥，类似 Apple Books 暗色',
        swatch: 'linear-gradient(135deg, #2C2C2E 0%, #1C1C1E 100%)',
      },
      {
        id: 'warm',
        label: '暖墨色',
        desc: '保留暖色文学氛围，明亮版',
        swatch: 'linear-gradient(135deg, #2E2823 0%, #221E1A 100%)',
      },
      {
        id: 'oled',
        label: '纯黑',
        desc: '近乎纯黑，OLED 屏省电，极简',
        swatch: 'linear-gradient(135deg, #1C1C1C 0%, #0F0F0F 100%)',
      },
    ] as DarkVariantOption[],

    fontOptions: [
      {
        id: 'sans',
        label: '无衬线（默认）',
        desc: '现代利落，与正文统一',
        swatch: 'linear-gradient(135deg, #FAF6F0 0%, #F4EEE5 100%)',
        previewClass: '',
      },
      {
        id: 'serif',
        label: '衬线标题',
        desc: '文学感强，强化阅读/观影气质',
        swatch: 'linear-gradient(135deg, #FAF6F0 0%, #F0E8DA 100%)',
        previewClass: 'preview-serif',
      },
    ] as FontOption[],

    // === 年度目标 ===
    // 目标年份（当前年份；用户改设备时间会自然跨年，无需做选择器）
    goalYear: new Date().getFullYear(),
    goalRows: [] as GoalRowView[],

    // === 系统勋章目标（用户可改每枚勋章的目标值）===
    medalRows: [] as MedalRowView[],

    // === 年度关键词 ===
    // 输入框当前值（编辑中间态；失焦时写回偏好）
    annualKeywordInput: '',
    // 算法推荐候选词（点选即填入）；数据不足时为空数组
    keywordCandidates: [] as string[],

    // === 备份与恢复 ===
    // 当前数据计数摘要（驱动"将备份 X 条"提示）
    backupSummary: {
      achievements: 0, reports: 0, wishes: 0, inspirations: 0, checkins: 0,
      hasTemplates: false, hasPreferences: false,
    } as BackupSummary,
    // 导入输入框当前值（粘贴的 JSON 字符串；点"恢复"按钮时校验）
    importInput: '',
    // 导入预览文案（输入框失焦时计算，展示"将恢复 X 条/X 份"，非法时显示错误）
    importPreview: '',
    // 是否正在执行导出/导入（防重复点击；按钮态切换）
    backupBusy: false,

    // 回收站入口：当前条数（0 时仍显示入口，但副标题切到引导文案）
    trashCount: 0,

    // 习惯保护：连胜保护券开关（默认开启；关掉后打卡页隐藏 habit 行）
    protectionEnabled: true,
    // 开启态的描述文案（剩余券数动态拼接）
    protectionDescOn: '',
    // 连胜保护详情 sheet（手动用券保住断了的连胜）
    showProtectionSheet: false,
    streakStatuses: [] as StreakStatus[],
    protectionSheetFreebies: 0,
    protectionSheetBrokenCount: 0,

    // 第二批功能 2：打卡管理（分类列表 + 隐藏/恢复 + 目标设置）
    checkinMgmtSummary: '',
    showCheckinMgmt: false,
    checkinMgmtRows: [] as {
      id: string; label: string; icon: string
      disabled: boolean; goalText: string
    }[],
    // 目标设置 sheet（与打卡页一致）
    showMgmtGoal: false,
    mgmtGoalId: '',
    mgmtGoalLabel: '',
    mgmtGoalFreq: 'daily' as 'daily' | 'weekly' | 'monthly',
    mgmtGoalTimes: 1,
    mgmtFreqOptions: [
      { value: 'daily', label: '每日' },
      { value: 'weekly', label: '每周' },
      { value: 'monthly', label: '每月' },
    ],
  },

  onLoad() {
    applyThemeToPage(this)
    this.syncFromStorage()
  },

  onShow() {
    applyThemeToPage(this)
    this.syncFromStorage()
  },

  /** 从 storage 同步当前偏好到本页 data（驱动选中态）*/
  syncFromStorage() {
    const prefs: AppPreferences = loadPreferences()
    // 年度目标：遍历预设分类，从 annualGoals 取值（缺省显示空串）
    const goalRows: GoalRowView[] = PRESET_CATEGORIES.map(c => ({
      id: c.id,
      label: c.label,
      icon: c.icon,
      value: prefs.annualGoals[c.id] != null ? String(prefs.annualGoals[c.id]) : '',
    }))
    // 系统勋章：遍历内置勋章，取用户改过的目标（缺省取 defaultTarget）；
    // 解锁判定用累计计数比对目标（与首页 buildMedalRows 同口径，但不在这里写回 unlockedAt——
    // 写回是首页的职责，设置页只反映当前状态）
    const allAchievements = loadAllAchievements()
    const counts = countByCategory(allAchievements)
    const checkins: Checkin[] = loadCheckins()
    const checkinDates = checkins.map(c => c.date)
    const checkinLongestStreak = calcLongestStreak(checkinDates)
    // v7：按打卡分类分组的连胜（给动态「连续某分类 N 天」勋章用）
    const checkinCats = getAllCheckinCategories(prefs.customCheckinCategories)
    const streakByCat: { [catId: string]: number } = {}
    for (const cat of checkinCats) {
      const catDates = checkins.filter(c => c.category === cat.id).map(c => c.date)
      if (catDates.length > 0) streakByCat[cat.id] = calcLongestStreak(catDates)
    }
    // 合并内置 + 动态分类打卡勋章
    const dynamicMedals = [] as typeof SYSTEM_MEDALS
    for (const cat of checkinCats) {
      if (streakByCat[cat.id] !== undefined && cat.id !== 'other') {
        dynamicMedals.push(...buildCheckinCategoryMedals(cat.id, cat.label, cat.icon))
      }
    }
    const allMedals = [...SYSTEM_MEDALS, ...dynamicMedals]
    const medalRows: MedalRowView[] = allMedals.map(md => {
      const saved = prefs.systemMedals[md.id]
      const target = (saved && saved.target > 0) ? saved.target : md.defaultTarget
      const limitedEdition = !!md.limitedEdition
      const inWindow = isInUnlockWindow(new Date(), md.unlockWindow)
      // 计数分流：全局打卡连胜 / 分类打卡连胜 / __any__ 全量 / 其它分类计数
      // 计数分流（与 buildMedalRows 同口径；限量勋章优先用窗口内录入数）
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
      const progress = !unlocked && target > 0
        ? { current, target, percent: Math.min(100, Math.round(current / target * 100)) }
        : null
      // 窗口提示文案（「已解锁」只看 unlocked 状态，不依赖 unlockedAt——settings 不写回该字段）
      let windowHint = ''
      if (limitedEdition && md.unlockWindow) {
        if (unlocked) windowHint = '已解锁'
        else if (inWindow) windowHint = '解锁窗口期'
        else windowHint = '窗口期外'
      }
      return {
        id: md.id,
        label: md.label,
        icon: md.icon,
        desc: md.desc,
        value: String(target),
        unlocked,
        limitedEdition,
        editable: !limitedEdition,   // 限量勋章目标固定，不可改
        windowHint,
        progress,
      }
    })
    // 年度关键词候选：基于全年成就推导；数据不足时为空（候选区隐藏）
    const keywordCandidates = calcAnnualKeywords(allAchievements)
    // 备份摘要：实时统计本地各类数据条数（驱动"将备份 N 条"提示）
    const backupSummary: BackupSummary = {
      achievements: allAchievements.length,
      reports: loadReports().length,
      wishes: loadWishes().length,
      inspirations: loadInspirations().length,
      checkins: checkins.length,
      hasTemplates: true,
      hasPreferences: true,
    }
    // 第二批功能 2：打卡管理——列出全部分类（含已隐藏），算目标文案 + 隐藏态。
    // 注意这里用不过滤 disabled 的合并列表（getAllCheckinCategories 不传 disabled），
    // 因为设置页要能看到被隐藏的分类以便恢复。
    const disabled = prefs.disabledCheckinCategories || []
    const disabledSet = new Set(disabled)
    const checkinMgmtRows = getAllCheckinCategories(prefs.customCheckinCategories).map(c => {
      const goal = getGoalForCategory(c.id, prefs)
      let goalText = ''
      if (goal) {
        const freqLabel = goal.frequency === 'daily' ? '每日' : goal.frequency === 'weekly' ? '每周' : '每月'
        goalText = freqLabel + ' ' + String(goal.timesPerPeriod) + ' 次'
      }
      return {
        id: c.id, label: c.label, icon: c.icon,
        disabled: disabledSet.has(c.id), goalText,
      }
    })
    const visibleCount = checkinMgmtRows.filter(r => !r.disabled).length
    const hiddenCount = checkinMgmtRows.length - visibleCount
    const goalsCount = checkinMgmtRows.filter(r => r.goalText).length
    const summaryParts: string[] = [String(visibleCount) + ' 个分类在用']
    if (goalsCount > 0) summaryParts.push(String(goalsCount) + ' 个已设目标')
    if (hiddenCount > 0) summaryParts.push(String(hiddenCount) + ' 个已隐藏')
    const checkinMgmtSummary = summaryParts.join(' · ')
    // 连胜保护详情：全局 + 各分类的连胜状态（断了且能保护的在前）。
    // 关闭连胜保护时不显示入口（WXML wx:if 控制），但这里仍然算一份，
    // 给 protectionSheet 用——开关在 sheet 打开期间切回来也能立即反映。
    const streakStatuses = buildStreakStatuses(
      checkins,
      getAllCheckinCategories(prefs.customCheckinCategories).map(c => ({ id: c.id, label: c.label })),
    )
    const protectionSheetFreebies = getFreebies()
    const protectionSheetBrokenCount = streakStatuses.filter(s => s.isBroken && s.canProtect).length
    this.setData({
      themeMode: prefs.themeMode,
      titleFont: prefs.titleFont,
      darkVariant: prefs.darkVariant,
      isDarkActive: resolveTheme(prefs.themeMode) === 'dark',
      goalRows,
      medalRows,
      annualKeywordInput: prefs.annualKeyword,
      keywordCandidates,
      backupSummary,
      trashCount: trashCount(),
      protectionEnabled: isProtectionEnabled(),
      protectionDescOn: '每月自动发 1 张，最多囤 3 张。剩 ' + getFreebies() + ' 张',
      checkinMgmtRows,
      checkinMgmtSummary,
      streakStatuses,
      protectionSheetFreebies,
      protectionSheetBrokenCount,
    })
  },

  onPickTheme(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: ThemeMode }).id
    updatePreferences({ themeMode: id })
    refreshThemeCache()
    applyThemeToPage(this)
    this.setData({
      themeMode: id,
      isDarkActive: resolveTheme(id) === 'dark',
    })
  },

  onPickDarkVariant(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: DarkVariant }).id
    updatePreferences({ darkVariant: id })
    refreshThemeCache()
    applyThemeToPage(this)
    this.setData({ darkVariant: id })
  },

  onPickFont(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as { id: FontTitleStyle }).id
    updatePreferences({ titleFont: id })
    refreshThemeCache()
    applyThemeToPage(this)
    this.setData({ titleFont: id })
  },

  /** 年度目标输入：单分类数字输入。即时更新本地视图 + 写回偏好。
   *  空串/非数字视为「清除该分类目标」（不写入 annualGoals）。
   *  这里失焦时统一回写（bindblur），避免每次按键都触发 storage 写。 */
  onGoalInput(e: WechatMiniprogram.Input) {
    const catId = e.currentTarget.dataset.id as string
    const raw = String(e.detail.value || '')
    // 更新本页视图（让 input 即时反映输入）
    const goalRows = this.data.goalRows.map(r => r.id === catId ? { ...r, value: raw } : r)
    this.setData({ goalRows })
  },

  /** 失焦时把当前 row 的值规范化并写回偏好 */
  onGoalBlur(e: WechatMiniprogram.Input) {
    const catId = e.currentTarget.dataset.id as string
    const raw = String(e.detail.value || '').trim()
    const num = parseInt(raw, 10)
    const finalValue = (!isNaN(num) && num > 0) ? String(num) : ''
    // 规范化本页视图
    const goalRows = this.data.goalRows.map(r => r.id === catId ? { ...r, value: finalValue } : r)
    this.setData({ goalRows })
    // 写回偏好：把所有非空 row 汇总成 annualGoals
    const annualGoals: { [category: string]: number } = {}
    for (const r of goalRows) {
      if (r.value) {
        const n = parseInt(r.value, 10)
        if (!isNaN(n) && n > 0) annualGoals[r.id] = n
      }
    }
    updatePreferences({ annualGoals })
    refreshThemeCache()
  },

  /* === 系统勋章目标 === */

  /** 勋章目标输入：单枚数字输入；即时更新本页视图（失焦时统一写回，避免每次按键写 storage）。
   *  与年度目标不同：勋章目标永远有值（缺省取 defaultTarget），所以空串也允许输入但失焦会回退。 */
  onMedalTargetInput(e: WechatMiniprogram.Input) {
    const id = e.currentTarget.dataset.id as string
    const raw = String(e.detail.value || '')
    const medalRows = this.data.medalRows.map(r => r.id === id ? { ...r, value: raw } : r)
    this.setData({ medalRows })
  },

  /** 失焦时规范化并把所有勋章目标汇总写回偏好（保留各勋章原有的 unlockedAt） */
  onMedalTargetBlur(e: WechatMiniprogram.Input) {
    const id = e.currentTarget.dataset.id as string
    const raw = String(e.detail.value || '').trim()
    const num = parseInt(raw, 10)
    // 勋章目标不能为空：非法输入回退到该勋章的 defaultTarget
    const md = SYSTEM_MEDALS.find(m => m.id === id)
    const finalNum = (!isNaN(num) && num > 0) ? num : (md ? md.defaultTarget : 1)
    const medalRows = this.data.medalRows.map(r => r.id === id ? { ...r, value: String(finalNum) } : r)
    this.setData({ medalRows })
    // 写回偏好：合并所有勋章目标；保留原 unlockedAt
    const prefs = loadPreferences()
    const nextMedals: { [id: string]: { target: number; unlockedAt?: number } } = {}
    for (const r of medalRows) {
      const n = parseInt(r.value, 10)
      const def = SYSTEM_MEDALS.find(m => m.id === r.id)
      const target = (!isNaN(n) && n > 0) ? n : (def ? def.defaultTarget : 1)
      const prev = prefs.systemMedals[r.id]
      const entry: { target: number; unlockedAt?: number } = { target }
      if (prev && typeof prev.unlockedAt === 'number') {
        entry.unlockedAt = prev.unlockedAt
      }
      nextMedals[r.id] = entry
    }
    updatePreferences({ systemMedals: nextMedals })
    refreshThemeCache()
  },

  /* === 年度关键词 === */

  onKeywordInput(e: WechatMiniprogram.Input) {
    this.setData({ annualKeywordInput: String(e.detail.value || '') })
  },

  /** 失焦写回：把输入框值规范化并持久化（trim；空串 = 清空 → 首页会回退到算法推荐） */
  onKeywordBlur() {
    const raw = this.data.annualKeywordInput.trim()
    const year = new Date().getFullYear()
    this.setData({ annualKeywordInput: raw })
    updatePreferences({ annualKeyword: raw, annualKeywordYear: raw ? year : 0 })
    refreshThemeCache()
  },

  /** 点候选词：直接填入并持久化（候选词来自算法，干净无需再 trim） */
  onPickKeyword(e: WechatMiniprogram.TouchEvent) {
    const kw = e.currentTarget.dataset.kw as string
    const year = new Date().getFullYear()
    this.setData({ annualKeywordInput: kw })
    updatePreferences({ annualKeyword: kw, annualKeywordYear: year })
    refreshThemeCache()
  },

  /* === 备份与恢复 === */

  /** 把当前数据计数摘要拼成可读文案（"47 条成就 · 3 份报告 · 12 条愿望 · 5 条灵感 · 30 天打卡"）。
   *  全为 0 时返回"暂无数据"。 */
  formatBackupSummary(s: BackupSummary): string {
    const parts: string[] = []
    if (s.achievements > 0) parts.push(String(s.achievements) + ' 条成就')
    if (s.reports > 0) parts.push(String(s.reports) + ' 份报告')
    if (s.wishes > 0) parts.push(String(s.wishes) + ' 条愿望')
    if (s.inspirations > 0) parts.push(String(s.inspirations) + ' 条灵感')
    if (s.checkins > 0) parts.push(String(s.checkins) + ' 天打卡')
    return parts.length > 0 ? parts.join(' · ') : '暂无数据'
  },

  /** 导入框输入：实时存到本页 data（不立即校验，避免边输入边报错）。
   *  失焦时再算预览。 */
  onImportInput(e: WechatMiniprogram.Input) {
    this.setData({ importInput: String(e.detail.value || '') })
  },

  /** 导入框失焦：算一句预览文案。
   *  空输入 → 清空预览；非空 → 试着识别魔术字与计数（不真的导入）。 */
  onImportBlur() {
    const raw = this.data.importInput.trim()
    if (!raw) {
      this.setData({ importPreview: '' })
      return
    }
    // 只做轻量预判（不抛错）：能 JSON.parse 且 _app 对得上才算"看起来像备份"
    try {
      const parsed = JSON.parse(raw)
      if (parsed && parsed._app === 'literary-report-backup' && parsed.data) {
        const d = parsed.data
        // 用与导出相同的口径统计（容错：字段缺失记 0）
        const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)
        const parts: string[] = []
        const a = count(d['book_film_data'])
        const r = count(d['report_instances'])
        const w = count(d['wishlist'])
        const i = count(d['inspirations'])
        const ck = count(d['checkins'])
        if (a > 0) parts.push(String(a) + ' 条成就')
        if (r > 0) parts.push(String(r) + ' 份报告')
        if (w > 0) parts.push(String(w) + ' 条愿望')
        if (i > 0) parts.push(String(i) + ' 条灵感')
        if (ck > 0) parts.push(String(ck) + ' 天打卡')
        const summary = parts.length > 0 ? parts.join(' · ') : '空备份'
        this.setData({ importPreview: '识别到备份：' + summary + '（v' + String(parsed.version) + '）' })
      } else {
        this.setData({ importPreview: '这不是本应用的备份' })
      }
    } catch (e) {
      this.setData({ importPreview: 'JSON 格式有误，无法识别' })
    }
  },

  /** 导出：先复制 JSON 到剪贴板（最稳，所有基础库都支持），再尝试写文件作为可选备份。
   *  成功提示里告诉用户"已复制，可粘贴到笔记/备忘录留存"。 */
  onTapExport() {
    if (this.data.backupBusy) return
    this.setData({ backupBusy: true })
    const result = exportAllData()
    if (!result.ok || !result.json) {
      this.setData({ backupBusy: false })
      wx.showModal({ title: '导出失败', content: result.msg, showCancel: false })
      return
    }
    // 主路径：复制到剪贴板（所有用户都能用，不依赖文件权限）
    wx.setClipboardData({
      data: result.json,
      success: () => {
        this.setData({ backupBusy: false })
        const summaryText = result.summary ? this.formatBackupSummary(result.summary) : ''
        wx.showModal({
          title: '已复制到剪贴板',
          content: '已备份 ' + summaryText + '。\n\n请打开备忘录 / 微信文件传输助手，粘贴保存。\n\n需要的话也可以点"另存为文件"保存到本机。',
          confirmText: '另存为文件',
          cancelText: '完成',
          success: (res) => {
            if (res.confirm) {
              this.writeBackupFile(result.json || '')
            }
          },
        })
      },
      fail: () => {
        this.setData({ backupBusy: false })
        // 剪贴板失败的兜底：直接写文件
        this.writeBackupFile(result.json || '')
      },
    })
  },

  /** 把 JSON 写到小程序用户目录下的文件，并尝试让用户转发/保存。
   *  写完后用 wx.shareFileMessage 把文件交给用户（用户可发给"文件传输助手"留存）。 */
  writeBackupFile(json: string) {
    const now = Date.now()
    const wResult = writeBackupToFile(json, now)
    if (!wResult.ok || !wResult.filePath) {
      wx.showModal({ title: '保存失败', content: wResult.msg, showCancel: false })
      return
    }
    const filePath = wResult.filePath
    const filename = wResult.filename || buildBackupFilename(now)
    // 优先让用户通过 shareFileMessage 把文件发到文件传输助手（最常见的留存路径）。
    // 该 API 在新版基础库才存在，类型定义里可能缺失，所以用宽松的 any 调用 + 运行时存在性检查。
    const shareFn = (wx as unknown as { shareFileMessage?: (opts: {
      filePath: string
      fileName?: string
      success?: () => void
      fail?: () => void
    }) => void }).shareFileMessage
    if (typeof shareFn === 'function') {
      shareFn({
        filePath,
        fileName: filename,
        success: () => {
          wx.showToast({ title: '已发送', icon: 'success' })
        },
        fail: () => {
          // 分享失败也至少告诉用户文件路径
          wx.showModal({
            title: '文件已生成',
            content: '已保存为 ' + filename + '，但分享未成功。可稍后重试或继续用剪贴板里的备份。',
            showCancel: false,
          })
        },
      })
    } else {
      // 老基础库无 shareFileMessage：提示文件名即可
      wx.showModal({
        title: '文件已生成',
        content: '已保存为 ' + filename + '。',
        showCancel: false,
      })
    }
  },

  /** 导入：弹出二次确认（覆盖是不可逆操作）→ 调 importAllData → 成功后刷新本页 + 提示重启视角。
   *  导入前会再读一次剪贴板（用户可能刚刚才粘贴了新内容到输入框又复制走了）。 */
  onTapImport() {
    if (this.data.backupBusy) return
    const raw = this.data.importInput.trim()
    if (!raw) {
      // 输入框空 → 尝试直接读剪贴板（最常见的"我刚复制了备份"场景）
      wx.getClipboardData({
        success: (clip) => {
          const clipText = String(clip.data || '').trim()
          if (clipText) {
            this.setData({ importInput: clipText })
            this.confirmImport(clipText)
          } else {
            wx.showModal({
              title: '请先粘贴备份',
              content: '把之前导出的备份 JSON 粘贴到上方输入框，或先复制到剪贴板再点此按钮。',
              showCancel: false,
            })
          }
        },
        fail: () => {
          wx.showModal({
            title: '请先粘贴备份',
            content: '把之前导出的备份 JSON 粘贴到上方输入框。',
            showCancel: false,
          })
        },
      })
      return
    }
    this.confirmImport(raw)
  },

  /** 二次确认 + 真正执行导入。
   *  覆盖是不可逆的，所以一定要用 showModal 让用户明确点头。 */
  confirmImport(json: string) {
    wx.showModal({
      title: '确认恢复',
      content: '恢复会用备份内容覆盖当前所有数据（成就/报告/愿望/灵感/偏好），且不可撤销。\n\n建议在换机或清空数据前先导出一次当前数据。\n\n确认继续？',
      confirmText: '覆盖恢复',
      cancelText: '取消',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (!res.confirm) return
        this.setData({ backupBusy: true })
        const result = importAllData(json)
        this.setData({ backupBusy: false })
        if (result.ok) {
          // 清空导入框 + 刷新本页（偏好/目标/勋章可能全变了）
          this.setData({ importInput: '', importPreview: '' })
          this.syncFromStorage()
          refreshThemeCache()
          applyThemeToPage(this)
          wx.showModal({
            title: '恢复成功',
            content: result.msg + '。\n\n如果页面显示异常，请退出小程序后重新进入，让所有页面重新加载。',
            showCancel: false,
          })
        } else {
          wx.showModal({ title: '恢复失败', content: result.msg, showCancel: false })
        }
      },
    })
  },

  /** 清空导入输入框（用户错粘了别的内容时方便重置） */
  onTapClearImport() {
    this.setData({ importInput: '', importPreview: '' })
  },

  /** 回收站入口：跳回收站页 */
  onTapTrash() {
    wx.navigateTo({ url: '/pages/trash/trash' })
  },

  /** 切换连胜保护开关：开 → 打卡页显示习惯强度行 + 每月发券；关 → 隐藏 + 不发券。
   *  关掉时不清掉已囤的券（用户随时再开，券还在），只是停止发放与显示。 */
  onToggleProtection() {
    const next = !this.data.protectionEnabled
    setProtectionEnabled(next)
    this.setData({
      protectionEnabled: next,
      protectionDescOn: '每月自动发 1 张，最多囤 3 张。剩 ' + getFreebies() + ' 张',
    })
    wx.showToast({
      title: next ? '已开启连胜保护' : '已关闭连胜保护',
      icon: 'none',
    })
  },

  /* === 第二批功能 2：打卡管理 sheet === */

  onOpenCheckinMgmt() {
    this.setData({ showCheckinMgmt: true })
  },

  onCloseCheckinMgmt() {
    this.setData({ showCheckinMgmt: false })
  },

  /** 切换某分类的隐藏态：已隐藏 → 恢复；在用 → 隐藏（加入 disabledCheckinCategories）。 */
  onMgmtToggleHide(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const prefs = loadPreferences()
    const disabled = (prefs.disabledCheckinCategories || []).slice()
    const idx = disabled.indexOf(id)
    if (idx >= 0) {
      disabled.splice(idx, 1)
      updatePreferences({ disabledCheckinCategories: disabled })
      this.syncFromStorage()
      wx.showToast({ title: '已恢复', icon: 'success' })
    } else {
      const row = this.data.checkinMgmtRows.find(r => r.id === id)
      const label = row ? row.label : id
      wx.showModal({
        title: '隐藏「' + label + '」？',
        content: '从今日打卡移除，已有记录保留。可随时在此恢复',
        confirmColor: designTokens.color.danger,
        success: (res) => {
          if (!res.confirm) return
          disabled.push(id)
          updatePreferences({ disabledCheckinCategories: disabled })
          this.syncFromStorage()
          wx.showToast({ title: '已隐藏', icon: 'none' })
        },
      })
    }
  },

  /* === 连胜保护详情 sheet（手动用券保住断掉的连胜） === */

  onOpenProtectionSheet() {
    this.syncFromStorage()
    this.setData({ showProtectionSheet: true })
  },

  onCloseProtectionSheet() {
    this.setData({ showProtectionSheet: false })
  },

  /** 在保护详情里点「🛡️ 用券保住」：扣 1 张券、记保护日期、刷新列表。
   *  数据驱动：data-scope 是 GLOBAL_SCOPE 或某分类 id；brokenDate 来自 streakStatuses。 */
  onUseFreebie(e: WechatMiniprogram.TouchEvent) {
    const scope = (e.currentTarget.dataset as { scope?: string }).scope
    if (!scope) return
    const status = this.data.streakStatuses.find(s => s.scope === scope)
    if (!status) return
    if (!status.isBroken) {
      wx.showToast({ title: '当前连胜未断，无需用券', icon: 'none' })
      return
    }
    if (status.hasProtected) {
      wx.showToast({ title: '已用券保护过这天', icon: 'none' })
      return
    }
    if (this.data.protectionSheetFreebies <= 0) {
      wx.showToast({ title: '保护券已用完', icon: 'none' })
      return
    }
    const ok = useFreebie(scope, status.brokenDate)
    if (!ok) {
      wx.showToast({ title: '用券失败（券不足或已保护过）', icon: 'none' })
      return
    }
    const label = status.label
    this.syncFromStorage()
    this.setData({ showProtectionSheet: true })
    wx.showToast({ title: '已用券保住「' + label + '」连胜', icon: 'success' })
  },

  /** 点「目标」按钮：打开目标设置 sheet，预填该分类当前目标。 */
  onMgmtToggleGoal(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const row = this.data.checkinMgmtRows.find(r => r.id === id)
    const prefs = loadPreferences()
    const current = getGoalForCategory(id, prefs)
    this.setData({
      showCheckinMgmt: false,
      showMgmtGoal: true,
      mgmtGoalId: id,
      mgmtGoalLabel: row ? row.label : id,
      mgmtGoalFreq: current ? current.frequency : 'daily',
      mgmtGoalTimes: current ? current.timesPerPeriod : 1,
    })
  },

  onMgmtPickFreq(e: WechatMiniprogram.TouchEvent) {
    this.setData({ mgmtGoalFreq: e.currentTarget.dataset.value as 'daily' | 'weekly' | 'monthly' })
  },

  onMgmtGoalMinus() {
    const n = this.data.mgmtGoalTimes
    if (n <= 1) return
    this.setData({ mgmtGoalTimes: n - 1 })
  },

  onMgmtGoalPlus() {
    const n = this.data.mgmtGoalTimes
    if (n >= 30) return
    this.setData({ mgmtGoalTimes: n + 1 })
  },

  onMgmtSaveGoal() {
    const id = this.data.mgmtGoalId
    if (!id) return
    const goal: CheckinGoal = { frequency: this.data.mgmtGoalFreq, timesPerPeriod: this.data.mgmtGoalTimes }
    const prefs = loadPreferences()
    const goals = { ...(prefs.checkinGoals || {}) }
    goals[id] = goal
    updatePreferences({ checkinGoals: goals })
    this.setData({ showMgmtGoal: false, mgmtGoalId: '', mgmtGoalLabel: '' })
    this.syncFromStorage()
    const freqLabel = goal.frequency === 'daily' ? '每日' : goal.frequency === 'weekly' ? '每周' : '每月'
    wx.showToast({ title: '已设：' + freqLabel + ' ' + String(goal.timesPerPeriod) + ' 次', icon: 'none' })
  },

  onMgmtClearGoal() {
    const id = this.data.mgmtGoalId
    if (!id) return
    const prefs = loadPreferences()
    const goals = { ...(prefs.checkinGoals || {}) }
    delete goals[id]
    updatePreferences({ checkinGoals: goals })
    this.setData({ showMgmtGoal: false, mgmtGoalId: '', mgmtGoalLabel: '' })
    this.syncFromStorage()
    wx.showToast({ title: '已清除目标', icon: 'none' })
  },

  onCloseMgmtGoal() {
    this.setData({ showMgmtGoal: false, mgmtGoalId: '', mgmtGoalLabel: '' })
  },

  onShareAppMessage() {
    return {
      title: '阅观年度 — 记录你的每一个成就',
      path: '/pages/index/index',
    }
  },
})
