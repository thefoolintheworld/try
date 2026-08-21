// utils/design-tokens.ts
// 设计令牌：配色与字号常量（与 app.less 顶部 LESS 变量同步）
// 所有颜色/字号都从这里读，不要硬编码 hex
//
// S2 扩展：新增 CardStyle 卡片样式模型 + mergeStyle/resolveStyle + THEME_PRESETS 主题预设
// 这是样式系统的「单一数据源」：poster.ts（canvas 导出）和 report-edit（wxml 预览）都从这里读样式

export const designTokens = {
  color: {
    bg:            '#FAF6F0',
    card:          '#FFFFFF',
    textPrimary:   '#3D3530',
    textSecondary: '#6F6354',   // WCAG AA: 对 #FAF6F0 对比度 5.2+（原 #8B7D6E 仅 3.71 不达标）
    accent:        '#D97A4A',
    book:          '#6B8E5A',
    film:          '#8B6F9C',
    star:          '#E8A33D',
    divider:       '#E8E0D5',
    danger:        '#C05650',   // 与 app.less --color-danger 同源（统一 confirmColor 等）
  },
  fontSize: {
    // 单位 rpx；与 app.less --font-size-* 同源
    xs: 20,      // 角标/极小辅助
    s: 22,       // 辅助说明（最高频）
    sm: 24,      // 次文字
    base: 26,    // 正文小
    m: 28,       // 正文
    l: 30,       // 小标题/强调正文
    lg: 32,      // 标题基准
    xl: 40,      // 大标题
    xxl: 56,     // 展示标题
    display: 96, // 数字展示（年份/计数）
    xxl2: 120,   // 更大数字展示（打卡计数/连胜天数）
    display2: 160, // 最大数字展示（年份仪式位）
  },
  // 条目卡片自动分配的代表色（coverColor 候选）
  coverPalette: ['#D97A4A', '#6B8E5A', '#8B6F9C', '#5B8FA8', '#C26B6B', '#A88B5C'],
  // 三环/图例等仪式语义色（与 app.less --color-ring-* 同源；canvas 用）
  ringColors: {
    red:   '#F54D4D',
    green: '#6BE36B',
    blue:  '#4A9DFF',
  },
} as const

export type DesignTokens = typeof designTokens

/* ============================================================
 * canvasColors —— Canvas 字面色单一真相源
 * ============================================================
 * Canvas 无法读 CSS 变量（@color-* 别名是 var()，编译期取不到值），
 * 所以 canvas 页只能用字面 hex。这里集中导出 canvas 专用色，让
 * tree/graph/wrapped/poster 都从这里取，避免散落硬编码：
 *   - 改主题色时只改这里 + designTokens，canvas 页自动跟随
 *   - 与 app.less 的 CSS 变量保持同源（手动同步，改一处改两处）
 *
 * 包含：
 *   - nav 导航栏色（4 个 canvas 页共用 navigation-bar）
 *   - pageFill 页面/canvas 底色
 *   - starGold/starGoldSoft 里程碑星辉（含淡色派生）
 *   - inkDark 树/图节点描边的深墨色
 *   - personalitySoft Wrapped 第三幕人格色淡化（派生自 book）
 *   - categoryPalette 分类色板（与 category-meta.ts 同源，作者/分类节点用）
 *   - authorPalette 作者节点色板（coverPalette 子集 + 一色补充）
 */
