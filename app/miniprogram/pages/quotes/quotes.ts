// pages/quotes/quotes.ts
// 金句墙独立页：跨年份全局聚合所有成就的金句，文学化排版展示。
// 与 stats 页的金句墙区别：stats 是「单年份精选 30 条」纯文本快览；本页是「全局金句库」
//   支持排序切换（最新/按书/随机）+ 展示金句上下文（quoteNotes）+ 点击跳转书详情。
// 纯只读展示页，不写数据；与 stats 页同口径用 loadAllAchievements 过滤 done。

import { loadAllAchievements } from '../../utils/storage'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 排序模式 */
type SortMode = 'recent' | 'byBook' | 'shuffle'

/** 单条金句视图（携带足够信息独立渲染）*/
interface QuoteCardView {
  key: string           // 唯一 key（bookId + '|' + quoteIndex）
  text: string          // 金句正文
  context: string       // 上下文（来自 Item.quoteNotes[trimmedText]；空串表示无）
  bookId: string
  bookTitle: string
  bookAuthor: string
  finishedDate: string
  categoryIcon: string
  categoryColor: string
  categoryLabel: string
}

/** 按书分组视图（byBook 模式用）*/
interface BookGroupView {
  bookId: string
  bookTitle: string
  bookAuthor: string
  categoryIcon: string
  categoryColor: string
  categoryLabel: string
  quotes: QuoteCardView[]
}

/** 排序 chip 视图 */
interface SortChipView {
  mode: SortMode
  label: string
  active: boolean
}

