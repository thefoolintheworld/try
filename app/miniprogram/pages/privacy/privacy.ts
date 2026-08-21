// pages/privacy/privacy.ts
// 隐私政策页面（个人主体小程序提审必需）

import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    updateDate: '2026-08-07',
  },

  onLoad() {
    applyThemeToPage(this)
  },

  onShow() {
    applyThemeToPage(this)
  },
})
