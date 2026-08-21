// pages/stats/stats.ts
// 数据回顾页：消化 stats.ts 里 9 个统计函数的可视化页。
// 设计目标：让用户录入的数据「被看见」——总览仪表盘 + 月度柱状 + 评分分布 + 体裁/分类占比 + 阅读足迹 + 金句墙 + 高分榜。
// 所有统计基于「当前选中年份」的成就（与列表页同口径）；切年份即时重算。
// 纯只读展示页，不写数据；与成就墙/报告完全解耦。

import { Item, loadYears, loadCheckins, loadAllAchievements, loadAchievementsByYear } from '../../utils/storage'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { calcInsights, InsightView } from '../../utils/insights'
import { safeRefresh } from '../../utils/error-boundary'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'
import {
  calcOverview, OverviewStats,
  calcMonthlyStats, MonthStat,
  calcRatingDist, RatingDist,
  calcGenreStats, GenreStat,
  calcTypeRatio, TypeRatio,
  calcFootprint, FootprintEntry,
  calcQuotes, QuoteEntry,
  calcTopItems,
  countByCategory,
} from '../../utils/stats'

/** 热力图单日数据（与 components/heatmap/heatmap.ts 的 HeatmapDay 同构；
 *  这里本地声明避免页面 ↔ 组件双向类型依赖） */
interface HeatmapDay {
  date: string
  count: number
}

/** 总览数字格视图 */
interface OverviewCell {
  label: string
  value: string
  icon: string
}

/** 月度柱视图（柱高百分比 + 月份标签 + 数量） */
interface MonthBarView {
  month: number
  count: number
  height: number   // 0-100，相对最大值的百分比（用于柱高）
  isPeak: boolean
}

/** 评分分布行视图（星级文字 + 条宽百分比 + 数量） */
interface RatingRowView {
  ratingText: string   // "5.0★" / "4.5★" ...
  count: number
  width: number        // 0-100，相对最大值的条宽
}

/** 体裁条视图（体裁名 + 数量 + 条宽） */
interface GenreBarView {
  name: string
  count: number
  width: number        // 0-100
  percent: number      // 占比百分比（相对总数）
}

/** 分类占比视图（分类名 + 图标 + 数量 + 占比） */
interface CategoryShareView {
  id: string
  label: string
  icon: string
  color: string
  count: number
  percent: number      // 占比百分比
}

/** 阅读足迹行视图 */
interface FootprintView {
  place: string
  count: number
  sampleTitles: string   // 前 2 本的标题，逗号分隔
}

/** 金句卡视图 */
interface QuoteView {
  text: string
  bookTitle: string
}

/** 高分榜行视图 */
interface TopItemView {
  id: string
  title: string
  rating: number
  categoryIcon: string
  categoryColor: string
  finishedDate: string
}

/** P2-5 洞察条目视图（直接复用 utils/insights 的 InsightView） */
type InsightRowView = InsightView

/** 类型占比胶囊（书/影） */
interface TypePillView {
  label: string
  count: number
  percent: number
  color: string
}

