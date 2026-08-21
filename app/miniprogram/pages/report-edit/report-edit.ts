// pages/report-edit/report-edit.ts
// 报告编辑器：卡片左右滑动预览 + 逐卡改标题/正文 + 增/删/改顺序
// 数据来源：storage.loadReport(id)；任何改动即时 saveReport

import {
  ReportInstance,
  ReportCard,
  CardType,
  TextSegment,
  loadReport,
  saveReport,
  loadTemplates,
} from '../../utils/storage'
import { CardStyle, SegmentStyle, ArtFontStyle, resolveStyle, mergeStyle, mergeSegmentStyle, BG_PRESETS, THEME_PRESETS, builtInBgToCss, designTokens } from '../../utils/design-tokens'
import { applyThemeToPage, getNavDefaults, getRootClassDefault } from '../../utils/theme'
import { safeRefresh } from '../../utils/error-boundary'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 卡片类型的中文标签，用于"添加卡片"选择器 */
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

/** T2-4 段落结构预设：把多段骨架写入 content，配合每段独立样式 sheet 形成结构化排版。
 *  模板里每行 = 一段（换行分段是现有 segments 管线的既定切分规则）。
 *  占位文字用「（…）」标记，引导用户改成自己的话。纯本地文本，零合规风险。 */
interface ParagraphPreset {
  id: string
  label: string       // 按钮文案
  desc: string        // 一句话说明结构
  template: string    // 写入 content 的多段骨架（\n 分段）
}
const PARAGRAPH_PRESETS: ParagraphPreset[] = [
  {
    id: 'intro-body-signoff',
    label: '引言·正文·落款',
    desc: '经典三段式',
    template: '（在这里写一句引言，定下整张卡的调子）\n（这里是正文，讲你想讲的故事）\n—— （落款：日期 / 署名）',
  },
  {
    id: 'two-contrast',
    label: '对比两段',
    desc: '前后对照',
    template: '（从前……）\n（后来……）',
  },
  {
    id: 'quote-then-thought',
    label: '金句+感想',
    desc: '先引后议',
    template: '「（在这里贴一句金句）」\n（写下你为什么被它击中）',
  },
  {
    id: 'list-three',
    label: '三点列举',
    desc: '清爽清单',
    template: '一、（第一个点）\n二、（第二个点）\n三、（第三个点）',
  },
]

/** 新卡片默认文案模板（用户添加新卡片时的初始内容） */
function defaultCardContent(type: CardType): { title: string; content: string } {
  switch (type) {
    case 'cover':
      return { title: '', content: '这一年，与书相遇' }
    case 'overview':
      return { title: '这一年', content: '这一年，你读了一些书。' }
    case 'footprint':
      return { title: '阅读的足迹', content: '你的阅读足迹，遍布各地。' }
    case 'favorite':
      return { title: '年度之书', content: '若只能选一本……' }
    case 'theme':
      return { title: '一场漫长的跋涉', content: '这一年，你在字句中跋涉。' }
    case 'quote':
      return { title: '字里行间', content: '「在这里写下打动你的句子」\n—— 《书名》' }
    case 'journey':
      return { title: '在路上', content: '你在某个地方，翻开过某一本书。' }
    case 'ending':
      return { title: '', content: '愿你今后的旅程，永远有书相伴。' }
  }
}

/**
 * 卡片视图模型：原卡片数据 + 已 resolve 的样式 + wxml 友好的 css 字符串字段
 * wxml 里用内联 style 绑定这些字段，实现样式实时反映到预览
 */
/** 段落视图模型：用于 textarea 下方的段落样式预览区 */
interface SegmentView {
  text: string
  color: string
  fontSizeRpx: number
  align: 'left' | 'center' | 'right'
  /** 该段是否有自定义样式（用于 UI 提示） */
  hasOwnStyle: boolean
  /** 图片段：非空表示该段是图片，text 通常为空 */
  image?: string
  /** 艺术字 css（已拍平，wxml 直接拼到 style）；空字符串表示无艺术字 */
  artCss?: string
  /** transform css 片段（rotate+skew，拼进 style；空串=无） */
  transformCss?: string
  /** font-family css 值（映射到系统字体栈）；空串=用默认 */
  fontFamilyCss?: string
  /** letter-spacing css（rpx；空串=正常） */
  letterSpacingCss?: string
  /** 盒布局 css（position:absolute + left/top/width%；空串=流式堆叠）。PPT 化自由布局 */
  boxCss?: string
  /** 是否处于自由定位模式（决定是否渲染拖拽/缩放手柄） */
  isFreePositioned?: boolean
}

interface CardView {
  type: CardType
  title: string
  content: string
  bookRef?: string
  // 已 resolve 的样式（全字段必填，供样式编辑器回显）
  style: Required<CardStyle>
  // wxml 内联 style 用的 css 字符串（背景 + 内边距）
  cardStyleCss: string
  // 正文文字颜色
  textColor: string
  // 标题颜色
  titleColor: string
  // 正文 css 字号（rpx）
  fontSizeRpx: number
  // 标题 css 字号（rpx，受同一 scale 影响，保持与 canvas 一致）
  titleFontSizeRpx: number
  // 文字对齐
  textAlign: 'left' | 'center' | 'right'
  // 段落视图（富文本）：用于 textarea 下方段落样式预览区；为空数组则表示无段落（回落整段）
  segmentViews: SegmentView[]
  // P6 缩略图导航：类型图标 + 短标签 + 纯背景色（缩略图圆角色块用）
  thumbIcon: string
  thumbLabel: string
  cardStyleCssBgOnly: string
}

/** 默认正文字号基准（rpx），与 report-edit.less 原 .card-body 一致 */
const BASE_BODY_FONT_RPX = 32
/** 默认标题字号基准（rpx），与 report-edit.less 原 .card-tag 一致 */
const BASE_TITLE_FONT_RPX = 24

/** 把段艺术字样式转成 wxml 内联 css（与 canvas drawArtText 对应，保证预览≈导出）
 *  css 无原生描边，用多方向 text-shadow 近似；渐变用 -webkit-background-clip: text */
function artFontToCss(merged: SegmentStyle, fontRpx: number): string {
  const art = merged.artFont
  if (!art || art === 'none') return ''
  if (art === 'outline') {
    // 4 方向 + 8 斜向 1rpx 偏移模拟描边（粗细随字号缩放）
    const sw = Math.max(1, Math.round((merged.strokeWidth !== undefined ? merged.strokeWidth : 2) * fontRpx / 30))
    const sc = merged.strokeColor || '#3D3530'
    const o = `${sw}rpx`
    return `text-shadow: ${o} 0 ${sc}, -${o} 0 ${sc}, 0 ${o} ${sc}, 0 -${o} ${sc}, ${o} ${o} ${sc}, -${o} -${o} ${sc}, ${o} -${o} ${sc}, -${o} ${o} ${sc};`
  }
  if (art === 'shadow') {
    const sc = merged.shadowColor || 'rgba(61, 53, 48, 0.45)'
    const blur = Math.round(fontRpx * 0.18)
    const off = Math.round(fontRpx * 0.08)
    return `text-shadow: 0 ${off}rpx ${blur}rpx ${sc};`
  }
  if (art === 'gradient') {
    const to = merged.gradientTo || '#D97A4A'
    return `background-image: linear-gradient(180deg, ${merged.color || '#3D3530'}, ${to}); -webkit-background-clip: text; background-clip: text; color: transparent;`
  }
  if (art === 'handwritten') {
    return `font-style: italic;`
  }
  if (art === 'neon') {
    // 霓虹发光：多层 0 模糊偏移的同色 text-shadow 叠加成光晕（与 canvas 多层 shadowBlur 对齐）
    const neonColor = merged.shadowColor || '#FF6EC7'
    const blur = Math.round(fontRpx * 0.5)
    return `color: ${neonColor}; text-shadow: 0 0 ${blur}rpx ${neonColor}, 0 0 ${Math.round(blur * 0.6)}rpx ${neonColor}, 0 0 ${Math.round(blur * 0.3)}rpx ${neonColor};`
  }
  if (art === 'glow') {
    // 高光描边：多方向白色细偏移模拟描边 + 外层柔光
    const glowColor = merged.strokeColor || '#FFFFFF'
    const o = Math.max(1, Math.round(fontRpx / 45))
    const blur = Math.round(fontRpx * 0.12)
    return `text-shadow: ${o}rpx 0 ${glowColor}, -${o}rpx 0 ${glowColor}, 0 ${o}rpx ${glowColor}, 0 -${o}rpx ${glowColor}, 0 0 ${blur}rpx ${glowColor};`
  }
  if (art === 'rainbow') {
    // 彩虹渐变：横向 7 色，与 canvas createLinearGradient 对齐
    return `background-image: linear-gradient(90deg, #FF6B6B, #FFA94D, #FFD43B, #8CE99A, #74C0FC, #9775FA, #E599F7); -webkit-background-clip: text; background-clip: text; color: transparent;`
  }
  if (art === 'metallic') {
    // 金属质感：垂直三段渐变（暗→亮→暗），中间高光带
    const deep = merged.gradientTo || '#6A6A6A'
    return `background-image: linear-gradient(180deg, ${deep} 0%, #F5F5F5 42%, #FFFFFF 50%, #F5F5F5 58%, ${deep} 100%); -webkit-background-clip: text; background-clip: text; color: transparent;`
  }
  if (art === 'relief') {
    // 立体投影：多层右下偏移递增的同色 text-shadow，形成长投影（与 canvas 6 层偏移对齐）
    const reliefColor = merged.shadowColor || 'rgba(61, 53, 48, 0.35)'
    const shadows: string[] = []
    for (let i = 1; i <= 6; i++) {
      shadows.push(`${i}rpx ${i}rpx ${reliefColor}`)
    }
    return `text-shadow: ${shadows.join(', ')};`
  }
  if (art === 'letterpress') {
    // 凹陷字：顶部白色高光 + 底部深色阴影，模拟内嵌（与 canvas 上偏白/下偏黑对齐）
    return `text-shadow: 0 -1rpx 0 rgba(255, 255, 255, 0.6), 0 1rpx 1rpx rgba(0, 0, 0, 0.4);`
  }
  if (art === 'vintage') {
    // 复古做旧：暖褐多方向细描边 + 半透明本色
    const vintageStroke = merged.strokeColor || '#6B4A2B'
    const o = Math.max(1, Math.round(fontRpx / 60))
    return `text-shadow: ${o}rpx 0 ${vintageStroke}, -${o}rpx 0 ${vintageStroke}, 0 ${o}rpx ${vintageStroke}, 0 -${o}rpx ${vintageStroke}; opacity: 0.88;`
  }
  if (art === 'stamp') {
    // 印章风：粗印泥色多方向描边 + 右下偏移投影（与 canvas 粗 strokeText + 偏移 shadow 对齐）
    const stampColor = merged.stampColor || '#C0392B'
    const o = Math.max(2, Math.round(fontRpx / 18))
    return `color: ${stampColor}; text-shadow: ${o}rpx 0 ${stampColor}, -${o}rpx 0 ${stampColor}, 0 ${o}rpx ${stampColor}, 0 -${o}rpx ${stampColor}, 2rpx 3rpx 4rpx rgba(192, 57, 43, 0.3);`
  }
  return ''
}