/** 每页加载条数（仅 flatQuotes 模式分页；byBook 分组结构不分页）*/
const PAGE_SIZE = 20

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    sortMode: 'recent' as SortMode,
    sortChips: [] as SortChipView[],
    flatQuotes: [] as QuoteCardView[],      // recent/shuffle 模式用
    bookGroups: [] as BookGroupView[],      // byBook 模式用
    total: 0,
    bookCount: 0,
    loaded: false,
    loading: true,        // 首屏骨架屏；refresh 完成后置 false
    hasMore: false,       // flatQuotes 还有更多可加载
    loadingMore: false,
  },

  // 缓存原始全量金句（排序切换时复用，避免重算）
  _all: [] as QuoteCardView[],
  // flatQuotes 全量切片源（分页用；byBook 模式时为空）
  _flatAll: [] as QuoteCardView[],
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
    // 跳转回来时数据可能变了（用户在 edit 页增删金句），重算
    // 首次进入由 onLoad 处理（含骨架）；后续 onShow 仅在成就有变动时刷新
    if (this.data.loading) return
    const watched: DirtyField[] = ['achievements']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  /** 聚合全部金句（跨年份）*/
  refresh() {
    const items = loadAllAchievements()
    const views: QuoteCardView[] = []
    items.forEach(it => {
      if (!it.quotes || it.quotes.length === 0) return
      const meta = getCategoryMeta(resolveCategory(it.category, it.type))
      const notes = it.quoteNotes || {}
      it.quotes.forEach((raw, i) => {
        const text = (raw || '').trim()
        if (!text) return
        // 上下文：按 trim 后的金句正文查 quoteNotes；找不到则空串
        const context = (notes[text] || '').trim()
        views.push({
          key: it.id + '|' + i,
          text,
          context,
          bookId: it.id,
          bookTitle: it.title,
          bookAuthor: it.author,
          finishedDate: it.finishedDate,
          categoryIcon: meta.icon,
          categoryColor: meta.color,
          categoryLabel: meta.label,
        })
      })
    })

    this._all = views
    const bookCount = new Set(views.map(v => v.bookId)).size
    const patch = {
      total: views.length,
      bookCount,
      loaded: true,
    }
    const remaining = this._minShowMs - (Date.now() - this._loadStart)
    if (remaining > 0) {
      setTimeout(() => { this.setData({ ...patch, loading: false }); this.applySort(this.data.sortMode) }, remaining)
    } else {
      this.setData({ ...patch, loading: false })
      this.applySort(this.data.sortMode)
    }
  },

  /** 切换排序模式 */
  onSortTap(e: WechatMiniprogram.TouchEvent) {
    const mode = (e.currentTarget.dataset.mode as SortMode) || 'recent'
    if (mode === this.data.sortMode) return
    this.applySort(mode)
  },

  /** 按模式重排并写回 data */
  applySort(mode: SortMode) {
    const all = this._all.slice()
    let flatAll: QuoteCardView[] = []
    let bookGroups: BookGroupView[] = []

    if (mode === 'recent') {
      // 按书的完成日降序（最新的书的金句排前）；同书内保持录入顺序
      flatAll = all.sort((a, b) => b.finishedDate.localeCompare(a.finishedDate))
    } else if (mode === 'shuffle') {
      // 随机洗牌：每次进来都不同，给「随手翻翻」的灵感感
      flatAll = this.shuffle(all)
    } else if (mode === 'byBook') {
      // 按书分组：书按完成日降序，组内金句保持录入顺序
      const groupMap = new Map<string, BookGroupView>()
      all.sort((a, b) => b.finishedDate.localeCompare(a.finishedDate)).forEach(q => {
        let g = groupMap.get(q.bookId)
        if (!g) {
          g = {
            bookId: q.bookId,
            bookTitle: q.bookTitle,
            bookAuthor: q.bookAuthor,
            categoryIcon: q.categoryIcon,
            categoryColor: q.categoryColor,
            categoryLabel: q.categoryLabel,
            quotes: [],
          }
          groupMap.set(q.bookId, g)
        }
        g.quotes.push(q)
      })
      bookGroups = Array.from(groupMap.values())
    }

    // flatQuotes 分页：byBook 模式不分页（分组结构）
    this._flatAll = flatAll
    this._shown = mode === 'byBook' ? flatAll.length : Math.min(PAGE_SIZE, flatAll.length)
    const flatQuotes = mode === 'byBook' ? [] : flatAll.slice(0, this._shown)

    const sortChips: SortChipView[] = [
      { mode: 'recent', label: '最新', active: mode === 'recent' },
      { mode: 'byBook', label: '按书', active: mode === 'byBook' },
      { mode: 'shuffle', label: '随机', active: mode === 'shuffle' },
    ]

    this.setData({
      sortMode: mode,
      sortChips,
      flatQuotes,
      bookGroups,
      hasMore: mode !== 'byBook' && this._shown < flatAll.length,
      loadingMore: false,
    })
  },

  /** 上拉加载更多（仅 flatQuotes 模式）*/
  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    if (this.data.sortMode === 'byBook') return
    this.setData({ loadingMore: true })
    setTimeout(() => {
      this._shown = Math.min(this._shown + PAGE_SIZE, this._flatAll.length)
      this.setData({
        flatQuotes: this._flatAll.slice(0, this._shown),
        hasMore: this._shown < this._flatAll.length,
        loadingMore: false,
      })
    }, 0)
  },

  /** Fisher-Yates 洗牌（原地）*/
  shuffle(arr: QuoteCardView[]): QuoteCardView[] {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  },

  /** 点击金句卡：跳转到书的编辑页（让用户能补上下文/修改金句）*/
  onQuoteTap(e: WechatMiniprogram.TouchEvent) {
    const bookId = (e.currentTarget.dataset.bookId as string) || ''
    if (!bookId) return
    wx.navigateTo({ url: '/pages/edit/edit?id=' + bookId })
  },

  /** 空态：跳录入页去添加第一条金句 */
  onTapAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },

  /** 再来一次随机（shuffle 模式下的「换一批」按钮）*/
  onReshuffle() {
    if (this.data.sortMode === 'shuffle') {
      this.applySort('shuffle')
    }
  },
})
