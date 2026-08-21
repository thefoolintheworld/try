// pages/index/index.ts
// 首页：年度 hero + 成就墙展示区 + 「录入新成就」主入口 + 「我的报告」次入口
// 成就系统主轴下：去掉四宫格统计与分类分布（信息过载）；新增成就墙（默认最新 6 条，
// 用户可勾选置顶哪些上首页）。CTA 文案从「继续记录成就」改为「录入新成就」。
//
// 重构说明：跨实体的加载 + 跨页面可能复用的聚合已收口到 utils/dashboard.ts 的
// loadDashboardSnapshot()。本页 refresh 只负责把 Snapshot 摆成 UI 视图（wallItems /
// rings / capsule / wrapped 入口等），不再直接调 storage/stats 函数。

import { Item, loadAllAchievements, loadAchievementsByYear } from '../../utils/storage'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { presetToCss } from '../../utils/achievement-presets'
import { loadPreferences, updatePreferences } from '../../utils/preferences'
import { loadDashboardSnapshot } from '../../utils/dashboard'
import { collectOnThisDay } from '../../utils/on-this-day'
import { listWrappedYears, isYearUnlocked } from '../../utils/wrapped'
import { analyzePersonality } from '../../utils/personality'
import { safeRefresh } from '../../utils/error-boundary'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

interface WallItemView {
  id: string
  title: string
  finishedDate: string
  categoryIcon: string
  categoryColor: string
  // 图片渲染：'none' 无图（用分类 emoji 占位）/ 'preset' 预设（用 cssPreview）/ 'image' 真实路径
  imageKind: 'none' | 'preset' | 'image'
  image: string
  presetCss: string
  // 里程碑进度：hasProgress=false 时 wxml 不渲染进度条
  hasProgress: boolean
  progressCurrent: number
  progressTarget: number
  progressPercent: number   // 0-100 整数；用于 fill 宽度
}

/** 年度目标进度行视图（首页 goals-card 用） */
interface GoalProgressView {
  id: string
  label: string
  icon: string
  current: number      // 今年该分类已记录条数
  target: number       // 用户设的目标
  percent: number      // 0-100（current>target 钳到 100）
}

/** 勾选 sheet 里的候选项（全部成就 + 当前是否已勾选上首页） */
interface PinCandidateView {
  id: string
  title: string
  finishedDate: string
  categoryIcon: string
  checked: boolean
}

/** 首页勋章墙单行视图：把 SystemMedal + 当前计数 + 用户目标 解析成渲染数据 */
/** 首页成就墙展示条数上限 */
const WALL_MAX = 6

/** Hero 区数据胶囊条视图：把年度目标卡 + 勋章墙卡的核心数字压成一行紧凑胶囊。
 *  每个字段空串/0 时对应胶囊隐藏；全空时整条隐藏（首次使用不轰炸用户）。
 *  - streak: 最长连续记录天数（累计，跨年）
 *  - books / films: 累计书数 / 影数（countByCategory）
 *  - medalText: 勋章进度概览文案（如 "2/4"，未设勋章时空串）
 *  - goalText: 年度目标进度概览文案（如 "94%"，未设目标时空串） */
interface CapsuleView {
  streak: number
  books: number
  films: number
  medalText: string
  goalText: string
}

