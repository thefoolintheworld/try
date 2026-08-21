/// <reference path="./types/index.d.ts" />

/** 主题缓存结构（与 utils/theme.ts 的 ThemeCache 同构；这里重复声明避免跨目录 import 路径问题）*/
interface ThemeCache {
  prefs: {
    themeMode: 'light' | 'dark' | 'auto'
    titleFont: 'sans' | 'serif'
    darkVariant: 'neutral' | 'warm' | 'oled'
    pinnedAchievements: string[]
    wallLayout: 'single' | 'double'
    listViewMode: 'list' | 'grid' | 'gallery'
    annualGoals: { [category: string]: number }
    annualKeyword: string
    annualKeywordYear: number
    systemMedals: { [id: string]: { target: number; unlockedAt?: number } }
  }
  rootClass: string
  navColor: string
  navBg: string
}

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
    /** 主题缓存（utils/theme.ts 维护；每页 onShow 读它拿根 class + 导航栏配色）*/
    themeCache?: ThemeCache,
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,
}

/**
 * Canvas 2D 上下文最小类型声明
 * 小程序的 Canvas 2D 接口与 Web 一致，但官方 typings 没有提供 getContext 的返回类型。
 * 这里声明项目实际用到的 CanvasRenderingContext2D 子集，让 utils/poster.ts 和各页面
 * 的 canvas 绘制代码能通过严格类型检查。
 */
interface CanvasRenderingContext2D {
  // 状态
  fillStyle: string | CanvasGradient
  strokeStyle: string | CanvasGradient
  lineWidth: number
  lineJoin: 'bevel' | 'round' | 'miter'
  font: string
  /** 字间距（px）；微信基础库 2.32+ Canvas 2D 支持，与 Web 一致 */
  letterSpacing: string
  textAlign: 'left' | 'center' | 'right' | 'start' | 'end'
  textBaseline: 'top' | 'middle' | 'bottom' | 'alphabetic' | 'hanging' | 'ideographic'
  globalAlpha: number

  // 阴影（艺术字效果用）
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number

  // 矩形
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  strokeRect(x: number, y: number, w: number, h: number): void

  // 文本
  fillText(text: string, x: number, y: number, maxWidth?: number): void
  strokeText(text: string, x: number, y: number, maxWidth?: number): void
  measureText(text: string): { width: number }

  // 路径
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  rect(x: number, y: number, w: number, h: number): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, anticlockwise?: boolean): void
  fill(): void
  stroke(): void

  // 变换与状态栈
  save(): void
  restore(): void
  scale(x: number, y: number): void
  rotate(angle: number): void
  translate(x: number, y: number): void
  /** 矩阵变换（a c e / b d f），skew 用 transform(1,0,tan(skew),1,0,0) */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void

  // 裁剪
  clip(fillRule?: 'nonzero' | 'evenodd'): void

  // 渐变
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient

  // 图像（项目暂未用，保留签名）
  drawImage(image: any, dx: number, dy: number): void
  drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void
  drawImage(image: any, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
}

interface CanvasGradient {
  addColorStop(offset: number, color: string): void
}

/**
 * 给小程序 Canvas 接口补上 getContext 方法签名（官方 typings 遗漏）
 */
declare namespace WechatMiniprogram {
  interface Canvas {
    getContext(type: '2d'): CanvasRenderingContext2D
    getContext(type: 'webgl'): any
  }
  /** 给 Wx 接口补上官方 typings 遗漏的 createImage 方法 */
  interface Wx {
    createImage(): WxImage
  }
}

/**
 * wx.createImage() 返回的 Image 对象（用于异步加载图片到 canvas）
 * 与 Web HTMLImageElement 类似但官方 typings 没声明 wx.createImage
 */
interface WxImage {
  src: string
  width: number
  height: number
  onload: (() => void) | null
  onerror: (() => void) | null
}