/** 字体档 → WXSS font-family css 值（与 canvas 选 font 保持同源）
 *  楷体依赖设备系统字体，不同机型渲染可能不完全一致（平台固有限制）
 *  导出供测试套件验证（PPT 化段落样式扩展） */
export function fontFamilyToCss(ff: 'sans' | 'serif' | 'kai' | 'mono' | undefined): string {
  if (!ff) return ''
  if (ff === 'sans') return 'var(--font-sans)'
  if (ff === 'serif') return 'var(--font-serif)'
  if (ff === 'kai') return '"KaiTi", "STKaiti", "楷体", "Kaiti SC", cursive'
  if (ff === 'mono') return '"Courier New", "Menlo", monospace'
  return ''
}

/** 把卡片正文按 \n 切成段落视图（合并段样式继承链）
 *  封面卡段缺省居中、落款卡段缺省右对齐（与 canvas drawSegments 的 segDefaultAlign 对齐，
 *  保证 wxml 预览 ≈ canvas 导出）。通用卡用 rs.textAlign。段内若显式设了 align 仍以段样式优先。
 *  导出供测试套件验证 transformCss/fontFamilyCss/letterSpacingCss 生成（PPT 化段落样式扩展） */
export function buildSegmentViews(card: ReportCard, rs: Required<CardStyle>): SegmentView[] {
  // 优先用 card.segments（已有富文本数据），否则按 content 切段
  let segs: { text: string; style?: SegmentStyle; image?: string }[]
  if (card.segments && card.segments.length > 0) {
    segs = card.segments
  } else {
    segs = (card.content || '').split('\n').map(text => ({ text }))
  }
  // 卡类型语义缺省对齐：封面居中、落款右对齐、通用用 rs.textAlign
  const baseAlign: 'left' | 'center' | 'right' =
    card.type === 'cover' ? 'center' : card.type === 'ending' ? 'right' : rs.textAlign
  return segs.map(seg => {
    const merged = mergeSegmentStyle(
      { color: rs.textColor, fontSizeScale: rs.fontSizeScale, align: baseAlign },
      seg.style
    )
    const fontRpx = Math.round(BASE_BODY_FONT_RPX * (merged.fontSizeScale !== undefined ? merged.fontSizeScale : rs.fontSizeScale))
    // hasOwn 判断扩展：颜色/字号/对齐/艺术字/旋转/倾斜/字体档/字间距 任一自定义即视为已定制
    const hasOwn = !!(seg.style && (
      seg.style.color || seg.style.fontSizeScale !== undefined || seg.style.align || seg.style.artFont ||
      seg.style.rotate !== undefined || seg.style.skew !== undefined || seg.style.fontFamily || seg.style.letterSpacing !== undefined ||
      seg.style.boxX !== undefined
    ))
    // transformCss：rotate 或 skew 非零才拼（空串=无变换）
    const transforms: string[] = []
    if (merged.rotate) transforms.push(`rotate(${merged.rotate}deg)`)
    if (merged.skew) transforms.push(`skewX(${merged.skew}deg)`)
    const transformCss = transforms.join(' ')
    // 字间距：非 1 才拼（单位 rpx）
    const letterSpacingCss = merged.letterSpacing !== undefined && merged.letterSpacing !== 1
      ? `${Math.round(fontRpx * (merged.letterSpacing - 1) * 0.5)}rpx`
      : ''
    // boxCss：boxX 非缺省即进入自由定位模式（从流式栈抽出独立绝对定位）
    // 坐标用百分比相对正文区（与 canvas drawSegments 同源：两边都按正文区宽高缩放）
    const isFreePositioned = merged.boxX !== undefined
    let boxCss = ''
    if (isFreePositioned) {
      const leftPct = Math.round((merged.boxX || 0) * 100)
      const topPct = Math.round((merged.boxY || 0) * 100)
      const widthPct = Math.round((merged.boxW !== undefined ? merged.boxW : 1) * 100)
      boxCss = `position: absolute; left: ${leftPct}%; top: ${topPct}%; width: ${widthPct}%;`
    }
    return {
      text: seg.text,
      color: merged.color || rs.textColor,
      fontSizeRpx: fontRpx,
      align: merged.align || baseAlign,
      hasOwnStyle: hasOwn,
      image: seg.image,
      artCss: artFontToCss(merged, fontRpx),
      transformCss,
      fontFamilyCss: fontFamilyToCss(merged.fontFamily),
      letterSpacingCss,
      boxCss,
      isFreePositioned,
    }
  })
}

/**
 * 把一份报告的所有卡片映射成视图模型数组（带样式解析）
 * 继承链：卡片自身 style > 报告 globalStyle > 默认
 */
function buildCardViews(report: ReportInstance): CardView[] {
  return report.cards.map(card => {
    const resolved = resolveStyle(mergeStyle(report.globalStyle, card.style))
    return {
      type: card.type,
      title: card.title,
      content: card.content,
      bookRef: card.bookRef,
      style: resolved,
      cardStyleCss: buildCardStyleCss(resolved),
      textColor: resolved.textColor,
      titleColor: resolved.titleColor,
      fontSizeRpx: Math.round(BASE_BODY_FONT_RPX * resolved.fontSizeScale),
      titleFontSizeRpx: Math.round(BASE_TITLE_FONT_RPX * resolved.fontSizeScale),
      textAlign: resolved.textAlign,
      segmentViews: buildSegmentViews(card, resolved),
      thumbIcon: CARD_TYPE_ICONS[card.type] || '📄',
      thumbLabel: buildThumbLabel(card),
      cardStyleCssBgOnly: buildCardBgOnly(resolved),
    }
  })
}

/** 卡片类型的图标（缩略图导航用）。与 CARD_TYPE_LABELS 配对。*/
const CARD_TYPE_ICONS: Record<CardType, string> = {
  cover: '📕',
  overview: '📋',
  footprint: '🗺️',
  favorite: '⭐',
  theme: '✦',
  quote: '❝',
  journey: '🧭',
  ending: '✓',
}

