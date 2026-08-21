// pages/edit/edit.ts
// 录入/编辑成就：分类选择 + 多字段表单 + 金句列表
// 成就系统主轴：阅读/观影 与 技能/游戏/旅行/考试/第一次/自定义 平级。
// reading/film 保留作者/类型/评分/阅读情境等丰富字段；其他分类字段简化。

import { ItemType, ItemStatus, loadById, addItem, updateItem, deleteItem, editQuoteTextByIndex, loadWishById, linkWishAchievement, loadCheckinById } from '../../utils/storage'
import { formatDate } from '../../utils/util'
import { PRESET_CATEGORIES, CategoryMeta, getCategoryMeta, isPresetCategory, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { ACHIEVEMENT_PRESETS, presetToCss } from '../../utils/achievement-presets'
import { saveAchievementImage, deleteAchievementImage } from '../../utils/image-store'
import { PRESET_TAG_GROUPS, MOOD_OPTIONS, MOOD_NONE } from '../../utils/tag-presets'
import { pickContextualNotePrompt } from '../../utils/note-prompts'

interface CategoryView extends CategoryMeta {
  active: boolean
}

interface PresetView {
  id: string
  name: string
  css: string
}

/** 从标签数组构建查找表（wxml 用 selectedTagMap[item] 判 chip 选中态，O(1)）*/
function buildTagMap(tags: string[]): { [tag: string]: boolean } {
  const map: { [tag: string]: boolean } = {}
  for (const t of tags) map[t] = true
  return map
}

/** 清理 quoteNotes 孤儿键：只保留 quotes 数组里仍存在的金句正文对应的上下文。
 *  返回值用于 Item.quoteNotes；空对象 → undefined（不写入存储层）。
 *  参数声明为 any 避免循环依赖 storage.ts 的 Item 类型；运行时按结构使用。 */
function pruneQuoteNotes(
  quotes: string[],
  raw: { [quoteText: string]: string } | undefined,
): { [quoteText: string]: string } | undefined {
  if (!raw) return undefined
  const quoteSet = new Set(quotes)
  const out: { [quoteText: string]: string } = {}
  let hasAny = false
  for (const key of Object.keys(raw)) {
    if (quoteSet.has(key) && raw[key]) {
      out[key] = raw[key]
      hasAny = true
    }
  }
  return hasAny ? out : undefined
}

/** 批量粘贴智能切段（T2-3）：把一大段原文切成多条金句候选。
 *  切分规则（按优先级）：
 *    1. 先按换行切段（每非空行一条候选）
 *    2. 若整段没有换行，尝试按中文/英文引号对提取被包裹的句子（「」『』""''）
 *    3. 都没有则整段 trim 作为一条候选
 *  每条 trim 后丢弃空串；保留顺序与重复（用户可能有意录入相同句）。
 *  纯本地文本处理，零合规风险（无 OCR、无外部服务）。 */
function splitBulkQuotes(raw: string): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []

  // 1. 换行切分：任何换行符（\n / \r\n / \r）都算分隔
  if (/[\n\r]/.test(trimmed)) {
    const lines = trimmed.split(/[\r\n]+/)
    const out: string[] = []
    for (const line of lines) {
      const t = line.trim()
      if (t) out.push(t)
    }
    return out
  }

  // 2. 引号提取：匹配成对引号包裹的内容（支持中文「」『』和英文""''）
  //    用全局正则找所有匹配，取捕获组 1（引号内文本）
  const quotePairs = /[「「『"'][^「」『"']{2,}[」」』"']/g
  const matched = trimmed.match(quotePairs)
  if (matched && matched.length >= 2) {
    // 去掉首尾引号字符
    return matched.map(m => m.replace(/^[「「『"']|[」」』"']$/g, '').trim()).filter(Boolean)
  }

  // 3. 兜底：整段一条
  return [trimmed]
}

/**
 * 计算进度百分比字符串（供 UI 实时预览）。无效输入（非数字/分母 0）返回空串。
 * 输入是 input 原生返回的字符串；浮点直接舍掉小数部分取整展示。
 */
function calcProgressPercent(currentStr: string, targetStr: string): string {
  const cur = parseFloat(currentStr)
  const tgt = parseFloat(targetStr)
  if (isNaN(cur) || isNaN(tgt) || tgt <= 0) return ''
  const pct = Math.min(100, Math.max(0, Math.floor(cur / tgt * 100)))
  return String(pct)
}

/** 把打卡分类映射到成就分类：reading/film 直接对应；其它打卡动作（exercise/meditation/other）落到 skill。
 *  成就分类词表偏"完成的事物"，打卡词表偏"每日动作"，需要一个桥接。 */
function mapCheckinCategoryToAchievement(checkinCategory: string): string {
  if (checkinCategory === 'reading' || checkinCategory === 'film') return checkinCategory
  // exercise/meditation/skill/other 都落到 skill（"学会了/坚持了"语义最近）
  return 'skill'
}

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    isEdit: false,
    id: '' as string,
    type: 'book' as ItemType,
    category: 'reading' as string,
    customCategory: '' as string,   // 自定义分类名（仅当 category === '__custom__' 时用）
    title: '',
    author: '',
    genre: '',
    rating: 0 as number,
    finishedDate: '' as string,
    note: '',
    // R1 新增字段（仅 reading/film 用）
    readingPlace: '',
    readingContext: '',
    understanding: '',
    quotes: [] as string[],
    // 金句输入临时值
    quoteInput: '',

    ratingLevels: [1, 2, 3, 4, 5],
    today: '' as string,
    // 分类选择器：预设 + "自定义"
    categoryViews: [] as CategoryView[],
    // 是否为阅读/观影类（决定是否渲染作者/评分/阅读情境区）
    isRichCategory: false,
    // 当前分类的用户可见标签（导航栏标题/按钮文案/日期 label 用）
    categoryLabel: '阅读',
    // 当前分类对应日期字段 label：reading→读完日期 film→观影日期 其他→达成日期
    //   注：会被状态选择进一步细化（选「在读」→「开读于」、选「搁置」→「搁置于」）
    dateLabel: '完成于',
    // === 三态状态机（P1-5）：默认 done；picker 选项固定三项 ===
    status: 'done' as ItemStatus,
    statusOptions: [
      { id: 'reading', label: '在读', dateLabel: '开读于' },
      { id: 'done', label: '完成', dateLabel: '完成于' },
      { id: 'abandoned', label: '搁置', dateLabel: '搁置于' },
    ] as { id: ItemStatus; label: string; dateLabel: string }[],
    statusIndex: 1,   // 默认指向「完成」（与 statusOptions 顺序对齐；picker 的 value 索引）
    // 当前分类对应的标题字段提示（placeholder）
    titlePlaceholder: '书名',
    // 当前分类的 emoji（无图时作为占位符）
    categoryIcon: '📖',

    // === 成就图片相关 ===
    // 图片标识：预设 id / 包内路径 / saveFile 永久路径；空表示无图
    image: '' as string,
    // 图片源类型：none 无图 / preset 预设 / custom 上传 / builtin 包内（预留）
    imageType: 'none' as 'none' | 'preset' | 'custom' | 'builtin',
    // 当前选中预设的 CSS 近似预览（wxml 用 style 渲染，免去实时 canvas）
    presetCss: '',
    // 预设图选择 sheet：是否显示
    showPresetSheet: false,
    // 预设图列表（一次性构造，sheet 里循环渲染）
    presetList: [] as PresetView[],
    // 编辑模式下记录原始图片（用于判断是否要删旧文件）
    originalImage: '' as string,
    originalImageType: 'none' as 'none' | 'preset' | 'custom' | 'builtin',

    // === 情绪与五感标签 ===
    // 已选标签数组（存进 Item.tags；预设词 + 自定义词混在一起）
    tags: [] as string[],
    // 自定义标签输入临时值
    tagInput: '',
    // 预设标签分组（情绪 + 五感），wxml 按分组循环渲染 chip
    presetTagGroups: PRESET_TAG_GROUPS,
    // 已选标签的快速查找表（key=标签词，value=true）；wxml 用 selectedTagMap[item] 判定 chip 选中态
    selectedTagMap: {} as { [tag: string]: boolean },

    // === P3-1 心境单选（Item.mood）===
    // 当前选中的心境（空串 = 未选/无；存进 Item.mood 时空串转 undefined）
    mood: '',
    // 心境候选词（单选 chip 组；来自 tag-presets 的 MOOD_OPTIONS）
    moodOptions: MOOD_OPTIONS,
    // 「无」选项标识（UI 显示用，选中时 mood 清空）
    moodNone: MOOD_NONE,

    // === 金句上下文（Item.quoteNotes）===
    // { 金句正文: 上下文（页码/章节/一句话感想）}；保存时清掉金句已删除的孤儿键
    quoteNotes: {} as { [quoteText: string]: string },
    // 当前正在编辑上下文的金句 index（-1 = 无）；用底部浮层/就地展开输入
    editingQuoteIndex: -1,
    // 上下文输入临时值
    quoteContextInput: '',

    // === 金句正文编辑（T3：补「改金句正文」入口，避免用户只能删了重加丢失注释）===
    // 当前正在改正文的金句 index（-1 = 无）；与 editingQuoteIndex（编辑上下文）互斥
    editingQuoteTextIndex: -1,
    // 正文编辑输入临时值
    quoteTextInput: '',
    // 记录「开始改正文时」的原文，提交时传给 storage.editQuoteText 做 oldText 匹配
    quoteTextOriginal: '',

    // === 批量粘贴摘抄辅助（T2-3）===
    // 是否展开批量录入面板
    showBulkQuote: false,
    // 批量录入的原文 textarea 临时值
    bulkQuoteText: '',
    // 切分预览：候选金句数组（用户确认前先看一眼）
    bulkQuotePreview: [] as string[],
    // 切分预览是否已生成（控制「确认导入」按钮显隐）
    bulkQuoteHasPreview: false,

    // === 目标进度（里程碑）===
    // 是否启用本条进度（开关）；关闭时不写入 Item.progress
    hasProgress: false,
    // 进度数字输入存字符串（input 原生返回 string）；保存时转 number
    progressCurrent: '',
    progressTarget: '',
    // 实时百分比预览（wxml 显示），无效时分母为 0 时为空
    progressPercent: '',

    // === P2-3 短评引导 Prompt ===
    // 笔记框上方随机显示一句轻量提问，帮用户破冰。点 ✨ 换一条；空表示不显示。
    notePrompt: '' as string,

    // === 愿望转化关联 ===
    // 来自哪条愿望（非空表示本次录入是把愿望转成成就）；保存后调 linkWishAchievement 收口双向关联
    wishId: '' as string,
    // === 打卡转化关联 ===
    // 来自哪条打卡（非空表示本次录入是把打卡升级为成就）；与 wishId 互斥。
    // 当前不写回打卡侧（打卡保留原状，用户可在打卡页继续编辑/删除）；此处仅用于预填表单。
    checkinId: '' as string,
  },

  onLoad(options: Record<string, string>) {
    applyThemeToPage(this)
    const today = formatDate(new Date())
    // P2-3/P3：所有入口都随机抽一条短评 prompt。
    //   新建态：category 还没选、mood 为空 → 走通用池（pickContextualNotePrompt 自动兜底）。
    //   编辑态：从 options.id 能提前读到 item 的 category/mood → 首条就贴合语境。
    //   通用兜底永远不返回空。
    let initialCategory = 'reading'
    let initialMood = ''
    if (options.id) {
      const peek = loadById(options.id)
      if (peek) {
        initialCategory = resolveCategory(peek.category, peek.type)
        initialMood = peek.mood || ''
      }
    } else if (options.wishId) {
      const wish = loadWishById(options.wishId)
      if (wish && wish.category) initialCategory = wish.category
    }
    const notePrompt = pickContextualNotePrompt({ category: initialCategory, mood: initialMood })
    // 构造分类选择器：预设列表 + 一个"自定义"占位项
    const categoryViews: CategoryView[] = PRESET_CATEGORIES.map(c => ({ ...c, active: false }))
    categoryViews.push({ id: '__custom__', label: '自定义', icon: '✏️', color: '#8B7D6E', active: false })
    // 预设图列表（一次性，sheet 用 cssPreview 近似缩略，避免实时 canvas 开销）
    const presetList: PresetView[] = ACHIEVEMENT_PRESETS.map(p => ({ id: p.id, name: p.name, css: p.cssPreview }))

    if (options.id) {
      const item = loadById(options.id)
      if (item) {
        const category = resolveCategory(item.category, item.type)
        // 老数据可能是自定义分类（不在预设里）—— 把它作为已激活的自定义项展示
        let customCategory = ''
        let activeCategory = category
        if (!isPresetCategory(category)) {
          customCategory = category
          activeCategory = '__custom__'
        }
        // 回显图片：imageType 缺失时由 image 字段推断（老数据兼容）
        const image = item.image || ''
        const imageType = item.imageType
          || (image ? 'custom' : 'none') as 'none' | 'preset' | 'custom' | 'builtin'
        const presetCss = imageType === 'preset' ? presetToCss(image) : ''
        // 回显标签：从 item.tags 构建已选数组 + 查找表（驱动预设 chip 的选中态）
        const tags = item.tags || []
        const selectedTagMap = buildTagMap(tags)
        // 回显进度：仅当 item.progress 存在且 target>0 时启用，否则默认关闭
        const prog = item.progress
        const hasProgress = !!(prog && prog.target > 0)
        const progressCurrent = hasProgress ? String(prog.current) : ''
        const progressTarget = hasProgress ? String(prog.target) : ''
        const progressPercent = hasProgress ? Math.min(100, Math.round(prog.current / prog.target * 100)) + '' : ''
        // 回显三态状态：老数据无 status 字段 → 默认 done（statusOptions 里的索引 1）
        const status: ItemStatus = item.status || 'done'
        const statusIndex = this.data.statusOptions.findIndex(o => o.id === status)
        this.setData({
          isEdit: true,
          id: item.id,
          type: item.type,
          category: activeCategory,
          customCategory,
          title: item.title,
          author: item.author,
          genre: item.genre,
          rating: item.rating,
          finishedDate: item.finishedDate,
          note: item.note,
          readingPlace: item.readingPlace || '',
          readingContext: item.readingContext || '',
          understanding: item.understanding || '',
          quotes: item.quotes || [],
          quoteNotes: item.quoteNotes || {},
          categoryViews: categoryViews.map(c => ({ ...c, active: c.id === activeCategory })),
          image,
          imageType,
          presetCss,
          presetList,
          originalImage: image,
          originalImageType: imageType,
          tags,
          selectedTagMap,
          mood: item.mood || '',
          hasProgress,
          progressCurrent,
          progressTarget,
          progressPercent,
          status,
          statusIndex,
          notePrompt,
        }, () => this.syncCategoryDerived())
        return
      }
      wx.showToast({ title: '条目不存在', icon: 'none' })
    }
    // 愿望转化模式：从愿望预填字段（title/category/author/genre/note/tags），finishedDate 默认今天。
    // 与 options.id 互斥（id 是编辑既有成就，wishId 是把愿望转成新成就）。
    if (options.wishId) {
      const wish = loadWishById(options.wishId)
      if (wish) {
        // 愿望的 category 可能是预设 id、自定义名、或空；空则回落 reading
        let customCategory = ''
        let activeCategory = resolveCategory(wish.category)
        if (activeCategory && !isPresetCategory(activeCategory)) {
          customCategory = activeCategory
          activeCategory = '__custom__'
        }
        const tags = wish.tags || []
        this.setData({
          wishId: wish.id,
          title: wish.title,
          author: wish.author || '',
          genre: wish.genre || '',
          note: wish.note || '',
          tags,
          selectedTagMap: buildTagMap(tags),
          finishedDate: today,
          today,
          category: activeCategory,
          customCategory,
          categoryViews: categoryViews.map(c => ({ ...c, active: c.id === activeCategory })),
          presetList,
          notePrompt,
        }, () => this.syncCategoryDerived())
        return
      }
      wx.showToast({ title: '愿望不存在', icon: 'none' })
    }
    // 打卡转化模式：从打卡预填字段（category/note→title）；finishedDate 默认打卡日期或今天。
    // 与 options.id / options.wishId 互斥。
    // 第二批功能 3：分类汇总升级入口（传 checkinCategory + title + days + total），
    // 把某分类的累计坚持度预填成一条成就（标题/短评），区别于逐条升级（checkinId）。
    if (options.checkinCategory && !options.id && !options.wishId) {
      const catRaw = decodeURIComponent(options.checkinCategory)
      const titleDefault = options.title ? decodeURIComponent(options.title) : ''
      const days = options.days ? parseInt(options.days, 10) : 0
      const total = options.total ? parseInt(options.total, 10) : 0
      let customCategory = ''
      let activeCategory = mapCheckinCategoryToAchievement(catRaw)
      if (activeCategory && !isPresetCategory(activeCategory)) {
        customCategory = activeCategory
        activeCategory = '__custom__'
      }
      const noteParts: string[] = []
      if (days > 0) noteParts.push('坚持 ' + String(days) + ' 天')
      if (total > 0) noteParts.push('共 ' + String(total) + ' 次')
      const noteText = noteParts.join(' · ')
      this.setData({
        title: titleDefault,
        note: noteText,
        finishedDate: today,
        today,
        category: activeCategory,
        customCategory,
        categoryViews: categoryViews.map(c => ({ ...c, active: c.id === activeCategory })),
        presetList,
        notePrompt,
      }, () => this.syncCategoryDerived())
      return
    }
    if (options.checkinId) {
      // v7：checkinId 是某条打卡的真实 id（打卡页一天多条后必须按 id 查，不再按 date）
      const checkin = loadCheckinById(options.checkinId)
      if (checkin) {
        let customCategory = ''
        let activeCategory = mapCheckinCategoryToAchievement(checkin.category)
        if (activeCategory && !isPresetCategory(activeCategory)) {
          customCategory = activeCategory
          activeCategory = '__custom__'
        }
        const titleGuess = (checkin.note && checkin.note.trim()) ? checkin.note.trim() : ''
        this.setData({
          checkinId: checkin.id,
          title: titleGuess,
          note: checkin.note || '',
          finishedDate: checkin.date,
          today,
          category: activeCategory,
          customCategory,
          categoryViews: categoryViews.map(c => ({ ...c, active: c.id === activeCategory })),
          presetList,
          notePrompt,
        }, () => this.syncCategoryDerived())
        return
      }
      wx.showToast({ title: '打卡记录不存在', icon: 'none' })
    }
    // 新增模式：默认选中 reading
    this.setData({
      finishedDate: today,
      today,
      categoryViews: categoryViews.map(c => ({ ...c, active: c.id === 'reading' })),
      presetList,
      notePrompt,
    }, () => this.syncCategoryDerived())
  },

  /** 根据 data.category / customCategory 同步派生字段（标签/提示/是否富字段）。
   *  dateLabel 由分类决定基础文案（读完于/观影于/达成于），再被三态状态进一步细化：
   *    选「在读」→「开读于」；选「搁置」→「搁置于」；选「完成」→ 用分类基础文案。 */
  syncCategoryDerived() {
    const { category, customCategory, status } = this.data
    // 真实分类 id（用于报告变量/存储）：预设用自身 id；自定义用 customCategory 字符串
    const realCategory = category === '__custom__' ? (customCategory.trim() || '自定义') : category
    const meta = getCategoryMeta(realCategory)
    const isRich = category === 'reading' || category === 'film'
    const categoryDateLabel = category === 'reading' ? '读完于'
      : category === 'film' ? '观影于'
      : '达成于'
    // 状态覆盖：在读/搁置时统一覆盖日期语义（分类基础文案只在「完成」态用）
    const statusOpt = this.data.statusOptions.find(o => o.id === status)
    const dateLabel = statusOpt && status !== 'done' ? statusOpt.dateLabel : categoryDateLabel
    const titlePlaceholder = category === 'reading' ? '书名'
      : category === 'film' ? '电影/剧集名'
      : category === 'game' ? '游戏名'
      : category === 'travel' ? '去了哪里'
      : category === 'exam' ? '考试/证书名'
      : category === 'skill' ? '学会了什么'
      : category === 'first' ? '第一次做什么'
      : '成就标题'
    this.setData({
      isRichCategory: isRich,
      categoryLabel: meta.label,
      dateLabel,
      titlePlaceholder,
      categoryIcon: meta.icon,
    })
  },

  /** 点击分类 chip */
  onPickCategory(e: WechatMiniprogram.TouchEvent) {
    const categoryId = e.currentTarget.dataset.id as string
    this.setData({
      category: categoryId,
      // 切换到非自定义时清空自定义输入；切到 reading/film 之外时清掉评分（避免脏数据）
      categoryViews: this.data.categoryViews.map(c => ({ ...c, active: c.id === categoryId })),
      rating: (categoryId === 'reading' || categoryId === 'film') ? this.data.rating : 0,
    }, () => this.syncCategoryDerived())
  },

  /** 自定义分类名输入 */
  onCustomCategoryInput(e: WechatMiniprogram.Input) {
    this.setData({ customCategory: e.detail.value }, () => this.syncCategoryDerived())
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as string
    this.setData({ [field]: e.detail.value })
  },

  onTapRatingHalf(e: WechatMiniprogram.TouchEvent) {
    // 半星点击：左半 data-rating = 整星 -0.5，右半 = 整星。
    // 再次点击当前已选值 = 清零（常规评分交互：点亮的星再点一次取消）。
    const v = Number(e.currentTarget.dataset.rating)
    if (!v || v < 0.5) return
    const next = this.data.rating === v ? 0 : v
    this.setData({ rating: next })
  },

  onDateChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ finishedDate: e.detail.value as string })
  },

  /** 三态状态 picker 切换：更新 status + statusIndex，并联动 dateLabel（通过 syncCategoryDerived）。
   *  picker 的 value 是 index（对齐 statusOptions 顺序）；detail.value 是字符串索引。 */
  onStatusChange(e: WechatMiniprogram.CustomEvent) {
    const idx = parseInt(e.detail.value as string, 10)
    if (isNaN(idx) || idx < 0 || idx >= this.data.statusOptions.length) return
    const status = this.data.statusOptions[idx].id
    this.setData({ status, statusIndex: idx }, () => this.syncCategoryDerived())
  },

  /** P2-3/P3：点 ✨ 换一条短评 prompt。
   *  P3 升级：换的时候带上当前已选的分类 + 心境，让提问更贴合语境。 */
  onRefreshNotePrompt() {
    const category = this.data.category === '__custom__' ? this.data.customCategory : this.data.category
    this.setData({
      notePrompt: pickContextualNotePrompt({ category, mood: this.data.mood }),
    })
  },

  /* === 成就图片操作 === */

  /** 上传图片：chooseImage → saveFile 永久化 → setData */
  onPickFromAlbum() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempPath = res.tempFilePaths && res.tempFilePaths[0]
        if (!tempPath) return
        wx.showLoading({ title: '保存中', mask: true })
        const savedPath = await saveAchievementImage(tempPath)
        wx.hideLoading()
        if (!savedPath) {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' })
          return
        }
        // 如果原本是 custom 图且换了新图，删掉旧的避免文件泄漏
        const { imageType, image } = this.data
        if (imageType === 'custom' && image && image !== savedPath) {
          deleteAchievementImage(image)
        }
        this.setData({ image: savedPath, imageType: 'custom', presetCss: '' })
      },
    })
  },

  /** 打开预设图选择 sheet */
  onOpenPresetSheet() {
    this.setData({ showPresetSheet: true })
  },

  /** 关闭预设 sheet */
  onClosePresetSheet() {
    this.setData({ showPresetSheet: false })
  },

  /** 选某张预设图 */
  onPickPreset(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const css = presetToCss(id)
    // 切换预设时若原本是 custom 上传图，删旧文件
    const { imageType, image } = this.data
    if (imageType === 'custom' && image) {
      deleteAchievementImage(image)
    }
    this.setData({
      image: id,
      imageType: 'preset',
      presetCss: css,
      showPresetSheet: false,
    })
  },

  /** 清空图片（不设图片）*/
  onClearImage() {
    const { imageType, image } = this.data
    if (imageType === 'none') return
    // 只对 custom 上传图删文件；preset/builtin 只是清标识
    if (imageType === 'custom' && image) {
      deleteAchievementImage(image)
    }
    this.setData({ image: '', imageType: 'none', presetCss: '' })
  },

  /* === 金句列表操作 === */

  onQuoteInput(e: WechatMiniprogram.Input) {
    this.setData({ quoteInput: e.detail.value })
  },

  onAddQuote() {
    const text = this.data.quoteInput.trim()
    if (!text) return
    const quotes = [...this.data.quotes, text]
    this.setData({ quotes, quoteInput: '' })
  },

  onDeleteQuote(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const removedText = this.data.quotes[index]
    const quotes = this.data.quotes.filter((_, i) => i !== index)
    // 同步清理 quoteNotes：删掉该金句对应的上下文键，避免孤儿键
    const quoteNotes = { ...this.data.quoteNotes }
    if (removedText && quoteNotes[removedText] !== undefined) {
      delete quoteNotes[removedText]
    }
    // 若正在编辑这条的上下文，关闭编辑态
    const editingQuoteIndex = this.data.editingQuoteIndex === index ? -1 : this.data.editingQuoteIndex
    this.setData({ quotes, quoteNotes, editingQuoteIndex, quoteContextInput: '' })
  },

  /** 展开/收起某条金句的上下文录入（就地切换） */
  onToggleQuoteContext(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const cur = this.data.editingQuoteIndex
    if (cur === index) {
      this.setData({ editingQuoteIndex: -1, quoteContextInput: '' })
      return
    }
    const text = this.data.quotes[index]
    this.setData({
      editingQuoteIndex: index,
      quoteContextInput: (text && this.data.quoteNotes[text]) || '',
    })
  },

  /** 上下文输入 */
  onQuoteContextInput(e: WechatMiniprogram.Input) {
    this.setData({ quoteContextInput: e.detail.value })
  },

  /** 保存当前金句的上下文（写入 quoteNotes，键 = 金句正文） */
  onSaveQuoteContext() {
    const idx = this.data.editingQuoteIndex
    if (idx < 0) return
    const text = this.data.quotes[idx]
    if (!text) return
    const value = this.data.quoteContextInput.trim()
    const quoteNotes = { ...this.data.quoteNotes }
    if (value) {
      quoteNotes[text] = value
    } else {
      // 空值视为删除上下文
      delete quoteNotes[text]
    }
    this.setData({ quoteNotes, editingQuoteIndex: -1, quoteContextInput: '' })
  },

  /* === 金句正文编辑（T3）===
   *  之前没有「改正文」入口，用户想修错字只能删了重加，连带丢失这条金句的上下文注释。
   *  现在加一个就地改正文的入口；提交时走 storage.editQuoteText，它会同步迁移 quoteNotes 的 key，
   *  避免出现「正文改了但注释 key 还指向旧文本」的孤儿。 */

  /** 打开某条金句的正文编辑器（与上下文编辑互斥，避免同一行两个输入框打架） */
  onEditQuoteText(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const text = this.data.quotes[index]
    if (!text) return
    this.setData({
      editingQuoteTextIndex: index,
      quoteTextInput: text,
      // 存 trim 后的原文，与 storage 层 quotes[index].trim() 对齐；
      // 后续 onSaveQuoteText 的 hasOtherSameText 比较 q.trim()===oldText 才不会因前后空格误判。
      quoteTextOriginal: text.trim(),
      // 关掉可能开着的上下文编辑（互斥）
      editingQuoteIndex: -1,
      quoteContextInput: '',
    })
  },

  onQuoteTextInput(e: WechatMiniprogram.Input) {
    this.setData({ quoteTextInput: e.detail.value })
  },

  /** 提交金句正文修改：走 storage.editQuoteTextByIndex 单一入口（按 index 定位，正确处理重复金句）。
   *  重复金句场景下 quoteNotes key 迁移规则与 storage 层一致：
   *    - 若还有其它金句仍是旧文本，quoteNotes 的旧 key 不动（共享语义，留给其它同文本金句继续用）。
   *    - 没有其它金句仍是旧文本，才把 quoteNotes 的 key 从旧文本迁到新文本（注释跟着这条走）。
   *  新文本与原文一致 → 视作取消，不写入。空文本 → 提示并保持编辑态。 */
  onSaveQuoteText() {
    const idx = this.data.editingQuoteTextIndex
    if (idx < 0) return
    const newText = this.data.quoteTextInput.trim()
    if (!newText) {
      wx.showToast({ title: '金句不能为空', icon: 'none' })
      return
    }
    const oldText = this.data.quoteTextOriginal
    // 没改：直接关闭，不写
    if (newText === oldText) {
      this.setData({ editingQuoteTextIndex: -1, quoteTextInput: '', quoteTextOriginal: '' })
      return
    }
    // 编辑模式（已有 id）：走 storage 按 index 入口；保存失败给提示。
    // 新建模式（还没 id）：只改本地 quotes 数组 + 同步本地 quoteNotes（规则镜像 storage 层）。
    const id = this.data.id
    if (id) {
      const ok = editQuoteTextByIndex(id, idx, newText)
      if (!ok) {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
        return
      }
    }
    // 本地视图同步：替换 quotes[idx]；quoteNotes key 迁移与否取决于「是否还有其它金句仍是旧文本」。
    const quotes = [...this.data.quotes]
    quotes[idx] = newText
    const quoteNotes = { ...this.data.quoteNotes }
    const hasOtherSameText = quotes.some((q, i) => i !== idx && q.trim() === oldText)
    if (quoteNotes[oldText] !== undefined && !hasOtherSameText) {
      quoteNotes[newText] = quoteNotes[oldText]
      delete quoteNotes[oldText]
    }
    this.setData({
      quotes,
      quoteNotes,
      editingQuoteTextIndex: -1,
      quoteTextInput: '',
      quoteTextOriginal: '',
    })
  },

  /** 取消金句正文编辑 */
  onCancelEditQuoteText() {
    this.setData({ editingQuoteTextIndex: -1, quoteTextInput: '', quoteTextOriginal: '' })
  },

  /* === 批量粘贴摘抄辅助（T2-3）=== */

  /** 展开/收起批量录入面板 */
  onToggleBulkQuote() {
    const next = !this.data.showBulkQuote
    this.setData({
      showBulkQuote: next,
      // 收起时清掉临时状态（已导入的不会丢，只是清预览）
      bulkQuoteText: next ? this.data.bulkQuoteText : '',
      bulkQuotePreview: [],
      bulkQuoteHasPreview: false,
    })
  },

  /** 批量原文输入 */
  onBulkQuoteInput(e: WechatMiniprogram.Input) {
    this.setData({ bulkQuoteText: e.detail.value })
  },

  /** 智能切分预览：按换行 + 中文引号段落切段，过滤空串与过长段（>120 字提示）。
   *  切分规则（优先级从高到低）：
   *    1. 换行分隔（每行一条）
   *    2. 中文引号包裹的段落（「」『』""''）作为一条候选
   *    3. 以上都没有则整段作为一条候选
   *  每条 trim；空串丢弃；保留重复（用户可能有意录入相同句）。 */
  onPreviewBulkQuote() {
    const raw = this.data.bulkQuoteText || ''
    if (!raw.trim()) {
      wx.showToast({ title: '请先粘贴文本', icon: 'none' })
      return
    }
    const candidates = splitBulkQuotes(raw)
    if (candidates.length === 0) {
      wx.showToast({ title: '未识别到有效句子', icon: 'none' })
      return
    }
    this.setData({ bulkQuotePreview: candidates, bulkQuoteHasPreview: true })
  },

  /** 确认导入：把预览候选追加进 quotes（与已有去重） */
  onConfirmBulkQuote() {
    const preview = this.data.bulkQuotePreview
    if (preview.length === 0) return
    const existing = new Set(this.data.quotes)
    const added: string[] = []
    const dupCount: number[] = []
    preview.forEach(q => {
      if (existing.has(q)) {
        dupCount.push(0)
      } else {
        existing.add(q)
        added.push(q)
      }
    })
    const quotes = [...this.data.quotes, ...added]
    const dup = dupCount.length
    this.setData({
      quotes,
      bulkQuoteText: '',
      bulkQuotePreview: [],
      bulkQuoteHasPreview: false,
      showBulkQuote: false,
    })
    const msg = added.length > 0
      ? ('已导入 ' + added.length + ' 条' + (dup > 0 ? '（跳过 ' + dup + ' 条重复）' : ''))
      : (dup > 0 ? '全部 ' + dup + ' 条已存在' : '无新增')
    wx.showToast({ title: msg, icon: 'none' })
  },

  /** 从预览里删掉某条候选（导入前剔除） */
  onRemoveBulkPreviewItem(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const bulkQuotePreview = this.data.bulkQuotePreview.filter((_, i) => i !== index)
    this.setData({ bulkQuotePreview })
  },

  /* === 情绪/五感标签操作 === */

  /** 点预设标签 chip：切换选中态。已选则移除，未选则追加（去重）。 */
  onTogglePresetTag(e: WechatMiniprogram.TouchEvent) {
    const tag = e.currentTarget.dataset.tag as string
    const tags = this.data.tags
    const idx = tags.indexOf(tag)
    let next: string[]
    if (idx === -1) {
      next = [...tags, tag]   // 未选 → 追加
    } else {
      next = tags.filter((_, i) => i !== idx)  // 已选 → 移除
    }
    this.setData({ tags: next, selectedTagMap: buildTagMap(next) })
  },

  /** 自定义标签输入 */
  onTagInput(e: WechatMiniprogram.Input) {
    this.setData({ tagInput: e.detail.value })
  },

  /** 添加自定义标签（去重；空值忽略）*/
  onAddTag() {
    const text = this.data.tagInput.trim()
    if (!text) return
    const tags = this.data.tags
    if (tags.indexOf(text) !== -1) {
      wx.showToast({ title: '标签已存在', icon: 'none' })
      return
    }
    const next = [...tags, text]
    this.setData({ tags: next, tagInput: '', selectedTagMap: buildTagMap(next) })
  },

  /** 删除已选标签（预设和自定义统一处理）*/
  onDeleteTag(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const next = this.data.tags.filter((_, i) => i !== index)
    this.setData({ tags: next, selectedTagMap: buildTagMap(next) })
  },

  /** 心境单选 chip：再点一次同一项 = 取消选中（置空） */
  onMoodTap(e: WechatMiniprogram.TouchEvent) {
    const value = e.currentTarget.dataset.value as string
    const cur = this.data.mood
    // 点「无」或重复点已选项 → 清空；否则切换为新选项
    const next = (value === MOOD_NONE || value === cur) ? '' : value
    this.setData({ mood: next })
  },

  /* === 目标进度（里程碑）=== */

  /** 切换进度开关。开启时若空则给默认 target 占位，便于用户继续输入。 */
  onToggleProgress() {
    const next = !this.data.hasProgress
    this.setData({ hasProgress: next })
  },

  /** 进度数字输入：current/target 共用此 handler，靠 data-field 区分；同时刷新百分比预览。 */
  onProgressInput(e: WechatMiniprogram.Input) {
    const field = e.currentTarget.dataset.field as string
    // 允许中间态空串（用户清空重输）；非数字字符由 input type="digit" 拦截
    const value = String(e.detail.value || '')
    const patch: { [k: string]: string } = { [field]: value }
    const current = field === 'progressCurrent' ? value : this.data.progressCurrent
    const target = field === 'progressTarget' ? value : this.data.progressTarget
    patch.progressPercent = calcProgressPercent(current, target)
    this.setData(patch)
  },

  /* === 保存 === */

  onSave() {
    const {
      title, author, genre, rating, finishedDate, note, type, isEdit, id,
      readingPlace, readingContext, understanding, quotes,
      category, customCategory, isRichCategory,
      image, imageType, originalImage, originalImageType,
      tags, mood,
      hasProgress, progressCurrent, progressTarget,
      wishId,
      status,
    } = this.data

    // 解析真实分类 id
    const realCategory = category === '__custom__'
      ? customCategory.trim()
      : category
    if (category === '__custom__' && !realCategory) {
      wx.showToast({ title: '请填写自定义分类名', icon: 'none' })
      return
    }

    if (!title.trim()) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (!finishedDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    // 仅 reading/film 且 status==='done' 时强制评分；
    // 在读/搁置态还没到打分节点，允许 0 分保存（避免强制用户给一本没读完的书打分）。
    if (isRichCategory && status === 'done' && rating <= 0) {
      wx.showToast({ title: '请点星星评分', icon: 'none' })
      return
    }

    // 目标进度校验：开启时必须有合法 target>0；current 默认 0，允许 > target（自由超配）
    let progress: { current: number; target: number } | undefined
    if (hasProgress) {
      const cur = parseFloat(progressCurrent)
      const tgt = parseFloat(progressTarget)
      if (isNaN(tgt) || tgt <= 0) {
        wx.showToast({ title: '请填进度目标', icon: 'none' })
        return
      }
      progress = { current: isNaN(cur) ? 0 : Math.max(0, cur), target: tgt }
    }

    // 图片清理：编辑模式下，若原始是 custom 上传图且当前已不再是它，删旧文件避免泄漏
    // （onPickFromAlbum/onPickPreset/onClearImage 已即时清理一次，这里兜底防止那些路径没走的情况）
    if (isEdit && originalImageType === 'custom' && originalImage) {
      const stillUsingOriginal = image === originalImage && imageType === 'custom'
      if (!stillUsingOriginal) {
        deleteAchievementImage(originalImage)
      }
    }

    const payload = {
      type: isRichCategory ? type : 'book',  // 非 reading/film 的 type 固定 book（兼容字段，无实际用途）
      category: realCategory,
      title: title.trim(),
      author: author.trim(),
      genre: genre.trim(),
      rating,
      finishedDate,
      status,  // 三态：reading/done/abandoned；storage 缺省兜底为 done
      note: note.trim(),
      readingPlace: readingPlace.trim(),
      readingContext: readingContext.trim(),
      understanding: understanding.trim(),
      quotes,
      // 金句上下文：只保留 quotes 数组里仍存在的键（孤儿键清掉），空对象不写入
      quoteNotes: pruneQuoteNotes(quotes, this.data.quoteNotes),
      image: imageType === 'none' ? '' : image,
      imageType,
      tags,
      // 瞬时心境：空串不写入（避免 storage 层存空字符串语义歧义）
      mood: mood || undefined,
      progress,
      // 愿望转化时带上 wishId，建立成就侧反向关联（空串不写入存储层会变 undefined）
      wishId: wishId || undefined,
    }

    if (isEdit && id) {
      const ok = updateItem(id, payload)
      if (!ok) {
        wx.showToast({ title: '保存失败，存储空间不足', icon: 'none' })
        return
      }
      wx.showToast({ title: '已保存', icon: 'success' })
    } else {
      const newItem = addItem(payload)
      if (!newItem) {
        // addItem 返回 null：日期非法 或 存储写入失败（配额满/IO 错）
        wx.showToast({ title: '保存失败，存储空间不足', icon: 'none' })
        return
      }
      // 来自愿望的新成就：走 linkWishAchievement 收口双向关联（写 Wish.achievementId + 复核 Item.wishId）。
      // 成就侧 wishId 已在 payload 里带（addItem 时写入），这里主要补愿望侧 + 保证两边一致。
      if (wishId) {
        linkWishAchievement(wishId, newItem.id)
      }
      wx.showToast({ title: '已记录', icon: 'success' })
    }

    setTimeout(() => {
      wx.navigateBack()
    }, 600)
  },

  onDelete() {
    if (!this.data.isEdit || !this.data.id) return
    wx.showModal({
      title: '确认删除？',
      content: '删除后可在 30 天内从回收站恢复',
      success: (res) => {
        if (res.confirm) {
          // 删除成就时同步清理上传图片文件，避免永久文件泄漏
          if (this.data.imageType === 'custom' && this.data.image) {
            deleteAchievementImage(this.data.image)
          }
          const ok = deleteItem(this.data.id)
          if (!ok) {
            wx.showToast({ title: '删除失败，请重试', icon: 'none' })
            return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => {
            wx.navigateBack()
          }, 600)
        }
      },
    })
  },

  /** P3-2 跳转到共读引导页（带上当前成就 id，让引导页加载该书的问题） */
  onOpenReadingGuide() {
    if (!this.data.id) return
    wx.navigateTo({ url: '/pages/reading-guide/reading-guide?bookId=' + this.data.id })
  },
})
