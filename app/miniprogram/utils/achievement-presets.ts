// utils/achievement-presets.ts
// 成就图片系统预设：程序化生成的抽象装饰图（不引入外部素材，避免版权/审核问题）。
// 设计思路（与 utils/design-tokens.ts 的 BG_PRESETS 同源）：
//   - 预设图存的是 id 字符串（Item.image = 'achv-watercolor-sunset'），不占存储空间。
//   - 显示时由 canvas 程序化绘制（draw 函数）；编辑页/列表页缩略可用 cssPreview 近似。
//   - 8 张暖色调抽象插画，覆盖各分类氛围：水彩晕染（落日/森林/暮色）、几何（同心圆/三角拼）、纸纹。
//   - 预留扩展位：等你提供真实 PNG 路径，可加 imageType='builtin' + image='/assets/xxx.png'，无需改本文件。

/** 预设图的 canvas 绘制函数：在 (0,0,size,size) 方形画布上画完整一张图。
 *  ctx 已完成 dpr scale，绘制坐标用 css px（0~size）。 */
export type PresetDrawFn = (ctx: CanvasRenderingContext2D, size: number) => void

export interface AchievementImagePreset {
  /** 唯一 id，存进 Item.image */
  id: string
  /** 用户可见名称（预设选择 sheet 用） */
  name: string
  /** canvas 程序化绘制（编辑页预览 + 成就墙/首页显示用） */
  draw: PresetDrawFn
  /** CSS 近似预览（wxml 缩略用，与 BG_PRESETS 的 builtInBgToCss 同思路）。
   *  返回完整 CSS background 声明（含底色），调用方拼到 style 里。 */
  cssPreview: string
}

/* ============================================================
 * 绘制辅助
 * ============================================================ */

/** 把 hex 颜色转成 rgba 字符串 */
function hexRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 画一个径向晕染水彩斑（柔和水彩效果的核心单元）*/
function drawWatercolorBlob(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  color: string, opacity: number
): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  grad.addColorStop(0, hexRgba(color, opacity))
  grad.addColorStop(0.6, hexRgba(color, opacity * 0.5))
  grad.addColorStop(1, hexRgba(color, 0))
  ctx.fillStyle = grad
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

/** 画满底色 */
function fillBase(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)
}

/* ============================================================
 * 8 张预设
 * ============================================================ */

