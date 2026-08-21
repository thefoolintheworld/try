// app.ts
import { refreshThemeCache } from './utils/theme'
import { autoPurgeExpired } from './utils/trash'

App({
  globalData: {},
  onLaunch() {
    // 初始化主题缓存（亮/暗 + 字体）。所有页面 onShow 时读 cache 拿根 class + 导航栏配色。
    refreshThemeCache()

    // 回收站自动清理：删除超过 30 天的软删除条目（彻底清理，不可恢复）。
    // 静默执行，无需反馈；返回值是被清理的条数（暂不展示给用户）。
    try {
      autoPurgeExpired()
    } catch (e) {
      console.warn('[trash] 自动清理失败', e)
    }

    // 监听系统主题变化：仅当用户选 'auto' 时才需要刷新（其它模式用户显式指定，不受系统影响）。
    // wx.onThemeChange 基础库 2.11.1+ 支持，老库会静默忽略（回调不触发，无副作用）。
    if (wx.onThemeChange) {
      wx.onThemeChange(() => {
        // 这里不知道用户当前偏好，refreshThemeCache 内部会读 storage；
        // 如果用户是 light/dark，重算结果不变；如果是 auto，会跟随系统切换。
        const cache = refreshThemeCache()
        // 通知当前栈顶页面重渲染（最简单可靠的方式）。
        const pages = getCurrentPages()
        const top = pages[pages.length - 1] as { setData?: (d: { [k: string]: unknown }) => void; onThemeUpdate?: () => void } | undefined
        if (top && typeof top.setData === 'function') {
          // 给页面一个钩子做额外联动；否则只刷通用字段
          if (typeof top.onThemeUpdate === 'function') {
            top.onThemeUpdate()
          } else {
            top.setData({
              themeClass: cache.rootClass,
              navColor: cache.navColor,
              navBg: cache.navBg,
            })
          }
        }
      })
    }
  },
})
