// pages/tree/tree.ts
// P3-1 成就养成树：把成就画成节点树（中心=总成就 / 分支=分类 / 叶子=具体成就）。
//
// 设计决策（避开力导向动画陷阱，与 graph.ts 同思路）：
//   - 静态垂直树布局（一次性 canvas 绘制，不做交互式拖拽/缩放）：
//     · 顶层：中心节点 = 总成就数（用星辉底色 achv-stars 风格的深色填充 + 星点装饰）
//     · 中层：分类分支节点（横向排开），节点大小=该分类作品数
//     · 底层：每个分类下取 Top N 成就作为叶子（按完成日降序），里程碑成就高亮
//   - 复用 graph.ts 的 canvas bootstrap（createSelectorQuery + dpr + ctx.scale）。
//   - 点击节点走命中检测 + toast（与 graph 页同款轻量交互）。
//   - 数据 <5 显示空态（与 graph 页阈值一致）。
//
// 与 achievement-presets.draw 的关系：
//   原 draw 函数是方形 (0,0,size,size) 绑定的，树节点是圆形/不规则区域，
//   直接复用会把星点画到节点圆外。这里不强行适配 draw，而是自绘星辉底色 + 星点
//   （取 achv-stars 的配色与笔触思路），保证节点边界清晰。这比加一层区域适配更稳。

import { Item, loadAllAchievements } from '../../utils/storage'
import { getCategoryMeta, resolveCategory } from '../../utils/category-meta'
import { applyThemeToPage, getThemeCache } from '../../utils/theme'
import { canvasColors, getCanvasColors, CanvasColors } from '../../utils/design-tokens'
import { resolveTheme } from '../../utils/preferences'
import { isDirty, anyDirty, DirtyField } from '../../utils/data-dirty'

/** 树节点（命中检测 + 绘制用）*/
interface TreeNode {
  id: string
  label: string           // 显示文字（中心=数字 / 分类=分类名 / 叶子=书名截断）
  kind: 'center' | 'category' | 'leaf'
  x: number               // canvas CSS 坐标
  y: number
  radius: number
  color: string
  count: number           // 中心=总数 / 分类=该分类数 / 叶子=1
  milestone?: boolean     // 叶子专属：是否里程碑成就（高亮描边）
  fullLabel: string       // toast 用完整文字
}

/** 连线（中心 → 分类 → 叶子）*/
interface TreeEdge {
  fromX: number
  fromY: number
  toX: number
  toY: number
  color: string
  alpha: number
}

const TOP_CATEGORIES = 5        // 最多展示几个分类分支（太多横向挤不下）
const LEAVES_PER_CATEGORY = 4   // 每个分类最多展示几片叶子
const MIN_DATA = 5              // 与 graph 页一致的空态阈值
const CENTER_RADIUS = 40
const CATEGORY_RADIUS_MIN = 16
const CATEGORY_RADIUS_MAX = 28
const LEAF_RADIUS = 9

/** hex (#RRGGBB) → "r, g, b" 字符串（拼 rgba 用）；非法 hex 回落 "0, 0, 0" */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '0, 0, 0'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (isNaN(r) || isNaN(g) || isNaN(b)) ? '0, 0, 0' : (r + ', ' + g + ', ' + b)
}