Page({
  data: {
    // 主题
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    // 年份切换
    years: [] as number[],
    currentYear: new Date().getFullYear(),
    hasData: false,        // 该年份是否有任何成就（控制空状态）

    // 总览仪表盘
    overviewCells: [] as OverviewCell[],
    avgRatingText: '0.0',

    // 月度柱状图
    monthBars: [] as MonthBarView[],
    peakMonth: '' as string,   // "最投入的是 6 月"

    // 评分分布
    ratingRows: [] as RatingRowView[],

    // 体裁 Top
    genreBars: [] as GenreBarView[],

    // 书影占比 + 分类占比
    typePills: [] as TypePillView[],
    categoryShares: [] as CategoryShareView[],

    // 阅读足迹
    footprints: [] as FootprintView[],

    // 金句墙
    quotes: [] as QuoteView[],

    // 高分榜
    topItems: [] as TopItemView[],

    // 热力图：全年每日记录数（成就 + 打卡合并；最近 53 周窗口由组件自己裁剪）
    heatmapDays: [] as HeatmapDay[],

    // P2-5 自动元数据洞察（深夜阅读 / 最活跃星期 / 夜猫子认证 等）
    insights: [] as InsightRowView[],

    loading: true,
    loadError: false,      // refresh 抛错时显示「加载失败 + 重试」
  },

  _loadStart: 0 as number,
  _minShowMs: 300 as number,

  onLoad() {
    applyThemeToPage(this)
    this._loadStart = Date.now()
    setTimeout(() => this.refresh(), 0)
  },

  onShow() {
    applyThemeToPage(this)
    if (this.data.loading) return
    // 统计页重度聚合（成就 + 打卡），只在两者有变动时才重算
    const watched: DirtyField[] = ['achievements', 'checkins', 'preferences']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  /** 切年份：更新当前年份后重算所有统计 */
  onSwitchYear(e: WechatMiniprogram.TouchEvent) {
    const year = e.currentTarget.dataset.year as number
    if (year === this.data.currentYear) return
    this.setData({ currentYear: year }, () => this.refresh())
  },

  /** 点击热力图单元格：弹个简单 toast 显示当日记录数 */
  onHeatmapCellTap(e: WechatMiniprogram.CustomEvent) {
    const detail = e.detail as { date: string; count: number }
    if (!detail || !detail.date) return
    const text = detail.count > 0
      ? detail.date + ' · ' + detail.count + ' 条记录'
      : detail.date + ' · 无记录'
    wx.showToast({ title: text, icon: 'none' })
  },

  /** 长按热力图单元格：同样弹信息（预留：未来可跳转到该日的成就列表） */
  onHeatmapCellLongPress(e: WechatMiniprogram.CustomEvent) {
    const detail = e.detail as { date: string; count: number }
    if (!detail || !detail.date) return
    const text = detail.count > 0
      ? detail.date + ' 共 ' + detail.count + ' 条'
      : detail.date + ' 无记录'
    wx.showToast({ title: text, icon: 'none' })
  },

  /** P2-8 跳转到关系图谱页（书↔作者↔分类可视化） */
  onTapGraph() {
    wx.navigateTo({ url: '/pages/graph/graph' })
  },

  /** P3 跳转到勋章墙独立页（集中查看所有勋章的解锁状态） */
  onTapMedals() {
    wx.navigateTo({ url: '/pages/medals/medals' })
  },

  /** P3 跳转到养成树页（成就节点树可视化） */
  onTapTree() {
    wx.navigateTo({ url: '/pages/tree/tree' })
  },

  /** P3-1 跳转到全局金句墙页（跨年份聚合 + 排序切换 + 上下文展示） */
  onGoQuotes() {
    wx.navigateTo({ url: '/pages/quotes/quotes' })
  },

  /** 空态：跳录入页 */
  onTapAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },

  /** 错误态：重试 */
  onRetry() {
    this.setData({ loadError: false, loading: true })
    this._loadStart = Date.now()
    setTimeout(() => this.refresh(), 0)
  },

  onShareAppMessage() {
    return {
      title: this.data.currentYear + ' 数据回顾 · 我的阅读画像',
      path: '/pages/stats/stats',
    }
  },

  onShareTimeline() {
    const total = this.data.overviewCells.length > 0 ? this.data.overviewCells[0].value : ''
    return {
      title: this.data.currentYear + ' 数据回顾' + (total ? ' · ' + total + ' 条成就' : ''),
    }
  },

  refresh() {
    safeRefresh(this, () => {
    const years = loadYears()
    let currentYear = this.data.currentYear
    if (years.length > 0 && !years.includes(currentYear)) {
      currentYear = years[0]
    }
    // 统计页只算「已完成」成就（与 index/wrapped/list 等聚合器同口径）。
    // 在读/搁置项的 finishedDate 是「开读日/搁置日」语义，不该进总成就数/平均分/连续天数等聚合。
    const items = loadAchievementsByYear(currentYear)
    const hasData = items.length > 0

    // === 1. 总览仪表盘 ===
    const ov: OverviewStats = calcOverview(items)
    const overviewCells: OverviewCell[] = [
      { label: '总成就', value: String(ov.total), icon: '🏅' },
      { label: '阅读', value: String(ov.bookCount), icon: '📖' },
      { label: '观影', value: String(ov.filmCount), icon: '🎬' },
      { label: '记录天数', value: String(ov.uniqueDays), icon: '📅' },
      { label: '最长连续', value: String(ov.longestStreak) + ' 天', icon: '🔥' },
    ]

    // === 2. 月度柱状图 ===
    const monthly: MonthStat[] = calcMonthlyStats(items)
    const maxMonthCount = monthly.length > 0 ? monthly.reduce((mx, m) => Math.max(mx, m.count), 0) : 0
    let peakMonthNum = 0
    let peakMonthCount = 0
    const monthBars: MonthBarView[] = monthly.map(m => {
      const isPeak = m.count === maxMonthCount && maxMonthCount > 0
      if (isPeak && m.count > peakMonthCount) {
        peakMonthNum = m.month
        peakMonthCount = m.count
      }
      return {
        month: m.month,
        count: m.count,
        height: maxMonthCount > 0 ? Math.round((m.count / maxMonthCount) * 100) : 0,
        isPeak,
      }
    })
    const peakMonth = peakMonthNum > 0 ? (peakMonthNum + ' 月') : ''

    // === 3. 评分分布 ===
    const ratingDist: RatingDist[] = calcRatingDist(items)
    const maxRatingCount = ratingDist.length > 0 ? ratingDist.reduce((mx, r) => Math.max(mx, r.count), 0) : 0
    const ratingRows: RatingRowView[] = ratingDist.map(r => ({
      ratingText: r.rating.toFixed(1) + '★',
      count: r.count,
      width: maxRatingCount > 0 ? Math.round((r.count / maxRatingCount) * 100) : 0,
    }))

    // === 4. 体裁 Top 6 ===
    const genres: GenreStat[] = calcGenreStats(items, 6)
    const genreBars: GenreBarView[] = genres.map(g => ({
      name: g.name,
      count: g.count,
      width: g.percent,   // calcGenreStats 已算好相对最大值的百分比
      percent: items.length > 0 ? Math.round((g.count / items.length) * 100) : 0,
    }))

    // === 5. 书影占比 + 分类占比 ===
    const ratio: TypeRatio = calcTypeRatio(items)
    const typePills: TypePillView[] = []
    if (ratio.bookCount > 0 || ratio.filmCount > 0) {
      typePills.push({
        label: '📖 阅读', count: ratio.bookCount,
        percent: ratio.bookPercent, color: '#6B8E5A',
      })
      typePills.push({
        label: '🎬 观影', count: ratio.filmCount,
        percent: ratio.filmPercent, color: '#8B6F9C',
      })
    }
    const catCounts = countByCategory(items)
    const totalCat = items.length
    const categoryShares: CategoryShareView[] = Object.keys(catCounts)
      .map(id => {
        const meta = getCategoryMeta(id)
        const count = catCounts[id]
        return {
          id,
          label: meta.label,
          icon: meta.icon,
          color: meta.color,
          count,
          percent: totalCat > 0 ? Math.round((count / totalCat) * 100) : 0,
        }
      })
      .sort((a, b) => b.count - a.count)

    // === 6. 阅读足迹（按地点聚合）===
    const footprintsRaw: FootprintEntry[] = calcFootprint(items)
    const footprints: FootprintView[] = footprintsRaw.slice(0, 8).map(f => ({
      place: f.place,
      count: f.count,
      sampleTitles: f.books.slice(0, 2).map(b => b.title).join('、'),
    }))

    // === 7. 金句墙 ===
    const quotesRaw: QuoteEntry[] = calcQuotes(items)
    const quotes: QuoteView[] = quotesRaw.slice(0, 30).map(q => ({
      text: q.text,
      bookTitle: q.bookTitle,
    }))

    // === 8. 高分榜（评分 ≥4 的成就，按评分降序）===
    const topRaw: Item[] = calcTopItems(
      items.filter(it => it.rating >= 4),
      10,
    )
    const topItems: TopItemView[] = topRaw.map(it => {
      const meta = getCategoryMeta(resolveCategory(it.category, it.type))
      return {
        id: it.id,
        title: it.title,
        rating: it.rating,
        categoryIcon: meta.icon,
        categoryColor: meta.color,
        finishedDate: it.finishedDate,
      }
    })

    // === 9. P2-5 自动元数据洞察（基于 createdAt 推导时段/星期节律）===
    const insights: InsightRowView[] = calcInsights(items)

    // === 10. 热力图：跨年份全量成就 + 全量打卡，按日期聚合成每日记录数 ===
    //     热力图展示"最近 53 周"窗口（由组件裁剪），所以这里取全量数据而非当前年份。
    //     一条成就按 finishedDate 计 1；一条打卡按 date 计 1；同一天累加。
    const heatmapMap: { [date: string]: number } = {}
    // 全量成就（loadByYear 只取当年；这里另取全量，给热力图跨年视图）
    const allAchievements = loadAllAchievements()
    for (const it of allAchievements) {
      if (it.finishedDate) {
        heatmapMap[it.finishedDate] = (heatmapMap[it.finishedDate] || 0) + 1
      }
    }
    // 全量打卡
    const checkins = loadCheckins()
    for (const c of checkins) {
      if (c.date) {
        heatmapMap[c.date] = (heatmapMap[c.date] || 0) + 1
      }
    }
    const heatmapDays: HeatmapDay[] = Object.keys(heatmapMap).map(date => ({
      date,
      count: heatmapMap[date],
    }))

    const wasLoading = this.data.loading
    const hideSkeleton = () => {
      if (!wasLoading) return
      const remaining = this._minShowMs - (Date.now() - this._loadStart)
      if (remaining > 0) {
        setTimeout(() => this.setData({ loading: false }), remaining)
      } else {
        this.setData({ loading: false })
      }
    }
    this.setData({
      years,
      currentYear,
      hasData,
      overviewCells,
      avgRatingText: ov.avgRatingText,
      monthBars,
      peakMonth,
      ratingRows,
      genreBars,
      typePills,
      categoryShares,
      footprints,
      quotes,
      topItems,
      heatmapDays,
      insights,
    }, hideSkeleton)
    })  // safeRefresh
  },
})
