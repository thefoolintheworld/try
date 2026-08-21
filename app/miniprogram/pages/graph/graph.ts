// pages/graph/graph.ts
// P2-8 关联图谱（静态环图版）：书↔作者↔分类 的可视化关系网。
//
// 设计决策（避免力导向动画的复杂度与性能风险）：
//   - 采用「静态同心环」布局，而非力导向 simulation：
//     · 中心：总成就数（大圆）
//     · 内环：分类节点（reading/film/...），节点大小=该分类作品数
//     · 外环：作者节点，节点大小=该作者作品数（取 Top N，太多会糊）
//     · 连线：作者 → 其作品所属分类（同色淡线）
//   - 静态绘制（一次性 drawImage），不做交互式拖拽/缩放——复用 poster.ts 的 canvas bootstrap，
//     避开手势处理与重绘的性能/收敛调参陷阱。
//   - 点击节点显示信息（轻量交互，通过 canvas 坐标命中检测 + toast 实现）。
//   - 数据不足（<5 条）显示空态引导。

import { Item, loadAllAchievements } from '../../utils/storage'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getThemeCache } from '../../utils/theme'
import { calcAuthorStats } from '../../utils/stats'
import { canvasColors, getCanvasColors, CanvasColors } from '../../utils/design-tokens'
import { resolveTheme } from '../../utils/preferences'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 图节点（用于命中检测和绘制）*/
interface GraphNode {
  id: string
  label: string
  kind: 'center' | 'category' | 'author'
  x: number       // canvas 坐标（CSS 像素，未乘 dpr）
  y: number
  radius: number
  color: string
  count: number
}

/** 作者→分类的连线（用于绘制）*/
interface GraphEdge {
  fromX: number
  fromY: number
  toX: number
  toY: number
  color: string
  alpha: number
}

const TOP_AUTHORS = 12        // 外环最多显示多少个作者（太多会糊）
const CENTER_RADIUS = 38      // 中心圆半径（CSS px）
const MIN_NODE_RADIUS = 10    // 分类/作者节点最小半径
const MAX_NODE_RADIUS = 26    // 分类/作者节点最大半径
const INNER_RING_RATIO = 0.42 // 内环半径占画布半径的比例
const OUTER_RING_RATIO = 0.82 // 外环半径占画布半径的比例