export const canvasColors = {
  // 导航栏（与 navigation-bar 组件默认色一致）
  nav: {
    color: designTokens.color.textPrimary,   // #3D3530
    bg:    designTokens.color.bg,             // #FAF6F0
  },
  // canvas / 页面填充底
  pageFill:        designTokens.color.bg,     // #FAF6F0
  pageCardFill:    designTokens.color.card,   // #FFFFFF
  // 星辉里程碑（tree 用；starGoldSoft 是 starGold 的淡色派生）
  starGold:        designTokens.color.star,   // #E8A33D
  starGoldSoft:    '#F5C26B',                 // 淡金黄（starGold 浅化，canvas 装饰派生）
  // 深墨色：树节点描边（暗背景下勾勒节点边界用）
  inkDark:         '#2C2A28',
  // Wrapped 第三幕人格色淡化（派生自 book #6B8E5A 的浅化）
  personalitySoft: '#A8C49A',
  // 分类色板：与 utils/category-meta.ts 同源，canvas 节点按分类取色用
  categoryPalette: {
    reading: designTokens.color.book,   // #6B8E5A
    film:    designTokens.color.film,   // #8B6F9C
    skill:   designTokens.color.star,   // #E8A33D
    game:    designTokens.color.accent, // #D97A4A
    travel:  '#5B8FA8',
    exam:    '#C26B6B',
    first:   '#A88B5C',
  },
  // 作者节点色板（graph 外环节点按作者轮转取色；coverPalette 子集 + 补一色）
  authorPalette: ['#6B8E5A', '#5B8FA8', '#8B6F9C', '#C26B6B', '#A88B5C', '#7BA8B5'],
  // 三环/图例等仪式语义色（与 app.less --color-ring-* 亮色值同源；canvas 端用）
  ringRed:   designTokens.ringColors.red,    // #F54D4D
  ringGreen: designTokens.ringColors.green,  // #6BE36B
  ringBlue:  designTokens.ringColors.blue,   // #4A9DFF
} as const

/** canvasColors 的结构类型（字段统一为 string，让 light/dark 两套都能赋值） */
export interface CanvasColors {
  nav: { color: string; bg: string }
  pageFill: string
  pageCardFill: string
  starGold: string
  starGoldSoft: string
  inkDark: string
  personalitySoft: string
  categoryPalette: {
    reading: string; film: string; skill: string; game: string
    travel: string; exam: string; first: string
  }
  authorPalette: readonly string[]
  ringRed: string
  ringGreen: string
  ringBlue: string
}

/* ============================================================
 * canvasColorsDark —— 暗色主题下的 canvas 配色（双主题另一端）
 * ============================================================
 * 与 app.less 的 .theme-dark 段同源：
 *   - nav 用 theme.ts buildNavColors 的暗色返回值（与导航栏实际渲染一致）
 *   - pageFill 取 theme-dark-neutral 的底色（三套暗色变体里最中性的；
 *     canvas 无法读 CSS 变量，只能选一个代表色；用户切到 warm/oled 变体时
 *     canvas 底色会有微小差异，但都是深色调，视觉一致）
 *   - pageCardFill 取暗色下的亮文字色（节点填充在深底上要够亮才看得见）
 *   - 分类/作者色板用 .theme-dark 的提亮版本（与 app.less 同源）
 *
 * 用法：调 getCanvasColors(theme) 自动选 light/dark，canvas 页无需自己判断。
 */
export const canvasColorsDark: CanvasColors = {
  nav: {
    color: '#EDE4D8',   // 与 theme.ts buildNavColors 暗色返回一致
    bg:    '#1F1B17',
  },
  pageFill:        '#1C1C1E',  // theme-dark-neutral 底色
  pageCardFill:    '#F2E9DC',  // 暗色下的亮文字色（节点填充用）
  starGold:        '#F5C26B',  // 暗色下星辉提亮
  starGoldSoft:    '#FFE2A0',
  inkDark:         '#0F0F0F',  // 暗色下节点描边用更深的墨色
  personalitySoft: '#C8DDB0',  // 暗色下人格色淡化提亮
  categoryPalette: {
    reading: '#9CC080',  // book 暗色版
    film:    '#C5A8D8',  // film 暗色版
    skill:   '#F5C26B',  // star 暗色版
    game:    '#F0A875',  // accent 暗色版
    travel:  '#7BB8D0',
    exam:    '#E0A0A0',
    first:   '#D0B888',
  },
  authorPalette: ['#9CC080', '#7BB8D0', '#C5A8D8', '#E0A0A0', '#D0B888', '#9BC8D8'],
  // 三环/图例语义色：暗色下提亮（与 app.less .theme-dark --color-ring-* 同源）
  ringRed:   '#FF6B6B',
  ringGreen: '#8EE68E',
  ringBlue:  '#78AFFF',
}

/**
 * 按主题选 canvas 配色：light → canvasColors，dark → canvasColorsDark。
 * canvas 页在构建节点 / 绘制前调用一次，拿到对应主题的调色板。
 * 配合 getThemeCache() 读当前主题即可实现「切主题自动换色」。
 */
export function getCanvasColors(theme: 'light' | 'dark'): CanvasColors {
  return theme === 'dark' ? canvasColorsDark : canvasColors
}

