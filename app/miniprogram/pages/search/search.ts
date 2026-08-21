// pages/search/search.ts
// 全局搜索页：跨成就/愿望/灵感/打卡的全文搜索。
// 设计要点：
//  - 实时搜索（onKeywordInput 即触发）：关键词变 → 结果变，无需"点搜索"
//  - 输入去抖 200ms：避免每键一次都跑全量扫描（成就数较多时）
//  - 分组 tab：全部 + 四类，支持按类型筛选展示
//  - 点击结果按类型路由跳详情（成就→edit、愿望→wishlist、灵感→inspiration、打卡→checkin）
//  - 历史关键词：纯本地，最多 8 条，最近搜过的词快速复搜

import { searchAll, countByType, SearchResult, SearchResultType } from '../../utils/search'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'

const HISTORY_KEY = 'search_history'   // 与 storage.ts 隔离：搜索历史是 UI 状态，不入主数据
const MAX_HISTORY = 8

/** 分组 tab 的视图结构 */
interface TypeFilter {
  id: SearchResultType | 'all'
  label: string
  count: number
}

/** 用于 setData 的精简结果视图（避免把 rank/ts 暴露给 wxml） */
interface ResultView {
  id: string
  type: SearchResultType
  title: string
  subtitle: string
  icon: string
}

/** 分组渲染视图：每组带 type/icon/title/items（items 用精简视图） */
interface ResultGroup {
  type: SearchResultType
  icon: string
  title: string
  items: ResultView[]
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    keyword: '',                   // 当前输入的关键词（双向绑定）
    autoFocus: false,              // 进入页面自动聚焦输入框
    activeType: 'all' as TypeFilter['id'],  // 当前选中的分组 tab

    typeFilters: [] as TypeFilter[],
    groupedResults: [] as ResultGroup[],
    totalCount: 0,                 // 命中总数（用于三态判定）

