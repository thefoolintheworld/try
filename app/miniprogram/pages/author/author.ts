// pages/author/author.ts
// P2-4 作者聚合页：从 list/edit 页点作者名进入，展示该作者的全部作品 / 平均分 / 时间线。
// 设计：
//   - 纯只读展示页，不写数据；与 stats 同口径，使用 loadAllAchievements 过滤 done。
//   - 通过 onLoad options.author 接收作者名（URL 编码传入）。
//   - 数据不足时显示空状态（作者名错或无成就）。

import { loadAllAchievements } from '../../utils/storage'
import { calcSingleAuthor, AuthorStat } from '../../utils/stats'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'

interface BookRow {
  id: string
  title: string
  rating: number
  ratingText: string
  genre: string
  finishedDate: string
  note: string
  categoryIcon: string
  categoryColor: string
  categoryLabel: string
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    author: '',
    found: false,
    count: 0,
    avgRatingText: '0.0',
    topGenre: '',
    yearSpan: '',         // "2019–2024" 时间跨度
    books: [] as BookRow[],
  },

  onLoad(options: Record<string, string>) {
    applyThemeToPage(this)
    // 防御性 decode：当前唯一调用方（list 页）用 encodeURIComponent 编码，对称安全；
    // 但 options 是 URL 输入，未来若有其它入口（分享/场景值）可能带入非法 % 转义，这里兜底。
    let author = ''
    try {
      author = decodeURIComponent(options.author || '')
    } catch (_e) {
      author = options.author || ''
    }
    this.refresh(author)
  },

  onShow() {
    applyThemeToPage(this)
    // 跳转回来时如果列表数据变了，重新算一遍（author 已存 data）
    if (this.data.author) this.refresh(this.data.author)
  },

  refresh(author: string) {
    if (!author) {
      this.setData({ author: '', found: false })
      return
    }
    const all = loadAllAchievements()
    const stat: AuthorStat | null = calcSingleAuthor(all, author)
    if (!stat || stat.count === 0) {
      this.setData({ author, found: false, count: 0, books: [] })
      return
    }
    // 取所有作品的类型分布，找最多的（用于顶部摘要）
    const genreMap: { [g: string]: number } = {}
    for (const b of stat.books) {
      const g = (b.genre || '').trim() || '未分类'
      genreMap[g] = (genreMap[g] || 0) + 1
    }
    const topGenre = Object.keys(genreMap).sort((a, b) => genreMap[b] - genreMap[a])[0] || ''
    // 时间跨度：最早完成年 ~ 最晚完成年
    const years = stat.books.map(b => parseInt(b.finishedDate.slice(0, 4), 10)).filter(y => !isNaN(y))
    const minY = years.length > 0 ? Math.min(...years) : 0
    const maxY = years.length > 0 ? Math.max(...years) : 0
    const yearSpan = minY === maxY ? String(minY) : (minY + '–' + maxY)
    const books: BookRow[] = stat.books.map(b => {
      const catId = resolveCategory(b.category, b.type)
      const meta = getCategoryMeta(catId)
      return {
        id: b.id,
        title: b.title,
        rating: b.rating,
        ratingText: b.rating > 0 ? (b.rating.toFixed(1) + ' ★') : '未评分',
        genre: (b.genre || '').trim() || '未分类',
        finishedDate: b.finishedDate,
        note: b.note || '',
        categoryIcon: meta.icon,
        categoryColor: meta.color,
        categoryLabel: meta.label,
      }
    })
    this.setData({
      author,
      found: true,
      count: stat.count,
      avgRatingText: stat.avgRating.toFixed(1),
      topGenre,
      yearSpan,
      books,
    })
  },

  /** 点击作品跳到编辑页 */
  onTapBook(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (!id) return
    wx.navigateTo({ url: '/pages/edit/edit?id=' + id })
  },

  onShareAppMessage() {
    return {
      title: this.data.found ? this.data.author + ' · 共读 ' + this.data.count + ' 部' : '阅观 · 作者档案',
      path: '/pages/index/index',
    }
  },
})
