// pages/wishlist/wishlist.ts
// 许愿星：独立存储的愿望清单，与成就墙完全隔离。
// 愿望 → 成就的转化由 edit 页承担（带 wishId 参数跳过去），本页只管愿望自身的 CRUD。
// P2-B：支持自定义分类（＋新建分类入口），分类存进 preferences.customWishCategories。

import { Wish, loadWishes, addWish, updateWish, deleteWish } from '../../utils/storage'
import {
  PRESET_CATEGORIES,
  resolveCategory,
  getAllCategoriesWithCustom,
  findCategoryWithCustom,
} from '../../utils/category-meta'
import { loadPreferences, updatePreferences } from '../../utils/preferences'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { formatDate } from '../../utils/util'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

interface CategoryOption {
  id: string
  label: string
  icon: string
}

interface WishView {
  id: string
  title: string
  categoryLabel: string
  categoryIcon: string
  categoryColor: string
  metaText: string
  note: string
  createdAtText: string
  done: boolean           // achievementId 非空表示已完成
}

/** 新建分类可选 emoji（许愿星偏「向往」语义，词表与灵感略不同） */
const CATEGORY_ICON_CHOICES = ['🏆', '📖', '🎬', '🎯', '🎮', '✈️', '📝', '🌟', '🎨', '🧩', '🔮', '🗺️']

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    wishes: [] as WishView[],            // 全部（判定空状态用）
    filteredWishes: [] as WishView[],    // 实际渲染的列表（按 showDone 过滤）
    doneCount: 0,                        // 已达成愿望数（开关文案 + 空态判定用）
    showDone: false,                     // 是否展示已达成愿望（默认隐藏，点开关切换）
    categoryOptions: [] as CategoryOption[],

    // 顶部添加行临时态
    addTitle: '',
    addCategory: 'reading' as string,

    // 编辑 sheet 临时态
    showEditSheet: false,
    editingId: '' as string,
    editTitle: '',
    editNote: '',
    editCategory: 'reading' as string,

    // 新建分类 sheet 临时态（P2-B）
    showNewCatSheet: false,
    newCatLabel: '',
    newCatIcon: CATEGORY_ICON_CHOICES[0],
    categoryIconChoices: CATEGORY_ICON_CHOICES,
  },

  onLoad() {
    applyThemeToPage(this)
    this.rebuildCategoryOptions()
    // 首次进入无条件加载一次：脏标记纯内存（见 data-dirty.ts），App 重启后清空，
    // 若不在 onLoad 刷新，重启后首次进入 onShow 会因无脏标记早 return，列表停留在初始空数组。
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    const watched: DirtyField[] = ['wishes', 'achievements', 'preferences']
    if (!anyDirty(watched)) return
    if (isDirty('preferences')) this.rebuildCategoryOptions()
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  /** 切换「显示已达成」开关：重算过滤视图。 */
  onToggleShowDone() {
    this.setData({ showDone: !this.data.showDone })
    this.applyFilter()
  },

  /** 读偏好里的自定义愿望分类，与预设合并，刷新 categoryOptions。 */
  rebuildCategoryOptions() {
    const prefs = loadPreferences()
    const all = getAllCategoriesWithCustom(prefs.customWishCategories || [])
    const categoryOptions: CategoryOption[] = all.map(c => ({
      id: c.id, label: c.label, icon: c.icon,
    }))
    this.setData({ categoryOptions })
  },

  refresh() {
    const prefs = loadPreferences()
    const customCats = prefs.customWishCategories || []
    const all = loadWishes()
    const views: WishView[] = all.map(w => this.toView(w, customCats))
    this.setData({ wishes: views, doneCount: views.filter(w => w.done).length })
    this.applyFilter()
  },

  /** 按 showDone 过滤出 filteredWishes。
   *  - showDone=false：只渲染未达成（pending）；已达成隐藏（但仍计入 doneCount 供开关文案）
   *  - showDone=true：渲染全部（未达成在前、已达成在后），已达成之间加分隔感由 wxml 样式承担 */
  applyFilter() {
    const all = this.data.wishes
    const filtered = this.data.showDone
      ? [...all.filter(w => !w.done), ...all.filter(w => w.done)]
      : all.filter(w => !w.done)
    this.setData({ filteredWishes: filtered })
  },

  /** 把 Wish 转成渲染视图（补分类元信息 + 元信息行） */
  toView(w: Wish, customCats: { id: string; label: string; icon: string }[]): WishView {
    const cat = resolveCategory(w.category)
    const meta = findCategoryWithCustom(cat, customCats)
    const parts: string[] = []
    if (w.author) parts.push(w.author)
    if (w.genre) parts.push(w.genre)
    return {
      id: w.id,
      title: w.title,
      categoryLabel: meta.label,
      categoryIcon: meta.icon,
      categoryColor: meta.color,
      metaText: parts.join(' · '),
      note: w.note || '',
      createdAtText: formatDate(new Date(w.createdAt)),
      done: !!w.achievementId,
    }
  },

  /* === 顶部添加行 === */

  onAddTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ addTitle: e.detail.value })
  },

  onPickAddCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ addCategory: e.currentTarget.dataset.id as string })
  },

  /** 添加愿望：标题必填；分类可选（默认 reading） */
  onAddWish() {
    const title = this.data.addTitle.trim()
    if (!title) {
      wx.showToast({ title: '请填写愿望', icon: 'none' })
      return
    }
    const created = addWish({
      title,
      category: this.data.addCategory,
    })
    if (!created) {
      wx.showToast({ title: '保存失败，存储空间不足', icon: 'none' })
      return
    }
    this.setData({ addTitle: '' })
    this.refresh()
    wx.showToast({ title: '已加入抽屉', icon: 'success' })
  },

  /* === 新建分类 sheet（P2-B）=== */

  onOpenNewCatSheet() {
    this.setData({
      showNewCatSheet: true,
      newCatLabel: '',
      newCatIcon: CATEGORY_ICON_CHOICES[0],
    })
  },

  onNewCatLabelInput(e: WechatMiniprogram.Input) {
    this.setData({ newCatLabel: e.detail.value })
  },

  onPickNewCatIcon(e: WechatMiniprogram.TouchEvent) {
    this.setData({ newCatIcon: e.currentTarget.dataset.icon as string })
  },

  onCloseNewCatSheet() {
    this.setData({ showNewCatSheet: false })
  },

  /** 确认新建分类：label 必填（≤8 字）；id 用时间戳 + 随机串做稳定唯一 id；
   *  写入 preferences.customWishCategories；重建选项；把添加/编辑行当前分类切到新分类。 */
  onConfirmNewCat() {
    const label = this.data.newCatLabel.trim()
    if (!label) {
      wx.showToast({ title: '给分类起个名字', icon: 'none' })
      return
    }
    if (label.length > 8) {
      wx.showToast({ title: '名字 ≤8 字', icon: 'none' })
      return
    }
    const prefs = loadPreferences()
    const custom = (prefs.customWishCategories || []).slice()
    const presetIds = new Set(PRESET_CATEGORIES.map(c => c.id))
    const existIds = new Set(custom.map(c => c.id))
    let id = 'wcu_' + Date.now().toString(36)
    while (presetIds.has(id) || existIds.has(id)) {
      id = 'wcu_' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)
    }
    custom.push({ id, label, icon: this.data.newCatIcon })
    updatePreferences({ customWishCategories: custom })
    this.rebuildCategoryOptions()
    this.setData({
      showNewCatSheet: false,
      addCategory: id,
      editCategory: id,
    })
    this.refresh()
    wx.showToast({ title: '已新增分类', icon: 'success' })
  },

  /* === 单条操作 === */

  /** 标记完成：跳 edit 页带 wishId，让用户补全成就字段后保存。
   *  不直接生成成就——因为成就需要评分/日期/情境等用户输入，自动化会产出残缺数据。 */
  onMarkComplete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: '/pages/edit/edit?wishId=' + id })
  },

  /** 编辑：弹出底部 sheet 内联编辑（不跳页，愿望字段少，内联更顺手） */
  onEditWish(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const all = loadWishes()
    const w = all.find(x => x.id === id)
    if (!w) return
    this.setData({
      showEditSheet: true,
      editingId: id,
      editTitle: w.title,
      editNote: w.note || '',
      editCategory: resolveCategory(w.category),
    })
  },

  onEditTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ editTitle: e.detail.value })
  },

  onEditNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ editNote: e.detail.value })
  },

  onPickEditCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ editCategory: e.currentTarget.dataset.id as string })
  },

  onCloseEditSheet() {
    this.setData({ showEditSheet: false, editingId: '' })
  },

  /** 保存编辑：写回 title/note/category；其它字段不动 */
  onSaveEditWish() {
    const id = this.data.editingId
    const title = this.data.editTitle.trim()
    if (!id) return
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    updateWish(id, {
      title,
      note: this.data.editNote.trim(),
      category: this.data.editCategory,
    })
    this.setData({ showEditSheet: false, editingId: '' })
    this.refresh()
    wx.showToast({ title: '已更新', icon: 'success' })
  },

  /** 删除愿望：二次确认。不联动删除关联成就（双向独立）。 */
  onDeleteWish(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.showModal({
      title: '删除愿望？',
      content: '删除后可在 30 天内从回收站恢复',
      success: (res) => {
        if (res.confirm) {
          const ok = deleteWish(id)
          if (!ok) {
            wx.showToast({ title: '删除失败，请重试', icon: 'none' })
            return
          }
          this.refresh()
          wx.showToast({ title: '已删除', icon: 'none' })
        }
      },
    })
  },
})
