// pages/medals/medals.ts
// P3 勋章墙独立页：集中展示所有勋章（已解锁高亮 + 未解锁显示进度）。
// 设计：
//   - 纯只读展示页，不写数据（解锁写回由 buildMedalRows 内部副作用统一处理）。
//   - 复用 medal-config.ts 的 loadMedalRows()（与 index/settings 同源，避免三处计数漂移）。
//   - 分两组展示：「已解锁」在上，「未解锁（带进度）」在下；限量勋章带窗口提示。
//   - 数据不足时显示空状态。

import { loadMedalRows, MedalView } from '../../utils/medal-config'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 每页加载条数（locked 组分页；unlocked 组通常不多不分页）*/
const PAGE_SIZE = 20

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    rows: [] as MedalView[],
    unlockedCount: 0,
    totalCount: 0,
    unlocked: [] as MedalView[],
    locked: [] as MedalView[],       // 当前展示的切片
    hasData: false,
    loading: true,
    hasMore: false,                  // locked 还有更多
    loadingMore: false,
  },

  _loadStart: 0 as number,
  _minShowMs: 300 as number,
  _lockedAll: [] as MedalView[],     // locked 全量（分页源）
  _shown: 0 as number,

  onLoad() {
    applyThemeToPage(this)
    this._loadStart = Date.now()
    setTimeout(() => this.refresh(), 0)
  },

  onShow() {
    // 主题可能在设置页改过；回到本页要重应用 + 重算（解锁状态可能刚被 settings 改了目标）
    applyThemeToPage(this)
    if (this.data.loading) return
    // 勋章计数依赖成就 + 打卡 + 偏好（自定义目标）；三者有变动才重算
    const watched: DirtyField[] = ['achievements', 'checkins', 'preferences']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    const rows = loadMedalRows()
    const unlocked = rows.filter(r => r.unlocked)
    const lockedAll = rows.filter(r => !r.unlocked)
    this._lockedAll = lockedAll
    this._shown = Math.min(PAGE_SIZE, lockedAll.length)
    const locked = lockedAll.slice(0, this._shown)
    const patch = {
      rows,
      unlocked,
      locked,
      unlockedCount: unlocked.length,
      totalCount: rows.length,
      hasData: rows.length > 0,
      hasMore: this._shown < lockedAll.length,
      loadingMore: false,
    }
    const remaining = this._minShowMs - (Date.now() - this._loadStart)
    if (remaining > 0) {
      setTimeout(() => this.setData({ ...patch, loading: false }), remaining)
    } else {
      this.setData({ ...patch, loading: false })
    }
  },

  /** 上拉加载更多 locked 勋章 */
  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return
    this.setData({ loadingMore: true })
    setTimeout(() => {
      this._shown = Math.min(this._shown + PAGE_SIZE, this._lockedAll.length)
      this.setData({
        locked: this._lockedAll.slice(0, this._shown),
        hasMore: this._shown < this._lockedAll.length,
        loadingMore: false,
      })
    }, 0)
  },

  onShareAppMessage() {
    const u = this.data.unlockedCount
    const t = this.data.totalCount
    return {
      title: '我的勋章墙 · 已解锁 ' + u + '/' + t + ' 枚',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    return {
      title: '勋章墙 · 已点亮 ' + this.data.unlockedCount + '/' + this.data.totalCount + ' 枚',
    }
  },

  /** 空态：跳录入页去解锁第一枚勋章 */
  onTapAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' })
  },
})