/* ============================================================
 * CardStyle —— 卡片样式模型（S2 核心）
 * ============================================================
 * 继承链：card.style > report.globalStyle > template.cards[i].style > DEFAULT_CARD_STYLE
 * 任意一层不写（undefined 字段）就往下继承。mergeStyle 函数负责逐层合并。
 * 所有字段都可选，老数据读出来自然是 undefined，零迁移成本。
 */

/** 背景类型 */
export type BgType = 'color' | 'gradient' | 'image'

/** 文字对齐 */
export type TextAlign = 'left' | 'center' | 'right'

/** 卡片样式（每张卡可有独立配置；不配置则走继承链） */
export interface CardStyle {
  /** 背景类型 */
  bgType?: BgType
  /** 纯色背景色（bgType='color' 时生效；不填走 card 令牌） */
  bgColor?: string
  /** 渐变两端色（bgType='gradient' 时生效） */
  bgGradient?: [string, string]
  /** 背景图：内置图 id（如 'paper-warm'）或用户本地路径（S3 才用到） */
  bgImage?: string
  /** 背景图蒙版透明度 0-1（避免图片压过文字） */
  bgImageOpacity?: number

  /** 正文颜色 */
  textColor?: string
  /** 标题颜色（不填则跟 accent 令牌） */
  titleColor?: string
  /** 字号缩放倍数（1 = 默认，0.8 小，1.3 大） */
  fontSizeScale?: number
  /** 文字对齐 */
  textAlign?: TextAlign

  /** 内容内边距（css px，相对宽 600 的比例尺；不填走默认 80） */
  padding?: number
}

/* ============================================================
 * SegmentStyle —— 段落级文字样式（富文本，S3+ 新增）
 * ============================================================
 * 每张卡片的正文按 \n 切成多段，每段可独立配置文字样式。
 * 继承链：段 style > 卡片 style 的对应字段 > 默认
 * 仅含「文字相关」字段（不含背景），因为背景是整卡的。
 */

/** 艺术字风格（整段应用）
 *  光影发光：neon 霓虹发光 / glow 高光描边
 *  渐变色彩：rainbow 彩虹渐变 / metallic 金属质感
 *  立体浮雕：relief 立体投影 / letterpress 凹陷字
 *  复古印刷：vintage 复古做旧 / stamp 印章风 */
export type ArtFontStyle =
  | 'none' | 'outline' | 'shadow' | 'gradient' | 'handwritten'
  | 'neon' | 'glow'
  | 'rainbow' | 'metallic'
  | 'relief' | 'letterpress'
  | 'vintage' | 'stamp'

export interface SegmentStyle {
  /** 该段文字颜色（不填继承卡片 textColor） */
  color?: string
  /** 该段字号缩放（不填继承卡片 fontSizeScale） */
  fontSizeScale?: number
  /** 该段对齐（不填继承卡片 textAlign） */
  align?: TextAlign
  /** 艺术字风格（不填即 'none' 普通字） */
  artFont?: ArtFontStyle
  /** 描边色（artFont='outline' 时生效；不填默认用 color 的对比色） */
  strokeColor?: string
  /** 描边粗细 css px（相对 600 宽；不填默认 2） */
  strokeWidth?: number
  /** 阴影色（artFont='shadow' 时生效；不填默认半透明黑） */
  shadowColor?: string
  /** 渐变末端色（artFont='gradient'/'metallic' 时生效；起点用 color） */
  gradientTo?: string
  /** 印泥色（artFont='stamp' 时生效；不填默认印泥红 #C0392B） */
  stampColor?: string
  /** 旋转角度（度，-180~180；正=顺时针；0/不填=不转）。PPT 化段落样式扩展 */
  rotate?: number
  /** 倾斜变形角度（度，-45~45；skewX 平行四边形错切；0/不填=不倾斜） */
  skew?: number
  /** 字体档（'sans' 无衬线 / 'serif' 衬线 / 'kai' 楷体 / 'mono' 等宽；不填继承卡片/默认）
   *  注：楷体档依赖设备系统字体，不同机型渲染可能不完全一致 */
  fontFamily?: 'sans' | 'serif' | 'kai' | 'mono'
  /** 字间距倍数（0.6~2.0；1=正常；仅影响视觉间距，不强制换行） */
  letterSpacing?: number
  /** 段落盒水平位置（卡片正文区宽的小数 0~1；0=最左 1=最右；不填=流式堆叠）。PPT 化自由布局 */
  boxX?: number
  /** 段落盒垂直位置（卡片正文区高的小数 0~1；0=最上 1=最下；不填=流式堆叠） */
  boxY?: number
  /** 段落盒宽度（卡片正文区宽的小数 0~1；不填=撑满内容区；高度始终跟内容走不裁字） */
  boxW?: number
}

