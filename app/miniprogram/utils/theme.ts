// utils/theme.ts
// 主题接线工具：每页用 buildThemeClasses() 拼 class 字符串、buildNavColors() 拿导航栏配色。
//
// 设计：
//   - 偏好缓存在 app.globalData.themeCache，避免每页都同步读 storage（性能）。
//   - app.ts onLaunch 时调 refreshThemeCache() 一次；settings 页改完偏好调 refreshThemeCache()
//     然后 setData 触发本页重渲染；其它页 onShow 时从 cache 读即可。
//   - 自动跟随系统：app 监听 wx.onThemeChange，系统切换时刷新 cache 并通知所有页面。
//   - navigation-bar 组件接受 color/background 两个字符串 prop（看其 wxml），所以每页
//     需要把当前主题下的导航栏前景/背景色传进去（不能让它写死 #3D3530/#FAF6F0）。

import { AppPreferences, loadPreferences, resolveTheme } from './preferences'

/** 注入到 page 根节点的 class 字符串（拼到 scroll-view/.page 上）*/
export function buildThemeClasses(prefs: AppPreferences): string {
  const theme = resolveTheme(prefs.themeMode)
  const classes: string[] = []
  if (theme === 'dark') {
    // 暗色：theme-dark（共享色）+ 变体 class（底色）
    classes.push('theme-dark')
    classes.push('theme-dark-' + prefs.darkVariant)
  } else {
    classes.push('theme-light')
  }
  if (prefs.titleFont === 'serif') classes.push('theme-serif-title')
  return classes.join(' ')
}

/** 导航栏配色（前景文字色 + 背景色），随主题变化 */
export function buildNavColors(prefs: AppPreferences): { color: string; background: string } {
  const theme = resolveTheme(prefs.themeMode)
  if (theme === 'dark') {
    return { color: '#EDE4D8', background: '#1F1B17' }
  }
  return { color: '#3D3530', background: '#FAF6F0' }
}

/**
 * 缓存结构：放在 app.globalData.themeCache。
 * 字段是页面渲染直接需要的（避免每页都自己拼一次）。
 * 注：与 typings/index.d.ts 里全局声明的 ThemeCache 同构；这里给出具体类型。
 */
export interface ThemeCache {
  prefs: AppPreferences
  /** 已拼好的根 class 字符串 */
  rootClass: string
  /** 导航栏前景色 */
  navColor: string
  /** 导航栏背景色 */
  navBg: string
}

/** 从 globalData 读缓存；不存在则构建一次 */
export function getThemeCache(): ThemeCache {
  const app = getApp<IAppOption>()
  if (app && app.globalData.themeCache) {
    return app.globalData.themeCache
  }
  return refreshThemeCache()
}

/**
 * 重新读偏好并刷新缓存。返回新缓存。
 * settings 页改完偏好后调用，然后再 setData 触发重渲染。
 */
export function refreshThemeCache(): ThemeCache {
  const prefs = loadPreferences()
  const cache: ThemeCache = {
    prefs,
    rootClass: buildThemeClasses(prefs),
    navColor: buildNavColors(prefs).color,
    navBg: buildNavColors(prefs).background,
  }
  const app = getApp<IAppOption>()
  if (app) {
    app.globalData.themeCache = cache
  }
  return cache
}

/**
 * 页面通用：在 onShow/onLoad 里调用，把当前主题相关字段塞进 this.data。
 * 返回当前缓存（含 rootClass/navColor/navBg），便于调用方做其它联动。
 *
 * 用法（页面 onShow）：
 *   applyThemeToPage(this)
 *   // this.data.themeClass / navColor / navBg 已就绪；wxml 里直接绑定
 */
export function applyThemeToPage(page: { setData: (data: Anyable) => void }): ThemeCache {
  const cache = getThemeCache()
  page.setData({
    themeClass: cache.rootClass,
    navColor: cache.navColor,
    navBg: cache.navBg,
  })
  return cache
}

/** setData 参数的最小通用类型（避免依赖官方 AnyObject 私有类型）*/
type Anyable = { [key: string]: unknown }

/**
 * 取当前主题下的导航栏配色，供页面 data 初始值用。
 *
 * 背景：26 个页面 data 里硬编码了 navColor:'#3D3530' / navBg:'#FAF6F0' 作为初始值，
 * 首帧渲染时 applyThemeToPage 还没跑，导致暗色主题下首帧闪一下亮色导航栏。
 * 用这个 helper 取当前主题的真实配色作为初始值，消除首帧闪烁。
 *
 * 注意：必须在页面模块加载时同步调用（data 字面量初始化），所以这里读 cache；
 * 若 cache 还没建（app onLaunch 之前，理论上不会发生），回落到亮色默认。
 */
export function getNavDefaults(): { color: string; background: string } {
  try {
    const cache = getThemeCache()
    return { color: cache.navColor, background: cache.navBg }
  } catch (e) {
    return { color: '#3D3530', background: '#FAF6F0' }
  }
}

/** 取当前主题的根 class 字符串（供页面 data 初始 themeClass 用，消除首帧闪烁）。*/
export function getRootClassDefault(): string {
  try {
    return getThemeCache().rootClass
  } catch (e) {
    return 'theme-light'
  }
}
