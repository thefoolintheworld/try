// pages/template-edit/template-edit.ts
// 模板编辑器：编辑模板元信息 + 卡片定义（标题模板、正文模板）
// 三种入口：
//   id=<模板id>      编辑现有（内置只读）
//   from=<模板id>    复制现有新建
//   mode=new         空白新建

import {
  ReportTemplate,
  TemplateCardDef,
  CardType,
  loadTemplate,
  saveTemplate,
} from '../../utils/storage'
import { genId } from '../../utils/util'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'

const CARD_TYPE_LABELS: Record<CardType, string> = {
  cover: '封面',
  overview: '总览',
  footprint: '足迹',
  favorite: '年度之书',
  theme: '主题',
  quote: '金句',
  journey: '旅程',
  ending: '落款',
}

/** 卡片默认模板文案（新建卡片时） */
function defaultCardDef(type: CardType): TemplateCardDef {
  switch (type) {
    case 'cover':
      return { type, titleTemplate: '{reportTitle}', contentTemplate: '{year}\n这一年，与书相遇' }
    case 'overview':
      return { type, titleTemplate: '这一年', contentTemplate: '这一年，你读了 {bookCount} 本书。' }
    case 'footprint':
      return { type, titleTemplate: '阅读的足迹', contentTemplate: '你的阅读足迹，遍布 {places}。' }
    case 'favorite':
      return { type, titleTemplate: '年度之书', contentTemplate: '若只能选一本，那便是《{topBook}》。' }
    case 'theme':
      return { type, titleTemplate: '一场漫长的跋涉', contentTemplate: '这一年，你在 {themeGenre} 中跋涉。' }
    case 'quote':
      return { type, titleTemplate: '字里行间', contentTemplate: '「{quote1}」\n—— 《{quoteBook1}》' }
    case 'journey':
      return { type, titleTemplate: '在路上', contentTemplate: '你在 {place1}，翻开过《{book1}》。' }
    case 'ending':
      return { type, titleTemplate: '', contentTemplate: '愿你今后的旅程，永远有书相伴。' }
  }
}

interface EditableCardDef extends TemplateCardDef {
  _key: string
  typeLabel: string  // 中文标签，供 wxml 直接显示
}

function toEditableCard(def: TemplateCardDef): EditableCardDef {
  return { ...def, _key: genId(), typeLabel: CARD_TYPE_LABELS[def.type] }
}

/** 可用的占位符清单（提示用户）—— 已包成 {varName} 显示字符串
 *  含两套变量：书目变量（阅读报告用）+ 成就变量（成就报告用），模板可自由混用。 */
