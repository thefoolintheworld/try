// pages/on-this-day/on-this-day.ts
// 往年今日页面：展示历史上今天（同月同日，早于今年）的所有记录。
// 数据由 utils/on-this-day.ts 聚合（成就/打卡/灵感/愿望四类合并）；本页只管渲染 + 跳转。

import {
  collectOnThisDay,
  groupByYear,
  memoryTypeLabel,
  MemoryEntry,
  MemoryYearGroup,
  MemoryType,
} from '../../utils/on-this-day'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 单条记忆的渲染视图（补 typeLabel 给 wxml） */
interface MemoryView {
  id: string
  type: MemoryType
  typeLabel: string
  title: string
  subtitle: string
  icon: string
}

/** 分组视图（给 wxml） */
interface GroupView {
  year: number
  yearsAgoText: string
  entries: MemoryView[]
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    todayDateText: '',    // "8 月 10 日"
    total: 0,             // 历史上今天的记录总数
    totalText: '',        // "3 条往年今日" / "还没有往年今日"
    groups: [] as GroupView[],
  },

  onLoad() {
    applyThemeToPage(this)
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    // 往年今日跨四类实体聚合（成就/打卡/灵感/愿望），任一变动才重算
    const watched: DirtyField[] = ['achievements', 'checkins', 'inspirations', 'wishes']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    const today = new Date()
    const todayDateText = (today.getMonth() + 1) + ' 月 ' + today.getDate() + ' 日'

    const entries: MemoryEntry[] = collectOnThisDay(today)
    const total = entries.length

    // 按 year 分组（collectOnThisDay 已按年份降序）
    const yearGroups: MemoryYearGroup[] = groupByYear(entries)
    const groups: GroupView[] = yearGroups.map(g => ({
      year: g.year,
      yearsAgoText: g.yearsAgoText,
      entries: g.entries.map(e => this.toView(e)),
    }))

    const totalText = total > 0
      ? total + ' 条往年今日'
      : '还没有往年今日'

    this.setData({
      todayDateText,
      total,
      totalText,
      groups,
    })
  },

  /** MemoryEntry → 渲染视图（补 typeLabel） */
  toView(e: MemoryEntry): MemoryView {
    return {
      id: e.id,
      type: e.type,
      typeLabel: memoryTypeLabel(e.type),
      title: e.title,
      subtitle: e.subtitle,
      icon: e.icon,
    }
  },

  /** 点击单条记忆：按类型路由跳详情（与 search 页同款策略） */
  onTapMemory(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as MemoryType
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

  /** 空状态 CTA：跳到添加成就 */
  onTapAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },
})
