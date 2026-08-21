// pages/about/about.ts
// 关于页：产品介绍 + 版本号 + 隐私政策入口
// 成就系统主轴：记录每一个值得纪念的成就，并可选部分成就做成可导出的报告。

import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    version: '1.0.0',
    features: [
      { icon: '🏆', title: '记录成就', desc: '阅读、观影、技能、旅行、第一次……每一个值得纪念的瞬间，都被认真记下' },
      { icon: '✍️', title: '做成报告', desc: '选几个成就，挑一个模板，把它们写成一份专属的报告' },
      { icon: '🖼️', title: '随心修改', desc: '逐张卡片改写文案，调整顺序，导出长图分享给朋友' },
    ],
  },

  onLoad() {
    applyThemeToPage(this)
  },

  onShow() {
    applyThemeToPage(this)
  },

  onTapPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  onShareAppMessage() {
    return {
      title: '阅观年度 — 记录你的每一个成就',
      path: '/pages/index/index',
    }
  },
})
