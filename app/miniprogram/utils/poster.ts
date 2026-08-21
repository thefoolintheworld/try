// utils/poster.ts
// 报告卡片 canvas 绘制原语：把一张 ReportCard 画到 canvas 上
// 严守 dpr 纪律：调用方负责设 canvas.width/height 和 ctx.scale，本函数只用 css 坐标系绘制
// 所有字号、间距按画布尺寸比例计算，保证任意尺寸不重叠
//
// S2 改造：drawCard 接受 resolvedStyle（合并后的最终样式），背景/文字读样式字段
// 调用方负责把继承链（卡片 > 报告 > 模板 > 默认）合并好后传入；
// 不传 style 则全部走 DEFAULT_CARD_STYLE（向后兼容老调用）

import { ReportCard, CardType, TextSegment } from './storage'
import { CardStyle, SegmentStyle, resolveStyle, mergeSegmentStyle, DEFAULT_CARD_STYLE, designTokens, getBuiltInBg, isBuiltInBg, BgPreset } from './design-tokens'

/** 已 resolve 的样式（全字段必填），绘制函数内部统一用这个类型 */
type ResolvedStyle = Required<CardStyle>

/** 卡片配色点缀（按 type 区分主色调）—— 仅用于装饰元素（右上角圆点等），不覆盖样式系统的文字色 */
const CARD_ACCENT: Record<CardType, string> = {
  cover: designTokens.color.accent,
  overview: designTokens.color.book,
  footprint: designTokens.color.accent,
  favorite: '#C05650',
  theme: '#8B6F9C',
  quote: designTokens.color.book,
  journey: designTokens.color.accent,
  ending: designTokens.color.textSecondary,
}

/** 标准卡片宽高比（宽:高 = 3:4，与 report-edit swiper 卡片一致） */
export const CARD_ASPECT = 3 / 4

/**
 * 把一张卡片画到整个 canvas（用于单张导出 / 屏幕预览）
 * @param ctx 已被调用方 scale 过 dpr 的 2d context
 * @param w css 宽
 * @param h css 高
 * @param card 卡片数据
 * @param style 已合并的最终样式（可选；不传走默认）
 */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  card: ReportCard,
  style?: CardStyle
): void {
  // 合并到完整样式（保证后续绘制每个字段都有值）
  const rs: ResolvedStyle = style ? resolveStyle(style) : DEFAULT_CARD_STYLE

  // 清空
  ctx.clearRect(0, 0, w, h)

  // 比例尺：以宽 600 为基准
  const s = w / 600

  // 背景
  drawBackground(ctx, w, h, rs)

  switch (card.type) {
    case 'cover':
      drawCoverCard(ctx, w, h, s, card, rs)
      break
    case 'ending':
      drawEndingCard(ctx, w, h, s, card, rs)
      break
    default:
      drawNormalCard(ctx, w, h, s, card, rs)
  }
}

/* ===== 背景：支持纯色 / 渐变 / 内置程序化纹理 / 用户上传图片 ===== */

/** 用户图片缓存：路径 → WxImage（加载完后复用，避免重复 getImageInfo） */
const _imageCache: { [path: string]: WxImage } = {}

/**
 * 图片工厂：用于创建可绘制的 Image 对象。
 * 问题：wx.createImage 在部分基础库/模拟器上不存在（TypeError: wx.createImage is not a function），
 *       它一旦抛错会让 preloadImagePath 的 Promise reject，连锁导致整页预览空白、导出卡死。
 * 解决：页面拿到任意一个 Canvas 2D 节点后，通过 setImageFactory 注入 canvas.createImage；
 *       preloadImagePath 优先用注入的工厂，回退 wx.createImage，两者都没有则放弃加载（不抛错）。
 * canvas.createImage 是 Canvas 2D 官方推荐 API，一定可用。
 */
let _imageFactory: (() => any) | null = null

/** 注入图片工厂（传入任意 Canvas 2D 节点，用其 createImage 方法） */
export function setImageFactory(canvas: any): void {
  if (_imageFactory) return  // 已注入
  if (canvas && typeof canvas.createImage === 'function') {
    _imageFactory = () => canvas.createImage()
    console.log('[poster] 已注入图片工厂 canvas.createImage')
  }
}

/** P6 超长拆卡：单卡容纳段数预算（超出则拆成多张同类型卡）。
 *  经验值：默认正文字号 × 1.9 行高，卡片高 ≈ 宽/0.75，约可放 6~8 段（每段可能折多行），
 *  取保守值 6，宁可多拆一张也不要丢字。封面/落款不拆（语义上各自一张）。*/
export const SEGMENT_BUDGET_PER_CARD = 6

/** P6 超长拆卡：把一张卡按段数预算拆成多张同类型卡（纯函数，不碰 canvas）。
 *
 *  解决场景：模板引擎循环块（功能 4）把 N 条金句 / N 本带地点的书展开进单卡 content，
 *  导致单卡段数远超可绘制高度，导出时 drawSegments 的 curY>=maxH 截断丢字。
 *
 *  规则：
 *    - 取段数组：优先 card.segments，否则按 content 的 \n 切段（与 drawSegments 同源）。
 *    - 段数 ≤ 预算 → 返回 [card]（单元素数组，含原卡；不复制以避免无谓开销）。
 *    - 段数 > 预算 → 按预算切块，每块克隆一张卡：type/style/bookRef 继承，标题从第二张起加「（续）」，
 *      content 按该块的段文本用 \n 重建，segments 同步生成（保证导出走 segments 时也是分块后的）。
 *    - 封面/落款卡不拆（语义上各自一张，即便段多也应单卡容纳）。
 *    - 图片段：参与计数但不因拆分而丢图（块内图片段保留 image 字段）。
 *
 *  @returns 拆分后的卡片数组（1 张或多张）；调用方用它替代原卡参与导出循环。
 */