/**
 * 合并多层 SegmentStyle：后者覆盖前者（后者优先级更高）
 * 用法：mergeSegmentStyle(卡片级投影, 段自身 style)
 */
export function mergeSegmentStyle(...layers: (SegmentStyle | null | undefined)[]): SegmentStyle {
  const out: SegmentStyle = {}
  for (const layer of layers) {
    if (!layer) continue
    if (layer.color !== undefined) out.color = layer.color
    if (layer.fontSizeScale !== undefined) out.fontSizeScale = layer.fontSizeScale
    if (layer.align !== undefined) out.align = layer.align
    if (layer.artFont !== undefined) out.artFont = layer.artFont
    if (layer.strokeColor !== undefined) out.strokeColor = layer.strokeColor
    if (layer.strokeWidth !== undefined) out.strokeWidth = layer.strokeWidth
    if (layer.shadowColor !== undefined) out.shadowColor = layer.shadowColor
    if (layer.gradientTo !== undefined) out.gradientTo = layer.gradientTo
    if (layer.stampColor !== undefined) out.stampColor = layer.stampColor
    if (layer.rotate !== undefined) out.rotate = layer.rotate
    if (layer.skew !== undefined) out.skew = layer.skew
    if (layer.fontFamily !== undefined) out.fontFamily = layer.fontFamily
    if (layer.letterSpacing !== undefined) out.letterSpacing = layer.letterSpacing
    if (layer.boxX !== undefined) out.boxX = layer.boxX
    if (layer.boxY !== undefined) out.boxY = layer.boxY
    if (layer.boxW !== undefined) out.boxW = layer.boxW
  }
  return out
}

/** 默认卡片样式：所有继承链的兜底 */
export const DEFAULT_CARD_STYLE: Required<CardStyle> = {
  bgType: 'color',
  bgColor: designTokens.color.card,
  bgGradient: [designTokens.color.accent, designTokens.color.book],
  bgImage: '',
  bgImageOpacity: 0.25,
  textColor: designTokens.color.textPrimary,
  titleColor: designTokens.color.accent,
  fontSizeScale: 1,
  textAlign: 'left',
  padding: 80,
}

/**
 * 合并多层 CardStyle：后者覆盖前者（后者优先级更高）
 * 用法：mergeStyle(默认, 模板级, 报告级, 卡片级)
 * 任何一个传 undefined/null 都安全跳过；空对象 {} 也安全（无字段覆盖）。
 */
export function mergeStyle(...layers: (CardStyle | null | undefined)[]): CardStyle {
  const out: CardStyle = {}
  for (const layer of layers) {
    if (!layer) continue
    if (layer.bgType !== undefined) out.bgType = layer.bgType
    if (layer.bgColor !== undefined) out.bgColor = layer.bgColor
    if (layer.bgGradient !== undefined) out.bgGradient = layer.bgGradient
    if (layer.bgImage !== undefined) out.bgImage = layer.bgImage
    if (layer.bgImageOpacity !== undefined) out.bgImageOpacity = layer.bgImageOpacity
    if (layer.textColor !== undefined) out.textColor = layer.textColor
    if (layer.titleColor !== undefined) out.titleColor = layer.titleColor
    if (layer.fontSizeScale !== undefined) out.fontSizeScale = layer.fontSizeScale
    if (layer.textAlign !== undefined) out.textAlign = layer.textAlign
    if (layer.padding !== undefined) out.padding = layer.padding
  }
  return out
}

