// pages/wrapped/wrapped.ts
// 年度 Wrapped：五幕叙事页（开场 → Top → 人格 → 稀有度 → 代表作）。
// 数据由 utils/wrapped.ts 聚合（输入年份 + items，输出 WrappedData）；本页只管渲染 + 年份切换 + 跳导出。
//
// 解锁规则（与 utils/wrapped.ts isYearUnlocked 对齐）：
//  - 历史年份（< 今年）：永远可看
//  - 当年：仅 12 月解锁（其余月份显示"年底揭晓"锁定态）
//
// 入口：首页"年度回顾"卡片（12 月或历史年份显示）；URL 形如 /pages/wrapped/wrapped?year=2026

import {
  loadWrapped,
  listWrappedYears,
  isYearUnlocked,
  MIN_WRAPPED_ITEMS,
  WrappedData,
  ActOpening,
  ActTopLists,
  ActPersonality,
  ActRarity,
  ActSummary,
} from '../../utils/wrapped'
import { loadAchievementsByYear, Item } from '../../utils/storage'
import { getCategoryMeta, CategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage } from '../../utils/theme'
import { canvasColors } from '../../utils/design-tokens'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** Top 5 评分榜的渲染视图（补 ratingText / categoryLabel 给 wxml） */
interface RatedView {
  id: string
  title: string
  author: string
  ratingText: string   // "4.5"
}

/** 代表作的渲染视图（补 coverColor/categoryLabel/ratingText） */
interface HighlightView {
  title: string
  author: string
  note: string
  coverColor: string
  categoryLabel: string
  ratingText: string
}

