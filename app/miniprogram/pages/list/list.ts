// pages/list/list.ts
// 成就墙：按年份 + 分类双重筛选；每条成就带分类图标/配色
// 成就系统主轴下取代「我的书架」—— 数据底层仍是 Item，语义变为「一条成就」。

import { Item, loadByYear, loadItemYears, loadWishes, loadAchievementsByYear, updateItemStatus, ItemStatus } from '../../utils/storage'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { calcLongestStreak, calcMonthlyStats } from '../../utils/stats'
import { loadPreferences, updatePreferences, ListViewMode } from '../../utils/preferences'
import { presetToCss } from '../../utils/achievement-presets'
import { normalizeKeyword } from '../../utils/search'
import { safeRefresh } from '../../utils/error-boundary'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** P2-7 视图切换选项（驱动顶部 segmented control） */
const VIEW_OPTIONS: { id: ListViewMode; icon: string; label: string }[] = [
  { id: 'list', icon: '☰', label: '列表' },
  { id: 'grid', icon: '▦', label: '网格' },
  { id: 'gallery', icon: '❒', label: '画廊' },
]

interface CategoryFilter {
  id: string
  label: string
  icon: string
  color: string
  count: number
}

/** 状态筛选 chip（三态状态机 P1-5）：与 CategoryFilter 同构，复用 .filter-chip 样式 */
interface StatusFilter {
  id: string        // 'all' | 'reading' | 'done' | 'abandoned'
  label: string
  icon: string
  count: number
}

interface ItemView extends Item {
  categoryIcon: string
  categoryColor: string
  categoryLabel: string
  ratingText: string
  metaText: string
  // P2-4 作者聚合页入口：单独存 author，wxml 把它做成可点击 chip（点击跳作者页）
  authorDisplay: string   // 显示用的作者名（空=无作者）
  // 三态状态机的展示字段（在读/搁置角标 + dateLabel 用）
  statusLabel: string   // 「在读 / 已搁置 / （空字符串=完成态不显示角标）」
  statusIcon: string    // 📖 / 🗂️ / 空
  // P2-7 gallery 视图：封面渲染所需（与 index 的 WallItemView 同构）
  imageKind: 'none' | 'preset' | 'image'
  presetCss: string
}

/** 列表页底部「灵感抽屉」区的愿望视图（轻量，只取展示所需字段） */
interface WishView {
  id: string
  title: string
  note: string
  categoryLabel: string
  categoryIcon: string
  categoryColor: string
}