    history: [] as string[],       // 最近搜索关键词（最多 8 条）
  },

  // 用于去抖的 timer 句柄；不在 data 里（不需要触发渲染）
  // 注意：Page({}) 是对象字面量，自定义字段不能用 private/class 语法，挂在对象上即可。
  debounceTimer: null as number | null,
  // 标记本次搜索是否由"输入触发"（用于决定是否写历史）
  fromInput: false as boolean,

  onLoad() {
    applyThemeToPage(this)
    this.setData({
      autoFocus: true,
      history: this.loadHistory(),
    })
  },

  onShow() {
    applyThemeToPage(this)
  },

  /* ============ 输入处理 ============ */

  onKeywordInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value
    this.setData({ keyword })
    this.fromInput = true
    this.scheduleSearch(keyword)
  },

  /** 键盘"搜索"键确认（confirm-type="search"）—— 立即执行搜索并写历史 */
  onConfirmSearch(e: WechatMiniprogram.InputConfirm) {
    const keyword = e.detail.value || this.data.keyword
    const trimmed = keyword.trim()
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.fromInput = true
    this.runSearch(trimmed, /* writeHistory */ true)
  },

  /** 去抖搜索：输入停止 200ms 后触发；空关键词直接清结果 */
  scheduleSearch(keyword: string) {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    const trimmed = keyword.trim()
    if (!trimmed) {
      // 输入清空：立刻清除结果（不写历史）
      this.setData({
        groupedResults: [],
        totalCount: 0,
        typeFilters: [],
        activeType: 'all',
      })
      return
    }
    this.debounceTimer = setTimeout(() => {
      this.runSearch(trimmed, /* writeHistory */ false)
    }, 200)
  },

  /** 实际执行搜索（搜索核心调用 + 视图聚合）。
   *  writeHistory=true 时把关键词写入历史（仅"确认搜索"时为 true；实时输入不写，避免污染历史）。 */
  runSearch(keyword: string, writeHistory: boolean) {
    const results = searchAll(keyword)
    const counts = countByType(results)
    const totalCount = results.length

    // 分组 tab：全部 + 四类，只显示有命中的类型。
    // 用 TypeFilter[] 显式标注 + 字面量 id 加 as 断言，避免 filter 后被宽化为 string。
    const allFilters: TypeFilter[] = [
      { id: 'all', label: '全部', count: totalCount },
      { id: 'achievement', label: '成就', count: counts.achievement || 0 },
      { id: 'wish', label: '愿望', count: counts.wish || 0 },
      { id: 'inspiration', label: '灵感', count: counts.inspiration || 0 },
      { id: 'checkin', label: '打卡', count: counts.checkin || 0 },
    ]
    const typeFilters: TypeFilter[] = allFilters.filter(f => f.count > 0 || f.id === 'all')

    // 按 activeType 过滤；如果当前选中的 tab 已无命中，回退到"全部"
    const activeType = this.data.activeType
    const activeHasResults = activeType === 'all' || counts[activeType] > 0
    const finalActiveType = activeHasResults ? activeType : 'all'

    const groupedResults = this.buildGroupedResults(results, finalActiveType)

    this.setData({
      typeFilters,
      groupedResults,
      totalCount,
      activeType: finalActiveType,
    })

    if (writeHistory && totalCount > 0) {
      this.saveHistory(keyword)
    }
  },

  /** 把 SearchResult[] 按 type 分组成渲染视图 */
  buildGroupedResults(results: SearchResult[], activeType: TypeFilter['id']): ResultGroup[] {
    // 要展示的类型集合
    const types: SearchResultType[] = activeType === 'all'
      ? ['achievement', 'wish', 'inspiration', 'checkin']
      : [activeType as SearchResultType]

    const groups: ResultGroup[] = []
    for (const t of types) {
      const items = results.filter(r => r.type === t)
      if (items.length === 0) continue
      const meta = groupMeta(t)
      groups.push({
        type: t,
        icon: meta.icon,
        title: meta.title,
        items: items.map(r => ({
          id: r.id,
          type: r.type,
          title: r.title,
          subtitle: r.subtitle,
          icon: r.icon,
        })),
      })
    }
    return groups
  },

  /* ============ 分组切换 ============ */

  onSwitchType(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as TypeFilter['id']
    this.setData({ activeType: id })
    // 重新分组（保留搜索结果，只改展示过滤）
    const keyword = this.data.keyword.trim()
    if (keyword) {
      const results = searchAll(keyword)
      const groupedResults = this.buildGroupedResults(results, id)
      this.setData({ groupedResults })
    }
  },

  /* ============ 点击结果跳转 ============ */

  /** 点击搜索结果：按类型路由跳详情页。
   *  - achievement：直接跳 edit 页打开该条成就（edit 页已支持 ?id= 参数）
   *  - wish/inspiration/checkin：当前列表页未支持 focusId 高亮，跳到列表页由用户定位；
   *    后续若加了 focusId 支持，把 URL 改成 ?focusId=xxx 即可。 */
  onTapResult(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as SearchResultType
    const id = e.currentTarget.dataset.id as string
    switch (type) {
      case 'achievement':
        wx.navigateTo({ url: '/pages/edit/edit?id=' + id })
        break
      case 'wish':
        wx.navigateTo({ url: '/pages/wishlist/wishlist' })
        break
      case 'inspiration':
        wx.navigateTo({ url: '/pages/inspiration/inspiration' })
        break
      case 'checkin':
        wx.navigateTo({ url: '/pages/checkin/checkin' })
        break
    }
  },

  /* ============ 清除 / 历史 ============ */

  onClearKeyword() {
    this.setData({
      keyword: '',
      groupedResults: [],
      totalCount: 0,
      typeFilters: [],
      activeType: 'all',
    })
  },

  onTapHistory(e: WechatMiniprogram.TouchEvent) {
    const kw = e.currentTarget.dataset.kw as string
    this.fromInput = true
    this.setData({ keyword: kw })
    this.runSearch(kw, /* writeHistory */ false)
  },

  onClearHistory() {
    try {
      wx.removeStorageSync(HISTORY_KEY)
    } catch (e) { /* ignore */ }
    this.setData({ history: [] })
  },

  /** 读历史：最多 MAX_HISTORY 条，按"最近搜过"倒序 */
  loadHistory(): string[] {
    try {
      const raw = wx.getStorageSync(HISTORY_KEY)
      if (!raw || !Array.isArray(raw)) return []
      return (raw as string[]).slice(0, MAX_HISTORY)
    } catch (e) {
      return []
    }
  },

  /** 写历史：去重 + 加到队首 + 截到 MAX_HISTORY 条 */
  saveHistory(keyword: string): void {
    const trimmed = keyword.trim()
    if (!trimmed) return
    let list = this.loadHistory().filter(k => k !== trimmed)
    list.unshift(trimmed)
    list = list.slice(0, MAX_HISTORY)
    try {
      wx.setStorageSync(HISTORY_KEY, list)
    } catch (e) { /* ignore */ }
    this.setData({ history: list })
  },
})

/* ============ 小工具（模块级，不在 Page 内） ============ */

/** 给每个分组生成图标和标题 */
function groupMeta(type: SearchResultType): { icon: string; title: string } {
  switch (type) {
    case 'achievement': return { icon: '🏆', title: '成就' }
    case 'wish':        return { icon: '⭐', title: '愿望' }
    case 'inspiration': return { icon: '🌱', title: '灵感' }
    case 'checkin':     return { icon: '🔥', title: '打卡' }
  }
}
