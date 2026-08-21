// pages/inspiration/inspiration.ts
// 灵感抽屉：自由记录闪念想法（带分类标签 + 自由标签的轻量笔记），独立存储，与成就/愿望隔离。
// 这里只管灵感自身的 CRUD（添加/筛选/编辑/删除），不涉及成就转化。
// P2-A：支持自定义分类（＋新建分类入口）+ tags 自由标签 + 搜索范围扩展（内容/分类名/标签）。

import { loadInspirations, addInspiration, updateInspiration, deleteInspiration, Inspiration } from '../../utils/storage'
import {
  INSPIRATION_CATEGORIES,
  DEFAULT_INSPIRATION_CATEGORY,
  getAllInspirationCategories,
  findInspirationCategory,
} from '../../utils/inspiration-presets'
import { loadPreferences, updatePreferences } from '../../utils/preferences'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { formatDate } from '../../utils/util'
import { normalizeKeyword } from '../../utils/search'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

interface CategoryOption {
  id: string
  label: string
  icon: string
}

/** 分类筛选条用：含「全部」选项 + 每个分类的当前条数 */
interface CategoryFilter extends CategoryOption {
  count: number
}

interface InspirationView {
  id: string
  content: string
  category: string
  categoryLabel: string
  categoryIcon: string
  categoryColor: string
  tags: string[]              // P2-A：标签视图（空数组 = 无标签）
  tagsText: string            // P2-A：标签用空格拼接的纯文本，给搜索匹配用（避免 wxml 里 join）
  createdAtText: string
  createdAtTs: number         // 原始时间戳，给日期范围筛选比较用
}

/** 给分类标签生成柔和背景色（基于分类 id 选一个稳定色，浅底深字）。
 *  预设分类走固定映射；自定义分类用统一中性灰（视觉上不打扰）。 */
const CATEGORY_TINTS: { [id: string]: string } = {
  idea: 'rgba(217, 122, 74, 0.16)',     // 暖橙
  writing: 'rgba(74, 122, 217, 0.16)',  // 静蓝
  memo: 'rgba(74, 160, 100, 0.16)',     // 草绿
  quote: 'rgba(160, 100, 160, 0.16)',   // 雅紫
  thought: 'rgba(160, 140, 74, 0.16)',  // 焦糖
}
const CUSTOM_CATEGORY_TINT = 'rgba(120, 120, 120, 0.14)'

/** 新建分类弹层用的可选 emoji（用户点选其一作为新分类图标） */
const CATEGORY_ICON_CHOICES = ['💡', '✍️', '📌', '📖', '🍃', '🪐', '🎨', '🧩', '🔬', '🔮', '🗺️', '🎯']