Page({
  data: {
    // 主题相关（每页都有；applyThemeToPage 注入）
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    year: new Date().getFullYear(),
    years: [] as number[],
    wallItems: [] as WallItemView[],
    pinnedCount: 0,   // P2-2 陈列柜入口：置顶成就数（>0 时显示入口）
    hasData: false,
    loadError: false,  // refresh 抛错时显示「加载失败 + 重试」
    reportCount: 0,
    hasReports: false,

    // === 许愿星入口（原灵感抽屉/愿望清单）===
    wishPendingCount: 0,   // 未完成的愿望数（achievementId 为空）
    wishTotalCount: 0,     // 总愿望数

    // === 灵感抽屉入口（新功能：自由记录闪念）===
    inspirationCount: 0,   // 灵感总条数；用于入口文案切换（0 时显示引导语）

    // === 每日打卡入口（v7 多分类：一天可多条不同分类）===
    checkinStreak: 0,       // 当前连续打卡天数（入口卡片副标题 + 胶囊条 🔥 联动）
    todayChecked: false,    // 今天是否已打卡（入口卡片文案切换）
    todayCheckinCount: 0,   // 今日已打卡分类数（多分类时显示「N 项」）

    // === 往年今日入口（条件出现：仅当天有往年记录时才显示卡片）===
    onThisDayCount: 0,      // 历史上今天的记录总数（0 时整张卡片隐藏）
    onThisDayPreview: '',   // 最近一条的标题预览（用于卡片副标题"X 年前的今天：…"）

    // === 年度回顾入口（条件出现：有可看的历史年份，或当年 12 月解锁时显示）===
    wrappedYear: 0,         // 点击后跳转的目标年份（优先去年；去年没数据则取 listWrappedYears 第一个）
    wrappedHeadline: '',    // 入口副标题文案（如"回看 2024 · 你的人格是「深读派」"）
    wrappedHasYear: false,  // 是否显示卡片（无可看年份时整张隐藏）

    // === 金句墙入口（条件出现：有 ≥1 条金句时显示）===
    quotesCount: 0,         // 金句总数（>0 时显示入口）
    quotesPreview: '',      // 入口副标题（最近一条金句的预览，超长截断）

    // === Hero 数据胶囊条（替代原年度目标卡 + 勋章墙卡；详见 CapsuleView）===
    capsule: {
      streak: 0, books: 0, films: 0, medalText: '', goalText: '',
    } as CapsuleView,

    // === 成就墙勾选 sheet（自定义哪些上首页） ===
    showPinSheet: false,
    // sheet 里展示的全部成就（带勾选态）；最多提示勾 6 条
    pinCandidates: [] as PinCandidateView[],
    // 已勾选条数（实时反馈给用户）
    pinSelectedCount: 0,

    // 成就墙列数布局：single 单列 / double 双列（默认）。驱动 wall-grid 的 CSS 类。
    wallLayout: 'double' as 'single' | 'double',
  },

  onLoad() {
    applyThemeToPage(this)
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    // 首页读几乎所有实体（成就/打卡/勋章/偏好/金句/往年今日），只要任一脏了就重算；
    // 都没动则跳过 refresh（纯内存读开销可忽略），避免切回首页时的无谓重活。
    const watched: DirtyField[] = ['achievements', 'checkins', 'preferences', 'reports']
    if (!anyDirty(watched)) return
    // 命中后逐个清标记（anyDirty 不自动清；这里按需清掉本次关心过的）
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    safeRefresh(this, () => {
    // 一次性装配跨实体数据 + 跨域聚合；本函数只做 UI 视图构造，不再调 storage/stats。
    const snap = loadDashboardSnapshot()
    const { year, years, prefs, allAchievements, counts, checkin, overview, categoryCounts, medalRows, quotes } = snap
    const hasData = allAchievements.length > 0

    const wallItems = this.buildWallItems(allAchievements)
    const wallLayout = prefs.wallLayout
    // P2-2 陈列柜入口：用户置顶过的成就数（驱动首页入口卡片显示/隐藏）
    const pinnedCount = prefs.pinnedAchievements.length

    const medalUnlockedCount = medalRows.filter(m => m.unlocked).length

    // 年度目标进度：基于今年成就按分类统计 current；只显示用户设了目标的分类。
    const goalRows = this.buildGoalRows(prefs.annualGoals, year)

    // 数据胶囊条：把上面的分散指标压成一行紧凑数字。
    // streak 优先用打卡连续天数（更准确的"打卡感"），无打卡时回退到成就最长连续天数。
    const capsule: CapsuleView = {
      streak: checkin.streak > 0 ? checkin.streak : overview.longestStreak,
      books: categoryCounts['reading'] || 0,
      films: categoryCounts['film'] || 0,
      medalText: medalRows.length > 0 ? String(medalUnlockedCount) + '/' + String(medalRows.length) : '',
      goalText: this.buildGoalSummary(goalRows),
    }

    // 往年今日：历史上今天的记录总数 + 最近一条预览（卡片条件出现，0 条时整张隐藏）
    const onThisDayEntries = collectOnThisDay(new Date())
    const onThisDayCount = onThisDayEntries.length
    const latestEntry = onThisDayCount > 0 ? onThisDayEntries[0] : null
    // P3-1 预览增强：若最近一条有金句，用金句做预览（比标题更打动人）；否则回退标题
    const onThisDayPreview = latestEntry
      ? (latestEntry.quotePreview
          ? latestEntry.yearsAgo + ' 年前：' + latestEntry.quotePreview
          : latestEntry.yearsAgo + ' 年前的今天：' + latestEntry.title)
      : ''

    // 年度回顾入口：有"可看"的年份才显示卡片。
    //  - 可看 = 该年份已解锁（历史年份永远解锁；当年仅 12 月）且有 ≥MIN 条数据。
    //  - 目标年份优先取去年（最值得回看）；去年没数据则取 listWrappedYears 第一个。
    //  - 副标题预览该年人格标签（让用户一眼想点进去）；数据不足或解析失败时回退到通用文案。
    const thisYear = new Date().getFullYear()
    const wrappedYearsAll = listWrappedYears()
    // 过滤出"已解锁 + 数据足够"的年份（listWrappedYears 已保证数据足够，这里再过一遍解锁态更稳妥）
    const viewableYears = wrappedYearsAll.filter(y => isYearUnlocked(y))
    let wrappedYear = 0
    let wrappedHeadline = ''
    let wrappedHasYear = false
    if (viewableYears.length > 0) {
      // 优先去年；去年不在列表里（数据不足）则取列表第一个
      const lastYear = thisYear - 1
      wrappedYear = viewableYears.indexOf(lastYear) >= 0
        ? lastYear
        : viewableYears[0]
      wrappedHasYear = true
      // 副标题：尽量带上人格标签（情绪钩子）；解析失败回退到通用文案。
      // 性能：只跑人格分析（analyzePersonality），不走完整 loadWrapped（后者会建 5 幕 + 多轮统计），
      // 避免每次 onShow 都做一次重活——首页本来已经在算成就墙/胶囊条/目标等。
      try {
        const yearItems = loadAchievementsByYear(wrappedYear)
        const personality = analyzePersonality(yearItems)
        wrappedHeadline = personality.sufficient && personality.meta
          ? '回看 ' + wrappedYear + ' · 你的人格是「' + personality.meta.label + '」'
          : '回看 ' + wrappedYear + ' 年度故事'
      } catch (_e) {
        wrappedHeadline = '回看 ' + wrappedYear + ' 年度故事'
      }
    }

    // === 金句墙入口数据（snapshot 已聚合跨年累计金句）===
    const quotesCount = quotes.length
    // 预览：取最近一条（calcQuotes 按 items 顺序聚合，items 按 createdAt 升序，故末尾是最新的）金句前 24 字
    let quotesPreview = ''
    if (quotesCount > 0) {
      const last = quotes[quotesCount - 1]
      const preview = last.text.length > 24 ? last.text.slice(0, 24) + '…' : last.text
      quotesPreview = '「' + preview + '」'
    }

    this.setData({
      year,
      years,
      hasData,
      reportCount: counts.report,
      hasReports: counts.report > 0,
      wallItems,
      wallLayout,
      pinnedCount,
      wishPendingCount: counts.wishPending,
      wishTotalCount: counts.wishTotal,
      inspirationCount: counts.inspiration,
      checkinStreak: checkin.streak,
      todayChecked: checkin.todayChecked,
      todayCheckinCount: checkin.todayCheckins.length,
      capsule,
      onThisDayCount,
      onThisDayPreview,
      wrappedYear,
      wrappedHeadline,
      wrappedHasYear,
      quotesCount,
      quotesPreview,
      // 回顾区是否整体可见（四张回顾卡片任意一张出现即显示分组标题）
      hasRecap: onThisDayCount > 0 || wrappedHasYear || pinnedCount > 0 || quotesCount > 0,
    })
    })  // safeRefresh
  },

  /** 错误态：重试 */
  onRetry() {
    this.setData({ loadError: false })
    this.refresh()
  },

  /** 把年度目标行汇总成一个百分比文案（如 "94%"）。
   *  规则：取所有已设目标的分类，按 current/target 算各自完成率，取平均（最直观的整体进度）。
   *  无任何目标 → 空串（胶囊条该格隐藏）。 */
  buildGoalSummary(goalRows: GoalProgressView[]): string {
    if (goalRows.length === 0) return ''
    const sum = goalRows.reduce((s, r) => s + r.percent, 0)
    const avg = Math.round(sum / goalRows.length)
    return String(avg) + '%'
  },

  /**
   * 构造年度目标进度行：遍历用户设了目标的分类，统计今年该分类已记录条数。
   *  无任何目标 → 返回空数组（首页整张卡片隐藏）。
   */
  buildGoalRows(annualGoals: { [cat: string]: number }, year: number): GoalProgressView[] {
    const goalCats = Object.keys(annualGoals).filter(c => annualGoals[c] > 0)
    if (goalCats.length === 0) return []
    const yearItems = loadAchievementsByYear(year)
    // 今年各分类计数
    const counts: { [cat: string]: number } = {}
    for (const it of yearItems) {
      const c = resolveCategory(it.category, it.type)
      counts[c] = (counts[c] || 0) + 1
    }
    return goalCats.map(cat => {
      const meta = getCategoryMeta(cat)
      const target = annualGoals[cat]
      const current = counts[cat] || 0
      const percent = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0
      return { id: cat, label: meta.label, icon: meta.icon, current, target, percent }
    })
  },

  /** 构造成就墙展示列表（最多 6 条）。
   *  优先级：用户勾选置顶（pinnedAchievements 偏好，按勾选顺序）→ 不足 6 条用最新成就补齐；
   *  偏好为空 → 直接取最新 6 条。 */
  buildWallItems(all: Item[]): WallItemView[] {
    if (all.length === 0) return []
    const prefs = loadPreferences()
    const byId: { [id: string]: Item } = {}
    for (const it of all) byId[it.id] = it

    const wall: WallItemView[] = []
    const seen: { [id: string]: boolean } = {}

    // 1. 用户置顶项（按偏好里的顺序）
    for (const id of prefs.pinnedAchievements) {
      if (wall.length >= WALL_MAX) break
      const it = byId[id]
      if (!it || seen[id]) continue
      wall.push(this.toWallView(it))
      seen[id] = true
    }
    // 2. 用最新成就补齐到 6 条
    const sorted = [...all].sort((a, b) =>
      a.finishedDate < b.finishedDate ? 1 : a.finishedDate > b.finishedDate ? -1 : 0
    )
    for (const it of sorted) {
      if (wall.length >= WALL_MAX) break
      if (seen[it.id]) continue
      wall.push(this.toWallView(it))
      seen[it.id] = true
    }
    return wall
  },

  /** 把 Item 转成成就墙渲染视图（处理图片的三种渲染形态）*/
  toWallView(it: Item): WallItemView {
    const cat = resolveCategory(it.category, it.type)
    const meta = getCategoryMeta(cat)
    const image = it.image || ''
    const imageType = it.imageType
    let imageKind: 'none' | 'preset' | 'image' = 'none'
    let presetCss = ''
    if (imageType === 'preset' || (imageType === undefined && image && image.indexOf('achv-') === 0)) {
      imageKind = 'preset'
      presetCss = presetToCss(image)
    } else if (image && (imageType === 'custom' || imageType === 'builtin')) {
      imageKind = 'image'
    }
    // 进度：仅 target>0 才视为有效里程碑；current 上限钳到 target 防止溢出条宽
    const prog = it.progress
    const hasProgress = !!(prog && prog.target > 0)
    const progressCurrent = hasProgress ? prog.current : 0
    const progressTarget = hasProgress ? prog.target : 0
    const progressPercent = hasProgress
      ? Math.min(100, Math.max(0, Math.round(prog.current / prog.target * 100)))
      : 0
    return {
      id: it.id,
      title: it.title,
      finishedDate: it.finishedDate,
      categoryIcon: meta.icon,
      categoryColor: meta.color,
      imageKind,
      image,
      presetCss,
      hasProgress,
      progressCurrent,
      progressTarget,
      progressPercent,
    }
  },

  /** 主 CTA：录入新成就 */
  onTapAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },

  /** 次入口：成就墙（完整列表页） */
  onTapList() {
    wx.navigateTo({ url: '/pages/list/list' })
  },

  /** 次入口：生成报告（可选成就做成报告，保留原有功能） */
  onTapReport() {
    wx.navigateTo({ url: '/pages/report/report' })
  },

  /** 次入口：文案生成海报——直达报告页的「从文案导入」标签（自带文案直接出海报） */
  onTapPosterFromText() {
    wx.navigateTo({ url: '/pages/report/report?mode=import' })
  },

  /** 次入口：我的报告列表 */
  onTapReports() {
    wx.navigateTo({ url: '/pages/reports/reports' })
  },

  /** P2-2 陈列柜入口：跳个人陈列柜页（展示置顶的 6 条成就） */
  onTapProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  },

  /** P3-1 金句墙入口：跳全局金句墙页（跨年份聚合 + 排序切换） */
  onTapQuotes() {
    wx.navigateTo({ url: '/pages/quotes/quotes' })
  },

  /** 许愿星入口（原灵感抽屉）：跳愿望清单页 */
  onTapWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' })
  },

  /** 灵感抽屉入口：跳灵感记录页 */
  onTapInspiration() {
    wx.navigateTo({ url: '/pages/inspiration/inspiration' })
  },

  /** 每日打卡入口：跳打卡页 */
  onTapCheckin() {
    wx.navigateTo({ url: '/pages/checkin/checkin' })
  },

  /** 全局搜索入口：跳搜索页（跨成就/愿望/灵感/打卡全文搜索） */
  onTapSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },

  /** 往年今日入口：跳 on-this-day 页（历史上今天留下的记录） */
  onTapOnThisDay() {
    wx.navigateTo({ url: '/pages/on-this-day/on-this-day' })
  },

  /** 年度回顾入口：跳 wrapped 页，带目标年份（优先去年；去年没数据则取其它可看年份） */
  onTapWrapped() {
    const year = this.data.wrappedYear
    if (!year) {
      wx.navigateTo({ url: '/pages/wrapped/wrapped' })
      return
    }
    wx.navigateTo({ url: '/pages/wrapped/wrapped?year=' + year })
  },

  /** 年度目标「设置 ›」入口：跳设置页（滚到目标区由用户自行定位） */
  onTapEditGoals() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  /** 勋章墙「编辑目标」入口：跳设置页（同上，由用户自行滚到勋章区） */
  onTapEditMedals() {
    // P3：勋章墙有了独立页，胶囊条点击直达展示页（设置页仍保留目标编辑入口）
    wx.navigateTo({ url: '/pages/medals/medals' })
  },

  /** 成就墙卡片：跳到该成就的编辑页 */
  onTapWallItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    wx.navigateTo({ url: `/pages/edit/edit?id=${id}` })
  },

  /** 成就墙「编辑展示」入口：打开底部勾选 sheet。
   *  加载当前偏好里已勾选的 id，给每条成就标记 checked 状态。 */
  onTapEditWall() {
    const all = loadAllAchievements()
    if (all.length === 0) {
      wx.showToast({ title: '还没有成就可勾选', icon: 'none' })
      return
    }
    const pinned = loadPreferences().pinnedAchievements
    const pinnedSet: { [id: string]: boolean } = {}
    for (const id of pinned) pinnedSet[id] = true
    // 候选按日期降序排（最新的在上面，方便找）
    const candidates: PinCandidateView[] = [...all]
      .sort((a, b) => (a.finishedDate < b.finishedDate ? 1 : a.finishedDate > b.finishedDate ? -1 : 0))
      .map(it => {
        const cat = resolveCategory(it.category, it.type)
        const meta = getCategoryMeta(cat)
        return {
          id: it.id,
          title: it.title,
          finishedDate: it.finishedDate,
          categoryIcon: meta.icon,
          checked: !!pinnedSet[it.id],
        }
      })
    this.setData({
      showPinSheet: true,
      pinCandidates: candidates,
      pinSelectedCount: candidates.filter(c => c.checked).length,
    })
  },

  /** 勾选/取消勾某条：切换 checked，维持最多 6 条上限 */
  onTogglePin(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const candidates = this.data.pinCandidates
    let selectedCount = 0
    const next = candidates.map(c => {
      if (c.id !== id) {
        if (c.checked) selectedCount++
        return c
      }
      // 要把这条从 unchecked 变 checked：先看是否还有名额
      if (!c.checked) {
        if (selectedCount >= WALL_MAX) {
          wx.showToast({ title: `最多勾选 ${WALL_MAX} 条`, icon: 'none' })
          return c
        }
        selectedCount++
        return { ...c, checked: true }
      }
      // checked → unchecked：直接取消
      return { ...c, checked: false }
    })
    // selectedCount 此时可能漏算最后一条（上面逻辑里 selectedCount 已含转换后的），
    // 重新准确统计一次避免漂移
    const recount = next.filter(c => c.checked).length
    this.setData({ pinCandidates: next, pinSelectedCount: recount })
  },

  /** 确认勾选：把 checked 的 id 按当前列表顺序写进偏好，刷新首页 */
  onConfirmPin() {
    const pinnedIds = this.data.pinCandidates.filter(c => c.checked).map(c => c.id)
    updatePreferences({ pinnedAchievements: pinnedIds })
    this.setData({ showPinSheet: false })
    this.refresh()
    wx.showToast({ title: '已更新展示', icon: 'success' })
  },

  /** 关闭勾选 sheet（不保存） */
  onClosePinSheet() {
    this.setData({ showPinSheet: false })
  },

  /** 切换成就墙列数：double ↔ single。即时生效并写偏好。 */
  onToggleWallLayout() {
    const current = this.data.wallLayout
    const next = current === 'double' ? 'single' : 'double'
    updatePreferences({ wallLayout: next })
    this.setData({ wallLayout: next })
  },

  onTapAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  },

  onTapSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  /** 数据回顾入口：跳统计页（全年数据可视化画像） */
  onTapStats() {
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  onShareAppMessage() {
    return {
      title: '阅观年度 — 记录你的每一个成就',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    const total = this.data.wallItems.length
    return {
      title: this.data.year + ' 成就年度' + (total > 0 ? ' · ' + total + ' 条记录' : ''),
    }
  },
})
