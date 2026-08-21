// pages/templates/templates.ts
// 模板管理页：
// - 来自 report 页（from=report）：点模板 = 选中并返回
// - 独立访问：模板管理（新建 / 复制 / 编辑 / 删除）

import { ReportTemplate, loadTemplates, deleteTemplate } from '../../utils/storage'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { designTokens } from '../../utils/design-tokens'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

const PENDING_TEMPLATE_KEY = 'pending_template_id'

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    templates: [] as ReportTemplate[],
    from: '' as string,             // 'report' 表示来自报告组装器
    isPickerMode: false,            // 是否选择模式（点选即返回）
  },

  // 实例字段：标记是否已完成首次加载，用于区分 onLoad 与后续 onShow
  _loadedOnce: false as boolean,

  onLoad(options: Record<string, string>) {
    applyThemeToPage(this)
    const from = options.from || ''
    this.setData({
      from,
      isPickerMode: from === 'report',
    })
    // 首次进入强制加载一次——内置模板的初始化路径（ensureBuiltInTemplates / migrateToV3）
    // 写 storage 时不会 markDirty('templates')，脏检查短路会让首访列表永远空。
    // 用 _loadedOnce 标志区分「首次加载」与「后续 onShow 重入」。
    this.refresh()
    this._loadedOnce = true
  },

  onShow() {
    applyThemeToPage(this)
    // 首次进入已由 onLoad 处理；后续 onShow 仅在模板有变动时才重读
    if (!this._loadedOnce) return
    const watched: DirtyField[] = ['templates']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    this.setData({ templates: loadTemplates() })
  },

  /* ===== 选择模式：点模板卡 = 选中并返回 ===== */

  onTapTemplate(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    if (this.data.isPickerMode) {
      // 选择模式：写临时缓存返回
      wx.setStorageSync(PENDING_TEMPLATE_KEY, id)
      wx.navigateBack()
    } else {
      // 管理模式：进编辑页查看/编辑
      wx.navigateTo({ url: '/pages/template-edit/template-edit?id=' + id })
    }
  },

  /* ===== 管理模式操作 ===== */

  /** 复制内置模板为我用 */
  onCopyTemplate(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/template-edit/template-edit?from=' + id })
  },

  /** 编辑我的模板 */
  onEditTemplate(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/template-edit/template-edit?id=' + id })
  },

  /** 删除我的模板（内置不可删） */
  onDeleteTemplate(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const tpl = this.data.templates.find(t => t.id === id)
    if (!tpl || tpl.isBuiltIn) return
    wx.showModal({
      title: '删除这个模板？',
      content: `「${tpl.name}」将被永久删除`,
      confirmText: '删除',
      confirmColor: designTokens.color.danger,
      success: res => {
        if (!res.confirm) return
        deleteTemplate(id)
        this.refresh()
        wx.showToast({ title: '已删除', icon: 'none' })
      },
    })
  },

  /** 新建空白模板 */
  onCreateBlank() {
    wx.navigateTo({ url: '/pages/template-edit/template-edit?mode=new' })
  },

  onBack() {
    wx.navigateBack()
  },

  onShareAppMessage() {
    return {
      title: '阅观年度 — 把成就做成一份报告',
      path: '/pages/index/index',
    }
  },
})