export function splitCardIfOverflow(card: ReportCard, budget: number = SEGMENT_BUDGET_PER_CARD): ReportCard[] {
  // 封面/落款不拆
  if (card.type === 'cover' || card.type === 'ending') return [card]
  // 取段数组（与 drawSegments 同源）
  let segs: TextSegment[]
  if (card.segments && card.segments.length > 0) {
    segs = card.segments
  } else {
    segs = (card.content || '').split('\n').map(text => ({ text }))
  }
  // P10：自由定位段用绝对坐标，拆卡会让坐标错位 → 有自由定位段的卡不拆（整张画）
  if (segs.some(s => s.style && s.style.boxX !== undefined)) return [card]
  if (segs.length <= budget) return [card]

  // 按预算切块
  const chunks: TextSegment[][] = []
  for (let i = 0; i < segs.length; i += budget) {
    chunks.push(segs.slice(i, i + budget))
  }

  return chunks.map((chunkSegs, idx) => {
    const isFirst = idx === 0
    const newContent = chunkSegs.map(s => s.text || '').join('\n')
    return {
      ...card,
      title: isFirst ? card.title : ((card.title || '') + '（续）'),
      content: newContent,
      segments: chunkSegs,
    }
  })
}

/** P6 超长拆卡：对整份报告的卡片数组逐张拆分，返回扁平化的新数组（纯函数）。
 *  长图导出 / 多图导出前调一次，用结果替代 report.cards 参与绘制。*/
export function splitOverflowCards(cards: ReportCard[], budget: number = SEGMENT_BUDGET_PER_CARD): ReportCard[] {
  const out: ReportCard[] = []
  for (const card of cards) {
    const split = splitCardIfOverflow(card, budget)
    for (const c of split) out.push(c)
  }
  return out
}

/** 尝试创建 Image：优先 canvas.createImage，回退 wx.createImage，都没有返回 null */
function tryCreateImage(): any | null {
  if (_imageFactory) {
    try { return _imageFactory() } catch (e) { /* fall through */ }
  }
  if (typeof (wx as any).createImage === 'function') {
    try { return (wx as any).createImage() } catch (e) { /* fall through */ }
  }
  return null
}

/**
 * 预加载用户图片背景（异步）。调用方在 paintCard 前调用此函数。
 * - 若卡片 bgType='image' 且 bgImage 不是内置预设，则尝试加载用户图
 * - 加载成功后缓存到 _imageCache，drawCard 内部会查这个缓存
 * - 失败则忽略（drawBackground 会回退到纯色 bgColor）
 * 返回 Promise<void>，永远 resolve（不抛错）
 */
export function preloadCardImage(style: CardStyle | undefined): Promise<void> {
  if (!style || !style.bgImage) return Promise.resolve()
  if (isBuiltInBg(style.bgImage)) return Promise.resolve()  // 内置纹理不需要预加载
  return preloadImagePath(style.bgImage)
}

/**
 * 预加载单张图片到缓存（通用版，正文插图用）。
 * 内置纹理 id / 已缓存 / 空路径 直接 resolve。永远 resolve（绝不抛错、绝不 reject）。
 * 即便没有任何可用的 Image 工厂（wx.createImage 不存在且未注入 canvas 工厂），
 * 也只跳过加载（drawBackground 会回退纯色），不阻断后续绘制。
 */
export function preloadImagePath(path: string | undefined): Promise<void> {
  if (!path) return Promise.resolve()
  if (isBuiltInBg(path)) return Promise.resolve()  // 内置纹理不走图片加载
  if (_imageCache[path]) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }

    const img = tryCreateImage()
    if (!img) {
      // 无可用工厂：放弃加载（不抛错），drawBackground 会回退纯色背景
      console.warn('[poster] 无可用 Image 工厂，跳过加载:', path)
      finish()
      return
    }
    img.onload = () => { _imageCache[path] = img; finish() }
    img.onerror = (e: any) => { console.warn('[poster] 图片加载失败:', path, e); finish() }
    img.src = path
    // 超时保护：3 秒内未加载完则强制 resolve，避免某个失效路径让整个渲染/保存流程永久卡死
    setTimeout(finish, 3000)
  })
}

/** 预加载多张图片（并行）。返回 Promise<void[]>，全部 resolve（不抛错） */
export function preloadImagePaths(paths: (string | undefined)[]): Promise<void[]> {
  return Promise.all(paths.map(p => preloadImagePath(p)))
}