Page({
  data: {
    themeClass: 'theme-light',
    navColor: canvasColors.nav.color,
    navBg: canvasColors.nav.bg,
    canvasW: 0,           // canvas CSS 宽（绘图坐标系）
    canvasH: 0,
    hasData: false,
    totalAchievements: 0,
    legend: [] as { label: string; color: string; count: number }[],
    emptyHint: '',        // 空态副标题
    // canvas 绘制状态：'drawing' 节点就绪中 / 'done' 完成 / 'failed' 重试 3 次仍失败
    canvasState: 'drawing' as 'drawing' | 'done' | 'failed',
  },

  // 非 data 的绘图状态（节点/边用于点击命中检测；不触发 setData）。
  // 注：微信小程序 Page() 是普通对象字面量，不支持 TS 的 `prop: Type = value` 字段声明语法；
  //     只能用 `_` 前缀 + `as` 表达式（与 poster.ts 的 _offCanvas 同模式）。
  _nodes: [] as GraphNode[],
  _edges: [] as GraphEdge[],
  _canvas: null as WechatMiniprogram.Canvas | null,
  _ctx: null as CanvasRenderingContext2D | null,
  _dpr: 2,
  _colors: canvasColors as CanvasColors,  // 当前主题的 canvas 配色（refresh 时按主题刷新）

  onLoad() {
    applyThemeToPage(this)
    this.refresh()
  },

  onShow() {
    applyThemeToPage(this)
    // canvas 重绘成本高，只在成就变动时才重算
    const watched: DirtyField[] = ['achievements']
    if (!anyDirty(watched)) return
    watched.forEach(f => isDirty(f))
    this.refresh()
  },

  // 系统主题变化时（app.ts 的 onThemeChange）触发即时重绘，
  // 避免切暗色后停在当前页时 canvas 仍用旧主题色（要回到本页 onShow 才换色的滞后）。
  onThemeUpdate() {
    applyThemeToPage(this)
    this.refresh()
  },

  refresh() {
    // 按当前主题选 canvas 配色（切主题回到本页时 onShow 会再调 refresh，自动换色）
    const cache = getThemeCache()
    this._colors = getCanvasColors(resolveTheme(cache.prefs.themeMode))

    const all = loadAllAchievements()
    if (all.length < 5) {
      this.setData({ hasData: false, emptyHint: '至少记录 5 条成就后，这里会出现你的阅读关系图谱' })
      return
    }
    // 计算画布尺寸（用窗口宽高定个合理的方形画布）
    let winW = 375
    let winH = 667
    try {
      const info = (wx as any).getWindowInfo ? (wx as any).getWindowInfo() : wx.getSystemInfoSync()
      winW = info.windowWidth || winW
      winH = info.windowHeight || winH
    } catch (_e) { /* 用默认值 */ }
    // 画布取「窗口宽 与 (窗口高 - 顶部导航) 的较小值」做正方形，留出图例空间
    const side = Math.min(winW - 32, winH - 280)
    const canvasW = Math.max(280, Math.floor(side))
    const canvasH = canvasW

    // 构建图数据
    const { nodes, edges, legend, total } = this.buildGraph(all, canvasW, canvasH)
    this._nodes = nodes
    this._edges = edges

    this.setData({
      hasData: true,
      totalAchievements: total,
      canvasW,
      canvasH,
      legend,
      canvasState: 'drawing',  // 开始绘制：显示 loading 直到 draw() 完成
    }, () => {
      // setData 后等 canvas 节点就绪再绘制
      this.setupCanvasAndDraw()
    })
  },

  /** 构建 图数据：中心 + 内环分类 + 外环作者 + 连线 */
  buildGraph(all: Item[], w: number, h: number): {
    nodes: GraphNode[], edges: GraphEdge[], legend: { label: string; color: string; count: number }[], total: number
  } {
    const cx = w / 2
    const cy = h / 2
    const ringR = Math.min(w, h) / 2
    const innerR = ringR * INNER_RING_RATIO
    const outerR = ringR * OUTER_RING_RATIO
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    // 中心节点
    nodes.push({
      id: '__center__',
      label: String(all.length),
      kind: 'center',
      x: cx, y: cy,
      radius: CENTER_RADIUS,
      color: this._colors.categoryPalette.game,  // 中心节点用 accent 系
      count: all.length,
    })

    // 内环：分类节点（按作品数取 Top 6）
    const catCounts: { [cat: string]: number } = {}
    for (const it of all) {
      const c = resolveCategory(it.category, it.type)
      catCounts[c] = (catCounts[c] || 0) + 1
    }
    const cats = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]).slice(0, 6)
    const catMax = cats.length > 0 ? catCounts[cats[0]] : 1
    const catNodes: GraphNode[] = []
    cats.forEach((cat, i) => {
      const meta = getCategoryMeta(cat)
      const angle = (i / cats.length) * Math.PI * 2 - Math.PI / 2  // 从正上方开始
      const x = cx + Math.cos(angle) * innerR
      const y = cy + Math.sin(angle) * innerR
      const count = catCounts[cat]
      const ratio = catMax > 0 ? count / catMax : 0
      const radius = MIN_NODE_RADIUS + (MAX_NODE_RADIUS - MIN_NODE_RADIUS) * ratio
      const node: GraphNode = {
        id: 'cat:' + cat,
        label: meta.label,
        kind: 'category',
        x, y, radius,
        color: meta.color,
        count,
      }
      catNodes.push(node)
      nodes.push(node)
    })

    // 外环：作者节点（取 Top N；按作者聚合）
    const authorStats = calcAuthorStats(all).slice(0, TOP_AUTHORS)
    const authorMax = authorStats.length > 0 ? authorStats[0].count : 1
    const authorColorPalette = this._colors.authorPalette
    authorStats.forEach((au, i) => {
      const angle = (i / Math.max(authorStats.length, 1)) * Math.PI * 2 - Math.PI / 2
      const x = cx + Math.cos(angle) * outerR
      const y = cy + Math.sin(angle) * outerR
      const ratio = authorMax > 0 ? au.count / authorMax : 0
      const radius = MIN_NODE_RADIUS + (MAX_NODE_RADIUS - MIN_NODE_RADIUS) * ratio
      const color = authorColorPalette[i % authorColorPalette.length]
      const node: GraphNode = {
        id: 'author:' + au.author,
        label: au.author,
        kind: 'author',
        x, y, radius,
        color,
        count: au.count,
      }
      nodes.push(node)
      // 连线：该作者 → 其作品的主分类（取该作者作品数最多的分类）
      const auCatCounts: { [cat: string]: number } = {}
      for (const b of au.books) {
        const c = resolveCategory(b.category, b.type)
        auCatCounts[c] = (auCatCounts[c] || 0) + 1
      }
      const topCat = Object.keys(auCatCounts).sort((a, b) => auCatCounts[b] - auCatCounts[a])[0]
      const catNode = catNodes.find(n => n.id === 'cat:' + topCat)
      if (catNode) {
        edges.push({
          fromX: node.x, fromY: node.y,
          toX: catNode.x, toY: catNode.y,
          color: catNode.color,
          alpha: 0.15 + 0.25 * ratio,   // 作品越多线越显眼
        })
      }
    })

    // 图例：分类列表（给底部 legend 用）
    const legend = cats.map(cat => {
      const meta = getCategoryMeta(cat)
      return { label: meta.label, color: meta.color, count: catCounts[cat] }
    })

    return { nodes, edges, legend, total: all.length }
  },

  /** 等 canvas 节点就绪 + 设置 dpr + 绘制（复用 poster.ts 的 bootstrap 模式） */
  setupCanvasAndDraw(retry = 0) {
    const query = wx.createSelectorQuery()
    query.select('#graph-canvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        if (retry < 3) {
          setTimeout(() => this.setupCanvasAndDraw(retry + 1), 50 * (retry + 1))
        } else {
          // 3 次重试节点仍未就绪：切失败态，显示重试入口（而非永久空白）
          this.setData({ canvasState: 'failed' })
        }
        return
      }
      const canvas = res[0].node as unknown as WechatMiniprogram.Canvas
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
      const dpr = this.getDpr()
      const cssW = this.data.canvasW
      const cssH = this.data.canvasH
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
      ctx.scale(dpr, dpr)
      this._canvas = canvas
      this._ctx = ctx
      this._dpr = dpr
      this.draw()
      this.setData({ canvasState: 'done' })  // 绘制完成，隐藏 loading
    })
  },

  /** 用户点「重试」按钮：重置状态并重新走绘制流程 */
  onRetryCanvas() {
    this.setData({ canvasState: 'drawing' })
    this.setupCanvasAndDraw()
  },

  getDpr(): number {
    try {
      const winInfo = (wx as any).getWindowInfo
      return (typeof winInfo === 'function' ? winInfo().pixelRatio : 0) || wx.getSystemInfoSync().pixelRatio || 2
    } catch (_e) {
      return wx.getSystemInfoSync().pixelRatio || 2
    }
  },

  /** 绘制：连线 → 节点 → 标签 */
  draw() {
    const ctx = this._ctx
    if (!ctx) return
    const w = this.data.canvasW
    const h = this.data.canvasH
    // 清空（背景透明，让 page bg 透过来）
    ctx.clearRect(0, 0, w, h)

    // 1. 先画连线（在节点下方）
    for (const e of this._edges) {
      ctx.beginPath()
      ctx.moveTo(e.fromX, e.fromY)
      ctx.lineTo(e.toX, e.toY)
      ctx.strokeStyle = e.color
      ctx.globalAlpha = e.alpha
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // 2. 画节点（填充 + 边框）
    for (const n of this._nodes) {
      // 填充
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
      ctx.fillStyle = n.color
      ctx.globalAlpha = n.kind === 'center' ? 1 : 0.85
      ctx.fill()
      // 边框（白色描边让节点和背景分离）
      ctx.globalAlpha = 1
      ctx.lineWidth = 2
      ctx.strokeStyle = this._colors.pageFill
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    // 3. 画标签（节点中心文字）
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const n of this._nodes) {
      if (n.kind === 'center') {
        // 中心：显示总数，大字号
        ctx.fillStyle = this._colors.pageCardFill
        ctx.font = 'bold 18px sans-serif'
        ctx.fillText(n.label, n.x, n.y)
      } else if (n.kind === 'category') {
        // 分类：显示分类名（白字）
        ctx.fillStyle = this._colors.pageCardFill
        ctx.font = 'bold 11px sans-serif'
        ctx.fillText(n.label, n.x, n.y)
      } else {
        // 作者：标签画在节点外侧，避免遮住圆点
        const cx = w / 2
        const cy = h / 2
        const dx = n.x - cx
        const dy = n.y - cy
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const labelX = n.x + (dx / dist) * (n.radius + 8)
        const labelY = n.y + (dy / dist) * (n.radius + 8)
        ctx.fillStyle = this._colors.nav.color  // 作者标签深墨色（与 nav 同源）
        ctx.font = '10px sans-serif'
        // 作者名太长截断
        const label = n.label.length > 6 ? n.label.slice(0, 5) + '…' : n.label
        // 根据 dx 方向调整对齐
        ctx.textAlign = dx > 0 ? 'left' : 'right'
        ctx.fillText(label, labelX, labelY)
      }
    }
    ctx.textAlign = 'center'
  },

  /** 点击 canvas：命中检测，命中节点弹 toast 显示信息 */
  onCanvasTap(e: WechatMiniprogram.TouchEvent) {
    const touch = e.detail
    const x = touch.x
    const y = touch.y
    if (typeof x !== 'number' || typeof y !== 'number') return
    // 从外向内找命中（作者/分类优先于中心，因为中心常被覆盖）
    for (let i = this._nodes.length - 1; i >= 0; i--) {
      const n = this._nodes[i]
      const dx = x - n.x
      const dy = y - n.y
      if (dx * dx + dy * dy <= n.radius * n.radius) {
        const text = n.kind === 'center'
          ? '共 ' + n.count + ' 条成就'
          : n.kind === 'category'
            ? n.label + ' · ' + n.count + ' 条'
            : n.label + ' · ' + n.count + ' 部作品'
        wx.showToast({ title: text, icon: 'none' })
        return
      }
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.hasData ? '我的阅读关系图谱 · ' + this.data.totalAchievements + ' 条成就' : '阅观 · 关系图谱',
      path: '/pages/index/index',
    }
  },
})
