// pages/poster/poster.ts
// 报告导出页：卡片 canvas 预览 + 单张导出 / 长图拼接导出 + 存相册分享
// 入参：id（报告 id）或 wrappedYear（年度回顾年份）；两者互斥。
//   - id 走 loadReport → 普通报告卡片
//   - wrappedYear 走 loadWrappedReport → Wrapped 五幕专属卡片（强化分享传播）
// 严守 dpr 纪律：每次绘制前设 canvas.width/height 并 ctx.scale(dpr)

import { ReportInstance, ReportCard, loadReport, markReportExported } from '../../utils/storage'
import { drawCard, CARD_ASPECT, preloadCardImage, preloadImagePath, clearImageCache, setImageFactory, splitOverflowCards } from '../../utils/poster'
import { CardStyle, mergeStyle, canvasColors } from '../../utils/design-tokens'
import { applyThemeToPage } from '../../utils/theme'
import { loadWrappedReport } from '../../utils/wrapped-poster'

/** 预加载一张卡的全部图片：背景图 + 所有段的正文图 */
function preloadCardAll(style: CardStyle | undefined, card: ReportCard | undefined): Promise<void[]> {
  const tasks: Promise<void>[] = [preloadCardImage(style)]  // 背景图（内部判断内置纹理）
  if (card && card.segments) {
    for (const seg of card.segments) {
      if (seg.image) tasks.push(preloadImagePath(seg.image))
    }
  }
  return Promise.all(tasks)
}

type ExportMode = 'long' | 'single'

/**
 * 计算报告里某张卡的合并样式（继承链：卡片自身 > 报告 globalStyle > 默认）
 * 模板级 style 暂不参与（报告生成时已把模板内容拷到 cards，模板 style 后续再补）
 * 返回未 resolve 的 CardStyle，传给 drawCard 由其内部 resolve。
 */
function resolveCardStyle(report: ReportInstance, index: number): CardStyle {
  const card = report.cards[index]
  return mergeStyle(report.globalStyle, card ? card.style : null)
}