Page({
  data: {
    themeClass: 'theme-light',
    navColor: canvasColors.nav.color,
    navBg: canvasColors.nav.bg,
    navTitle: '年度回顾',

    // 当前看的年份（从 URL ?year= 读，缺省取今年）
    year: new Date().getFullYear(),
    // 当年是否解锁（12 月解锁当年；历史永远解锁）
    unlocked: false,
    // 数据是否充足（≥ MIN_WRAPPED_ITEMS）
    sufficient: false,
    minItems: MIN_WRAPPED_ITEMS,
    // 一年总条数（数据不足态用于显示"才 N 条"）
    total: 0,
    // 当年已记录条数（锁定态给个进度提示）
    currentTotal: 0,

    // 历史可看年份（按降序；锁定态/页尾切换用）
    historyYears: [] as number[],

    // === 五幕数据 ===
    opening: null as unknown as ActOpening,
    topLists: null as unknown as ActTopLists,
    topRatedCount: 0,
    personality: null as unknown as ActPersonality,
    personalityColor: canvasColors.categoryPalette.reading as string,  // 人格主色默认（驱动 Act3 渐变背景；加载后由实际人格色覆盖）
    personalityColorSoft: canvasColors.personalitySoft as string,      // 人格主色淡化（渐变起点）
    rarity: null as unknown as ActRarity,
    rarityTierLabel: '稀有',
    summary: null as unknown as ActSummary,
  },

  onLoad(options: { year?: string }) {
    applyThemeToPage(this)
    // 解析年份参数（支持 ?year=2025 回看历史；非法值或缺省取今年）
    let year = new Date().getFullYear()
    if (options && options.year) {
      const parsed = parseInt(options.year, 10)
      if (!isNaN(parsed) && parsed > 1900 && parsed < 9999) {
        year = parsed
      }
    }
    this.setData({ year })
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    // Wrapped 重活（聚合 5 幕 + 多轮统计），只在成就有变动时才重算
    const watched: DirtyField[] = ['achievements']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  // 系统主题变化时（app.ts 的 onThemeChange）触发即时重绘，
  // 避免切暗色后停在当前页时 canvas 仍用旧主题色（要回到本页 onShow 才换色的滞后）。
  onThemeUpdate() {
    applyThemeToPage(this)
    this.refresh()
  },

  refresh() {
    const year = this.data.year
    const unlocked = isYearUnlocked(year)
    const wrapped: WrappedData = loadWrapped(year)
    const currentTotal = loadAchievementsByYear(new Date().getFullYear()).length

    // 历史可看年份（按降序）。只列「已解锁 + 数据足够」的年份，
    // 否则当年（11 月及以前未解锁）会作为可点 chip 出现，点了又跳回锁定态（体验回路）。
    const allYears = listWrappedYears()
    const historyYears: number[] = []
    for (const y of allYears) {
      if (isYearUnlocked(y)) historyYears.push(y)
    }
    // 兜底：若当前看的年份没在列表里（比如当前看的去年刚好没在 listWrappedYears 返回值里），手动加进去
    if (historyYears.indexOf(year) < 0 && unlocked && wrapped.total >= MIN_WRAPPED_ITEMS) {
      historyYears.unshift(year)
      historyYears.sort((a, b) => b - a)
    }

    if (!unlocked || !wrapped.sufficient) {
      // 锁定态 / 数据不足态：只显示对应占位，但仍 setData 基础字段
      this.setData({
        year,
        unlocked,
        sufficient: wrapped.sufficient,
        total: wrapped.total,
        currentTotal,
        historyYears,
        navTitle: year + ' 年度回顾',
      })
      return
    }

    // 完整五幕：把 WrappedData 映射到 wxml 友好的视图
    this.setData({
      year,
      unlocked,
      sufficient: wrapped.sufficient,
      total: wrapped.total,
      currentTotal,
      historyYears,
      navTitle: year + ' 年度回顾',

      opening: wrapped.opening,
      topLists: this.buildTopListsView(wrapped.topLists),
      topRatedCount: wrapped.topLists.topRated.length,
      personality: wrapped.personality,
      personalityColor: wrapped.personality.meta.color,
      personalityColorSoft: this.softenColor(wrapped.personality.meta.color),
      rarity: wrapped.rarity,
      rarityTierLabel: this.tierLabel(wrapped.rarity.tier),
      summary: this.buildSummaryView(wrapped.summary),
    })
  },

  /** 把 ActTopLists 里 topRated 的 Item[] 转成精简 RatedView（补 ratingText） */
  buildTopListsView(src: ActTopLists): ActTopLists {
    // topRated 已经是 Item[]；ratingText 不在 Item 上，需要补。
    // 但 Item 类型不允许加字段；用一个并行数组并通过 wx:for 的 index 渲染会有问题。
    // 替代方案：直接在 wxml 用 wx:for + 自定义字段不行；所以这里把 topRated 替换为带 ratingText 的视图。
    // 由于 ActTopLists 的类型定义里 topRated: Item[]，我们用一个 extends 的临时对象绕开。
    const ratedViews = src.topRated.map(it => this.itemToRatedView(it))
    // 直接覆盖 topRated 字段（运行时多出来的 ratingText 字段在 wxml 里照常可读）
    const patched: ActTopLists & { topRated: unknown } = { ...src, topRated: ratedViews as unknown as Item[] }
    return patched as unknown as ActTopLists
  },

  itemToRatedView(it: Item): RatedView {
    return {
      id: it.id,
      title: it.title,
      author: it.author || '',
      ratingText: it.rating.toFixed(1),
    }
  },

  /** 把 ActSummary.highlight（Item | null）映射成 wxml 友好的 HighlightView；
   *  返回类型保持 ActSummary，运行时 highlight 已被替换为带额外字段的视图对象。 */
  buildSummaryView(src: ActSummary): ActSummary {
    if (!src.highlight) {
      return src
    }
    const it = src.highlight
    const meta: CategoryMeta = getCategoryMeta(resolveCategory(it.category, it.type))
    const hv: HighlightView = {
      title: it.title,
      author: it.author || '',
      note: it.note || '',
      coverColor: it.coverColor || meta.color,
      categoryLabel: meta.label,
      ratingText: it.rating.toFixed(1),
    }
    // 运行时把 highlight 替换为 HighlightView（多了 categoryLabel/ratingText/coverColor 字段），
    // 类型上仍是 Item 的结构超集，wxml 可照常读取额外字段。
    return { ...src, highlight: hv as unknown as ActSummary['highlight'] }
  },

  /** 把人格色淡化（用于 Act3 渐变起点色）—— 简单粗暴：把每个通道往白色拉 40% */
  softenColor(hex: string): string {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
    if (!m) return hex
    const r = parseInt(m[1].slice(0, 2), 16)
    const g = parseInt(m[1].slice(2, 4), 16)
    const b = parseInt(m[1].slice(4, 6), 16)
    const mix = (c: number) => Math.round(c + (255 - c) * 0.4)
    const toHex = (c: number) => c.toString(16).padStart(2, '0')
    return '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b))
  },

  /** 稀有度档位文案 */
  tierLabel(tier: ActRarity['tier']): string {
    if (tier === 'legendary') return '传说'
    if (tier === 'epic') return '史诗'
    if (tier === 'rare') return '稀有'
    return '常见'
  },

  /* === handlers === */

  /** 切换历史年份（页内 chip 点击） */
  onPickHistoryYear(e: WechatMiniprogram.TouchEvent) {
    const year = parseInt(String(e.currentTarget.dataset.year), 10)
    if (isNaN(year) || year === this.data.year) return
    this.setData({ year })
    this.refresh()
    // 滚回顶部，让用户从 Act 1 重新看起
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  /** 跳 poster 页导出年度海报（复用现有海报引擎；wrappedYear 参数驱动 Wrapped 专属卡片样式）。 */
  onExportPoster() {
    wx.navigateTo({ url: '/pages/poster/poster?wrappedYear=' + this.data.year })
  },

  onShareAppMessage() {
    return {
      title: this.data.year + ' 年度回顾 · 我的人格是「' + (this.data.personality && this.data.personality.meta ? this.data.personality.meta.label : '') + '」',
      path: '/pages/wrapped/wrapped?year=' + this.data.year,
    }
  },

  /** P3-1 朋友圈分享：让 Wrapped 回顾能分享到朋友圈（强化传播） */
  onShareTimeline() {
    const label = this.data.personality && this.data.personality.meta ? this.data.personality.meta.label : ''
    return {
      title: this.data.year + ' 年度回顾' + (label ? ' · 人格「' + label + '」' : ''),
      query: 'year=' + this.data.year,
    }
  },
})