const AVAILABLE_VARS: string[] = [
  // 报告元信息
  'reportTitle', 'year',
  // 书目变量（阅读报告模板用）
  'bookCount', 'avgRating', 'topGenre',
  'places', 'topPlace', 'topPlaceCount',
  'topBook', 'topBookNote', 'topBookAuthor',
  'themeGenre', 'themeBook', 'themeSentence',
  'place1', 'book1', 'place2', 'book2',
  'quote1', 'quoteBook1', 'quote2', 'quoteBook2',
  // 成就变量（成就报告模板用）
  'achievementCount', 'categoryCount',
  'topCategory', 'topCategoryCount', 'topCategoryIcon', 'categoryList',
  'firstTimeCount', 'readingCount', 'filmCount', 'otherCount',
  'dateSpan', 'milestone1', 'milestone1Note', 'milestone2', 'milestone3',
  'recentAchievement',
].map(name => `{${name}}`)

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    // 模板状态
    template: null as ReportTemplate | null,
    isReadOnly: false,       // 内置模板只读
    isNew: false,            // 新建模式
    // 编辑中的字段
    name: '',
    description: '',
    cards: [] as EditableCardDef[],
    // UI 状态
    showAddSheet: false,
    showVarSheet: false,
    cardTypeLabels: (Object.keys(CARD_TYPE_LABELS) as CardType[]).map(t => ({
      type: t,
      label: CARD_TYPE_LABELS[t],
    })),
    availableVars: AVAILABLE_VARS,
    activeCardIndex: -1,     // 当前在查看哪张卡的变量提示
  },

  onLoad(options: Record<string, string>) {
    applyThemeToPage(this)
    if (options.id) {
      // 编辑现有
      const tpl = loadTemplate(options.id)
      if (tpl) {
        this.setData({
          template: tpl,
          isReadOnly: tpl.isBuiltIn,
          name: tpl.name,
          description: tpl.description,
          cards: tpl.cards.map(toEditableCard),
        })
        return
      }
    } else if (options.from) {
      // 复制新建
      const src = loadTemplate(options.from)
      if (src) {
        this.setData({
          isNew: true,
          name: src.name + '（副本）',
          description: src.description,
          cards: src.cards.map(toEditableCard),
        })
        return
      }
    } else if (options.mode === 'new') {
      // 空白新建
      this.setData({
        isNew: true,
        name: '我的模板',
        description: '点击编辑描述',
        cards: [toEditableCard(defaultCardDef('cover'))],
      })
      return
    }
    wx.showToast({ title: '参数错误', icon: 'none' })
  },

  /* ===== 模板元信息编辑 ===== */

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value })
  },

  onDescInput(e: WechatMiniprogram.Input) {
    this.setData({ description: e.detail.value })
  },

  /* ===== 卡片定义编辑 ===== */

  onCardTitleInput(e: WechatMiniprogram.Input) {
    if (this.data.isReadOnly) return
    const index = Number(e.currentTarget.dataset.index)
    const value = e.detail.value
    const cards = this.data.cards.slice()
    cards[index] = { ...cards[index], titleTemplate: value }
    this.setData({ cards })
  },

  onCardContentInput(e: WechatMiniprogram.Input) {
    if (this.data.isReadOnly) return
    const index = Number(e.currentTarget.dataset.index)
    const value = e.detail.value
    const cards = this.data.cards.slice()
    cards[index] = { ...cards[index], contentTemplate: value }
    this.setData({ cards })
  },

  /* ===== 删除卡片 ===== */

  onDeleteCard(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isReadOnly) return
    const index = Number(e.currentTarget.dataset.index)
    if (this.data.cards.length <= 1) {
      wx.showToast({ title: '至少保留一张卡片', icon: 'none' })
      return
    }
    const cards = this.data.cards.slice()
    cards.splice(index, 1)
    this.setData({ cards })
  },

  /* ===== 移动卡片顺序 ===== */

  onMoveUp(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isReadOnly) return
    const index = Number(e.currentTarget.dataset.index)
    if (index <= 0) return
    this.swap(index, index - 1)
  },

  onMoveDown(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isReadOnly) return
    const index = Number(e.currentTarget.dataset.index)
    if (index >= this.data.cards.length - 1) return
    this.swap(index, index + 1)
  },

  swap(i: number, j: number) {
    const cards = this.data.cards.slice()
    const tmp = cards[i]
    cards[i] = cards[j]
    cards[j] = tmp
    this.setData({ cards })
  },

  /* ===== 添加卡片 ===== */

  onOpenAddSheet() {
    if (this.data.isReadOnly) return
    this.setData({ showAddSheet: true })
  },

  onCloseAddSheet() {
    this.setData({ showAddSheet: false })
  },

  onAddCardByType(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isReadOnly) return
    const type = e.currentTarget.dataset.type as CardType
    const cards = this.data.cards.slice()
    cards.push(toEditableCard(defaultCardDef(type)))
    this.setData({ cards, showAddSheet: false })
  },

  /* ===== 变量提示 ===== */

  onShowVars(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ showVarSheet: true, activeCardIndex: index })
  },

  onCloseVars() {
    this.setData({ showVarSheet: false })
  },

  /** 点击变量 → 插入到当前卡片的正文末尾（简化交互）
   *  dataset.var 已经是 "{varName}" 形式，直接拼接
   */
  onInsertVar(e: WechatMiniprogram.TouchEvent) {
    if (this.data.isReadOnly) return
    const v = e.currentTarget.dataset.var as string  // 形如 "{bookCount}"
    const index = this.data.activeCardIndex
    if (index < 0) return
    const cards = this.data.cards.slice()
    cards[index] = {
      ...cards[index],
      contentTemplate: cards[index].contentTemplate + v,
    }
    this.setData({ cards, showVarSheet: false })
  },

  /* ===== 保存 ===== */

  onSave() {
    if (this.data.isReadOnly) {
      // 内置模板只读时，保存按钮其实是"返回"
      wx.navigateBack()
      return
    }
    const name = this.data.name.trim()
    if (!name) {
      wx.showToast({ title: '请填模板名', icon: 'none' })
      return
    }
    if (this.data.cards.length === 0) {
      wx.showToast({ title: '至少一张卡片', icon: 'none' })
      return
    }

    const cleanCards: TemplateCardDef[] = this.data.cards.map(c => ({
      type: c.type,
      titleTemplate: c.titleTemplate,
      contentTemplate: c.contentTemplate,
    }))

    let template: ReportTemplate
    if (this.data.template && !this.data.isNew) {
      // 编辑现有（非内置）
      template = {
        ...this.data.template,
        name,
        description: this.data.description.trim(),
        cards: cleanCards,
        isBuiltIn: false,
      }
    } else {
      // 新建（空白或复制）
      template = {
        id: genId(),
        name,
        description: this.data.description.trim(),
        isBuiltIn: false,
        cards: cleanCards,
      }
    }

    saveTemplate(template)
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
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