/** 数据彩蛋条目（列表底部趣味统计） */
interface VizEggView {
  key: string
  icon: string
  label: string
  value: string
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    years: [] as number[],
    currentYear: new Date().getFullYear(),
    items: [] as ItemView[],
    categories: [] as CategoryFilter[],
    activeCategory: 'all' as string,
    // B2 关键词筛选（与分类/状态筛选 AND 组合）
    activeKeyword: '' as string,
    // === 三态状态机筛选（P1-5）：与分类筛选正交，AND 组合 ===
    statuses: [] as StatusFilter[],
    activeStatus: 'all' as string,
    // === P2-7 视图切换：list 横向卡（默认）/ grid 紧凑网格 / gallery 大封面画廊 ===
    viewMode: 'list' as ListViewMode,
    viewOptions: VIEW_OPTIONS,
    // 灵感抽屉：未完成的愿望（achievementId 为空）；与年份/分类筛选无关，独立成区
    pendingWishes: [] as WishView[],
    // 数据彩蛋（列表底部）；数据不足时为空，wxml 据此隐藏
    vizEggs: [] as VizEggView[],
    loading: true,
    loadError: false,
    hasMore: false,           // 列表还有更多可加载（分页）
    loadingMore: false,
  },

  /** 每页加载条数（上拉分页，三种视图共用）*/
  _pageSize: 20 as number,
  /** 全量视图（筛选后；分页切片源）*/
  _allItems: [] as ItemView[],
  /** 当前已加载条数（分页游标）*/
  _shown: 0 as number,

  _loadStart: 0 as number,
  _minShowMs: 300 as number,

  onLoad() {
    applyThemeToPage(this)
    this._loadStart = Date.now()
    setTimeout(() => this.refresh(), 0)
  },

  onShow() {
    applyThemeToPage(this)
    // 首次进入由 onLoad 处理（含骨架）；后续 onShow 仅在成就/愿望/偏好有变动时才重算
    if (this.data.loading) return
    const watched: DirtyField[] = ['achievements', 'wishes', 'preferences']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    safeRefresh(this, () => {
    // 列表页用 loadItemYears（含在读/搁置的年份），不用 loadYears（只完成年份）。
    // 否则用户在某年只标了「在读」的书，那年根本不会出现在年份 tab，那些书就找不到了。
    const years = loadItemYears()
    let currentYear = this.data.currentYear
    if (years.length > 0 && !years.includes(currentYear)) {
      currentYear = years[0]
    }
    // P2-7：从偏好读视图模式（与首页 wallLayout 同模式：读偏好 + setData + 改时写回）
    const viewMode = loadPreferences().listViewMode
    this.setData({ years, currentYear, viewMode }, () => {
      this.buildCategoryFilters()
      this.buildStatusFilters()
      this.loadItems()
      this.loadPendingWishes()
      this.loadVizEggs()
      // 防闪烁：保证骨架至少展示 _minShowMs
      if (this.data.loading) {
        const remaining = this._minShowMs - (Date.now() - this._loadStart)
        if (remaining > 0) {
          setTimeout(() => this.setData({ loading: false }), remaining)
        } else {
          this.setData({ loading: false })
        }
      }
    })
    })  // safeRefresh
  },

  /** 错误态：重试 */
  onRetry() {
    this.setData({ loadError: false, loading: true })
    this._loadStart = Date.now()
    setTimeout(() => this.refresh(), 0)
  },

  /** P2-7 切换视图模式：写回偏好持久化，下次进列表保持。 */
  onSwitchView(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as ListViewMode
    if (!mode || mode === this.data.viewMode) return
    updatePreferences({ listViewMode: mode })
    this.setData({ viewMode: mode })
  },

  /**
   * 数据彩蛋：基于当前年份的全部成就（不受分类筛选影响），推导 2-3 条趣味统计。
   *  数据不足（<3 条）返回空数组，wxml 据此隐藏整区。
   *  - 最长连续记录天数（连续打卡感的体现）
   *  - 最活跃的月份（哪个月最投入）
   *  - 5 星最多的分类（哪个领域最让人惊艳）
   */
  loadVizEggs() {
    // 彩蛋只统计「已完成」成就（在读/搁置不计入连续天数/活跃月份/五星领域）
    const items = loadAchievementsByYear(this.data.currentYear)
    if (items.length < 3) {
      this.setData({ vizEggs: [] })
      return
    }
    const eggs: VizEggView[] = []

    // 1. 最长连续记录天数
    const streak = calcLongestStreak(items.map(it => it.finishedDate))
    if (streak >= 2) {
      eggs.push({
        key: 'streak',
        icon: '🔥',
        label: '最长连续记录',
        value: streak + ' 天',
      })
    }

    // 2. 最活跃的月份
    const monthly = calcMonthlyStats(items)
    if (monthly.length > 0) {
      const top = monthly.reduce((a, b) => a.count > b.count ? a : b)
      eggs.push({
        key: 'topMonth',
        icon: '📅',
        label: '最活跃的月份',
        value: top.month + ' 月 · ' + top.count + ' 条',
      })
    }

    // 3. 5 星最多的分类
    const fiveStarByCat: { [cat: string]: number } = {}
    items.forEach(it => {
      if (it.rating === 5) {
        const c = resolveCategory(it.category, it.type)
        fiveStarByCat[c] = (fiveStarByCat[c] || 0) + 1
      }
    })
    const fiveStarCats = Object.keys(fiveStarByCat)
    if (fiveStarCats.length > 0) {
      const topCat = fiveStarCats.sort((a, b) => fiveStarByCat[b] - fiveStarByCat[a])[0]
      const meta = getCategoryMeta(topCat)
      eggs.push({
        key: 'fiveStarCat',
        icon: '⭐',
        label: '5 星最多的领域',
        value: meta.label + ' · ' + fiveStarByCat[topCat] + ' 个',
      })
    }

    this.setData({ vizEggs: eggs })
  },

  /** 加载未完成的愿望（achievementId 为空），转成列表页底部灰显视图。
   *  不参与年份/分类筛选——愿望无完成日期，独立成区。 */
  loadPendingWishes() {
    const all = loadWishes()
    const pending = all.filter(w => !w.achievementId)
    const views: WishView[] = pending.map(w => {
      const cat = resolveCategory(w.category)
      const meta = getCategoryMeta(cat)
      return {
        id: w.id,
        title: w.title,
        note: w.note || '',
        categoryLabel: meta.label,
        categoryIcon: meta.icon,
        categoryColor: meta.color,
      }
    })
    this.setData({ pendingWishes: views })
  },

  /** 构造分类筛选条：基于当前年份出现的成就统计每个分类计数 */
  buildCategoryFilters() {
    const items = loadByYear(this.data.currentYear)
    const counts: { [cat: string]: number } = {}
    for (const it of items) {
      const cat = resolveCategory(it.category, it.type)
      counts[cat] = (counts[cat] || 0) + 1
    }
    // 「全部」+ 出现过的分类（按计数降序）
    const filters: CategoryFilter[] = [{
      id: 'all', label: '全部', icon: '✦', color: '#D97A4A', count: items.length,
    }]
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(cat => {
      const meta = getCategoryMeta(cat)
      filters.push({ id: cat, label: meta.label, icon: meta.icon, color: meta.color, count: counts[cat] })
    })
    // 若当前激活的分类已不在该年份列表里，回退到「全部」
    let activeCategory = this.data.activeCategory
    if (activeCategory !== 'all' && !counts[activeCategory]) {
      activeCategory = 'all'
    }
    this.setData({ categories: filters, activeCategory })
  },

  /** 构造状态筛选条：基于当前年份的「全部 Item（含在读/搁置）」统计三态计数。
   *  克隆 buildCategoryFilters 模式；数据源是 loadByYear（全量），不是 loadAchievementsByYear（只 done）。 */
  buildStatusFilters() {
    const items = loadByYear(this.data.currentYear)
    // 计数三态（status 缺省视为 done）
    let reading = 0, done = 0, abandoned = 0
    for (const it of items) {
      const s = it.status || 'done'
      if (s === 'reading') reading++
      else if (s === 'abandoned') abandoned++
      else done++
    }
    // 固定四项：「全部 / 在读 / 完成 / 搁置」；只在有数据时显示对应项
    const filters: StatusFilter[] = [{
      id: 'all', label: '全部', icon: '✦', count: items.length,
    }]
    if (reading > 0) filters.push({ id: 'reading', label: '在读', icon: '📖', count: reading })
    filters.push({ id: 'done', label: '完成', icon: '✓', count: done })
    if (abandoned > 0) filters.push({ id: 'abandoned', label: '搁置', icon: '🗂️', count: abandoned })
    // 若当前激活的状态在新列表里不存在（比如切到没有在读的年份），回退到「全部」
    let activeStatus = this.data.activeStatus
    const validIds = filters.map(f => f.id)
    if (!validIds.includes(activeStatus)) {
      activeStatus = 'all'
    }
    this.setData({ statuses: filters, activeStatus })
  },

  loadItems() {
    let items = loadByYear(this.data.currentYear)
    const activeCategory = this.data.activeCategory
    const activeStatus = this.data.activeStatus
    // 分类筛选（沿用旧逻辑）
    if (activeCategory !== 'all') {
      items = items.filter(it => resolveCategory(it.category, it.type) === activeCategory)
    }
    // 状态筛选（P1-5）：AND 组合；'all' 不筛
    if (activeStatus !== 'all') {
      items = items.filter(it => (it.status || 'done') === activeStatus)
    }
    // B2 关键词筛选：AND 组合；空关键词不筛。命中字段参考 search.ts（title/author/genre/
    // note/readingContext/readingPlace/understanding/quotes + category 标签）
    const kw = normalizeKeyword(this.data.activeKeyword)
    if (kw) {
      items = items.filter(it => {
        const hay = [
          it.title, it.author, it.genre, it.note,
          it.readingContext, it.readingPlace, it.understanding,
          (it.quotes || []).join(' '),
          getCategoryMeta(resolveCategory(it.category, it.type)).label,
        ].join(' ').toLowerCase()
        return hay.indexOf(kw) >= 0
      })
    }
    const views: ItemView[] = items.map(it => {
      const cat = resolveCategory(it.category, it.type)
      const meta = getCategoryMeta(cat)
      const metaParts: string[] = []
      // P2-4：author 单独抽出做可点击 chip，不再拼进 metaText
      if (it.genre) metaParts.push(it.genre)
      if (it.readingPlace) metaParts.push('📍 ' + it.readingPlace)
      // 三态状态机展示字段：在读/搁置带角标，完成态不显示（保持视觉干净）
      const status = it.status || 'done'
      const statusLabel = status === 'reading' ? '在读' : status === 'abandoned' ? '已搁置' : ''
      const statusIcon = status === 'reading' ? '📖' : status === 'abandoned' ? '🗂️' : ''
      // P2-7 gallery 视图封面：与 index toWallView 同逻辑（预设渐变 / 真图 / 纯色占位）
      const img = it.image || ''
      const imgType = it.imageType
      let imageKind: 'none' | 'preset' | 'image' = 'none'
      let presetCss = ''
      if (imgType === 'preset' || (imgType === undefined && img && img.indexOf('achv-') === 0)) {
        imageKind = 'preset'
        presetCss = presetToCss(img)
      } else if (img && (imgType === 'custom' || imgType === 'builtin')) {
        imageKind = 'image'
      }
      return {
        ...it,
        categoryIcon: meta.icon,
        categoryColor: meta.color,
        categoryLabel: meta.label,
        ratingText: it.rating > 0 ? it.rating.toFixed(1) : '',
        metaText: metaParts.join(' · '),
        authorDisplay: (it.author || '').trim(),
        statusLabel,
        statusIcon,
        imageKind,
        presetCss,
      }
    })
    this._allItems = views
    this._shown = Math.min(this._pageSize, views.length)
    this.setData({
      items: views.slice(0, this._shown),
      hasMore: this._shown < views.length,
      loadingMore: false,
    })
  },

  /** 上拉加载更多（scroll-view bindscrolltolower）*/
  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    setTimeout(() => {
      this._shown = Math.min(this._shown + this._pageSize, this._allItems.length)
      this.setData({
        items: this._allItems.slice(0, this._shown),
        hasMore: this._shown < this._allItems.length,
        loadingMore: false,
      })
    }, 0)
  },

  onSwitchYear(e: WechatMiniprogram.TouchEvent) {
    const year = Number(e.currentTarget.dataset.year)
    if (year === this.data.currentYear) return
    this.setData({ currentYear: year, activeCategory: 'all', activeStatus: 'all' }, () => {
      this.buildCategoryFilters()
      this.buildStatusFilters()
      this.loadItems()
      this.loadVizEggs()
    })
  },

  onSwitchCategory(e: WechatMiniprogram.TouchEvent) {
    const cat = e.currentTarget.dataset.id as string
    if (cat === this.data.activeCategory) return
    this.setData({ activeCategory: cat }, () => this.loadItems())
  },

  /** B2 关键词输入：实时过滤（与分类/状态 AND 组合） */
  onKeywordInput(e: WechatMiniprogram.Input) {
    this.setData({ activeKeyword: e.detail.value }, () => this.loadItems())
  },

  onClearKeyword() {
    if (!this.data.activeKeyword) return
    this.setData({ activeKeyword: '' }, () => this.loadItems())
  },

  /** 状态筛选 chip 切换（与分类筛选正交，AND 组合） */
  onSwitchStatus(e: WechatMiniprogram.TouchEvent) {
    const status = e.currentTarget.dataset.id as string
    if (status === this.data.activeStatus) return
    this.setData({ activeStatus: status }, () => this.loadItems())
  },

  onTapItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/edit/edit?id=' + id })
  },

  /** 图片加载失败兜底：把对应成就的 imageKind 降级为 'none'，让分类 emoji 占位接管。
   *  只改内存视图层，不动 storage（真实数据下次进入仍尝试加载，给 savedFilePath 恢复留余地）。
   *  binderror 必须用 catchtap 阻止冒泡到卡片点击（否则失败图会触发跳转编辑）。 */
  onImageError(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const items = this.data.items.map(it => it.id === id ? { ...it, imageKind: 'none' as const } : it)
    this.setData({ items })
  },

  /** P2-4 点击作者名：跳到作者聚合页（catchtap 阻止冒泡到卡片整体点击）。
   *  作者名空时不该被调用（wxml 用 wx:if 守住）；此处再做一道兜底防御。 */
  onTapAuthor(e: WechatMiniprogram.TouchEvent) {
    const author = (e.currentTarget.dataset.author as string || '').trim()
    if (!author) return
    wx.navigateTo({ url: '/pages/author/author?author=' + encodeURIComponent(author) })
  },

  /** 长按列表项：一键循环切换三态状态（done → reading → abandoned → done）。
   *  给用户一条「不改其它字段、只切状态」的捷径（进 edit 页改状态太重）。
   *  用今天作为新状态的日期（done→reading 切到今天「开读」；切回 done 也用今天作完成日）。 */
  onCycleStatus(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const item = this.data.items.find(it => it.id === id)
    if (!item) return
    const current = item.status || 'done'
    // 循环顺序：done → reading → abandoned → done
    const next: ItemStatus = current === 'done' ? 'reading'
      : current === 'reading' ? 'abandoned'
      : 'done'
    const today = this.formatToday()
    const verb = next === 'reading' ? '标记为在读' : next === 'abandoned' ? '标记为搁置' : '标记为完成'
    wx.showModal({
      title: '切换状态',
      content: '「' + item.title + '」' + verb + '？\n（日期将更新为今天）',
      confirmText: '确定',
      success: (res) => {
        if (!res.confirm) return
        const ok = updateItemStatus(id, next, today)
        if (ok) {
          wx.showToast({ title: '已更新', icon: 'success' })
          this.refresh()
        } else {
          wx.showToast({ title: '更新失败', icon: 'none' })
        }
      },
    })
  },

  /** 今天的 YYYY-MM-DD（给状态流转用；不引入 util 里已有的 formatDate 避免改动 import） */
  formatToday(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + day
  },

  onTapAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },

  /** 灵感抽屉中的愿望：点跳 edit 页带 wishId，标记完成（预填成就字段） */
  onTapWishItem(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/edit/edit?wishId=' + id })
  },

  /** 「查看全部」入口：跳愿望清单页 */
  onTapWishlist() {
    wx.navigateTo({ url: '/pages/wishlist/wishlist' })
  },
})