/** 清空图片缓存（比如报告切换时调一次，释放内存） */
export function clearImageCache(): void {
  Object.keys(_imageCache).forEach(k => { delete _imageCache[k] })
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  rs: ResolvedStyle
): void {
  if (rs.bgType === 'gradient' && rs.bgGradient) {
    // 线性渐变（左上 → 右下）
    const grad = ctx.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, rs.bgGradient[0])
    grad.addColorStop(1, rs.bgGradient[1])
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    return
  }

  if (rs.bgType === 'image' && rs.bgImage) {
    const builtIn = getBuiltInBg(rs.bgImage)
    if (builtIn) {
      // 内置程序化纹理
      drawTexture(ctx, w, h, builtIn)
      return
    }
    // 用户上传图片：查缓存
    const cached = _imageCache[rs.bgImage]
    if (cached) {
      drawUserImageBg(ctx, w, h, cached, rs.bgImageOpacity)
      return
    }
    // 图片还没加载好 → 回退到 bgColor 纯色（下次重绘会带上图）
    ctx.fillStyle = rs.bgColor
    ctx.fillRect(0, 0, w, h)
    return
  }

  // 纯色（默认）
  ctx.fillStyle = rs.bgColor
  ctx.fillRect(0, 0, w, h)
}

/** 把用户图片绘制为背景：等比覆盖（cover）+ 蒙版降低对比避免压过文字 */
function drawUserImageBg(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  img: WxImage,
  opacity: number
): void {
  // 等比 cover 计算
  const iw = img.width
  const ih = img.height
  if (!iw || !ih) return
  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (w - dw) / 2
  const dy = (h - dh) / 2
  ctx.drawImage(img, dx, dy, dw, dh)

  // 白色蒙版（透明度由 bgImageOpacity 控制压暗程度，opacity 越大蒙版越透明 → 图越显眼）
  ctx.fillStyle = 'rgba(255, 255, 255, ' + (1 - opacity) + ')'
  ctx.fillRect(0, 0, w, h)
}

/* ===== 程序化纹理绘制（内置背景） ===== */
function drawTexture(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  preset: BgPreset
): void {
  // 先填底色
  ctx.fillStyle = preset.baseColor
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.globalAlpha = preset.patternOpacity
  ctx.fillStyle = preset.patternColor
  ctx.strokeStyle = preset.patternColor

  switch (preset.texture) {
    case 'paper':
      drawPaperNoise(ctx, w, h)
      break
    case 'grid':
      drawGrid(ctx, w, h)
      break
    case 'dot':
      drawDots(ctx, w, h)
      break
    case 'watercolor':
      drawWatercolor(ctx, w, h)
      break
    case 'wave':
      drawWave(ctx, w, h)
      break
  }

  ctx.restore()
}

