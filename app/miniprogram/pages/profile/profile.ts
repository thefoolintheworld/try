// pages/profile/profile.ts
// P2-2 个人陈列柜：把用户在首页「置顶」的 6 条成就以陈列柜风格展示。
//
// 设计决策（避免数据冗余）：
//   - 直接复用 preferences.pinnedAchievements（与首页成就墙同源）—— 用户在首页 pin/unpin，
//     这里即时反映，不引入新的 profileSlots 字段。
//   - 这是「只读展示页」：编辑入口跳回首页的 pin 流程（onTapEditPins）。
//   - 视觉上是「个人主页」风格：大封面 + 风格化排版 + 全成就摘要，区别于首页的紧凑成就墙。
//   - 数据不足（<3 条置顶）显示引导态，引导用户去首页置顶。

import { Item, loadAllAchievements } from '../../utils/storage'
import { loadPreferences } from '../../utils/preferences'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { presetToCss } from '../../utils/achievement-presets'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

interface ShowcaseSlot {
  id: string
  title: string
  author: string
  finishedDate: string
  categoryIcon: string
  categoryColor: string
  categoryLabel: string
  rating: number
  ratingText: string
  note: string
  genre: string
  imageKind: 'none' | 'preset' | 'image'
  image: string
  presetCss: string
}

interface ProfileSummary {
  totalAchievements: number
  totalBooks: number
  totalFilms: number
  topGenre: string
  yearSpan: string
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    hasPin: false,           // 是否有 ≥1 条置顶（控制空态）
    slots: [] as ShowcaseSlot[],
    summary: null as ProfileSummary | null,
    pinnedCount: 0,          // 当前置顶数（驱动「X / 6」徽标）
  },

  onLoad() {
    applyThemeToPage(this)
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    const watched: DirtyField[] = ['achievements', 'preferences']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    const all = loadAllAchievements()
    const prefs = loadPreferences()
    const byId: { [id: string]: Item } = {}
    for (const it of all) byId[it.id] = it
    // 按 pinnedAchievements 顺序构造槽位（跳过失效 id）
    const slots: ShowcaseSlot[] = []
    for (const id of prefs.pinnedAchievements) {
      const it = byId[id]
      if (!it) continue
      slots.push(this.toShowcaseSlot(it))
    }
    const hasPin = slots.length > 0
    // 全成就摘要（无论是否置顶都有）
    const summary = this.buildSummary(all)
    this.setData({
      hasPin,
      slots,
      summary,
      pinnedCount: slots.length,
    })
  },

  /** Item → 陈列柜槽位视图（处理图片三种形态 + 分类元数据）*/
  toShowcaseSlot(it: Item): ShowcaseSlot {
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
    return {
      id: it.id,
      title: it.title,
      author: (it.author || '').trim(),
      finishedDate: it.finishedDate,
      categoryIcon: meta.icon,
      categoryColor: meta.color,
      categoryLabel: meta.label,
      rating: it.rating,
      ratingText: it.rating > 0 ? it.rating.toFixed(1) : '',
      note: it.note || '',
      genre: (it.genre || '').trim(),
      imageKind,
      image,
      presetCss,
    }
  },

  /** 全成就统计摘要（顶部「我的画像」用）*/
  buildSummary(all: Item[]): ProfileSummary | null {
    if (all.length === 0) return null
    let totalBooks = 0
    let totalFilms = 0
    const genreMap: { [g: string]: number } = {}
    const years: number[] = []
    for (const it of all) {
      const cat = resolveCategory(it.category, it.type)
      if (cat === 'reading') totalBooks += 1
      else if (cat === 'film') totalFilms += 1
      const g = (it.genre || '').trim()
      if (g) genreMap[g] = (genreMap[g] || 0) + 1
      const y = parseInt((it.finishedDate || '').slice(0, 4), 10)
      if (!isNaN(y)) years.push(y)
    }
    const topGenre = Object.keys(genreMap).sort((a, b) => genreMap[b] - genreMap[a])[0] || ''
    const minY = years.length > 0 ? Math.min(...years) : 0
    const maxY = years.length > 0 ? Math.max(...years) : 0
    const yearSpan = minY === maxY ? String(minY) : (minY + '–' + maxY)
    return {
      totalAchievements: all.length,
      totalBooks,
      totalFilms,
      topGenre,
      yearSpan,
    }
  },

  /** 点击槽位跳到编辑页 */
  onTapSlot(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    wx.navigateTo({ url: '/pages/edit/edit?id=' + id })
  },

  /** 图片加载失败兜底：把对应 slot 的 imageKind 降级为 'none'，分类 emoji 占位接管。
   *  只改内存视图层，不动 storage。 */
  onImageError(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    const slots = this.data.slots.map(s => s.id === id ? { ...s, imageKind: 'none' as const } : s)
    this.setData({ slots })
  },

  /** 空态引导：跳回首页去 pin（首页有 onTapEditWall 入口）。
   *  index 不是 tabBar 页（本项目无 tabBar），所以不能用 switchTab。
   *  若页面栈里有上一页（从首页 navigateTo 进来）直接 navigateBack；
   *  否则（从分享链接直接进）用 reLaunch 重置到首页。 */
  onTapGoPin() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  onShareAppMessage() {
    const cnt = this.data.pinnedCount
    return {
      title: cnt > 0 ? '我的阅读陈列柜 · ' + cnt + ' 部精选' : '阅观 · 我的阅读陈列柜',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    const cnt = this.data.pinnedCount
    return {
      title: cnt > 0 ? '我的阅读陈列柜 · ' + cnt + ' 部精选' : '阅观 · 阅读陈列柜',
    }
  },
})