/** 把合并后的 CardStyle 补全为 Required（填入默认值），给 canvas 绘制用 */
export function resolveStyle(
  ...layers: (CardStyle | null | undefined)[]
): Required<CardStyle> {
  const merged = mergeStyle(...layers)
  return {
    bgType: merged.bgType !== undefined ? merged.bgType : DEFAULT_CARD_STYLE.bgType,
    bgColor: merged.bgColor !== undefined ? merged.bgColor : DEFAULT_CARD_STYLE.bgColor,
    bgGradient: merged.bgGradient !== undefined ? merged.bgGradient : DEFAULT_CARD_STYLE.bgGradient,
    bgImage: merged.bgImage !== undefined ? merged.bgImage : DEFAULT_CARD_STYLE.bgImage,
    bgImageOpacity: merged.bgImageOpacity !== undefined ? merged.bgImageOpacity : DEFAULT_CARD_STYLE.bgImageOpacity,
    textColor: merged.textColor !== undefined ? merged.textColor : DEFAULT_CARD_STYLE.textColor,
    titleColor: merged.titleColor !== undefined ? merged.titleColor : DEFAULT_CARD_STYLE.titleColor,
    fontSizeScale: merged.fontSizeScale !== undefined ? merged.fontSizeScale : DEFAULT_CARD_STYLE.fontSizeScale,
    textAlign: merged.textAlign !== undefined ? merged.textAlign : DEFAULT_CARD_STYLE.textAlign,
    padding: merged.padding !== undefined ? merged.padding : DEFAULT_CARD_STYLE.padding,
  }
}

/* ============================================================
 * 主题预设：一键套用一组配色（S3 才会用到 UI，先定义出来）
 * ============================================================ */
export interface ThemePreset {
  id: string
  name: string
  /** 套用后写入 CardStyle 的样式（bgType + bgColor + textColor + titleColor） */
  style: CardStyle
  /** 预览色块（供 UI 用） */
  swatch: [string, string]   // [背景色, 强调色]
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'warm-literary',
    name: '暖橘文学',
    style: {
      bgType: 'color',
      bgColor: '#FAF6F0',
      textColor: '#3D3530',
      titleColor: '#D97A4A',
    },
    swatch: ['#FAF6F0', '#D97A4A'],
  },
  {
    id: 'ink-green',
    name: '墨绿素雅',
    style: {
      bgType: 'color',
      bgColor: '#F2F4EE',
      textColor: '#3A4035',
      titleColor: '#6B8E5A',
    },
    swatch: ['#F2F4EE', '#6B8E5A'],
  },
  {
    id: 'deep-night',
    name: '深夜静读',
    style: {
      bgType: 'color',
      bgColor: '#2C2A28',
      textColor: '#E8E0D5',
      titleColor: '#E8A33D',
    },
    swatch: ['#2C2A28', '#E8A33D'],
  },
  {
    id: 'pure-white',
    name: '素白极简',
    style: {
      bgType: 'color',
      bgColor: '#FFFFFF',
      textColor: '#1A1A1A',
      titleColor: '#1A1A1A',
    },
    swatch: ['#FFFFFF', '#1A1A1A'],
  },
]

/* ============================================================
 * 内置背景预设（S3 新增）
 * ============================================================
 * 不引入真实图片文件（避免外部素材版权/审核问题），改用「程序化纹理」：
 *   - bgImage 字段存内置 preset id（如 'paper-warm'）或用户上传的本地路径
 *   - drawBackground 检测 bgImage 是否在 BUILT_IN_BG_IDS 里：
 *       是 → 走对应程序化纹理（canvas 内绘制噪点/网格/渐变）
 *       否 → 当作用户图片路径，走 wx.getImageInfo + drawImage（S3-2）
 */

/** 程序化纹理类型 */
export type BgTextureKind = 'paper' | 'grid' | 'dot' | 'watercolor' | 'wave'

export interface BgPreset {
  id: string
  name: string
  /** 程序化纹理类型（驱动 canvas 绘制） */
  texture: BgTextureKind
  /** 纹理底色（绘制时填整个 canvas） */
  baseColor: string
  /** 纹理叠加色（绘制图案用） */
  patternColor: string
  /** 叠加不透明度（0-1） */
  patternOpacity: number
  /** UI 预览色块（缩略感） */
  swatch: string
}