/** 标签输入约束：单条 ≤8 字（避免一行标签过长）；每条灵感最多 5 个标签 */
const TAG_MAX_LEN = 8
const TAG_MAX_COUNT = 5

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,

    inspirations: [] as InspirationView[],          // 全部（用于判定空状态 + 入口文案）
    filteredInspirations: [] as InspirationView[],  // 当前筛选下的视图
    categoryOptions: [] as CategoryOption[],        // 添加/编辑用的分类选项（预设 + 自定义）
    categoryFilters: [] as CategoryFilter[],        // 顶部筛选条（含「全部」+ 计数）

    activeCategory: 'all',   // 当前筛选分类；'all' 表示全部

    // 关键词 + 日期范围筛选态
    keyword: '',           // 关键词（trim+小写比较）
    dateFrom: '',          // 起始日期 'YYYY-MM-DD'（空=不筛）
    dateTo: '',            // 截止日期 'YYYY-MM-DD'（空=不筛）

    // 顶部添加行临时态
    addContent: '',
    addCategory: DEFAULT_INSPIRATION_CATEGORY,
    addTags: [] as string[],       // P2-A：添加行的标签暂存
    addTagInput: '',               // P2-A：标签输入框当前值

    // 编辑 sheet 临时态
    showEditSheet: false,
    editingId: '',
    editContent: '',
    editCategory: DEFAULT_INSPIRATION_CATEGORY,
    editTags: [] as string[],      // P2-A：编辑行标签暂存
    editTagInput: '',              // P2-A：编辑标签输入框当前值

    // 新建分类 sheet 临时态（P2-A）
    showNewCatSheet: false,
    newCatLabel: '',
    newCatIcon: CATEGORY_ICON_CHOICES[0],
    categoryIconChoices: CATEGORY_ICON_CHOICES,
  },

  onLoad() {
    applyThemeToPage(this)
    this.rebuildCategoryOptions()
    // 首次进入无条件加载一次：脏标记纯内存（见 data-dirty.ts），App 重启后清空，
    // 若不在 onLoad 刷新，重启后首次进入 onShow 会因无脏标记早 return，列表停留在初始空数组
    // （这正是「外面显示 1 条、里面 0 条」bug 的根因）。
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    const watched: DirtyField[] = ['inspirations', 'preferences']
    if (!anyDirty(watched)) return
    // 偏好若脏（例如别处改了自定义分类）先重建选项；inspirations 脏走 refresh
    if (isDirty('preferences')) this.rebuildCategoryOptions()
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  /** 读偏好里的自定义分类，与预设合并，刷新 categoryOptions。 */
  rebuildCategoryOptions() {
    const prefs = loadPreferences()
    const all = getAllInspirationCategories(prefs.customInspirationCategories)
    const categoryOptions: CategoryOption[] = all.map(c => ({
      id: c.id, label: c.label, icon: c.icon,
    }))
    this.setData({ categoryOptions })
  },

  refresh() {
    const prefs = loadPreferences()
    const customCats = prefs.customInspirationCategories || []
    const all = loadInspirations()
    const views: InspirationView[] = all.map(it => this.toView(it, customCats))
    const categoryFilters = this.buildCategoryFilters(views, customCats)
    const filtered = this.applyAllFilters(views, {
      category: this.data.activeCategory,
      keyword: this.data.keyword,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
    })
    this.setData({
      inspirations: views,
      categoryFilters,
      filteredInspirations: filtered,
    })
  },

  /** 把 Inspiration 转成渲染视图（补分类元信息 + 日期文案 + 标签色 + 标签文本） */
  toView(it: Inspiration, customCats: { id: string; label: string; icon: string }[]): InspirationView {
    const meta = findInspirationCategory(it.category || DEFAULT_INSPIRATION_CATEGORY, customCats)
    const isPreset = INSPIRATION_CATEGORIES.some(c => c.id === meta.id)
    const tint = isPreset ? (CATEGORY_TINTS[meta.id] || CUSTOM_CATEGORY_TINT) : CUSTOM_CATEGORY_TINT
    const tags = (it.tags || []).filter(t => typeof t === 'string' && t.length > 0)
    return {
      id: it.id,
      content: it.content,
      category: meta.id,
      categoryLabel: meta.label,
      categoryIcon: meta.icon,
      categoryColor: tint,
      tags,
      tagsText: tags.join(' '),
      createdAtText: formatDate(new Date(it.createdAt)),
      createdAtTs: it.createdAt,
    }
  },

  /** 顶部筛选条：「全部」+ 各分类（预设 + 自定义，带计数） */
  buildCategoryFilters(views: InspirationView[], customCats: { id: string; label: string; icon: string }[]): CategoryFilter[] {
    const counts: { [id: string]: number } = { all: views.length }
    for (const v of views) {
      counts[v.category] = (counts[v.category] || 0) + 1
    }
    const filters: CategoryFilter[] = [
      { id: 'all', label: '全部', icon: '✦', count: counts.all },
    ]
    const allCats = getAllInspirationCategories(customCats)
    for (const c of allCats) {
      filters.push({
        id: c.id, label: c.label, icon: c.icon,
        count: counts[c.id] || 0,
      })
    }
    return filters
  },

  /** 多条件过滤（AND 组合）：分类 + 关键词（内容/分类名/标签）+ 日期范围。
   *  - 分类：'all' 表示不筛
   *  - 关键词：normalizeKeyword 后子串匹配 content / categoryLabel / 任一 tag（空关键词不筛）
   *  - 日期范围：[dateFrom, dateTo] 闭区间，比较 YYYY-MM-DD；空端不筛 */
  applyAllFilters(views: InspirationView[], opts: {
    category: string
    keyword: string
    dateFrom: string
    dateTo: string
  }): InspirationView[] {
    const kw = normalizeKeyword(opts.keyword)
    const from = opts.dateFrom
    const to = opts.dateTo
    return views.filter(v => {
      if (opts.category !== 'all' && v.category !== opts.category) return false
      if (kw) {
        const hay = (v.content + ' ' + v.categoryLabel + ' ' + v.tagsText).toLowerCase()
        if (hay.indexOf(kw) < 0) return false
      }
      if (from || to) {
        const d = formatDate(new Date(v.createdAtTs))   // 'YYYY-MM-DD'
        if (from && d < from) return false
        if (to && d > to) return false
      }
      return true
    })
  },

  /* === 顶部筛选条 === */

  /** 用当前 data 里的所有筛选态重跑过滤（关键词/日期/分类任一变化后调） */
  applyFiltersFromData(extra?: Partial<{ activeCategory: string; keyword: string; dateFrom: string; dateTo: string }>) {
    const next = {
      activeCategory: extra && extra.activeCategory !== undefined ? extra.activeCategory : this.data.activeCategory,
      keyword: extra && extra.keyword !== undefined ? extra.keyword : this.data.keyword,
      dateFrom: extra && extra.dateFrom !== undefined ? extra.dateFrom : this.data.dateFrom,
      dateTo: extra && extra.dateTo !== undefined ? extra.dateTo : this.data.dateTo,
    }
    const filtered = this.applyAllFilters(this.data.inspirations, {
      category: next.activeCategory,
      keyword: next.keyword,
      dateFrom: next.dateFrom,
      dateTo: next.dateTo,
    })
    this.setData({
      activeCategory: next.activeCategory,
      keyword: next.keyword,
      dateFrom: next.dateFrom,
      dateTo: next.dateTo,
      filteredInspirations: filtered,
    })
  },

  onSwitchCategory(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    this.applyFiltersFromData({ activeCategory: id })
  },

  /* === 关键词 + 日期范围筛选 === */

  onKeywordInput(e: WechatMiniprogram.Input) {
    this.applyFiltersFromData({ keyword: e.detail.value })
  },

  onClearKeyword() {
    this.applyFiltersFromData({ keyword: '' })
  },

  onPickDateFrom(e: WechatMiniprogram.PickerChange) {
    this.applyFiltersFromData({ dateFrom: String(e.detail.value) })
  },

  onPickDateTo(e: WechatMiniprogram.PickerChange) {
    this.applyFiltersFromData({ dateTo: String(e.detail.value) })
  },

  onClearDateFilters() {
    this.applyFiltersFromData({ dateFrom: '', dateTo: '' })
  },

  /* === 顶部添加行 === */

  onAddContentInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ addContent: e.detail.value })
  },

  onPickAddCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ addCategory: e.currentTarget.dataset.id as string })
  },

  /* === 添加行：标签输入（P2-A）=== */

  onAddTagInput(e: WechatMiniprogram.Input) {
    this.setData({ addTagInput: e.detail.value })
  },

  /** 提交一个标签到添加行暂存：回车或点「+」触发。
   *  规则：trim 后非空、≤8 字、≤5 个、去重（大小写敏感）。超限给 toast 提示。 */
  onAddTagConfirm() {
    const raw = this.data.addTagInput.trim()
    if (!raw) return
    if (raw.length > TAG_MAX_LEN) {
      wx.showToast({ title: `单个标签 ≤${TAG_MAX_LEN} 字`, icon: 'none' })
      return
    }
    const cur = this.data.addTags
    if (cur.length >= TAG_MAX_COUNT) {
      wx.showToast({ title: `最多 ${TAG_MAX_COUNT} 个标签`, icon: 'none' })
      return
    }
    if (cur.indexOf(raw) >= 0) {
      this.setData({ addTagInput: '' })
      return
    }
    this.setData({ addTags: [...cur, raw], addTagInput: '' })
  },

  /** 删除添加行某个已暂存标签 */
  onRemoveAddTag(e: WechatMiniprogram.TouchEvent) {
    const tag = e.currentTarget.dataset.tag as string
    this.setData({ addTags: this.data.addTags.filter(t => t !== tag) })
  },

  /** 添加灵感：内容必填（≤500 字由 maxlength 限制）；分类默认 idea；标签可选 */
  onAddInspiration() {
    const content = this.data.addContent.trim()
    if (!content) {
      wx.showToast({ title: '写点什么吧', icon: 'none' })
      return
    }
    const tags = this.data.addTags.slice()
    const created = addInspiration({
      content,
      category: this.data.addCategory,
      tags: tags.length > 0 ? tags : undefined,
    })
    if (!created) {
      wx.showToast({ title: '保存失败，存储空间不足', icon: 'none' })
      return
    }
    this.setData({ addContent: '', addTags: [], addTagInput: '' })
    this.refresh()
    wx.showToast({ title: '已记下', icon: 'success' })
  },

  /* === 新建分类 sheet（P2-A）=== */

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

  /** 确认新建分类：label 必填（≤8 字）；id 用 label 拼音不可能稳定，直接用时间戳 + 随机串做稳定唯一 id。
   *  写入 preferences.customInspirationCategories；重建选项；把添加行/编辑行的当前分类切到新分类。 */
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
    const custom = (prefs.customInspirationCategories || []).slice()
    // id 冲突保护：与预设和已有自定义都不可重复
    const presetIds = new Set(INSPIRATION_CATEGORIES.map(c => c.id))
    const existIds = new Set(custom.map(c => c.id))
    let id = 'cus_' + Date.now().toString(36)
    while (presetIds.has(id) || existIds.has(id)) {
      id = 'cus_' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36)
    }
    custom.push({ id, label, icon: this.data.newCatIcon })
    updatePreferences({ customInspirationCategories: custom })
    this.rebuildCategoryOptions()
    this.setData({
      showNewCatSheet: false,
      addCategory: id,
      editCategory: id,
    })
    this.refresh()
    wx.showToast({ title: '已新增分类', icon: 'success' })
  },

  /* === 单条编辑/删除 === */

  /** 编辑：弹出底部 sheet 内联编辑（灵感有内容/分类/标签三个字段，内联顺手） */
  onEditInspiration(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const found = this.data.inspirations.find(v => v.id === id)
    if (!found) return
    this.setData({
      showEditSheet: true,
      editingId: id,
      editContent: found.content,
      editCategory: found.category,
      editTags: found.tags.slice(),
      editTagInput: '',
    })
  },

  onEditContentInput(e: WechatMiniprogram.TextareaInput) {
    this.setData({ editContent: e.detail.value })
  },

  onPickEditCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ editCategory: e.currentTarget.dataset.id as string })
  },

  /* === 编辑行：标签输入（P2-A）=== */

  onEditTagInput(e: WechatMiniprogram.Input) {
    this.setData({ editTagInput: e.detail.value })
  },

  onEditTagConfirm() {
    const raw = this.data.editTagInput.trim()
    if (!raw) return
    if (raw.length > TAG_MAX_LEN) {
      wx.showToast({ title: `单个标签 ≤${TAG_MAX_LEN} 字`, icon: 'none' })
      return
    }
    const cur = this.data.editTags
    if (cur.length >= TAG_MAX_COUNT) {
      wx.showToast({ title: `最多 ${TAG_MAX_COUNT} 个标签`, icon: 'none' })
      return
    }
    if (cur.indexOf(raw) >= 0) {
      this.setData({ editTagInput: '' })
      return
    }
    this.setData({ editTags: [...cur, raw], editTagInput: '' })
  },

  onRemoveEditTag(e: WechatMiniprogram.TouchEvent) {
    const tag = e.currentTarget.dataset.tag as string
    this.setData({ editTags: this.data.editTags.filter(t => t !== tag) })
  },

  onCloseEditSheet() {
    this.setData({ showEditSheet: false, editingId: '' })
  },

  /** 保存编辑：写回 content/category/tags */
  onSaveEditInspiration() {
    const id = this.data.editingId
    const content = this.data.editContent.trim()
    if (!id) return
    if (!content) {
      wx.showToast({ title: '写点什么吧', icon: 'none' })
      return
    }
    const tags = this.data.editTags.slice()
    updateInspiration(id, {
      content,
      category: this.data.editCategory,
      tags: tags.length > 0 ? tags : undefined,
    })
    this.setData({ showEditSheet: false, editingId: '' })
    this.refresh()
    wx.showToast({ title: '已更新', icon: 'success' })
  },

  /** 删除灵感：二次确认 */
  onDeleteInspiration(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    wx.showModal({
      title: '删除这条灵感？',
      content: '删除后可在 30 天内从回收站恢复',
      success: (res) => {
        if (res.confirm) {
          const ok = deleteInspiration(id)
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