/** 缩略图短标签：优先标题首段，否则类型中文名，否则正文首字。*/
function buildThumbLabel(card: ReportCard): string {
  if (card.title && card.title.trim().length > 0) {
    const t = card.title.trim()
    return t.length <= 4 ? t : t.slice(0, 4)
  }
  const fallback = CARD_TYPE_LABELS[card.type]
  // 标题为空时，正文若有内容取首 4 字，否则用类型名
  const contentFirst = (card.content || '').trim()
  if (contentFirst.length > 0) {
    return contentFirst.length <= 4 ? contentFirst : contentFirst.slice(0, 4)
  }
  return fallback
}

/** 仅提取背景色（缩略图色块用，避免引入 padding/蒙版图导致缩略图变形）。*/
function buildCardBgOnly(s: Required<CardStyle>): string {
  if (s.bgType === 'gradient' && s.bgGradient) {
    return `linear-gradient(135deg, ${s.bgGradient[0]} 0%, ${s.bgGradient[1]} 100%)`
  }
  return s.bgColor
}

/* ===== P6 纯函数交换逻辑（抽离自 Page 方法，便于单元测试）===== */

/** 交换数组 i/j 位置的元素，返回新数组（不改原数组）。越界或 i===j 返回原数组副本。*/
export function swapArrayElements<T>(arr: T[], i: number, j: number): T[] {
  const out = arr.slice()
  if (i < 0 || j < 0 || i >= out.length || j >= out.length || i === j) return out
  const tmp = out[i]
  out[i] = out[j]
  out[j] = tmp
  return out
}

/** 取一张卡的段数组：优先 card.segments，否则按 content 切段构造（与 buildSegmentViews 同源）。*/
export function getCardSegments(card: ReportCard): TextSegment[] {
  if (card.segments && card.segments.length > 0) {
    return card.segments.slice()
  }
  return (card.content || '').split('\n').map(text => ({ text }))
}

/** 把段数组同步回 content（纯文本用 \n 拼接；图片段 text 为空，拼接后会丢图——
 *  但 content 是纯文本回落字段，图片信息只在 segments 里，导出走 segments，故可接受）。*/
export function segmentsToContent(segs: TextSegment[]): string {
  return segs.map(s => s.text || '').join('\n')
}

/** 交换一张卡的两段，返回新卡（segments + content 同步）。越界或 i===j 返回原卡副本。*/
export function swapCardSegments(card: ReportCard, segA: number, segB: number): ReportCard {
  const segs = getCardSegments(card)
  const newSegs = swapArrayElements(segs, segA, segB)
  // swapArrayElements 在越界/i===j 时返回原序副本；判断是否有实质变化以决定是否重建 content
  const changed = newSegs.some((s, idx) => s !== segs[idx])
  if (!changed) return { ...card }
  return { ...card, segments: newSegs, content: segmentsToContent(newSegs) }
}

/** 根据背景类型生成 wxml 内联 css（背景 + 内边距）
 *  与 canvas 的 drawBackground 行为保持一致：
 *    - color → 纯色
 *    - gradient → 135deg 线性渐变
 *    - image + 用户图片路径 → cover 背景图 + 白色蒙版（透明度 = 1 - bgImageOpacity）
 *    - image + 内置预设 id → CSS 近似纹理（builtInBgToCss），让编辑页也能看到水彩/网格等大致效果
 */
function buildCardStyleCss(s: Required<CardStyle>): string {
  const pad = Math.round(s.padding / 600 * 100 * 2)  // css px → rpx 近似（padding 是相对 600 宽的比例尺；这里转成相对 750 设计稿的 rpx，×2 是粗略）
  const padRpx = pad + 'rpx'
  let bg = ''
  if (s.bgType === 'gradient' && s.bgGradient) {
    bg = `background: linear-gradient(135deg, ${s.bgGradient[0]} 0%, ${s.bgGradient[1]} 100%);`
  } else if (s.bgType === 'image' && s.bgImage && s.bgImage.indexOf('/') >= 0) {
    // 用户上传图片：CSS 多层 background（蒙版在上，图片在下）+ cover
    // 蒙版透明度：bgImageOpacity 越大蒙版越透明（图越显眼），与 canvas drawUserImageBg 一致
    const maskAlpha = 1 - s.bgImageOpacity
    bg = `background-image: linear-gradient(rgba(255,255,255,${maskAlpha}), rgba(255,255,255,${maskAlpha})), url('${s.bgImage}'); background-size: cover; background-position: center;`
  } else if (s.bgType === 'image' && s.bgImage) {
    // 内置预设纹理（id 不含 /）：用 CSS 近似表达（水彩用多层径向渐变，波纹用重复径向渐变等）
    const approx = builtInBgToCss(s.bgImage)
    bg = approx || `background: ${s.bgColor};`
  } else {
    bg = `background: ${s.bgColor};`
  }
  return `${bg} padding: ${padRpx} 48rpx;`
}

interface ViewState {
  report: ReportInstance | null
  current: number        // 当前卡片索引
  showAddSheet: boolean  // 是否显示"添加卡片"底部弹层
  showOrderSheet: boolean // 是否显示"调整顺序"底部弹层
  showStyleSheet: boolean // 是否显示"样式编辑"底部弹层（S2 新增）
  cardTypeLabels: { type: CardType; label: string }[]
  titleInput: string     // 当前卡片标题（受控输入）
  contentInput: string   // 当前卡片正文（受控输入）
  reportId: string       // 路由传入的报告 id
  cardViews: CardView[]  // S2 新增：卡片视图模型数组（带样式），wxml 遍历它而非 report.cards
  // S2 新增：样式编辑器当前回显状态（基于当前卡 resolve 后的样式）
  editBgType: 'color' | 'gradient' | 'image'
  editBgColor: string
  editGradFrom: string
  editGradTo: string
  editTextColor: string
  editTitleColor: string
  editFontSizeScale: number
  editTextAlign: 'left' | 'center' | 'right'
  // S3 新增：当前编辑卡的 bgImage（用于内置背景选中态回显）
  editBgImage: string
  // S3 新增：是否显示主题套用弹层
  showThemeSheet: boolean
  // P6 新增：卡片拖拽态（顺序弹层内长按 ≡ 拖动）
  orderDragIndex: number   // 正在拖动的卡索引（-1 = 未拖动）
  orderDropIndex: number   // 当前拖动落点索引（用于高亮提示；-1 = 无）
  // P6 新增：段拖拽态（段落预览区长按拖动）
  segDragIndex: number     // 正在拖动的段索引（-1 = 未拖动）
  segDropIndex: number     // 当前段拖动落点索引（用于高亮提示；-1 = 无）
  // P10 新增：自由布局段拖拽/缩放态（卡片预览区直接拖位置/拖右下角改宽）
  boxDragSegIndex: number  // 正在拖动的自由定位段索引（-1 = 未拖）
  boxIsResize: boolean     // true = 拖右下角改宽；false = 拖本体改位置
  boxDragOffsetX: number   // 拖动起点指尖相对段左上的 px 偏移（避免段跳到指尖）
  boxDragOffsetY: number
  boxCardRectW: number     // 拖动开始时查询到的卡片正文区 px 宽（px→小数换算分母）
  boxCardRectH: number     // 卡片正文区 px 高
  boxCardRectL: number     // 卡片正文区 px 左边（屏幕坐标，换算用）
  boxCardRectT: number     // 卡片正文区 px 顶边
  // 段落级富文本：是否显示段样式编辑弹层 + 当前编辑段索引
  showSegSheet: boolean
  editingSegIndex: number
  // 段样式编辑回显
  editSegColor: string
  editSegFontSizeScale: number
  editSegAlign: 'left' | 'center' | 'right'
  // 艺术字编辑回显
  editArtFont: ArtFontStyle
  editStrokeColor: string
  editShadowColor: string
  editGradientTo: string
  editStampColor: string
  // PPT 化段落样式扩展回显：旋转 / 倾斜 / 字体档 / 字间距
  editSegRotate: number
  editSegSkew: number
  editSegFontFamily: 'sans' | 'serif' | 'kai' | 'mono'
  editSegLetterSpacing: number
  // P10 自由布局回显：当前编辑段是否处于自由定位模式
  editSegFreePos: boolean
}

/** 字号缩放候选（样式编辑器滑块档位） */
const FONT_SCALE_OPTIONS = [0.8, 0.9, 1.0, 1.15, 1.3]