/** 纸张噪点：随机小点（伪随机种子保证可重现） */
function drawPaperNoise(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // 简单 LCG 伪随机：种子固定，保证每次绘制一样（避免每次重画位置变）
  let seed = 12345
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  const count = Math.floor(w * h / 800)  // 密度
  for (let i = 0; i < count; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = rnd() * 1.2 + 0.3
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 细格：横竖网格线 */
function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const step = 40
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = step; x < w; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = step; y < h; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
}

/** 点点：均匀网格圆点 */
function drawDots(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const step = 32
  const r = 2
  for (let x = step / 2; x < w; x += step) {
    for (let y = step / 2; y < h; y += step) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** 水彩：几个柔和的径向渐变色斑 */
function drawWatercolor(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // 关键：进入循环前先捕获一次 fillStyle（调用方传入的 patternColor 字符串）。
  // 不能在循环里读 ctx.fillStyle —— 因为循环体内会把 ctx.fillStyle 改成本次创建的 CanvasGradient，
  // 下一次迭代再读就成了「拿渐变喂 addColorStop」，触发 DOMException。
  const baseColor = ctx.fillStyle as string
  const blobs = [
    { x: w * 0.2, y: h * 0.25, r: Math.min(w, h) * 0.5 },
    { x: w * 0.8, y: h * 0.7, r: Math.min(w, h) * 0.45 },
    { x: w * 0.5, y: h * 0.5, r: Math.min(w, h) * 0.35 },
  ]
  for (const b of blobs) {
    const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
    grad.addColorStop(0, baseColor)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 循环结束后 ctx.fillStyle 已是渐变对象；调用方 drawTexture 末尾会 restore，无需手动复位
}

/** 波纹：同心圆等高线 */
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w * 0.7
  const cy = h * 0.3
  const maxR = Math.max(w, h) * 1.2
  const step = 28
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let r = step; r < maxR; r += step) {
    ctx.moveTo(cx + r, cy)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.stroke()
}

/* ===== 通用卡片：标签 + 正文 ===== */
function drawNormalCard(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, s: number,
  card: ReportCard,
  rs: ResolvedStyle
): void {
  const padX = rs.padding * s
  const accent = CARD_ACCENT[card.type]
  const scale = rs.fontSizeScale

  // 右上角小圆点装饰（用 CARD_ACCENT，不被样式覆盖）
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.5
  ctx.beginPath()
  ctx.arc(w - 48 * s, 48 * s, 8 * s, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // 标签（卡片标题）—— 读 style.titleColor
  if (card.title) {
    ctx.fillStyle = rs.titleColor
    ctx.font = `600 ${Math.round(24 * scale * s)}px serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(card.title, padX, 90 * s)

    // 标签下分隔线
    ctx.strokeStyle = designTokens.color.divider
    ctx.lineWidth = 1 * s
    ctx.beginPath()
    ctx.moveTo(padX, 90 * s + 48 * s)
    ctx.lineTo(w - padX, 90 * s + 48 * s)
    ctx.stroke()
  }

  // 正文 —— 优先用 segments（段落级富文本），否则回落 content 整段
  const bodyStartY = card.title ? 90 * s + 88 * s : 120 * s
  const bodyMaxH = h - bodyStartY - 80 * s
  if (card.segments && card.segments.length > 0) {
    drawSegments(ctx, card.segments, padX, bodyStartY, w - padX * 2, bodyMaxH, rs, s)
  } else {
    drawParagraph(ctx, card.content, padX, bodyStartY, w - padX * 2, bodyMaxH, {
      fontSize: 30 * scale * s,
      lineHeight: 1.9,
      color: rs.textColor,
      align: rs.textAlign,
    })
  }
}

/**
 * 按 segments 遍历绘制段落（每段独立样式）
 * 继承链：段 style.color/fontSizeScale/align > 卡片 rs 的对应字段 > 默认
 * @param segments 段落数组
 * @param x/y 正文区起始坐标
 * @param maxW/maxH 正文区最大宽高（用于折行和截断）
 * @param rs 卡片已 resolve 的样式（提供段缺省时的默认值）
 * @param s 比例尺
 */
/**
 * 绘制正文图片段：contain 模式（保留比例、不裁切），宽度撑满 maxW，高度按图片宽高比算。
 * 按对齐方式水平定位；绘制后推进 curY（含上下间距）。
 * 返回图片占据的高度（含间距），供调用方累加 curY；返回 0 表示未绘制（图未加载/无尺寸）。
 */
function drawSegmentImage(
  ctx: CanvasRenderingContext2D,
  path: string,
  x: number, curY: number, maxW: number,
  align: 'left' | 'center' | 'right',
  s: number
): number {
  const img = _imageCache[path]
  if (!img || !img.width || !img.height) {
    console.warn('[poster] drawSegmentImage 跳过（未缓存或无尺寸）:', path)
    return 0  // 未加载或无尺寸，跳过
  }
  const imgTopMargin = 12 * s
  const imgBottomMargin = 12 * s
  // 与编辑器 widthFix 对齐：宽度撑满正文区，高度按图片宽高比自然展开。
  // 不主动缩小高度 —— 宁可后续文字段被卡片底部裁掉（drawSegments 循环里有 curY >= y+maxH 的 break），
  // 也不要把图缩成邮票大小，否则编辑页（可滚动、图正常大）和导出页（图被压缩）严重不一致。
  const drawW = maxW
  const drawH = drawW * (img.height / img.width)
  // 水平对齐
  let dx = x
  if (align === 'center') dx = x + (maxW - drawW) / 2
  else if (align === 'right') dx = x + (maxW - drawW)
  ctx.drawImage(img, dx, curY + imgTopMargin, drawW, drawH)
  return drawH + imgTopMargin + imgBottomMargin
}

/**
 * 艺术字绘制：根据 merged.artFont 分支设置 ctx 状态后画一行文字。
 * 调用前需已设好 ctx.textAlign / textBaseline；本函数负责 fillStyle / font / shadow / stroke。
 * 绘制后会复位 shadow 和 lineWidth，避免污染后续绘制。
 */
function drawArtText(
  ctx: CanvasRenderingContext2D,
  line: string,
  drawX: number,
  drawY: number,
  segFont: number,
  merged: SegmentStyle,
  fillColor: string
): void {
  const art = merged.artFont || 'none'
  // 保存原始状态，绘制后还原（防止 shadow/lineWidth/offsetY/strokeStyle/globalAlpha 漏到其他文字）
  const prevLineWidth = ctx.lineWidth
  const prevShadowBlur = ctx.shadowBlur
  const prevShadowColor = ctx.shadowColor
  const prevShadowOffsetY = ctx.shadowOffsetY
  const prevStrokeStyle = ctx.strokeStyle
  const prevGlobalAlpha = ctx.globalAlpha

  if (art === 'outline') {
    // 描边：先填充内部（fillColor），再粗描边在外（strokeColor）。
    // 顺序很重要：fillText 在前、strokeText 在后，描边画在填充外缘，形成空心轮廓。
    // 必须显式设 fillStyle —— 否则 fillText 会用上一段残留的 fillStyle（可能是渐变对象或装饰色），
    // 把描边整个糊满，肉眼上等同于没艺术字（用户报告「海报中艺术字未显示」的根因之一）。
    const sw = (merged.strokeWidth !== undefined ? merged.strokeWidth : 2)
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
    ctx.lineWidth = sw * (segFont / 30)  // 描边随字号缩放
    ctx.strokeStyle = merged.strokeColor || '#3D3530'
    ctx.lineJoin = 'round'
    ctx.strokeText(line, drawX, drawY)
  } else if (art === 'shadow') {
    ctx.shadowColor = merged.shadowColor || 'rgba(61, 53, 48, 0.45)'
    ctx.shadowBlur = segFont * 0.18
    ctx.shadowOffsetY = segFont * 0.08
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  } else if (art === 'gradient') {
    // 垂直渐变：从 fillColor 到 gradientTo
    const grad = ctx.createLinearGradient(0, drawY, 0, drawY + segFont * 1.4)
    grad.addColorStop(0, fillColor)
    grad.addColorStop(1, merged.gradientTo || '#D97A4A')
    ctx.fillStyle = grad
    ctx.fillText(line, drawX, drawY)
  } else if (art === 'handwritten') {
    // 手写体感：加阴影偏移 + 略微加重，传递随性（font 的 italic 在调用前已设置）
    ctx.shadowColor = 'rgba(61, 53, 48, 0.2)'
    ctx.shadowBlur = segFont * 0.06
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
    ctx.shadowBlur = 0
  } else if (art === 'neon') {
    // 霓虹发光：高饱和发光色多层大模糊光晕 + 亮色本体在顶层。
    // 用阴影实现外发光：先叠 3 层逐渐收窄的光晕（大模糊），最后无阴影画亮色本体。
    const neonColor = merged.shadowColor || '#FF6EC7'
    const blur = segFont * 0.5
    ctx.fillStyle = neonColor
    ctx.shadowColor = neonColor
    ctx.shadowBlur = blur
    ctx.fillText(line, drawX, drawY)
    ctx.shadowBlur = blur * 0.6
    ctx.fillText(line, drawX, drawY)
    ctx.shadowBlur = blur * 0.3
    ctx.fillText(line, drawX, drawY)
    // 本体亮色（无阴影）置于顶层，让文字可读
    ctx.shadowBlur = 0
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
  } else if (art === 'glow') {
    // 高光描边：本体填充 + 白色细高光描边 + 柔和白色外发光，圣洁感。
    const glowColor = merged.strokeColor || '#FFFFFF'
    ctx.fillStyle = fillColor
    ctx.shadowColor = glowColor
    ctx.shadowBlur = segFont * 0.12
    ctx.fillText(line, drawX, drawY)
    // 细高光描边
    ctx.shadowBlur = 0
    ctx.lineWidth = Math.max(1, segFont / 45)
    ctx.strokeStyle = glowColor
    ctx.lineJoin = 'round'
    ctx.strokeText(line, drawX, drawY)
  } else if (art === 'rainbow') {
    // 彩虹渐变：横向 7 色渐变（红橙黄绿青蓝紫）。按文字宽度建立水平渐变。
    const tw = ctx.measureText(line).width || segFont
    const grad = ctx.createLinearGradient(drawX, 0, drawX + tw, 0)
    grad.addColorStop(0.00, '#FF6B6B')
    grad.addColorStop(0.17, '#FFA94D')
    grad.addColorStop(0.33, '#FFD43B')
    grad.addColorStop(0.50, '#8CE99A')
    grad.addColorStop(0.67, '#74C0FC')
    grad.addColorStop(0.83, '#9775FA')
    grad.addColorStop(1.00, '#E599F7')
    ctx.fillStyle = grad
    ctx.fillText(line, drawX, drawY)
  } else if (art === 'metallic') {
    // 金属质感：垂直三段渐变（暗→亮→暗）模拟金属反光带，中间一条高光。
    // gradientTo 作为金属深端色（默认银系）；起止用深端，中间用近白高光。
    const deep = merged.gradientTo || '#6A6A6A'
    const grad = ctx.createLinearGradient(0, drawY, 0, drawY + segFont * 1.3)
    grad.addColorStop(0.00, deep)
    grad.addColorStop(0.42, '#F5F5F5')
    grad.addColorStop(0.50, '#FFFFFF')
    grad.addColorStop(0.58, '#F5F5F5')
    grad.addColorStop(1.00, deep)
    ctx.fillStyle = grad
    ctx.fillText(line, drawX, drawY)
  } else if (art === 'relief') {
    // 立体投影（长投影）：向右下阶梯式延伸的半透明深色投影，本体在顶层。
    // 循环偏移 6 次，每次右下移 segFont*0.05，递减透明度，最后本体在原位。
    const reliefColor = merged.shadowColor || 'rgba(61, 53, 48, 0.35)'
    const step = segFont * 0.05
    const layers = 6
    for (let i = layers; i >= 1; i--) {
      ctx.fillStyle = reliefColor
      ctx.fillText(line, drawX + step * i, drawY + step * i)
    }
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
  } else if (art === 'letterpress') {
    // 凹陷字（内嵌阴影）：本体 + 顶部白色半透明高光（上偏移）+ 底部深色半透明阴影（下偏移）。
    // 用 globalAlpha 控制半透明，模拟文字凹进纸面的浮雕感。
    const off = Math.max(1, segFont / 40)
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
    // 顶部高光（上偏移，白色半透明）
    ctx.globalAlpha = 0.5
    ctx.fillStyle = '#FFFFFF'
    ctx.fillText(line, drawX, drawY - off)
    // 底部阴影（下偏移，深色半透明）
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#1A1A1A'
    ctx.fillText(line, drawX, drawY + off)
    ctx.globalAlpha = prevGlobalAlpha
  } else if (art === 'vintage') {
    // 复古做旧：暖褐基调，半透明本体 + 深褐偏移描边模拟颗粒磨损感。
    const vintageStroke = merged.strokeColor || '#6B4A2B'
    ctx.globalAlpha = 0.88
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
    ctx.globalAlpha = prevGlobalAlpha
    // 细褐描边 + 轻微偏移，模拟印刷磨损
    ctx.lineWidth = Math.max(1, segFont / 60)
    ctx.strokeStyle = vintageStroke
    ctx.lineJoin = 'round'
    ctx.globalAlpha = 0.5
    ctx.strokeText(line, drawX + Math.max(0.5, segFont / 120), drawY)
    ctx.globalAlpha = prevGlobalAlpha
  } else if (art === 'stamp') {
    // 印章风：粗圆角印泥色描边 + 印泥色填充 + 轻微偏移投影，方正硬朗像盖出来的。
    const stampColor = merged.stampColor || '#C0392B'
    ctx.fillStyle = stampColor
    ctx.lineWidth = Math.max(2, segFont / 18)  // 粗描边
    ctx.strokeStyle = stampColor
    ctx.lineJoin = 'round'
    ctx.strokeText(line, drawX, drawY)
    // 轻微偏移投影（增强印章立体感）
    ctx.shadowColor = 'rgba(192, 57, 43, 0.3)'
    ctx.shadowBlur = segFont * 0.05
    ctx.shadowOffsetY = segFont * 0.04
    ctx.fillText(line, drawX, drawY)
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  } else {
    // none：普通填充
    ctx.fillStyle = fillColor
    ctx.fillText(line, drawX, drawY)
  }

  // 复位（含 offsetY/strokeStyle/globalAlpha，避免跨段泄漏）
  ctx.lineWidth = prevLineWidth
  ctx.shadowBlur = prevShadowBlur
  ctx.shadowColor = prevShadowColor
  ctx.shadowOffsetY = prevShadowOffsetY
  ctx.strokeStyle = prevStrokeStyle
  ctx.globalAlpha = prevGlobalAlpha
}

/** 段字体档 → canvas font-family 字符串（与 report-edit.ts fontFamilyToCss 同源）
 *  楷体依赖设备系统字体；canvas 以设备实际渲染为准，不同机型可能不一致（平台固有限制） */
function fontFamilyToCanvasFont(ff: 'sans' | 'serif' | 'kai' | 'mono' | undefined): string {
  if (ff === 'kai') return '"KaiTi", "STKaiti", "楷体", serif'
  if (ff === 'mono') return '"Courier New", monospace'
  if (ff === 'serif') return 'serif'
  if (ff === 'sans') return 'sans-serif'
  return 'serif'  // 缺省沿用历史行为（正文用 serif）
}

/** 字间距倍数 → canvas letterSpacing 字符串（单位 px）
 *  倍数 1 = 正常（0px）；倍数 2 ≈ 加宽到 1 倍字宽间距；与 WXSS 预览侧同源 */
function letterSpacingToCssPx(mult: number | undefined, segFont: number): string {
  if (mult === undefined || mult === 1) return '0px'
  return `${Math.round(segFont * (mult - 1) * 0.5)}px`
}

/** 在指定盒区域内绘制单个文字段（P10 抽出：流式栈和自由定位盒共用）
 *  boxX/boxY/boxW/maxBottom 定义盒的绝对位置与边界；boxY 是段内逐行游标起点。
 *  返回 { textHeight, lineH }：textHeight = 文字行实际占用高度（用于流式栈 advance）；
 *  lineH = 本段行高（调用方加 lineH*0.4 作段间距，与原 drawSegments 行为一致）。
 *  含 P9 的 rotate/skew transform 包裹 + letterSpacing + fontFamily，与 WXSS 预览同源。 */
function drawSegmentTextBlock(
  ctx: CanvasRenderingContext2D,
  seg: TextSegment,
  merged: SegmentStyle,
  boxX: number, boxY: number, boxW: number, maxBottom: number,
  rs: ResolvedStyle, s: number, baseAlign: 'left' | 'center' | 'right'
): { textHeight: number; lineH: number } {
  const lineHeightFactor = 1.9
  const segColor = merged.color || rs.textColor
  const segScale = merged.fontSizeScale !== undefined ? merged.fontSizeScale : rs.fontSizeScale
  const segAlign = merged.align || baseAlign
  const segFont = 30 * segScale * s
  const lineH = segFont * lineHeightFactor

  // 设置本段字体后再测量折行（顺序很重要：font 影响宽度）
  const italic = merged.artFont === 'handwritten' ? 'italic ' : ''
  const fontFamily = fontFamilyToCanvasFont(merged.fontFamily)
  ctx.font = `${italic}${Math.round(segFont)}px ${fontFamily}`
  ctx.textAlign = segAlign
  ctx.textBaseline = 'top'
  ctx.letterSpacing = letterSpacingToCssPx(merged.letterSpacing, segFont)

  const rotateDeg = merged.rotate || 0
  const skewDeg = merged.skew || 0
  const hasTransform = rotateDeg !== 0 || skewDeg !== 0
  const skewTan = Math.tan((skewDeg * Math.PI) / 180)

  let curY = boxY
  const explicitLines = (seg.text || '').split('\n')
  for (const raw of explicitLines) {
    if (curY + lineH > maxBottom) break
    const wrapped = wrapText(ctx, raw, boxW)
    for (const line of wrapped) {
      if (curY + lineH > maxBottom) break
      const drawX = segAlign === 'center' ? boxX + boxW / 2
        : segAlign === 'right' ? boxX + boxW : boxX
      if (hasTransform) {
        ctx.save()
        const lineWidth = ctx.measureText(line).width
        const centerX = segAlign === 'center' ? drawX
          : segAlign === 'right' ? drawX - lineWidth / 2
          : drawX + lineWidth / 2
        const centerY = curY + lineH / 2
        ctx.translate(centerX, centerY)
        if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180)
        if (skewDeg) ctx.transform(1, 0, skewTan, 1, 0, 0)
        ctx.translate(-centerX, -centerY)
        drawArtText(ctx, line, drawX, curY, segFont, merged, segColor)
        ctx.restore()
      } else {
        drawArtText(ctx, line, drawX, curY, segFont, merged, segColor)
      }
      curY += lineH
    }
  }
  ctx.letterSpacing = '0px'
  return { textHeight: curY - boxY, lineH }
}

function drawSegments(
  ctx: CanvasRenderingContext2D,
  segments: TextSegment[],
  x: number, y: number, maxW: number, maxH: number,
  rs: ResolvedStyle,
  s: number,
  segDefaultAlign?: 'left' | 'center' | 'right',
  vertCenter?: boolean
): void {
  const lineHeightFactor = 1.9
  const baseAlign = segDefaultAlign || rs.textAlign

  // 预测量：算出所有【流式段】堆叠后的总高度（自由定位段不参与，否则居中栈会顶偏）。
  // 用于垂直居中（封面卡编辑器用 flex justify-content:center；canvas 这里先量再画）。
  const measureTotalHeight = (): number => {
    let h = 0
    for (const seg of segments) {
      if (seg.image) {
        const img = _imageCache[seg.image]
        if (img && img.width && img.height) {
          h += maxW * (img.height / img.width) + 24 * s
        }
        continue
      }
      // P10：自由定位段不参与流式栈高度测算
      if (seg.style && seg.style.boxX !== undefined) continue
      const cardProjection: SegmentStyle = { color: rs.textColor, fontSizeScale: rs.fontSizeScale, align: baseAlign }
      const merged = mergeSegmentStyle(cardProjection, seg.style)
      const segScale = merged.fontSizeScale !== undefined ? merged.fontSizeScale : rs.fontSizeScale
      const segFont = 30 * segScale * s
      const lineH = segFont * lineHeightFactor
      const italic = merged.artFont === 'handwritten' ? 'italic ' : ''
      const fontFamily = fontFamilyToCanvasFont(merged.fontFamily)
      ctx.font = `${italic}${Math.round(segFont)}px ${fontFamily}`
      ctx.letterSpacing = letterSpacingToCssPx(merged.letterSpacing, segFont)
      const explicitLines = (seg.text || '').split('\n')
      for (const raw of explicitLines) {
        const wrapped = wrapText(ctx, raw, maxW)
        h += wrapped.length * lineH
      }
      h += lineH * 0.4
    }
    return h
  }

  let curY = y
  if (vertCenter) {
    const total = measureTotalHeight()
    const centeredStart = total < maxH ? y + (maxH - total) / 2 : y
    curY = centeredStart
  }

  for (const seg of segments) {
    // 图片段：独占行绘制图片，跳过文字逻辑（图片不做自由定位）
    if (seg.image) {
      if (curY >= y + maxH) break
      const segAlign = (seg.style && seg.style.align) || baseAlign
      const consumed = drawSegmentImage(ctx, seg.image, x, curY, maxW, segAlign, s)
      curY += consumed
      continue
    }

    const cardProjection: SegmentStyle = {
      color: rs.textColor,
      fontSizeScale: rs.fontSizeScale,
      align: baseAlign,
    }
    const merged = mergeSegmentStyle(cardProjection, seg.style)

    // P10 自由定位段：按绝对盒绘制，不参与 curY 堆叠（与 WXSS position:absolute 同源）
    if (merged.boxX !== undefined) {
      const boxLeft = x + (merged.boxX || 0) * maxW
      const boxTop = y + (merged.boxY || 0) * maxH
      const boxWidth = (merged.boxW !== undefined ? merged.boxW : 1) * maxW
      ctx.save()
      ctx.beginPath()
      ctx.rect(boxLeft, boxTop, boxWidth, maxH - (boxTop - y))
      ctx.clip()
      drawSegmentTextBlock(ctx, seg, merged, boxLeft, boxTop, boxWidth, y + maxH, rs, s, baseAlign)
      ctx.restore()
      continue
    }

    // 流式段：在当前 curY 位置画，并 advance curY（文字高 + 段间距 lineH*0.4）
    if (curY >= y + maxH) break
    const drawn = drawSegmentTextBlock(ctx, seg, merged, x, curY, maxW, y + maxH, rs, s, baseAlign)
    curY += drawn.textHeight + drawn.lineH * 0.4
  }
}

/* ===== 封面卡：居中大标题 ===== */
function drawCoverCard(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, s: number,
  card: ReportCard,
  rs: ResolvedStyle
): void {
  const centerX = w / 2
  const centerY = h / 2
  const scale = rs.fontSizeScale

  // 顶部装饰符号（用 CARD_ACCENT.cover = accent，不被样式覆盖）
  ctx.fillStyle = CARD_ACCENT.cover
  ctx.globalAlpha = 0.6
  ctx.font = `${Math.round(48 * s)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('❋', centerX, centerY - 160 * s)
  ctx.globalAlpha = 1

  // 主标题 —— 读 style.textColor（封面主色用 textColor，不用 titleColor）
  ctx.fillStyle = rs.textColor
  ctx.font = `600 ${Math.round(52 * scale * s)}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  drawCenterText(ctx, card.title, centerX, centerY - 40 * s, w - 120 * s)

  // 分隔短线（装饰色，不被样式覆盖）
  ctx.strokeStyle = CARD_ACCENT.cover
  ctx.lineWidth = 3 * s
  ctx.beginPath()
  ctx.moveTo(centerX - 30 * s, centerY + 40 * s)
  ctx.lineTo(centerX + 30 * s, centerY + 40 * s)
  ctx.stroke()

  // 副内容（年份/插图等）—— 读 style.textColor
  // 优先用 segments（段级样式/艺术字/插图），否则回落 content 整段。
  // 段区域从分隔线下方延伸到接近卡片底部，给插图留足空间（编辑器用 flex 居中 + widthFix，
  // 图能自然展开；这里把段区拉高到 h-80*s 底边，让 drawSegmentImage 的 widthFix 不被压成邮票）。
  // 封面卡走 vertCenter=true：编辑器封面是 flex justify-content:center，图文作为一个整体垂直居中；
  // canvas 这里先预测量总高，再把起点偏移到段区垂直中央，避免「文字偏下、挤占图片」。
  // 段路径用 globalAlpha=1（用户显式设了段样式/艺术字就该完整呈现，半透明会弱化艺术字）；
  // content 整段路径保留 0.7 的次要信息设计感。
  const segY = centerY + 70 * s           // 段区起点（分隔线在 centerY+40*s，留 30*s 间距）
  const segMaxH = (h - 80 * s) - segY     // 段区高度 = 底边（h-80*s 内边距）减起点
  ctx.fillStyle = rs.textColor
  ctx.font = `${Math.round(28 * scale * s)}px serif`
  if (card.segments && card.segments.length > 0) {
    drawSegments(ctx, card.segments, 80 * s, segY, w - 160 * s, segMaxH, rs, s, 'center', true)
  } else {
    ctx.globalAlpha = 0.7
    drawParagraph(ctx, card.content, 80 * s, segY, w - 160 * s, segMaxH, {
      fontSize: 28 * scale * s,
      lineHeight: 1.8,
      color: rs.textColor,
      align: 'center',
    })
  }
  ctx.globalAlpha = 1
}

/* ===== 落款卡：右下落款式 ===== */
function drawEndingCard(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, s: number,
  card: ReportCard,
  rs: ResolvedStyle
): void {
  const padX = rs.padding * s
  const scale = rs.fontSizeScale

  // 正文 —— 优先用 segments（段级样式/艺术字/插图），否则回落 content 整段。
  // 落款卡视觉上是右下落款；段内若显式设了 align 以段样式为准，否则继承 rs.textAlign。
  if (card.segments && card.segments.length > 0) {
    drawSegments(ctx, card.segments, padX, h * 0.5, w - padX * 2, h * 0.35, rs, s, 'right')
  } else {
    drawParagraph(ctx, card.content, padX, h * 0.5, w - padX * 2, h * 0.35, {
      fontSize: 32 * scale * s,
      lineHeight: 1.9,
      color: rs.textColor,
      align: 'right',
    })
  }

  // 落款 —— 读 style.textColor（次要色感）
  ctx.fillStyle = rs.textColor
  ctx.globalAlpha = 0.6
  ctx.font = `${Math.round(24 * scale * s)}px serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('—  完  —', w - padX, h - 100 * s)
  ctx.globalAlpha = 1
}

/* ===== 文本绘制辅助 ===== */

interface DrawTextOpts {
  fontSize: number
  lineHeight: number
  color: string
  align: 'left' | 'center' | 'right'
}

/**
 * 绘制多行段落（支持 \n 换行 + 自动折行）
 * @param text 文本
 * @param x 起始 x
 * @param y 起始 y
 * @param maxW 最大宽度（超出折行）
 * @param maxH 最大高度（超出截断）
 */
function drawParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number, maxW: number, maxH: number,
  opts: DrawTextOpts
): void {
  ctx.fillStyle = opts.color
  ctx.font = `${Math.round(opts.fontSize)}px serif`
  ctx.textAlign = opts.align
  ctx.textBaseline = 'top'

  const lineH = opts.fontSize * opts.lineHeight
  const explicitLines = text.split('\n')

  let curY = y
  for (const raw of explicitLines) {
    if (curY + lineH > y + maxH) break
    const wrapped = wrapText(ctx, raw, maxW)
    for (const line of wrapped) {
      if (curY + lineH > y + maxH) break
      const drawX = opts.align === 'center' ? x + maxW / 2
        : opts.align === 'right' ? x + maxW : x
      ctx.fillText(line, drawX, curY)
      curY += lineH
    }
  }
}

/** 按字符宽度折行（中文按单字符算宽度，英文按 measureText） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (!text) return ['']
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    const candidate = cur + ch
    if (ctx.measureText(candidate).width > maxW && cur.length > 0) {
      lines.push(cur)
      cur = ch
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  return lines.length > 0 ? lines : ['']
}

/** 居中绘制单行（超长截断） */
function drawCenterText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number, cy: number, maxW: number
): void {
  if (!text) return
  let display = text
  if (ctx.measureText(display).width > maxW) {
    while (display.length > 1 && ctx.measureText(display + '…').width > maxW) {
      display = display.slice(0, -1)
    }
    display = display + '…'
  }
  ctx.fillText(display, cx, cy)
}
