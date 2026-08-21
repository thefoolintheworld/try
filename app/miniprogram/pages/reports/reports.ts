// pages/reports/reports.ts
// 我的报告列表：列出所有已生成的读书报告
// 每条显示：标题 / 生成时间 / 卡片数 / 导出状态（已导出/未导出）
// 操作：继续编辑（→ report-edit）、导出（→ poster）、删除（deleteReport）

import { loadReports, deleteReport, ReportInstance } from '../../utils/storage'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { designTokens } from '../../utils/design-tokens'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 列表项视图模型 */
interface ReportItemView {
  id: string
  title: string
  /** 创建时间（显示用，格式化后的字符串） */
  createdLabel: string
  /** 更新时间（显示用） */
  updatedLabel: string
  /** 卡片数量 */
  cardCount: number
  /** 是否已导出 */
  exported: boolean
  /** 导出时间（显示用，未导出则空串） */
  exportedLabel: string
}

/** 每页加载条数（上拉分页）*/
const PAGE_SIZE = 20

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    reports: [] as ReportItemView[],
    hasReports: false,
    loading: true,        // 首屏骨架屏；refresh 完成后置 false
    hasMore: false,       // 还有更多可加载（控制「上拉加载」提示）
    loadingMore: false,   // 正在加载下一页（防重复触发）
  },

  /** 骨架屏开始展示的时间戳（页面实例字段，不入 data）*/
  _loadStart: 0 as number,
  /** 最小骨架展示时间（ms），低于此值会延迟隐藏，避免快加载时骨架闪一下*/
  _minShowMs: 300 as number,
  /** 全量报告视图（分页切片的源数据）*/
  _all: [] as ReportItemView[],
  /** 当前已加载的条数（分页游标）*/
  _shown: 0 as number,

  onLoad() {
    applyThemeToPage(this)
    this._loadStart = Date.now()
    // 让骨架先渲染一帧，再在下一个 tick 加载数据
    setTimeout(() => this.refresh(), 0)
  },

  onShow() {
    applyThemeToPage(this)
    // 用 onShow 而非 onLoad：从 report-edit / poster 返回时能刷新列表状态
    // 首次进入由 onLoad 处理（含骨架）；后续 onShow 仅在报告有变动时才刷新
    if (this.data.loading) return
    const watched: DirtyField[] = ['reports']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    const all = loadReports()
    // 按 updatedAt 降序
    const sorted = all.slice().sort((a, b) => b.updatedAt - a.updatedAt)
    const views: ReportItemView[] = sorted.map((r) => toView(r))
    this._all = views
    this._shown = 0
    this.loadMore()
  },

  /** 加载下一页（或首屏）；从 _all 切 PAGE_SIZE 条追加到 reports */
  loadMore() {
    if (this._shown >= this._all.length) {
      // 无更多：只更新状态
      const patch = {
        reports: this._all.slice(0, this._shown),
        hasReports: this._all.length > 0,
        hasMore: false,
        loadingMore: false,
      }
      this.applyWithMinShow(patch)
      return
    }
    this._shown = Math.min(this._shown + PAGE_SIZE, this._all.length)
    const slice = this._all.slice(0, this._shown)
    const patch = {
      reports: slice,
      hasReports: slice.length > 0,
      hasMore: this._shown < this._all.length,
      loadingMore: false,
    }
    this.applyWithMinShow(patch)
  },

  /** 首次加载走最小展示时间；后续上拉加载直接 setData */
  applyWithMinShow(patch: object) {
    if (!this.data.loading) {
      this.setData(patch)
      return
    }
    const remaining = this._minShowMs - (Date.now() - this._loadStart)
    if (remaining > 0) {
      setTimeout(() => this.setData({ ...patch, loading: false }), remaining)
    } else {
      this.setData({ ...patch, loading: false })
    }
  },

  /** 上拉加载更多（scroll-view bindscrolltolower）*/
  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    // 用 setTimeout 让「加载中」状态先渲染一帧，再切数据
    setTimeout(() => this.loadMore(), 0)
  },

  /** 继续编辑 → report-edit */
  onTapEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/report-edit/report-edit?id=' + id })
  },

  /** 导出 → poster */
  onTapExport(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/poster/poster?id=' + id })
  },

  /** 删除：弹二次确认 */
  onTapDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const view = this.data.reports.find((r) => r.id === id)
    const title = view ? view.title : '该报告'
    wx.showModal({
      title: '删除报告',
      content: '确定删除「' + title + '」吗？此操作不可恢复。',
      confirmText: '删除',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (!res.confirm) return
        const ok = deleteReport(id)
        if (ok) {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.refresh()
        } else {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      },
    })
  },

  /** 空状态：去生成第一份 */
  onTapGenerate() {
    wx.navigateTo({ url: '/pages/report/report' })
  },
})

/* ============================================================
 * 视图模型转换
 * ============================================================ */

/** 把 ReportInstance 转成 wxml 友好的视图对象 */
function toView(r: ReportInstance): ReportItemView {
  const exported = typeof r.exportedAt === 'number' && r.exportedAt > 0
  return {
    id: r.id,
    title: r.title || '未命名报告',
    createdLabel: formatDate(r.createdAt),
    updatedLabel: formatDate(r.updatedAt),
    cardCount: (r.cards && r.cards.length) || 0,
    exported: exported,
    exportedLabel: exported ? formatDate(r.exportedAt as number) : '',
  }
}

/** 时间戳 → "2025-03-14 16:08" 这样的显示字符串 */
function formatDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return (
    d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes())
  )
}
