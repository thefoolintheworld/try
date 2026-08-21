// pages/trash/trash.ts
// 回收站页面：列出所有软删除条目，支持恢复 / 彻底删除 / 清空全部。
// 关键：把 TrashEntry 的快照解析成统一的渲染视图（title/subtitle），让 wxml 不区分类型。

import {
  loadTrash,
  purgeFromTrash,
  clearTrash,
  restoreFromTrash,
  trashTypeMeta,
  TrashEntry,
  TrashType,
  isItemSnapshot,
  isWishSnapshot,
  isInspirationSnapshot,
  isCheckinSnapshot,
  isReportSnapshot,
  isTemplateSnapshot,
} from '../../utils/trash'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { getInspirationCategoryMeta } from '../../utils/inspiration-presets'
import { getCheckinCategoryMeta } from '../../utils/checkin-presets'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { designTokens } from '../../utils/design-tokens'

/** 单条回收站的渲染视图 */
interface TrashView {
  key: string         // 唯一 key = type + '|' + id（防 wx:key 冲突）
  type: TrashType
  id: string
  typeLabel: string   // "成就" / "愿望" ...
  typeIcon: string    // emoji
  title: string       // 快照派生的标题
  subtitle: string    // 副标题（可空）
  daysLeft: number    // 还剩几天到期（0 表示今天到期）
}

const DAY_MS = 24 * 60 * 60 * 1000

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    entries: [] as TrashView[],
  },

  onLoad() {
    applyThemeToPage(this)
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    this.refresh()
  },

  refresh() {
    const list = loadTrash()
    const now = Date.now()
    const entries: TrashView[] = list.map(e => {
      const meta = trashTypeMeta(e.type)
      const derived = this.deriveTitleSubtitle(e)
      const daysLeft = Math.max(0, Math.ceil((e.autoPurgeAt - now) / DAY_MS))
      return {
        key: e.type + '|' + e.id,
        type: e.type,
        id: e.id,
        typeLabel: meta.label,
        typeIcon: meta.icon,
        title: derived.title,
        subtitle: derived.subtitle,
        daysLeft,
      }
    })
    this.setData({ entries })
  },

  /** 按快照类型派生 title/subtitle（统一字段，wxml 不再判断类型） */
  deriveTitleSubtitle(e: TrashEntry): { title: string; subtitle: string } {
    const s = e.snapshot
    switch (e.type) {
      case 'item': {
        if (!isItemSnapshot(s)) return { title: '（已损坏）', subtitle: '' }
        const meta = getCategoryMeta(resolveCategory(s.category, s.type))
        return {
          title: s.title,
          subtitle: meta.label + ' · ' + s.finishedDate + (s.author ? ' · ' + s.author : ''),
        }
      }
      case 'wish': {
        if (!isWishSnapshot(s)) return { title: '（已损坏）', subtitle: '' }
        return {
          title: s.title,
          subtitle: s.note || '',
        }
      }
      case 'inspiration': {
        if (!isInspirationSnapshot(s)) return { title: '（已损坏）', subtitle: '' }
        const meta = getInspirationCategoryMeta(s.category)
        return {
          title: truncate(s.content, 60),
          subtitle: meta.icon + ' ' + meta.label,
        }
      }
      case 'checkin': {
        if (!isCheckinSnapshot(s)) return { title: '（已损坏）', subtitle: '' }
        const meta = getCheckinCategoryMeta(s.category)
        return {
          title: s.note ? s.note : (meta.label + '打卡'),
          subtitle: '🔥 ' + s.date,
        }
      }
      case 'report': {
        if (!isReportSnapshot(s)) return { title: '（已损坏）', subtitle: '' }
        return {
          title: s.title,
          subtitle: s.cards.length + ' 张卡片',
        }
      }
      case 'template': {
        if (!isTemplateSnapshot(s)) return { title: '（已损坏）', subtitle: '' }
        return {
          title: s.name,
          subtitle: s.description || (s.cards.length + ' 张卡片'),
        }
      }
    }
  },

  /* === 单条操作 === */

  /** 恢复某条：调用 restoreFromTrash；成功后刷新列表 */
  onRestore(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as TrashType
    const id = e.currentTarget.dataset.id as string
    const res = restoreFromTrash(type, id)
    wx.showToast({ title: res.msg, icon: res.ok ? 'success' : 'none' })
    if (res.ok) this.refresh()
  },

  /** 彻底删除某条：二次确认后从回收站清除（不可恢复） */
  onPurge(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as TrashType
    const id = e.currentTarget.dataset.id as string
    wx.showModal({
      title: '彻底删除？',
      content: '删除后无法恢复',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (res.confirm) {
          const ok = purgeFromTrash(type, id)
          wx.showToast({ title: ok ? '已彻底删除' : '操作失败', icon: 'none' })
          if (ok) this.refresh()
        }
      },
    })
  },

  /** 清空全部：强二次确认 */
  onClearAll() {
    wx.showModal({
      title: '清空回收站？',
      content: '所有 ' + this.data.entries.length + ' 条记录将被彻底删除，不可恢复。',
      confirmColor: designTokens.color.danger,
      success: (res) => {
        if (res.confirm) {
          const ok = clearTrash()
          if (!ok) {
            wx.showToast({ title: '清空失败，请重试', icon: 'none' })
            return
          }
          wx.showToast({ title: '已清空', icon: 'success' })
          this.refresh()
        }
      },
    })
  },
})

/** 截断字符串到 maxLen 字 */
function truncate(s: string, maxLen: number): string {
  if (!s) return ''
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}