export const ACHIEVEMENT_PRESETS: AchievementImagePreset[] = [
  /* 1. 落日水彩 —— 暖橙金，适合阅读/技能/任意成就的主推荐 */
  {
    id: 'achv-watercolor-sunset',
    name: '落日水彩',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#FFF8F0')
      drawWatercolorBlob(ctx, size * 0.3, size * 0.35, size * 0.55, '#F2C28E', 0.85)
      drawWatercolorBlob(ctx, size * 0.75, size * 0.7, size * 0.5, '#E89B6C', 0.75)
      drawWatercolorBlob(ctx, size * 0.55, size * 0.5, size * 0.35, '#F5D5A8', 0.6)
    },
    cssPreview: 'background-color: #FFF8F0; background-image: radial-gradient(circle at 30% 35%, rgba(242,194,142,0.85) 0%, transparent 55%), radial-gradient(circle at 75% 70%, rgba(232,155,108,0.75) 0%, transparent 50%), radial-gradient(circle at 55% 50%, rgba(245,213,168,0.6) 0%, transparent 40%);',
  },
  /* 2. 森林水彩 —— 暖绿，适合技能/旅行 */
  {
    id: 'achv-watercolor-forest',
    name: '森林水彩',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#F4F8EE')
      drawWatercolorBlob(ctx, size * 0.25, size * 0.3, size * 0.5, '#B6D49A', 0.8)
      drawWatercolorBlob(ctx, size * 0.7, size * 0.65, size * 0.55, '#8FB074', 0.7)
      drawWatercolorBlob(ctx, size * 0.5, size * 0.45, size * 0.3, '#CCE0B0', 0.5)
    },
    cssPreview: 'background-color: #F4F8EE; background-image: radial-gradient(circle at 25% 30%, rgba(182,212,154,0.8) 0%, transparent 50%), radial-gradient(circle at 70% 65%, rgba(143,176,116,0.7) 0%, transparent 55%), radial-gradient(circle at 50% 45%, rgba(204,224,176,0.5) 0%, transparent 35%);',
  },
  /* 3. 暮色水彩 —— 暖紫，适合观影/第一次 */
  {
    id: 'achv-watercolor-dusk',
    name: '暮色水彩',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#F5F0F5')
      drawWatercolorBlob(ctx, size * 0.7, size * 0.3, size * 0.5, '#C5A8D8', 0.8)
      drawWatercolorBlob(ctx, size * 0.3, size * 0.7, size * 0.55, '#B598C7', 0.7)
      drawWatercolorBlob(ctx, size * 0.5, size * 0.5, size * 0.3, '#DCC4E8', 0.5)
    },
    cssPreview: 'background-color: #F5F0F5; background-image: radial-gradient(circle at 70% 30%, rgba(197,168,216,0.8) 0%, transparent 50%), radial-gradient(circle at 30% 70%, rgba(181,152,199,0.7) 0%, transparent 55%), radial-gradient(circle at 50% 50%, rgba(220,196,232,0.5) 0%, transparent 35%);',
  },
  /* 4. 同心圆 —— 几何装饰，暖橙底 */
  {
    id: 'achv-geo-rings',
    name: '同心圆',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#FDF4EA')
      const cx = size * 0.5, cy = size * 0.5
      const rings = [size * 0.45, size * 0.35, size * 0.25, size * 0.15]
      const colors = ['#F2C28E', '#E89B6C', '#D97A4A', '#C5622F']
      rings.forEach((r, i) => {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = hexRgba(colors[i], 0.5 - i * 0.05)
        ctx.fill()
      })
    },
    cssPreview: 'background-color: #FDF4EA; background-image: radial-gradient(circle at 50% 50%, rgba(242,194,142,0.5) 0%, rgba(242,194,142,0.5) 18%, rgba(232,155,108,0.45) 18%, rgba(232,155,108,0.45) 32%, rgba(217,122,74,0.4) 32%, rgba(217,122,74,0.4) 45%, rgba(197,98,47,0.35) 45%, rgba(197,98,47,0.35) 55%);',
  },
  /* 5. 三角拼色 —— 几何分割，暖橙+暖绿 */
  {
    id: 'achv-geo-triangle',
    name: '三角拼',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#FBF5EC')
      // 三个三角形拼满方形
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(size, 0)
      ctx.lineTo(0, size)
      ctx.closePath()
      ctx.fillStyle = hexRgba('#F2C28E', 0.7)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(size, 0)
      ctx.lineTo(size, size)
      ctx.lineTo(0, size)
      ctx.closePath()
      ctx.fillStyle = hexRgba('#B6D49A', 0.6)
      ctx.fill()
      // 中部小三角点缀
      ctx.beginPath()
      ctx.moveTo(size * 0.4, size * 0.35)
      ctx.lineTo(size * 0.75, size * 0.6)
      ctx.lineTo(size * 0.35, size * 0.75)
      ctx.closePath()
      ctx.fillStyle = hexRgba('#E89B6C', 0.8)
      ctx.fill()
    },
    cssPreview: 'background-color: #FBF5EC; background-image: linear-gradient(135deg, rgba(242,194,142,0.7) 0%, rgba(242,194,142,0.7) 50%, rgba(182,212,154,0.6) 50%, rgba(182,212,154,0.6) 100%);',
  },
  /* 6. 暖纸纹 —— 复古纸质感，最中性百搭 */
  {
    id: 'achv-paper-warm',
    name: '暖纸纹',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#FAF6F0')
      // 程序化噪点纹理
      const dotColor = '#D9B888'
      const count = Math.round(size * size / 80)
      for (let i = 0; i < count; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const r = Math.random() * 1.5 + 0.5
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = hexRgba(dotColor, Math.random() * 0.15 + 0.05)
        ctx.fill()
      }
      // 四角柔和晕染
      drawWatercolorBlob(ctx, 0, 0, size * 0.4, '#F2C28E', 0.4)
      drawWatercolorBlob(ctx, size, size, size * 0.4, '#E89B6C', 0.35)
    },
    cssPreview: 'background-color: #FAF6F0; background-image: radial-gradient(circle at 0% 0%, rgba(242,194,142,0.4) 0%, transparent 40%), radial-gradient(circle at 100% 100%, rgba(232,155,108,0.35) 0%, transparent 40%);',
  },
  /* 7. 星辉 —— 深底星点，适合里程碑/第一次 */
  {
    id: 'achv-stars',
    name: '星辉',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#2C2A28')
      // 星点（大小不一）
      const starColor = '#F5C26B'
      const count = 25
      for (let i = 0; i < count; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        const r = Math.random() * 2 + 0.5
        const opacity = Math.random() * 0.6 + 0.3
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = hexRgba(starColor, opacity)
        ctx.fill()
        // 大星加光晕
        if (r > 1.5) {
          drawWatercolorBlob(ctx, x, y, r * 4, starColor, opacity * 0.3)
        }
      }
    },
    cssPreview: 'background-color: #2C2A28; background-image: radial-gradient(circle at 20% 30%, rgba(245,194,107,0.8) 0%, rgba(245,194,107,0.8) 1%, transparent 1.5%), radial-gradient(circle at 70% 60%, rgba(245,194,107,0.6) 0%, rgba(245,194,107,0.6) 0.8%, transparent 1.2%), radial-gradient(circle at 45% 80%, rgba(245,194,107,0.7) 0%, rgba(245,194,107,0.7) 0.6%, transparent 1%);',
  },
  /* 8. 渐变条 —— 极简横向渐变，最现代 */
  {
    id: 'achv-gradient-band',
    name: '渐变条',
    draw: (ctx, size) => {
      fillBase(ctx, size, '#FFFFFF')
      // 三条横向渐变带
      const bandHeight = size / 3
      const bands = [
        ['#F2C28E', '#E89B6C'],
        ['#B6D49A', '#8FB074'],
        ['#C5A8D8', '#B598C7'],
      ]
      bands.forEach((colors, i) => {
        const y = i * bandHeight
        const grad = ctx.createLinearGradient(0, 0, size, 0)
        grad.addColorStop(0, hexRgba(colors[0], 0.75))
        grad.addColorStop(1, hexRgba(colors[1], 0.75))
        ctx.fillStyle = grad
        ctx.fillRect(0, y, size, bandHeight)
      })
    },
    cssPreview: 'background-image: linear-gradient(180deg, rgba(242,194,142,0.75) 0%, rgba(232,155,108,0.75) 33%, rgba(182,212,154,0.75) 33%, rgba(143,176,116,0.75) 66%, rgba(197,168,216,0.75) 66%, rgba(181,152,199,0.75) 100%);',
  },
]

/** 预设 id → 预设对象的快速查找表 */
const PRESET_MAP: { [id: string]: AchievementImagePreset } = ACHIEVEMENT_PRESETS.reduce(
  (map, p) => { map[p.id] = p; return map },
  {} as { [id: string]: AchievementImagePreset }
)

/** 判断一个字符串是否是预设 id（用于 UI 决定怎么渲染）*/
export function isPresetImage(image: string | undefined): boolean {
  return !!image && !!PRESET_MAP[image]
}

/** 取预设对象；不是预设返回 null */
export function getPreset(image: string | undefined): AchievementImagePreset | null {
  if (!image) return null
  return PRESET_MAP[image] || null
}

/** 取预设的 CSS 近似预览；不是预设返回空串（调用方回落纯色）*/
export function presetToCss(image: string | undefined): string {
  const p = getPreset(image)
  return p ? p.cssPreview : ''
}