Page({
  data: {
    themeClass: getRootClassDefault(),
    navColor: getNavDefaults().color,
    navBg: getNavDefaults().background,
    report: null,
    notFound: false,       // 报告加载失败标记，wxml 用 wx:elif 显示空态
    reportId: '',          // 路由传入的报告 id，onLoad 时缓存
    current: 0,
    showAddSheet: false,
    showOrderSheet: false,
    showStyleSheet: false,
    cardTypeLabels: (Object.keys(CARD_TYPE_LABELS) as CardType[]).map(t => ({
      type: t,
      label: CARD_TYPE_LABELS[t],
    })),
    // T2-4 段落结构预设（暴露给 wxml 渲染按钮组）
    paragraphPresets: PARAGRAPH_PRESETS.map(p => ({ id: p.id, label: p.label, desc: p.desc })),
    titleInput: '',
    contentInput: '',
    cardViews: [] as CardView[],
    editBgType: 'color' as 'color' | 'gradient' | 'image',
    editBgColor: '#FFFFFF',
    editGradFrom: '#D97A4A',
    editGradTo: '#6B8E5A',
    editTextColor: '#3D3530',
    editTitleColor: '#D97A4A',
    editFontSizeScale: 1.0,
    editTextAlign: 'left' as 'left' | 'center' | 'right',
    fontScaleOptions: FONT_SCALE_OPTIONS,
    fontScaleIndex: 2,    // 默认 1.0 对应 index 2
    // 色板（与设计风格一致；足够覆盖大部分搭配）
    bgColorPalette: ['#FFFFFF', '#FAF6F0', '#F2F4EE', '#FFF8EB', '#F5EFE8', '#2C2A28', '#1A1A1A'],
    accentColorPalette: ['#D97A4A', '#6B8E5A', '#8B6F9C', '#5B8FA8', '#C26B6B', '#A88B5C', '#3D3530', '#E8A33D'],
    textColorPalette: ['#3D3530', '#1A1A1A', '#5A5248', '#8B7D6E', '#E8E0D5', '#FFFFFF', '#6B8E5A', '#8B6F9C'],
    // S3 新增：内置背景预设 + 主题预设
    editBgImage: '',
    showThemeSheet: false,
    bgPresets: BG_PRESETS,
    themePresets: THEME_PRESETS,
    // P6 拖拽态默认值
    orderDragIndex: -1,
    orderDropIndex: -1,
    segDragIndex: -1,
    segDropIndex: -1,
    // P10 自由布局拖拽态默认值
    boxDragSegIndex: -1,
    boxIsResize: false,
    boxDragOffsetX: 0,
    boxDragOffsetY: 0,
    boxCardRectW: 0,
    boxCardRectH: 0,
    boxCardRectL: 0,
    boxCardRectT: 0,
    // 段落级富文本编辑
    showSegSheet: false,
    editingSegIndex: 0,
    editSegColor: '#3D3530',
    editSegFontSizeScale: 1.0,
    editSegAlign: 'left' as 'left' | 'center' | 'right',
    editArtFont: 'none' as ArtFontStyle,
    editStrokeColor: '#3D3530',
    editShadowColor: 'rgba(61, 53, 48, 0.45)',
    editGradientTo: '#D97A4A',
    editStampColor: '#C0392B',
    // PPT 化段落样式扩展默认值
    editSegRotate: 0,
    editSegSkew: 0,
    editSegFontFamily: 'sans' as 'sans' | 'serif' | 'kai' | 'mono',
    editSegLetterSpacing: 1,
    editSegFreePos: false,
    segColorPalette: ['#3D3530', '#1A1A1A', '#5A5248', '#8B7D6E', '#E8A33D', '#D97A4A', '#6B8E5A', '#8B6F9C'],
    // 艺术字配色板（描边/阴影/渐变末端共用）
    artColorPalette: ['#3D3530', '#1A1A1A', '#FFFFFF', '#D97A4A', '#E8A33D', '#6B8E5A', '#5B8FA8', '#8B6F9C', '#FF6EC7', '#74C0FC', '#9775FA', '#C0392B'],
  } as ViewState,

  onLoad(options: { id?: string }) {
    applyThemeToPage(this)
    // 触发 templates 初始化，确保模板列表可用（用户后续可能换模板）
    loadTemplates()
    this.setData({ reportId: (options && options.id) || '' })
    this.loadFromStorage()
  },

  onShow() {
    applyThemeToPage(this)
    // 从 poster 等子页面返回时刷新（首次进入已在 onLoad 加载过）
    // 只在报告有变动时才重读；未变保留当前编辑态，避免丢失用户输入
    if (!this.data.reportId) return
    const watched: DirtyField[] = ['reports']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.loadFromStorage()
  },

  /** 从 storage 重新读取报告，并把当前卡片同步到输入框 */
  loadFromStorage() {
    safeRefresh(this, () => {
    const id = this.data.reportId
    if (!id) {
      this.setData({ notFound: true })
      return
    }
    const report = loadReport(id)
    if (!report) {
      this.setData({ notFound: true })
      return
    }
    const safeCurrent = Math.min(this.data.current, report.cards.length - 1)
    const current = safeCurrent < 0 ? 0 : safeCurrent
    const cardViews = buildCardViews(report)
    this.setData({
      report,
      cardViews,
      current,
      titleInput: (report.cards[current] ? report.cards[current].title : '') || '',
      contentInput: (report.cards[current] ? report.cards[current].content : '') || '',
    })
    })  // safeRefresh
  },

  /** 局部刷新 cardViews（每次 patch 卡片样式/文案后调用，避免重新读 storage） */
  refreshCardViews() {
    const report = this.data.report
    if (!report) return
    this.setData({ cardViews: buildCardViews(report) })
  },

  /* ===== 滑动切换卡片 ===== */

  onSwiperChange(e: WechatMiniprogram.SwiperChange) {
    const current = e.detail.current
    const card = this.data.report!.cards[current]
    this.setData({
      current,
      titleInput: card.title,
      contentInput: card.content,
    })
  },

  /* ===== 编辑当前卡片 ===== */

  onTitleInput(e: WechatMiniprogram.Input) {
    const value = e.detail.value
    this.setData({ titleInput: value })
    this.patchCurrentCard({ title: value })
  },

  onContentInput(e: WechatMiniprogram.Input) {
    const value = e.detail.value
    this.setData({ contentInput: value })
    this.patchCurrentCard({ content: value })
  },

  /** 把改动写回当前卡片并落盘 */
  patchCurrentCard(patch: Partial<Pick<ReportCard, 'title' | 'content'>>) {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const cards = report.cards.slice()
    cards[current] = { ...cards[current], ...patch }
    const nextReport = { ...report, cards }
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
    saveReport(nextReport)
  },

  /* ===== 删除当前卡片 ===== */

  onDeleteCard() {
    const report = this.data.report
    if (!report) return
    if (report.cards.length <= 1) {
      wx.showToast({ title: '至少保留一张卡片', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除这张卡片？',
      content: '删除后不可撤销',
      success: res => {
        if (!res.confirm) return
        const current = this.data.current
        const cards = report.cards.slice()
        cards.splice(current, 1)
        const nextReport = { ...report, cards }
        const newCurrent = Math.min(current, cards.length - 1)
        this.setData({
          report: nextReport,
          cardViews: buildCardViews(nextReport),
          current: newCurrent,
          titleInput: cards[newCurrent].title,
          contentInput: cards[newCurrent].content,
        })
        saveReport(nextReport)
      },
    })
  },

  /* ===== 添加卡片 ===== */

  onOpenAddSheet() {
    this.setData({ showAddSheet: true })
  },

  onCloseAddSheet() {
    this.setData({ showAddSheet: false })
  },

  onAddCardByType(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as CardType
    const report = this.data.report
    if (!report) return
    const seed = defaultCardContent(type)
    const newCard: ReportCard = {
      type,
      title: seed.title,
      content: seed.content,
    }
    const cards = report.cards.slice()
    const insertAt = this.data.current + 1
    cards.splice(insertAt, 0, newCard)
    const nextReport = { ...report, cards }
    this.setData({
      report: nextReport,
      cardViews: buildCardViews(nextReport),
      current: insertAt,
      titleInput: seed.title,
      contentInput: seed.content,
      showAddSheet: false,
    })
    saveReport(nextReport)
  },

  /* ===== 调整顺序 ===== */

  onOpenOrderSheet() {
    this.setData({ showOrderSheet: true })
  },

  onCloseOrderSheet() {
    this.setData({ showOrderSheet: false })
  },

  onMoveCardUp(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    if (index <= 0) return
    this.swapCards(index, index - 1)
  },

  onMoveCardDown(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const report = this.data.report
    if (!report) return
    if (index >= report.cards.length - 1) return
    this.swapCards(index, index + 1)
  },

  onJumpToCard(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({
      current: index,
      titleInput: this.data.report!.cards[index].title,
      contentInput: this.data.report!.cards[index].content,
      showOrderSheet: false,
    })
  },

  swapCards(i: number, j: number) {
    const report = this.data.report
    if (!report) return
    const cards = report.cards.slice()
    const tmp = cards[i]
    cards[i] = cards[j]
    cards[j] = tmp
    const nextReport = { ...report, cards }
    this.setData({
      report: nextReport,
      cardViews: buildCardViews(nextReport),
      current: j,  // 跟着卡片走
      titleInput: cards[j].title,
      contentInput: cards[j].content,
    })
    saveReport(nextReport)
  },

  /* ===== P6 卡片拖拽排序（顺序弹层内长按 ≡ 拖动；touchmove 实时自动交换）===== */

  /** 长按拖拽手柄进入拖拽态。记录起始索引。*/
  onOrderDragStart(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const report = this.data.report
    if (!report || isNaN(index)) return
    // 阻止触发 onJumpToCard（行级 tap）：用 catchtouchstart 已拦，这里再加一层状态守卫
    this.setData({ orderDragIndex: index, orderDropIndex: index })
  },

  /** 拖动中：根据 clientY 相对弹层顶部的位置算落点行，落点变化时实时 swap。*/
  onOrderDragMove(e: WechatMiniprogram.TouchEvent) {
    const dragIndex = this.data.orderDragIndex
    if (dragIndex < 0) return
    const report = this.data.report
    if (!report) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const clientY = touch.clientY
    // 弹层顶部 Y（sheet-order 的 rect.top）+ 每行高度，换算落点索引
    wx.createSelectorQuery()
      .in(this)
      .select('.sheet-order .sheet-list')
      .boundingClientRect()
      .exec((res: any[]) => {
        if (!res || !res[0]) return
        const listRect = res[0]
        const offsetY = clientY - listRect.top
        const rowCount = report.cards.length
        if (rowCount === 0 || !listRect.height) return
        const rowH = listRect.height / rowCount
        let drop = Math.floor(offsetY / rowH)
        if (drop < 0) drop = 0
        if (drop > rowCount - 1) drop = rowCount - 1
        if (drop === this.data.orderDropIndex) return
        if (drop === this.data.orderDragIndex) {
          // 拖回原位：仅更新落点高亮，不交换
          this.setData({ orderDropIndex: drop })
          return
        }
        // 落点变了：实时交换被拖卡与目标位（swapCards 会刷新 report/cardViews，dragIndex 跟着卡片走）
        this.swapCards(this.data.orderDragIndex, drop)
        this.setData({ orderDragIndex: drop, orderDropIndex: drop })
      })
  },

  /** 松手：清除拖拽态（数据已随 swap 落库）。*/
  onOrderDragEnd() {
    if (this.data.orderDragIndex < 0) return
    this.setData({ orderDragIndex: -1, orderDropIndex: -1 })
  },

  /* ===== P6 段拖拽排序（段落预览区长按拖动；touchmove 实时自动交换）===== */

  /** 交换当前卡的两段（segments 与 content 同步）。仅作用于当前卡。*/
  swapSegments(segA: number, segB: number) {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    const newCard = swapCardSegments(card, segA, segB)
    // 纯函数在越界/同位时返回原序副本；判断是否有实质变化避免无谓 setData/save
    const changed = (newCard.segments !== card.segments) || (newCard.content !== card.content)
    if (!changed) return
    const cards = report.cards.slice()
    cards[current] = newCard
    const nextReport = { ...report, cards }
    this.setData({
      report: nextReport,
      cardViews: buildCardViews(nextReport),
      contentInput: newCard.content,
    })
    saveReport(nextReport)
  },

  /** 长按段落进入拖拽态。*/
  onSegDragStart(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.segindex)
    if (isNaN(index)) return
    // 不用可选链 ?. —— 真机旧基础库不支持 ES2020 语法（见 insights.ts 同款注释）
    const curView = this.data.cardViews[this.data.current]
    const segs = (curView && curView.segmentViews) || []
    if (segs.length < 2) return  // 单段无需排序
    this.setData({ segDragIndex: index, segDropIndex: index })
  },

  /** 段拖动中：按 clientY 落点行实时交换。*/
  onSegDragMove(e: WechatMiniprogram.TouchEvent) {
    const dragIndex = this.data.segDragIndex
    if (dragIndex < 0) return
    // 不用可选链 ?. —— 真机旧基础库不支持 ES2020 语法
    const curView = this.data.cardViews[this.data.current]
    const segs = (curView && curView.segmentViews) || []
    if (segs.length < 2) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const clientY = touch.clientY
    wx.createSelectorQuery()
      .in(this)
      .select('.seg-editor')
      .boundingClientRect()
      .exec((res: any[]) => {
        if (!res || !res[0]) return
        const editorRect = res[0]
        const segCount = segs.length
        if (!editorRect.height) return
        // 段落区从 label 之下开始粗略按平均段高估算；用 boundingClientRect 已足够定位
        const offsetY = clientY - editorRect.top
        const rowH = editorRect.height / (segCount + 1)  // +1 给 label 行留位
        let drop = Math.floor((offsetY - rowH) / rowH)
        if (drop < 0) drop = 0
        if (drop > segCount - 1) drop = segCount - 1
        if (drop === this.data.segDropIndex) return
        if (drop === this.data.segDragIndex) {
          this.setData({ segDropIndex: drop })
          return
        }
        this.swapSegments(this.data.segDragIndex, drop)
        this.setData({ segDragIndex: drop, segDropIndex: drop })
      })
  },

  /** 段拖拽结束。*/
  onSegDragEnd() {
    if (this.data.segDragIndex < 0) return
    this.setData({ segDragIndex: -1, segDropIndex: -1 })
  },

  /* ===== P10 自由布局：卡片预览区直接拖位置 / 拖右下角改宽 =====
   * 坐标模型：boxX/boxY/boxW 是 0~1 小数，相对当前卡的正文容器
   * （.card-body 通用 / .card-cover-inner 封面 / .card-ending-inner 落款）。
   * 拖动换算：px / 容器宽 = 小数；存小数保证预览（rpx）与导出（canvas）所见即所得。
   * 存盘节奏：拖动中只 setData 实时预览，touchend 才 applySegmentStylePatch 一次写盘（避免每帧写存储）。 */

  /** 取当前卡的正文容器选择器（按卡片类型）*/
  _freePosContainerSelector(): string {
    const cur = this.data.cardViews[this.data.current]
    if (!cur) return '.card-body'
    if (cur.type === 'cover') return '.card-cover-inner'
    if (cur.type === 'ending') return '.card-ending-inner'
    return '.card-body'
  },

  /** 把当前自由布局拖动写入预览（改 cardViews，不写盘）。*/
  _freePosUpdatePreview(boxX: number, boxY: number, boxW: number | undefined) {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card || !card.segments) return
    const segIndex = this.data.boxDragSegIndex
    if (segIndex < 0) return
    const segs = card.segments.slice()
    if (!segs[segIndex]) return
    const oldStyle = segs[segIndex].style || {}
    const newStyle: SegmentStyle = { ...oldStyle, boxX, boxY }
    if (boxW !== undefined) newStyle.boxW = boxW
    segs[segIndex] = { text: segs[segIndex].text, style: newStyle, image: segs[segIndex].image }
    const cards = report.cards.slice()
    cards[current] = { ...card, segments: segs }
    const nextReport = { ...report, cards }
    // 只更新预览，不 saveReport（touchend 才存盘）
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
  },

  /** 拖位置开始：记段索引 + 指尖相对段左上偏移 + 查容器矩形存分母。*/
  onSegBoxDragStart(e: WechatMiniprogram.TouchEvent) {
    const segIndex = Number(e.currentTarget.dataset.segindex)
    if (isNaN(segIndex)) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const selector = this._freePosContainerSelector()
    const clientX = touch.clientX
    const clientY = touch.clientY
    // 查容器矩形（boxCss 百分比的参考系）
    wx.createSelectorQuery()
      .in(this)
      .select(selector)
      .boundingClientRect()
      .exec((res: any[]) => {
        if (!res || !res[0]) return
        const r = res[0]
        // 指尖相对容器左上的偏移（即段左上的初始偏移；段 boxX% * r.width 是段左到容器左的距离）
        const report = this.data.report
        if (!report) return
        const card = report.cards[this.data.current]
        const seg = card && card.segments && card.segments[segIndex]
        const curBoxX = (seg && seg.style && seg.style.boxX !== undefined) ? seg.style.boxX : 0
        const curBoxY = (seg && seg.style && seg.style.boxY !== undefined) ? seg.style.boxY : 0
        const segLeftPx = r.left + curBoxX * r.width
        const segTopPx = r.top + curBoxY * r.height
        this.setData({
          boxDragSegIndex: segIndex,
          boxIsResize: false,
          boxDragOffsetX: clientX - segLeftPx,
          boxDragOffsetY: clientY - segTopPx,
          boxCardRectW: r.width,
          boxCardRectH: r.height,
          boxCardRectL: r.left,
          boxCardRectT: r.top,
        })
      })
  },

  /** 拖位置中：按指尖实时算 boxX/boxY，写预览。*/
  onSegBoxDragMove(e: WechatMiniprogram.TouchEvent) {
    if (this.data.boxDragSegIndex < 0 || this.data.boxIsResize) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const w = this.data.boxCardRectW
    const h = this.data.boxCardRectH
    if (!w || !h) return
    // 新段左 = 指尖 - 初始偏移；换算成容器宽的小数
    const newLeftPx = touch.clientX - this.data.boxCardRectL - this.data.boxDragOffsetX
    const newTopPx = touch.clientY - this.data.boxCardRectT - this.data.boxDragOffsetY
    const boxX = Math.max(0, Math.min(0.92, newLeftPx / w))
    const boxY = Math.max(0, Math.min(0.92, newTopPx / h))
    this._freePosUpdatePreview(boxX, boxY, undefined)
  },

  /** 缩放改宽开始。*/
  onSegBoxResizeStart(e: WechatMiniprogram.TouchEvent) {
    const segIndex = Number(e.currentTarget.dataset.segindex)
    if (isNaN(segIndex)) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const selector = this._freePosContainerSelector()
    wx.createSelectorQuery()
      .in(this)
      .select(selector)
      .boundingClientRect()
      .exec((res: any[]) => {
        if (!res || !res[0]) return
        const r = res[0]
        this.setData({
          boxDragSegIndex: segIndex,
          boxIsResize: true,
          boxDragOffsetX: 0,
          boxDragOffsetY: 0,
          boxCardRectW: r.width,
          boxCardRectH: r.height,
          boxCardRectL: r.left,
          boxCardRectT: r.top,
        })
      })
  },

  /** 缩放改宽中：指尖 x - 段左 = 新宽；换算小数。*/
  onSegBoxResizeMove(e: WechatMiniprogram.TouchEvent) {
    if (this.data.boxDragSegIndex < 0 || !this.data.boxIsResize) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const w = this.data.boxCardRectW
    if (!w) return
    const report = this.data.report
    if (!report) return
    const card = report.cards[this.data.current]
    const seg = card && card.segments && card.segments[this.data.boxDragSegIndex]
    const curBoxX = (seg && seg.style && seg.style.boxX !== undefined) ? seg.style.boxX : 0
    const segLeftPx = this.data.boxCardRectL + curBoxX * w
    const newWidthPx = touch.clientX - segLeftPx
    const boxW = Math.max(0.2, Math.min(1, newWidthPx / w))
    // boxX/boxY 不变，只改 boxW
    const curBoxY = (seg && seg.style && seg.style.boxY !== undefined) ? seg.style.boxY : 0
    this._freePosUpdatePreview(curBoxX, curBoxY, boxW)
  },

  /** 拖拽/缩放结束：写盘一次（拖动中只更新了预览）。*/
  onSegBoxDragEnd() {
    const segIndex = this.data.boxDragSegIndex
    if (segIndex < 0) return
    const report = this.data.report
    if (!report) return
    const card = report.cards[this.data.current]
    const seg = card && card.segments && card.segments[segIndex]
    const style = seg && seg.style
    if (style && style.boxX !== undefined) {
      // 把拖动结果写盘（applySegmentStylePatch 会重建 cardViews + saveReport）
      this.applySegmentStylePatch({ boxX: style.boxX, boxY: style.boxY, boxW: style.boxW })
    }
    this.setData({ boxDragSegIndex: -1, boxIsResize: false })
  },

  /* ===== 顶部操作 ===== */

  onBack() {
    wx.navigateBack()
  },

  onExport() {
    const report = this.data.report
    if (!report) return
    wx.navigateTo({
      url: '/pages/poster/poster?id=' + report.id,
    })
  },

  /* ===== S2：样式编辑器 ===== */

  /** 打开样式编辑弹层：回显当前卡的 resolve 后样式 */
  onOpenStyleSheet() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const rs = resolveStyle(mergeStyle(report.globalStyle, report.cards[current] ? report.cards[current].style : null))
    // 字号档位索引
    let fontIdx = 2
    for (let i = 0; i < FONT_SCALE_OPTIONS.length; i++) {
      if (Math.abs(FONT_SCALE_OPTIONS[i] - rs.fontSizeScale) < 0.05) { fontIdx = i; break }
    }
    this.setData({
      showStyleSheet: true,
      editBgType: rs.bgType,
      editBgColor: rs.bgColor,
      editGradFrom: (rs.bgGradient && rs.bgGradient[0]) || '#D97A4A',
      editGradTo: (rs.bgGradient && rs.bgGradient[1]) || '#6B8E5A',
      editTextColor: rs.textColor,
      editTitleColor: rs.titleColor,
      editFontSizeScale: rs.fontSizeScale,
      fontScaleIndex: fontIdx,
      editTextAlign: rs.textAlign,
      editBgImage: rs.bgType === 'image' ? rs.bgImage : '',
    })
  },

  onCloseStyleSheet() {
    this.setData({ showStyleSheet: false })
  },

  /** 背景类型切换 */
  onSwitchBgType(e: WechatMiniprogram.TouchEvent) {
    const t = e.currentTarget.dataset.type as 'color' | 'gradient'
    this.setData({ editBgType: t })
    this.applyStylePatch({ bgType: t })
  },

  /** 文字对齐切换 */
  onSwitchAlign(e: WechatMiniprogram.TouchEvent) {
    const a = e.currentTarget.dataset.align as 'left' | 'center' | 'right'
    this.setData({ editTextAlign: a })
    this.applyStylePatch({ textAlign: a })
  },

  /** 背景颜色选择（点击色块） */
  onPickBgColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editBgColor: c })
    this.applyStylePatch({ bgColor: c })
  },

  /** 渐变起点色 */
  onPickGradFrom(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    const to = this.data.editGradTo
    this.setData({ editGradFrom: c })
    this.applyStylePatch({ bgGradient: [c, to] })
  },

  /** 渐变终点色 */
  onPickGradTo(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    const from = this.data.editGradFrom
    this.setData({ editGradTo: c })
    this.applyStylePatch({ bgGradient: [from, c] })
  },

  /** 正文字色 */
  onPickTextColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editTextColor: c })
    this.applyStylePatch({ textColor: c })
  },

  /** 标题色 */
  onPickTitleColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editTitleColor: c })
    this.applyStylePatch({ titleColor: c })
  },

  /** 字号档位（滑块） */
  onFontSizeChange(e: WechatMiniprogram.SliderChange) {
    const idx = Math.round(e.detail.value)
    const scale = FONT_SCALE_OPTIONS[idx] || 1
    this.setData({ fontScaleIndex: idx, editFontSizeScale: scale })
    this.applyStylePatch({ fontSizeScale: scale })
  },

  /**
   * 把样式补丁写回当前卡的 card.style 并落盘
   * 每次写入都 merge 已有 style（避免覆盖之前调过的其它字段）
   */
  applyStylePatch(patch: CardStyle) {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    const mergedStyle = mergeStyle(card.style, patch)  // 老样式 + 新补丁
    const cards = report.cards.slice()
    cards[current] = { ...card, style: mergedStyle }
    const nextReport = { ...report, cards }
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
    saveReport(nextReport)
  },

  /** 重置当前卡样式：清除 card.style（让其回落到 globalStyle / 默认） */
  onResetCardStyle() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    const cards = report.cards.slice()
    cards[current] = { ...card }
    delete cards[current].style  // 彻底去掉卡片级样式
    const nextReport = { ...report, cards }
    this.setData({
      report: nextReport,
      cardViews: buildCardViews(nextReport),
      showStyleSheet: false,
    })
    saveReport(nextReport)
    wx.showToast({ title: '已重置', icon: 'none' })
  },

  /* ===== S3：内置背景预设 ===== */

  /** 切换到「图片」背景类型（选中内置背景或上传前的前置动作） */
  onSwitchToImageBg() {
    this.setData({ editBgType: 'image' })
    this.applyStylePatch({ bgType: 'image' })
  },

  /** 选择某个内置背景预设 */
  onPickBuiltInBg(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const preset = BG_PRESETS.find(p => p.id === id)
    if (!preset) return
    this.setData({ editBgType: 'image', editBgImage: id })
    // 套用预设：bgType=image + bgImage=id + 底色用预设 baseColor（绘制时实际由纹理覆盖）
    this.applyStylePatch({
      bgType: 'image',
      bgImage: id,
      bgColor: preset.baseColor,
    })
  },

  /** 从相册上传图片作为背景 */
  onUploadBgImage() {
    const report = this.data.report
    if (!report) return
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFilePaths && res.tempFilePaths[0]
        if (!tempPath) return
        // 用 getImageInfo 拿到稳定路径（避免 tempFilePath 在某些机型不可直接画）
        wx.getImageInfo({
          src: tempPath,
          success: (info) => {
            const path = info.path
            this.setData({ editBgType: 'image', editBgImage: path })
            this.applyStylePatch({ bgType: 'image', bgImage: path })
            wx.showToast({ title: '已设为背景', icon: 'success' })
          },
          fail: () => {
            // 退化：直接用 tempPath
            this.setData({ editBgType: 'image', editBgImage: tempPath })
            this.applyStylePatch({ bgType: 'image', bgImage: tempPath })
            wx.showToast({ title: '已设为背景', icon: 'success' })
          },
        })
      },
    })
  },

  /** 清除当前卡的背景图（回到纯色） */
  onClearBgImage() {
    this.setData({ editBgType: 'color', editBgImage: '' })
    const patch: CardStyle = { bgType: 'color' }
    // 同时清掉 bgImage 字段：用空字符串覆盖
    patch.bgImage = ''
    this.applyStylePatch(patch)
  },

  /* ===== S3：主题套用（写 globalStyle） ===== */

  onOpenThemeSheet() {
    this.setData({ showThemeSheet: true })
  },

  onCloseThemeSheet() {
    this.setData({ showThemeSheet: false })
  },

  /** 套用某个主题预设到整个报告（写 report.globalStyle，所有卡片继承） */
  onApplyTheme(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const preset = THEME_PRESETS.find(t => t.id === id)
    if (!preset) return
    const report = this.data.report
    if (!report) return
    const nextReport = { ...report, globalStyle: preset.style }
    this.setData({
      report: nextReport,
      cardViews: buildCardViews(nextReport),
      showThemeSheet: false,
    })
    saveReport(nextReport)
    wx.showToast({ title: '已套用「' + preset.name + '」', icon: 'none' })
  },

  /** 清除报告级主题（删除 globalStyle，所有卡回落到默认） */
  onClearTheme() {
    const report = this.data.report
    if (!report) return
    const nextReport = { ...report }
    delete nextReport.globalStyle
    this.setData({
      report: nextReport,
      cardViews: buildCardViews(nextReport),
      showThemeSheet: false,
    })
    saveReport(nextReport)
    wx.showToast({ title: '已清除主题', icon: 'none' })
  },

  /* ===== 段落级富文本样式编辑 ===== */

  /** 打开某段的样式编辑弹层
   * @param e 事件（dataset.segIndex）或直接传数字（内部调用）
   */
  onOpenSegSheet(e: WechatMiniprogram.TouchEvent) {
    const segIndex = Number(e.currentTarget.dataset.segindex)
    this.openSegSheetByIndex(segIndex)
  },

  /** 内部入口：按段索引打开段样式弹层 */
  openSegSheetByIndex(segIndex: number) {
    const report = this.data.report
    if (!report) return
    const card = report.cards[this.data.current]
    if (!card) return

    // 取该段当前 resolve 后的样式（用于回显）
    const rs = resolveStyle(mergeStyle(report.globalStyle, card.style))
    const segs = (card.segments && card.segments.length > 0)
      ? card.segments
      : (card.content || '').split('\n').map(t => ({ text: t }) as TextSegment)
    const seg = segs[segIndex]
    const segMerged = mergeSegmentStyle(
      { color: rs.textColor, fontSizeScale: rs.fontSizeScale, align: rs.textAlign },
      seg ? seg.style : null
    )

    this.setData({
      showSegSheet: true,
      editingSegIndex: segIndex,
      editSegColor: segMerged.color || rs.textColor,
      editSegFontSizeScale: segMerged.fontSizeScale !== undefined ? segMerged.fontSizeScale : rs.fontSizeScale,
      editSegAlign: segMerged.align || rs.textAlign,
      editArtFont: segMerged.artFont || 'none',
      editStrokeColor: segMerged.strokeColor || '#3D3530',
      editShadowColor: segMerged.shadowColor || 'rgba(61, 53, 48, 0.45)',
      editGradientTo: segMerged.gradientTo || '#D97A4A',
      editStampColor: segMerged.stampColor || '#C0392B',
      editSegRotate: segMerged.rotate !== undefined ? segMerged.rotate : 0,
      editSegSkew: segMerged.skew !== undefined ? segMerged.skew : 0,
      editSegFontFamily: segMerged.fontFamily || 'sans',
      editSegLetterSpacing: segMerged.letterSpacing !== undefined ? segMerged.letterSpacing : 1,
      editSegFreePos: segMerged.boxX !== undefined,
    })
  },

  onCloseSegSheet() {
    this.setData({ showSegSheet: false })
  },

  /** 段颜色 */
  onPickSegColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editSegColor: c })
    this.applySegmentStylePatch({ color: c })
  },

  /** 段字号（连续档：slider 直接给 scale 值，不再走 index） */
  onSegFontSizeChange(e: WechatMiniprogram.SliderChange) {
    const scale = Math.round(Number(e.detail.value) * 100) / 100
    this.setData({ editSegFontSizeScale: scale })
    this.applySegmentStylePatch({ fontSizeScale: scale })
  },

  /** 段对齐 */
  onSwitchSegAlign(e: WechatMiniprogram.TouchEvent) {
    const a = e.currentTarget.dataset.align as 'left' | 'center' | 'right'
    this.setData({ editSegAlign: a })
    this.applySegmentStylePatch({ align: a })
  },

  /* ===== PPT 化段落样式扩展：旋转 / 倾斜 / 字体档 / 字间距 ===== */

  /** 段旋转（slider；值是角度，0=不转） */
  onSegRotateChange(e: WechatMiniprogram.SliderChange) {
    const deg = Math.round(Number(e.detail.value))
    this.setData({ editSegRotate: deg })
    // 写入 0 表示「无旋转」（合并时数值会被继承链正确处理）
    this.applySegmentStylePatch({ rotate: deg })
  },

  /** 段倾斜（slider；值是角度，0=不倾斜） */
  onSegSkewChange(e: WechatMiniprogram.SliderChange) {
    const deg = Math.round(Number(e.detail.value))
    this.setData({ editSegSkew: deg })
    this.applySegmentStylePatch({ skew: deg })
  },

  /** 重置段旋转到 0 */
  onResetSegRotate() {
    this.setData({ editSegRotate: 0 })
    this.applySegmentStylePatch({ rotate: 0 })
  },

  /** 重置段倾斜到 0 */
  onResetSegSkew() {
    this.setData({ editSegSkew: 0 })
    this.applySegmentStylePatch({ skew: 0 })
  },

  /** 段字体档切换（chip 选中） */
  onSwitchSegFontFamily(e: WechatMiniprogram.TouchEvent) {
    const ff = e.currentTarget.dataset.ff as 'sans' | 'serif' | 'kai' | 'mono'
    this.setData({ editSegFontFamily: ff })
    this.applySegmentStylePatch({ fontFamily: ff })
  },

  /** 段字间距（slider；倍数，1=正常） */
  onSegLetterSpacingChange(e: WechatMiniprogram.SliderChange) {
    const mult = Math.round(Number(e.detail.value) * 10) / 10
    this.setData({ editSegLetterSpacing: mult })
    this.applySegmentStylePatch({ letterSpacing: mult })
  },

  /* ===== P10 自由布局开关 =====
   * 开：给该段写默认几何 { boxX:0.1, boxY:0.1, boxW:0.6 } 进入自由定位模式（从流式栈抽出）。
   * 关：mergeSegmentStyle 跳过 undefined 字段不会删，所以这里专门 delete 三字段回回流式堆叠。 */

  /** 切换当前编辑段的自由定位开关。*/
  onToggleSegFreePos() {
    if (this.data.editSegFreePos) {
      // 当前是自由定位 → 关掉：显式删 boxX/boxY/boxW 三字段（mergeSegmentStyle 跳过 undefined）
      this.clearSegBoxPos()
      this.setData({ editSegFreePos: false })
      wx.showToast({ title: '已关闭自由布局', icon: 'none' })
    } else {
      // 当前是流式 → 开启：写默认几何
      this.applySegmentStylePatch({ boxX: 0.1, boxY: 0.1, boxW: 0.6 })
      this.setData({ editSegFreePos: true })
      wx.showToast({ title: '可在卡片上拖动该段', icon: 'none' })
    }
  },

  /** 显式删当前编辑段的 boxX/boxY/boxW 三字段（回回流式堆叠）。
   *  不能走 applySegmentStylePatch（mergeSegmentStyle 跳过 undefined），这里直接操作 segments。 */
  clearSegBoxPos() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const segIndex = this.data.editingSegIndex
    const card = report.cards[current]
    if (!card) return
    if (!card.segments || card.segments.length === 0) return
    const segs = card.segments.slice()
    const seg = segs[segIndex]
    if (!seg || !seg.style) return
    const newStyle: SegmentStyle = { ...seg.style }
    delete (newStyle as any).boxX
    delete (newStyle as any).boxY
    delete (newStyle as any).boxW
    segs[segIndex] = { text: seg.text, style: newStyle, image: seg.image }
    const cards = report.cards.slice()
    cards[current] = { ...card, segments: segs }
    const nextReport = { ...report, cards }
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
    saveReport(nextReport)
  },

  /* ===== 艺术字 ===== */

  /** 切换艺术字风格 */
  onSwitchArtFont(e: WechatMiniprogram.TouchEvent) {
    const art = e.currentTarget.dataset.art as ArtFontStyle
    this.setData({ editArtFont: art })
    // 选 'none' 时清除所有艺术字字段；否则写入 artFont
    if (art === 'none') {
      this.applySegmentStylePatch({ artFont: 'none', strokeColor: undefined, strokeWidth: undefined, shadowColor: undefined, gradientTo: undefined, stampColor: undefined })
    } else {
      this.applySegmentStylePatch({ artFont: art })
    }
  },

  /** 选描边色 */
  onPickStrokeColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editStrokeColor: c })
    this.applySegmentStylePatch({ strokeColor: c })
  },

  /** 选阴影色 */
  onPickShadowColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editShadowColor: c })
    this.applySegmentStylePatch({ shadowColor: c })
  },

  /** 选渐变末端色 */
  onPickGradientTo(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editGradientTo: c })
    this.applySegmentStylePatch({ gradientTo: c })
  },

  /** 选印泥色（印章风用） */
  onPickStampColor(e: WechatMiniprogram.TouchEvent) {
    const c = e.currentTarget.dataset.color as string
    this.setData({ editStampColor: c })
    this.applySegmentStylePatch({ stampColor: c })
  },

  /** 清除当前段的独立样式（回落到卡片样式） */
  onClearSegStyle() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    const segIndex = this.data.editingSegIndex

    // 若已有 segments，删除该段的 style 字段（保留 text 和 image）
    if (card.segments && card.segments.length > 0) {
      const segs = card.segments.slice()
      if (segs[segIndex]) {
        const old = segs[segIndex]
        const cleared: TextSegment = { text: old.text }
        if (old.image) cleared.image = old.image  // 图片段：保留图片，只清样式
        segs[segIndex] = cleared
      }
      const cards = report.cards.slice()
      cards[current] = { ...card, segments: segs }
      const nextReport = { ...report, cards }
      this.setData({
        report: nextReport,
        cardViews: buildCardViews(nextReport),
        showSegSheet: false,
      })
      saveReport(nextReport)
      wx.showToast({ title: '已清除该段样式', icon: 'none' })
    } else {
      // 没有 segments（即该段无样式可清）——直接关闭
      this.setData({ showSegSheet: false })
    }
  },

  /** 在当前卡末尾追加一个图片段（用户从相册/拍照选择） */
  onInsertImage() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempPath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!tempPath) return
        // 用 getImageInfo 拿稳定路径（与背景图上传同款逻辑）
        wx.getImageInfo({
          src: tempPath,
          success: (info) => this.appendImageSegment(info.path),
          fail: () => this.appendImageSegment(tempPath),  // 退化用 tempPath
        })
      },
    })
  },

  /** 把图片路径作为新段追加到当前卡的 segments 末尾 */
  appendImageSegment(path: string) {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    // 懒创建 segments：若不存在，按 content 切段
    let segs: TextSegment[]
    if (card.segments && card.segments.length > 0) {
      segs = card.segments.slice()
    } else {
      segs = (card.content || '').split('\n').map(t => ({ text: t }) as TextSegment)
    }
    segs.push({ text: '', image: path })  // 追加图片段
    const cards = report.cards.slice()
    cards[current] = { ...card, segments: segs }
    const nextReport = { ...report, cards }
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
    saveReport(nextReport)
    wx.showToast({ title: '已插入图片', icon: 'success' })
  },

  /** 删除某个图片段（由段落预览的图片段「删除」按钮触发） */
  onDeleteSegImage(e: WechatMiniprogram.TouchEvent) {
    const segIndex = Number(e.currentTarget.dataset.segindex)
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    if (!card.segments || card.segments.length === 0) return
    wx.showModal({
      title: '删除这张图片？',
      content: '图片段将从卡片中移除',
      confirmText: '删除',
      confirmColor: designTokens.color.danger,
      success: (r) => {
        if (!r.confirm) return
        const segs = (card.segments || []).slice()
        segs.splice(segIndex, 1)
        const cards = report.cards.slice()
        cards[current] = { ...card, segments: segs }
        const nextReport = { ...report, cards }
        this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
        saveReport(nextReport)
        wx.showToast({ title: '已删除', icon: 'none' })
      },
    })
  },

  /**
   * 把段样式补丁写回当前卡某段的 style
   * 若 segments 不存在，按当前 content 切段懒创建
   */
  applySegmentStylePatch(patch: SegmentStyle) {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const segIndex = this.data.editingSegIndex
    const card = report.cards[current]
    if (!card) return

    // 懒创建 segments：若不存在，按 content 切段
    let segs: TextSegment[]
    if (card.segments && card.segments.length > 0) {
      segs = card.segments.slice()
    } else {
      segs = (card.content || '').split('\n').map(t => ({ text: t }) as TextSegment)
    }
    // 合并该段的旧 style + 新补丁
    if (segs[segIndex]) {
      const oldStyle = segs[segIndex].style || {}
      const merged = mergeSegmentStyle(oldStyle, patch)
      segs[segIndex] = { text: segs[segIndex].text, style: merged }
    }

    const cards = report.cards.slice()
    cards[current] = { ...card, segments: segs }
    const nextReport = { ...report, cards }
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
    saveReport(nextReport)
  },

  /** textarea 失焦：把 content 按 \n 重新切段，与现有文字段按索引匹配保留 style
   *  图片段（image 非空）不参与 content 同步——它们独立存在，保留在文字段之后 */
  onContentBlur() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return
    // 没有 segments 就不用同步
    if (!card.segments || card.segments.length === 0) return

    const oldSegs = card.segments
    // 拆分：文字段参与 content 同步；图片段原样保留（追加在文字段之后）
    const oldTextSegs = oldSegs.filter(s => !s.image)
    const oldImageSegs = oldSegs.filter(s => !!s.image)
    const newRawLines = (card.content || '').split('\n')
    // 文字段：按索引匹配，老段有 style 就保留（超出老段的 新行无样式）
    const newTextSegs: TextSegment[] = newRawLines.map((text, i) => {
      const old = oldTextSegs[i]
      return old && old.style ? { text, style: old.style } : { text }
    })
    const newSegs: TextSegment[] = newTextSegs.concat(oldImageSegs)

    const cards = report.cards.slice()
    cards[current] = { ...card, segments: newSegs }
    const nextReport = { ...report, cards }
    this.setData({ report: nextReport, cardViews: buildCardViews(nextReport) })
    saveReport(nextReport)
  },

  /* === T2-4 段落结构预设（三段式快捷模板）===
   * 现有编辑器已支持「换行分段 + 每段独立样式」（segments 管线），但分段靠用户手动敲回车，
   * 可发现性弱。这里加一组结构预设按钮：点击把预设的多段骨架写入 content，
   * 用户只需把占位文字改成自己的话。骨架里每段语义角色（引言/正文/落款）明确标注，
   * 配合每段独立样式 sheet，自然形成「引言+正文+落款」三段式视觉层次。
   * 不新增类型、不改 segments 管线——纯 content 文本模板辅助。 */

  /** 应用段落结构预设：把骨架模板写入当前卡的 content。
   *  空 content 直接写入；非空则弹确认（避免覆盖用户已有内容）。 */
  onApplyParagraphPreset(e: WechatMiniprogram.TouchEvent) {
    const presetId = e.currentTarget.dataset.preset as string
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    const card = report.cards[current]
    if (!card) return

    const skeleton = PARAGRAPH_PRESETS.find(p => p.id === presetId)
    if (!skeleton) return

    const existing = (card.content || '').trim()
    const apply = () => {
      const contentInput = skeleton.template
      this.patchCurrentCard({ content: contentInput })
      this.setData({ contentInput })
      wx.showToast({ title: '已套用「' + skeleton.label + '」', icon: 'none' })
    }

    if (existing) {
      wx.showModal({
        title: '覆盖正文？',
        content: '当前正文非空，套用预设会替换已有内容。',
        confirmText: '替换',
        cancelText: '取消',
        success: (res) => { if (res.confirm) apply() },
      })
    } else {
      apply()
    }
  },

  onShareAppMessage() {
    return {
      title: (this.data.report ? this.data.report.title : '') || '阅观年度 — 我的年度报告',
      path: '/pages/index/index',
    }
  },

  onShareTimeline() {
    return {
      title: (this.data.report ? this.data.report.title : '') || '我的年度报告 · 阅观年度',
    }
  },
})
