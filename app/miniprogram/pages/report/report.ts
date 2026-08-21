// pages/report/report.ts
// 报告组装器：选成就（多选）→ 填标题选模板 → 生成报告进入编辑器
// 成就系统主轴下：可选任意分类的成就做成报告；阅读报告与成就报告模板并存，用户自由选。

import { Item, ReportTemplate, loadAllAchievements, loadTemplate, saveReport } from '../../utils/storage'
import { generateReport } from '../../utils/template-engine'
import { parseImportedText } from '../../utils/report-import'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { normalizeKeyword } from '../../utils/search'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

const PENDING_TEMPLATE_KEY = 'pending_template_id'

interface BookPick extends Item {
  picked: boolean
  categoryIcon: string
  categoryColor: string
  categoryLabel: string
  metaText: string
  ratingText: string
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    mode: 'records' as 'records' | 'import',  // P5 顶部 Tab：从记录生成 / 从文案导入
    step: 1 as 1 | 2 | 3,    // 1=选成就 2=填标题选模板 3=生成中
    books: [] as BookPick[],            // 全部已完成成就（选书器数据源）
    filteredBooks: [] as BookPick[],    // 按搜索词过滤后的视图（wxml 遍历这个）
    searchKey: '',                      // 选书器搜索词（匹配标题/作者/类型/分类名）
    pickedCount: 0,
    reportTitle: '',
    selectedTemplateId: '',
    selectedTemplateName: '',
    year: new Date().getFullYear(),
    // P5 导入模式
    importTitle: '',        // 导入报告的标题
    importText: '',         // 用户粘贴的文案
    importChunkCount: 0,    // 预估切出的卡片段数（给「将生成 N 张卡」提示用）
  },

  onLoad(options: { mode?: string }) {
    applyThemeToPage(this)
    // 首页「文案海报」入口带 mode=import 直达文案导入标签；其它入口不带则默认 records
    if (options && options.mode === 'import') {
      this.setData({ mode: 'import' })
    }
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    // 检查是否从模板页带回了选择（pending_template_id 是页面间握手，不走脏标记通道）
    const pendingId = wx.getStorageSync(PENDING_TEMPLATE_KEY) as string
    if (pendingId) {
      wx.removeStorageSync(PENDING_TEMPLATE_KEY)
      const tpl = loadTemplate(pendingId)
      if (tpl) {
        this.setData({
          selectedTemplateId: pendingId,
          selectedTemplateName: tpl.name,
        })
      }
    }
    // 成就有变动才重算选书器（不变则保留当前 picked 状态，避免每次 onShow 把选中态丢失）
    const watched: DirtyField[] = ['achievements']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  refresh() {
    const prevPicks = this.data.books
    // 报告选书器只列「已完成」的成就：报告是回顾完成阅读的产物，
    // 在读/搁置的书（rating 可能为 0、finishedDate 是开读日）不该入选（会污染报告的平均分/时间跨度）。
    const all = loadAllAchievements()
    const books: BookPick[] = all.map(it => {
      const prev = prevPicks.find(b => b.id === it.id)
      const cat = resolveCategory(it.category, it.type)
      const meta = getCategoryMeta(cat)
      const metaParts: string[] = []
      if (it.author) metaParts.push(it.author)
      if (it.genre) metaParts.push(it.genre)
      if (it.readingPlace) metaParts.push('📍 ' + it.readingPlace)
      return {
        ...it,
        picked: prev ? prev.picked : false,
        categoryIcon: meta.icon,
        categoryColor: meta.color,
        categoryLabel: meta.label,
        metaText: metaParts.join(' · '),
        ratingText: it.rating > 0 ? it.rating.toFixed(1) : '',
      }
    })
    this.setData({
      books,
      pickedCount: books.filter(b => b.picked).length,
    })
    this.applySearch()
  },

  /** 按当前 searchKey 过滤 books → filteredBooks。
   *  匹配范围：标题 / 作者 / 类型 / 分类名（metaText 已含作者·类型·地点，直接复用）。
   *  空关键词 → 全量；picked 状态始终保留（搜索不应丢选中）。 */
  applySearch() {
    const kw = normalizeKeyword(this.data.searchKey)
    const books = this.data.books
    const filtered = kw
      ? books.filter(b => {
          const hay = (b.title + ' ' + b.author + ' ' + b.genre + ' ' + b.categoryLabel + ' ' + (b.metaText || '')).toLowerCase()
          return hay.indexOf(kw) >= 0
        })
      : books.slice()
    this.setData({ filteredBooks: filtered })
  },

  onSearchInput(e: WechatMiniprogram.Input) {
    this.setData({ searchKey: e.detail.value })
    this.applySearch()
  },

  onClearSearch() {
    this.setData({ searchKey: '' })
    this.applySearch()
  },

  /* === Step 1: 选成就 === */

  onTogglePick(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const books = this.data.books.map(b =>
      b.id === id ? { ...b, picked: !b.picked } : b
    )
    this.setData({
      books,
      pickedCount: books.filter(b => b.picked).length,
    })
    this.applySearch()
  },

  /** 全选/全不选：只作用于当前过滤结果（搜索时只选可见的，符合直觉）。 */
  onPickAll() {
    const filteredIds = new Set(this.data.filteredBooks.map(b => b.id))
    const allFilteredPicked = this.data.filteredBooks.length > 0 && this.data.filteredBooks.every(b => b.picked)
    const books = this.data.books.map(b =>
      filteredIds.has(b.id) ? { ...b, picked: !allFilteredPicked } : b
    )
    this.setData({
      books,
      pickedCount: books.filter(b => b.picked).length,
    })
    this.applySearch()
  },

  onNextToStep2() {
    if (this.data.pickedCount === 0) {
      wx.showToast({ title: '请至少选一个成就', icon: 'none' })
      return
    }
    // 默认标题：若选的都是阅读成就则用「读书报告」，否则「成就报告」
    const picked = this.data.books.filter(b => b.picked)
    const allReading = picked.every(b => resolveCategory(b.category, b.type) === 'reading')
    const defaultTitle = this.data.reportTitle ||
      (allReading ? `${this.data.year} 我的读书报告` : `${this.data.year} 我的成就报告`)
    this.setData({ step: 2, reportTitle: defaultTitle })
  },

  /* === Step 2: 填标题 + 选模板 === */

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ reportTitle: e.detail.value })
  },

  onTapChooseTemplate() {
    // 把当前页面状态存一下，让 templates 页选中后能回来
    wx.navigateTo({ url: '/pages/templates/templates?from=report' })
  },

  /* === 生成 === */

  /* === P5 模式 Tab 切换 + 文案导入 === */

  onSwitchMode(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as 'records' | 'import'
    this.setData({ mode })
  },

  onImportTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ importTitle: e.detail.value })
  },

  /** 文案输入：实时预估切出的卡片段数（给用户即时反馈「将生成 N 张卡」）。 */
  onImportTextInput(e: WechatMiniprogram.TextareaInput) {
    const text = e.detail.value || ''
    const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    const chunks = clean.length > 0 ? clean.split(/\n{2,}/).filter(s => s.trim().length > 0) : []
    // +2 是 cover 卡 + ending 卡
    this.setData({ importText: text, importChunkCount: chunks.length })
  },

  /** 清空导入框。 */
  onClearImport() {
    this.setData({ importText: '', importChunkCount: 0 })
  },

  /** 从文案生成报告：粗排 → saveReport → 跳 report-edit。 */
  onGenerateFromImport() {
    const text = this.data.importText.trim()
    if (!text) {
      wx.showToast({ title: '请先粘贴文案', icon: 'none' })
      return
    }
    const title = this.data.importTitle.trim() || '我的报告'
    this.setData({ step: 3 })
    setTimeout(() => {
      const report = parseImportedText(text, title)
      saveReport(report)
      wx.redirectTo({
        url: '/pages/report-edit/report-edit?id=' + report.id,
      })
    }, 300)
  },

  onGenerate() {
    const { selectedTemplateId, books, reportTitle, year } = this.data
    if (!selectedTemplateId) {
      wx.showToast({ title: '请先选择模板', icon: 'none' })
      return
    }
    const template = loadTemplate(selectedTemplateId) as ReportTemplate
    const pickedBooks: Item[] = books.filter(b => b.picked).map(b => {
      const { picked, categoryIcon, categoryColor, categoryLabel, metaText, ratingText, ...rest } = b
      return rest
    })

    this.setData({ step: 3 })

    setTimeout(() => {
      const report = generateReport(template, pickedBooks, reportTitle.trim(), year)
      saveReport(report)
      wx.redirectTo({
        url: '/pages/report-edit/report-edit?id=' + report.id,
      })
    }, 300)
  },

  onBack() {
    if (this.data.step === 2) {
      this.setData({ step: 1 })
    } else if (this.data.step === 3) {
      this.setData({ step: 2 })
    } else {
      wx.navigateBack()
    }
  },

  onShareAppMessage() {
    return {
      title: '阅观年度 — 把成就做成一份报告',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    return {
      title: '把成就做成一份报告 · 阅观年度',
    }
  },
})
