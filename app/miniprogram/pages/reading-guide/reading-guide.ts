// pages/reading-guide/reading-guide.ts
// P3-2 共读引导页：选一本书 → 展示推荐问题 → 用户回答写进 Item.understanding。
//
// 设计：
//   - 纯本地「预设问题 + 思考角度」，不涉及用户间交互（合规红线）。
//   - 入参：onLoad options.bookId 指定要引导的书（从 edit 页或 list 页跳入）。
//   - 用户可以把任一问题的回答写进 understanding（复用现有字段，不新增存储）。
//   - 写入用 updateItem(id, { understanding })，与 edit 页同一存储路径。

import { loadById, updateItem } from '../../utils/storage'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { getGuideQuestions, GuideQuestion, GROUP_LABELS } from '../../utils/reading-guide'

/** 问题视图：加一个临时回答输入字段 */
interface QuestionView {
  text: string
  group: GuideQuestion['group']
  groupLabel: string
  hint: string
  answer: string      // 用户当前输入的临时回答
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    bookId: '',
    bookTitle: '',
    bookAuthor: '',
    bookCategoryLabel: '',
    bookMood: '',
    found: false,
    questions: [] as QuestionView[],
    understanding: '',       // 当前书的理解字段（回显 + 拼接写入）
  },

  onLoad(options: Record<string, string>) {
    applyThemeToPage(this)
    const bookId = options.bookId || ''
    if (!bookId) {
      this.setData({ found: false })
      return
    }
    this.refresh(bookId)
  },

  onShow() {
    applyThemeToPage(this)
    if (this.data.bookId) this.refresh(this.data.bookId)
  },

  refresh(bookId: string) {
    const item = loadById(bookId)
    if (!item) {
      this.setData({ found: false, bookId })
      return
    }
    const category = resolveCategory(item.category, item.type)
    const meta = getCategoryMeta(category)
    const mood = item.mood || ''
    const rawQuestions = getGuideQuestions({ category, mood })
    const questions: QuestionView[] = rawQuestions.map(q => ({
      text: q.text,
      group: q.group,
      groupLabel: GROUP_LABELS[q.group],
      hint: q.hint || '',
      answer: '',
    }))
    this.setData({
      bookId,
      bookTitle: item.title,
      bookAuthor: item.author || '',
      bookCategoryLabel: meta.label,
      bookMood: mood,
      found: true,
      questions,
      understanding: item.understanding || '',
    })
  },

  /** 单个问题的回答输入 */
  onAnswerInput(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const answer = e.detail.value
    const questions = this.data.questions.slice()
    questions[index] = { ...questions[index], answer }
    this.setData({ questions })
  },

  /** 把某条回答追加进 understanding（拼成「Q + A」段落），写回存储。
   *  已有 understanding 则在末尾追加，避免覆盖用户既有内容。 */
  onAppendAnswer(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const q = this.data.questions[index]
    if (!q || !q.answer.trim()) {
      wx.showToast({ title: '先写点回答', icon: 'none' })
      return
    }
    const block = '【' + q.text + '】\n' + q.answer.trim()
    const existing = this.data.understanding.trim()
    const next = existing ? (existing + '\n\n' + block) : block
    updateItem(this.data.bookId, { understanding: next })
    // 清空该条回答输入 + 刷新 understanding 回显
    const questions = this.data.questions.slice()
    questions[index] = { ...questions[index], answer: '' }
    this.setData({ questions, understanding: next })
    wx.showToast({ title: '已写入理解', icon: 'success' })
  },

  /** 一键把所有已填回答拼成完整读书笔记，写进 understanding */
  onAppendAll() {
    const filled = this.data.questions.filter(q => q.answer.trim())
    if (filled.length === 0) {
      wx.showToast({ title: '还没有填回答', icon: 'none' })
      return
    }
    const blocks = filled.map(q => '【' + q.text + '】\n' + q.answer.trim())
    const addition = blocks.join('\n\n')
    const existing = this.data.understanding.trim()
    const next = existing ? (existing + '\n\n' + addition) : addition
    updateItem(this.data.bookId, { understanding: next })
    // 清空所有回答输入
    const questions = this.data.questions.map(q => ({ ...q, answer: '' }))
    this.setData({ questions, understanding: next })
    wx.showToast({ title: '已写入 ' + filled.length + ' 条', icon: 'success' })
  },

  onShareAppMessage() {
    const t = this.data.bookTitle || '这本书'
    return {
      title: '共读引导 ·《' + t + '》',
      path: '/pages/index/index',
    }
  },
})