Page({
  data: {
    themeClass: 'theme-light',
    navColor: canvasColors.nav.color,
    navBg: canvasColors.nav.bg,
    reportId: '',
    report: null as ReportInstance | null,
    // Wrapped 年度海报模式：从 pages/wrapped 点「导出年度海报」跳来时带 wrappedYear。
    // P3-1 已接入 wrapped-poster.ts 的 wrappedToReport 管线：把五幕转成专属卡片走 drawCard 导出。
    wrappedYear: 0,
    current: 0,
    exportMode: 'long' as ExportMode,
    generating: false,
    loaded: false,    // 数据是否已尝试加载（区分加载中 vs 真的不存在）
    tipText: '',
    // 每张卡渲染成图片后的临时路径（按 index 对齐 report.cards）
    // 关键：swiper 对内部多个 type="2d" canvas 节点做了虚拟化，导致所有页显示成同一张。
    //       改成「离屏 canvas 画好 → canvasToTempFilePath → swiper 里放 image」，绕开这个平台限制。
    cardImages: [] as string[],
  },

  // 离屏 canvas（渲染预览 + 导出共用）
  _offCanvas: null as WechatMiniprogram.Canvas | null,
  // 卡片预览尺寸（css px，所有卡相同）
  _cardW: 0,
  _cardH: 0,
  _dpr: 2,
  // 首次加载完成标记（区分 onLoad 已加载 vs onShow 返回刷新）
  _loadedOnce: false,
  // 保存超时定时器（全局兜底，防止 generating 永久卡死）
  _saveTimer: 0 as number,

  onLoad(options: { id?: string; wrappedYear?: string }) {
    applyThemeToPage(this)
    const id = (options && options.id) || ''
    // 年度海报模式：wrappedYear 存在且无 id 时进入（与报告模式互斥）。
    // 解析非法年份时回退到今年，保证页面不崩。
    let wrappedYear = 0
    if (options && options.wrappedYear) {
      const parsed = parseInt(options.wrappedYear, 10)
      if (!isNaN(parsed) && parsed > 1900 && parsed < 9999) wrappedYear = parsed
    }
    this._dpr = this.getDpr()
    this._loadedOnce = false  // 标记首次加载未完成，避免 onShow 重复触发 loadReportData
    this.setData({ reportId: id, wrappedYear }, () => {
      // 有 id 走原有报告导出流程；年度海报模式（wrappedYear 且无 id）走 WrappedData → ReportCard 管线。
      if (id) {
        this.loadReportData()
      } else if (wrappedYear) {
        this.loadWrappedData()
      } else {
        this.setData({ loaded: true })
        this._loadedOnce = true
      }
    })
  },

  onShow() {
    applyThemeToPage(this)
    // 从 report-edit 返回时刷新（编辑过卡片内容要重画）。
    // 但首次进入时 onLoad 已触发加载，onShow 也会执行 —— 用 _loadedOnce 避免双重加载导致渲染竞争。
    if (this.data.reportId && this._loadedOnce) this.loadReportData()
    // Wrapped 海报模式：返回时也刷新（用户可能在 wrapped 页切了年份）
    if (!this.data.reportId && this.data.wrappedYear && this._loadedOnce) this.loadWrappedData()
  },

  getDpr(): number {
    try {
      const winInfo = (wx as any).getWindowInfo
      return (typeof winInfo === 'function' ? winInfo().pixelRatio : 0) || wx.getSystemInfoSync().pixelRatio || 2
    } catch (e) {
      return wx.getSystemInfoSync().pixelRatio || 2
    }
  },

  loadReportData() {
    const report = this.data.reportId ? loadReport(this.data.reportId) : null
    console.log('[poster] loadReportData:', { reportId: this.data.reportId, hasReport: !!report, cardCount: report ? report.cards.length : 0 })
    // 重置图片缓存和卡片图片（新报告/重新加载时）
    clearImageCache()
    this.setData({
      report,
      loaded: true,
      current: report ? Math.min(this.data.current, report.cards.length - 1) : 0,
      cardImages: [],
      tipText: report && report.cards.length > 0 ? (report.cards[0] ? report.cards[0].title : '') || '封面' : '',
    }, () => {
      if (report) {
        // 等 swiper-item 渲染好，再把所有卡画到离屏 canvas 并转成图片
        setTimeout(() => this.renderAllToImages(), 50)
      }
      this._loadedOnce = true
    })
  },

  /** P3-1 Wrapped 年度海报模式：把 WrappedData 五幕转成 ReportInstance，复用报告导出流程。
   *  与 loadReportData 同构，只是数据源从 loadReport(id) 换成 loadWrappedReport(year)。
   *  数据不足（loadWrappedReport 返回 null）时显示占位态（让用户知道今年还不够生成海报）。 */
  loadWrappedData() {
    const year = this.data.wrappedYear
    const report = year ? loadWrappedReport(year) : null
    clearImageCache()
    this.setData({
      report,
      loaded: true,
      current: report ? Math.min(this.data.current, report.cards.length - 1) : 0,
      cardImages: [],
      tipText: report && report.cards.length > 0 ? (report.cards[0] ? report.cards[0].title : '') || (year + ' 年度回顾') : '',
    }, () => {
      if (report) {
        setTimeout(() => this.renderAllToImages(), 50)
      }
      this._loadedOnce = true
    })
  },

  /**
   * 把所有卡片依次画到离屏 canvas，每画完一张立刻 canvasToTempFilePath 转成临时图片，
   * 收集到 data.cardImages，swiper 里直接放 <image> 展示。
   *
   * 为什么不再用「swiper 里每页一个 canvas」：
   * 微信 swiper 对内部多个 type="2d" canvas 节点做了虚拟化/延迟激活，离屏画的内容会串到同一个
   * 激活的缓冲区上 —— 表现为「所有页都显示成第一张」。改成「离屏画 → 转图片 → swiper 放 image」，
   * image 是纯位图，不受 swiper 虚拟化影响，每页内容稳定独立。
   */
  renderAllToImages() {
    const report = this.data.report
    if (!report || report.cards.length === 0) {
      console.warn('[poster] renderAllToImages: report 为空，退出')
      return
    }
    this.ensureOffCanvas((canvas: WechatMiniprogram.Canvas) => {
      setImageFactory(canvas)
      const w = this._cardW || 600
      const h = this._cardH || w / CARD_ASPECT
      const cardImages: string[] = []

      // 串行画每张卡：画一张 → 转图片 → 画下一张（避免并发竞争同一个离屏 canvas）
      const drawOne = (index: number) => {
        if (index >= report.cards.length) {
          this.setData({ cardImages: cardImages.slice() })
          return
        }
        const style = resolveCardStyle(report, index)
        preloadCardAll(style, report.cards[index]).then(() => {
          let ctx: CanvasRenderingContext2D
          try {
            ctx = canvas.getContext('2d')
            canvas.width = w * this._dpr
            canvas.height = h * this._dpr
            ctx.scale(this._dpr, this._dpr)
            drawCard(ctx, w, h, report.cards[index], style)
          } catch (e) {
            console.error('[poster] renderAllToImages 第' + index + '张 drawCard 异常:', e)
            // 异常也填一个空位，保证 cardImages 和 cards 下标对齐
            cardImages[index] = ''
            drawOne(index + 1)
            return
          }
          // 把画好的 canvas 转成临时图片
          wx.canvasToTempFilePath({
            canvas,
            fileType: 'png',
            quality: 1,
            success: (res) => {
              cardImages[index] = res.tempFilePath
              drawOne(index + 1)
            },
            fail: (err) => {
              console.error('[poster] 第' + index + '张 canvasToTempFilePath 失败:', err)
              cardImages[index] = ''
              drawOne(index + 1)
            },
          })
        })
      }
      drawOne(0)
    })
  },

  /* ===== swiper 切换 ===== */

  onSwiperChange(e: WechatMiniprogram.SwiperChange) {
    const current = e.detail.current
    const report = this.data.report
    const card = report ? report.cards[current] : undefined
    // 卡片图片已预生成（renderAllToImages），swiper 里放的是 image，切换时无需重画
    this.setData({
      current,
      tipText: (card ? card.title : '') || '',
    })
  },

  /* ===== 导出模式切换 ===== */

  onSwitchMode(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as ExportMode
    if (mode === this.data.exportMode) return
    this.setData({ exportMode: mode })
  },

  /* ===== 保存 ===== */

  onSave() {
    const report = this.data.report
    if (!report) return
    // 全局超时保护：20 秒后若仍在生成，强制复位遮罩，避免「一直显示正在生成」卡死
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      if (this.data.generating) {
        console.error('[poster] 保存超时（20s），强制复位')
        this.finishGenerating()
        wx.showToast({ title: '保存超时，请重试', icon: 'none' })
      }
    }, 20000)
    if (this.data.exportMode === 'single') {
      this.saveSingle()
    } else {
      this.saveLong()
    }
  },

  /** 导出当前单张 */
  saveSingle() {
    const report = this.data.report
    if (!report) return
    const current = this.data.current
    this.setData({ generating: true })
    const style = resolveCardStyle(report, current)

    preloadCardAll(style, report.cards[current]).then(() => {
      this.ensureOffCanvas((canvas: WechatMiniprogram.Canvas) => {
        const card = report.cards[current]
        // 用预览时的卡片尺寸（保证导出和预览一致）
        const w = this._cardW || 600
        const h = this._cardH || w / CARD_ASPECT
        let ctx: CanvasRenderingContext2D
        try {
          ctx = canvas.getContext('2d')
          canvas.width = w * this._dpr
          canvas.height = h * this._dpr
          ctx.scale(this._dpr, this._dpr)
          drawCard(ctx, w, h, card, style)
        } catch (e) {
          console.error('[poster] saveSingle drawCard 异常:', e)
          this.finishGenerating()
          wx.showToast({ title: '导出失败，请重试', icon: 'none' })
          return
        }

        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          quality: 1,
          success: (res) => {
            this.saveToAlbum(res.tempFilePath)
          },
          fail: (err) => {
            console.error('[poster] canvasToTempFilePath 失败（单张）:', err)
            this.finishGenerating()
            wx.showToast({ title: '导出失败，请重试', icon: 'none' })
          },
        })
      })
    })
  },

  /** 拼长图导出 */
  saveLong() {
    const report = this.data.report
    if (!report) return
    if (report.cards.length === 0) {
      wx.showToast({ title: '没有卡片可导出', icon: 'none' })
      return
    }
    this.setData({ generating: true })
    // P6 超长拆卡：模板循环块展开后单卡可能段数过多，导出会被 drawSegments 截断丢字。
    // 导出前按段数预算拆成多张同类型卡（封面/落款不拆）。预览不受影响（仍按原 cards）。
    const cards = splitOverflowCards(report.cards)
    const globalStyle = report.globalStyle
    const styles = cards.map(card => mergeStyle(globalStyle, card.style))

    // 并行预加载所有卡的背景图 + 段图片，加载完后再统一画长图
    Promise.all(styles.map((s, i) => preloadCardAll(s, cards[i]))).then(() => {
      this.ensureOffCanvas((canvas: WechatMiniprogram.Canvas) => {
        const w = this._cardW || 600
        const singleH = this._cardH || w / CARD_ASPECT
        const gap = 0  // 卡片之间无间隙（每张卡自带白底）
        const totalH = singleH * cards.length + gap * (cards.length - 1)

        let ctx: CanvasRenderingContext2D
        try {
          ctx = canvas.getContext('2d')
          canvas.width = w * this._dpr
          canvas.height = totalH * this._dpr
          ctx.scale(this._dpr, this._dpr)

          // 先填整个背景为页面底色（卡间 gap 已无，但保险）
          ctx.fillStyle = canvasColors.pageFill
          ctx.fillRect(0, 0, w, totalH)

          // 依次画每张卡
          cards.forEach((card, i) => {
            const offsetY = i * (singleH + gap)
            // drawCard 会 clearRect 整个 canvas，这里要用裁剪区隔离每张卡
            ctx.save()
            ctx.beginPath()
            ctx.rect(0, offsetY, w, singleH)
            ctx.clip()
            // drawCard 内部会 clearRect(0,0,w,h) 清整张——所以要把绘制平移到本卡区
            ctx.translate(0, offsetY)
            drawCard(ctx, w, singleH, card, styles[i])
            ctx.restore()
          })
        } catch (e) {
          console.error('[poster] saveLong drawCard 异常:', e)
          this.finishGenerating()
          wx.showToast({ title: '导出失败，请重试', icon: 'none' })
          return
        }

        wx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          quality: 1,
          success: (res) => {
            this.saveToAlbum(res.tempFilePath)
          },
          fail: (err) => {
            console.error('[poster] canvasToTempFilePath 失败（长图）:', err)
            this.finishGenerating()
            wx.showToast({ title: '长图导出失败，请重试', icon: 'none' })
          },
        })
      })
    })
  },

  /** 拿到离屏 canvas 节点（首次用时查询一次，带重试）
   *  同时取 size，校验节点真实进入布局（width/height > 0），避免在 0×0 的空 canvas 上绘制导出空白图。 */
  ensureOffCanvas(cb: (canvas: WechatMiniprogram.Canvas) => void, retryCount = 0): void {
    if (this._offCanvas) {
      cb(this._offCanvas)
      return
    }
    const query = wx.createSelectorQuery()
    query.select('#offCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        // 节点未就绪：重试最多 3 次（每次间隔 100ms），仍失败则报错并复位 generating
        if (retryCount < 3) {
          console.warn('[poster] offCanvas 未就绪，重试 ' + (retryCount + 1))
          setTimeout(() => this.ensureOffCanvas(cb, retryCount + 1), 100)
        } else {
          console.error('[poster] offCanvas 重试 3 次仍失败')
          this.finishGenerating()
          wx.showToast({ title: '导出组件未就绪，请重试', icon: 'none' })
        }
        return
      }
      console.log('[poster] offCanvas 就绪')
      this._offCanvas = res[0].node as WechatMiniprogram.Canvas
      setImageFactory(this._offCanvas)  // 导出路径兜底注入图片工厂
      cb(this._offCanvas)
    })
  },

  /** 统一结束生成状态：复位 generating 遮罩 + 清除超时定时器 */
  finishGenerating() {
    if (this._saveTimer) { clearTimeout(this._saveTimer as any); this._saveTimer = 0 }
    this.setData({ generating: false })
  },

  /** 保存到相册（带权限处理） */
  saveToAlbum(filePath: string) {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting['scope.writePhotosAlbum'] === false) {
          this.finishGenerating()
          this.showSettingGuide()
        } else {
          this.doSaveAlbum(filePath)
        }
      },
      fail: () => this.doSaveAlbum(filePath),
    })
  },

  doSaveAlbum(filePath: string) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        this.finishGenerating()
        // 回写导出状态：报告列表页据此显示「已导出」标记
        if (this.data.reportId) {
          markReportExported(this.data.reportId)
        }
        wx.showToast({ title: '已保存到相册', icon: 'success' })
      },
      fail: (err) => {
        console.error('[poster] saveImageToPhotosAlbum 失败:', err)
        this.finishGenerating()
        // 权限拒绝：errMsg 含 auth deny / privacy permission / authorize（新版微信多种措辞）
        const msg = (err.errMsg || '').toLowerCase()
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('auth') >= 0 || msg.indexOf('privacy') >= 0 || msg.indexOf('authorize') >= 0) {
          this.showSettingGuide()
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
    })
  },

  showSettingGuide() {
    wx.showModal({
      title: '需要相册权限',
      content: '请在设置中允许保存到相册',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) wx.openSetting()
      },
    })
  },

  onBack() {
    wx.navigateBack()
  },

  onShareAppMessage() {
    // 年度海报模式：用 Wrapped 海报的真实标题（不再是"敬请期待"占位）
    if (!this.data.reportId && this.data.wrappedYear) {
      const title = (this.data.report && this.data.report.title) || (this.data.wrappedYear + ' 年度回顾')
      return {
        title: title + ' · 我的人格与高光时刻',
        path: '/pages/wrapped/wrapped?year=' + this.data.wrappedYear,
      }
    }
    return {
      title: (this.data.report ? this.data.report.title : '') || '阅观年度 — 我的年度报告',
      path: '/pages/index/index',
    }
  },

  /** P3-1 朋友圈分享：Wrapped 海报模式才开（普通报告走 onShareAppMessage 即可） */
  onShareTimeline() {
    if (!this.data.reportId && this.data.wrappedYear) {
      const title = (this.data.report && this.data.report.title) || (this.data.wrappedYear + ' 年度回顾')
      return {
        title: title + ' · 我的人格与高光时刻',
        query: 'year=' + this.data.wrappedYear,
      }
    }
    return {
      title: (this.data.report ? this.data.report.title : '') || '阅观年度',
    }
  },
})