export const BG_PRESETS: BgPreset[] = [
  {
    id: 'paper-warm',
    name: '暖纸纹',
    texture: 'paper',
    baseColor: '#FAF6F0',
    patternColor: '#D9B888',
    patternOpacity: 0.08,
    swatch: '#FAF6F0',
  },
  {
    id: 'paper-cream',
    name: '米黄纸',
    texture: 'paper',
    baseColor: '#FBF1DD',
    patternColor: '#C9A266',
    patternOpacity: 0.10,
    swatch: '#FBF1DD',
  },
  {
    id: 'grid-soft',
    name: '细格',
    texture: 'grid',
    baseColor: '#F5F5F0',
    patternColor: '#B8B0A0',
    patternOpacity: 0.18,
    swatch: '#F5F5F0',
  },
  {
    id: 'dot-minimal',
    name: '点点',
    texture: 'dot',
    baseColor: '#FFFFFF',
    patternColor: '#D97A4A',
    patternOpacity: 0.22,
    swatch: '#FFFFFF',
  },
  {
    id: 'watercolor-orange',
    name: '水彩橙',
    texture: 'watercolor',
    baseColor: '#FFF8F0',
    patternColor: '#F2C28E',
    patternOpacity: 0.45,
    swatch: '#FFE8D0',
  },
  {
    id: 'watercolor-green',
    name: '水彩绿',
    texture: 'watercolor',
    baseColor: '#F4F8EE',
    patternColor: '#B6D49A',
    patternOpacity: 0.45,
    swatch: '#E0F0CC',
  },
  {
    id: 'wave-calm',
    name: '波纹',
    texture: 'wave',
    baseColor: '#EEF3F5',
    patternColor: '#7AA6B8',
    patternOpacity: 0.25,
    swatch: '#D8E8EE',
  },
]

/** 内置背景 id 集合（快速判断 bgImage 是内置名还是用户图片路径） */
export const BUILT_IN_BG_IDS: { [id: string]: BgPreset } = BG_PRESETS.reduce(
  (map, p) => { map[p.id] = p; return map },
  {} as { [id: string]: BgPreset }
)

/** 判断 bgImage 是否是内置预设（而非用户上传路径） */
export function isBuiltInBg(bgImage: string): boolean {
  return !!bgImage && !!BUILT_IN_BG_IDS[bgImage]
}

/** 取内置预设；若不是内置则返回 null */
export function getBuiltInBg(bgImage: string): BgPreset | null {
  return BUILT_IN_BG_IDS[bgImage] || null
}

/**
 * 把内置纹理预设转成 CSS 近似背景（编辑页 wxml 预览用）。
 * canvas 用程序化绘制（噪点/网格/径向色斑），CSS 无法精确复现，这里做视觉近似的预览：
 *   - paper/dot/grid/wave → 底色 + 微弱 patternColor 叠加（表达"有纹理感"）
 *   - watercolor → 底色 + 多层径向渐变（模拟 canvas 画的几个柔和色斑），让用户在编辑页就能看到水彩大致效果
 * 返回完整的 CSS background 声明（含底色），调用方直接拼到 style 里。
 * 不是内置预设则返回空串（调用方回落到纯色）。
 */
export function builtInBgToCss(bgImage: string): string {
  const p = getBuiltInBg(bgImage)
  if (!p) return ''
  const c = p.patternColor
  const op = p.patternOpacity
  // rgba：把 hex patternColor 转 rgb，再拼 opacity
  const r = parseInt(c.slice(1, 3), 16)
  const g = parseInt(c.slice(3, 5), 16)
  const b = parseInt(c.slice(5, 7), 16)
  const rgba = (a: number) => `rgba(${r},${g},${b},${a})`
  if (p.texture === 'watercolor') {
    // 模拟 canvas 的 3 个径向色斑（左上、右下、中部）
    return `background-color: ${p.baseColor}; background-image: radial-gradient(circle at 20% 25%, ${rgba(op)} 0%, transparent 50%), radial-gradient(circle at 80% 70%, ${rgba(op * 0.9)} 0%, transparent 45%), radial-gradient(circle at 50% 50%, ${rgba(op * 0.7)} 0%, transparent 35%);`
  }
  if (p.texture === 'wave') {
    // 波纹：几道同心圆弧的近似（用重复径向渐变）
    return `background-color: ${p.baseColor}; background-image: repeating-radial-gradient(circle at 70% 30%, ${rgba(op)} 0px, ${rgba(op)} 1px, transparent 1px, transparent 14px);`
  }
  // paper / dot / grid：底色 + 极弱的 patternColor 蒙层（表达"纸感"，不强求精确）
  return `background-color: ${p.baseColor}; background-image: linear-gradient(${rgba(op * 0.5)}, ${rgba(op * 0.5)});`
}