Page({
  data: {
    themeClass: 'theme-light',
    navColor: canvasColors.nav.color,
    navBg: canvasColors.nav.bg,
    canvasW: 0,
    canvasH: 0,
    hasData: false,
    totalAchievements: 0,
    categoryLegend: [] as { label: string; color: string; count: number }[],
    emptyHint: '',
    // canvas 绘制状态：'drawing' 节点就绪中（显示 loading）/ 'done' 绘制完成 / 'failed' 重试 3 次仍失败
    canvasState: 'drawing' as 'drawing' | 'done' | 'failed',
  },

  // 非 data 的绘图状态（命中检测用；不触发 setData）
  _nodes: [] as TreeNode[],
  _edges: [] as TreeEdge[],
  _stars: [] as { x: number; y: number; r: number; alpha: number }[],  // 中心节点星点装饰
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
    if (all.length < MIN_DATA) {
      this.setData({ hasData: false, emptyHint: '至少记录 ' + MIN_DATA + ' 条成就后，这里会长出你的养成树' })
      return
    }

    // 画布尺寸：宽度撑满，高度按层数动态算（中心 + 分类 + 叶子三层）
    let winW = 375
    try {
      const info = (wx as any).getWindowInfo ? (wx as any).getWindowInfo() : wx.getSystemInfoSync()
      winW = info.windowWidth || winW
    } catch (_e) { /* 默认值 */ }

    const canvasW = Math.max(300, winW - 32)
    // 高度：顶部留白 + 中心层 + 分类层 + 叶子层 + 底部留白
    const layerCenterY = 80
    const layerCategoryY = 200
    const layerLeafY = 330
    const canvasH = 420

    const { nodes, edges, stars, legend, total } = this.buildTree(all, canvasW, canvasH, layerCenterY, layerCategoryY, layerLeafY)
    this._nodes = nodes
    this._edges = edges
    this._stars = stars

    this.setData({
      hasData: true,
      totalAchievements: total,
      canvasW,
      canvasH,
      categoryLegend: legend,
      canvasState: 'drawing',  // 开始绘制：显示 loading 直到 draw() 完成
    }, () => {
      this.setupCanvasAndDraw()
    })
  },

  /** 构建树数据：中心 + 分类分支 + 叶子 + 连线 */
  buildTree(
    all: Item[],
    w: number,
    _h: number,
    centerY: number,
    categoryY: number,
    leafY: number,
  ): {
    nodes: TreeNode[]; edges: TreeEdge[]; stars: { x: number; y: number; r: number; alpha: number }[];
    legend: { label: string; color: string; count: number }[]; total: number
  } {
    const cx = w / 2
    const nodes: TreeNode[] = []
    const edges: TreeEdge[] = []
    const stars: { x: number; y: number; r: number; alpha: number }[] = []

    // 中心节点：总成就数，深色底 + 星辉装饰
    nodes.push({
      id: '__center__',
      label: String(all.length),
      kind: 'center',
      x: cx, y: centerY,
      radius: CENTER_RADIUS,
      color: this._colors.inkDark,
      count: all.length,
      fullLabel: '共 ' + all.length + ' 条成就',
    })
    // 中心节点星点装饰（取 achv-stars 的星辉配色思路）
    const starCount = 18
    for (let i = 0; i < starCount; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = Math.random() * (CENTER_RADIUS - 6)
      stars.push({
        x: cx + Math.cos(angle) * dist,
        y: centerY + Math.sin(angle) * dist,
        r: Math.random() * 1.6 + 0.4,
        alpha: Math.random() * 0.5 + 0.3,
      })
    }

    // 分类分支：按作品数 Top N
    const catCounts: { [cat: string]: number } = {}
    for (const it of all) {
      const c = resolveCategory(it.category, it.type)
      catCounts[c] = (catCounts[c] || 0) + 1
    }
    const cats = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]).slice(0, TOP_CATEGORIES)
    const catMax = cats.length > 0 ? catCounts[cats[0]] : 1

    // 分类节点横向均匀排开
    const catSlotW = w / (cats.length + 1)
    const catNodes: TreeNode[] = []
    cats.forEach((cat, i) => {
      const meta = getCategoryMeta(cat)
      const x = catSlotW * (i + 1)
      const count = catCounts[cat]
      const ratio = catMax > 0 ? count / catMax : 0
      const radius = CATEGORY_RADIUS_MIN + (CATEGORY_RADIUS_MAX - CATEGORY_RADIUS_MIN) * ratio
      const node: TreeNode = {
        id: 'cat:' + cat,
        label: meta.label,
        kind: 'category',
        x, y: categoryY,
        radius,
        color: meta.color,
        count,
        fullLabel: meta.label + ' · ' + count + ' 条',
      }
      catNodes.push(node)
      nodes.push(node)
      // 连线：中心 → 分类
      edges.push({ fromX: cx, fromY: centerY, toX: x, toY: categoryY, color: meta.color, alpha: 0.35 })
    })

    // 叶子：每个分类取 Top N 成就（按完成日降序），里程碑高亮
    cats.forEach((cat, i) => {
      const catX = catSlotW * (i + 1)
      const meta = getCategoryMeta(cat)
      const leaves = all
        .filter(it => resolveCategory(it.category, it.type) === cat)
        .sort((a, b) => (b.finishedDate || '').localeCompare(a.finishedDate || ''))
        .slice(0, LEAVES_PER_CATEGORY)
      // 叶子在该分类下方纵向排开（小幅横向偏移避免重叠）
      leaves.forEach((it, j) => {
        const offsetX = (j - (leaves.length - 1) / 2) * 22
        const offsetY = j * 18
        const milestone = !!it.milestone
        const node: TreeNode = {
          id: 'leaf:' + it.id,
          label: '',
          kind: 'leaf',
          x: catX + offsetX,
          y: leafY + offsetY,
          radius: LEAF_RADIUS,
          color: milestone ? this._colors.starGold : meta.color,
          count: 1,
          milestone,
          fullLabel: it.title + (milestone ? ' · ★ 里程碑' : ''),
        }
        nodes.push(node)
        // 连线：分类 → 叶子
        edges.push({
          fromX: catX, fromY: categoryY,
          toX: node.x, toY: node.y,
          color: meta.color,
          alpha: milestone ? 0.5 : 0.2,
        })
      })
    })

    const legend = cats.map(cat => {
      const meta = getCategoryMeta(cat)
      return { label: meta.label, color: meta.color, count: catCounts[cat] }
    })

    return { nodes, edges, stars, legend, total: all.length }
  },

  /** canvas bootstrap（复用 graph.ts 的 createSelectorQuery + dpr + ctx.scale 模式） */
  setupCanvasAndDraw(retry = 0) {
    const query = wx.createSelectorQuery()
    query.select('#tree-canvas').fields({ node: true, size: true }).exec((res) => {
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

  /** 绘制：连线 → 星点装饰 → 节点 → 标签 */
  draw() {
    const ctx = this._ctx
    if (!ctx) return
    const w = this.data.canvasW
    const h = this.data.canvasH
    ctx.clearRect(0, 0, w, h)

    // 1. 连线（在节点下方）
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

    // 2. 节点填充 + 描边
    for (const n of this._nodes) {
      // 中心节点：先画星点装饰（在深色底之前画底色，星点画在底色上）
      if (n.kind === 'center') {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.fill()
        // 星点（取 achv-stars 星辉思路；颜色随主题取 starGoldSoft）
        const starRgb = hexToRgb(this._colors.starGoldSoft)
        for (const s of this._stars) {
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(' + starRgb + ', ' + s.alpha + ')'
          ctx.fill()
        }
      } else {
        // 分类 / 叶子：纯色填充
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.globalAlpha = n.kind === 'category' ? 0.9 : 0.7
        ctx.fill()
      }
      ctx.globalAlpha = 1
      // 描边
      ctx.lineWidth = n.milestone ? 2.5 : 2
      ctx.strokeStyle = n.milestone ? this._colors.starGold : this._colors.pageFill
      ctx.stroke()
    }

    // 3. 标签
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const n of this._nodes) {
      if (n.kind === 'center') {
        ctx.fillStyle = this._colors.starGoldSoft
        ctx.font = 'bold 18px sans-serif'
        ctx.fillText(n.label, n.x, n.y)
      } else if (n.kind === 'category') {
        ctx.fillStyle = this._colors.pageCardFill
        ctx.font = 'bold 11px sans-serif'
        ctx.fillText(n.label, n.x, n.y)
      }
      // 叶子节点不画标签（太密；点击 toast 看全名）
    }
    ctx.textAlign = 'center'
  },

  /** 点击命中检测 + toast（与 graph 页同款） */
  onCanvasTap(e: WechatMiniprogram.TouchEvent) {
    const touch = e.detail
    const x = touch.x
    const y = touch.y
    if (typeof x !== 'number' || typeof y !== 'number') return
    // 从外向内找命中（叶子/分类优先于中心）
    for (let i = this._nodes.length - 1; i >= 0; i--) {
      const n = this._nodes[i]
      const dx = x - n.x
      const dy = y - n.y
      if (dx * dx + dy * dy <= n.radius * n.radius) {
        wx.showToast({ title: n.fullLabel, icon: 'none' })
        return
      }
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.hasData ? '我的养成树 · ' + this.data.totalAchievements + ' 条成就' : '阅观 · 成长养成树',
      path: '/pages/index/index',
    }
  },
})
