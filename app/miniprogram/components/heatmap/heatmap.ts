// components/heatmap/heatmap.ts
// GitHub 式热力图组件：把一年的"每日记录数"渲染成 53 周 × 7 天的格子墙。
//
// 设计要点：
//  - 输入：days 数组 [{date:'YYYY-MM-DD', count:number}]，由父页面聚合好（成就数/打卡数/合并）
//  - 输出：weeks 数组（每周含 7 个 day 视图）+ 月份标签 + 摘要文案
//  - 分档：把 count 按"经验阈值"分到 level 0-4（0=无记录；1=1 条；2=2 条；3=3 条；4=4+ 条）
//    这是 GitHub 同款"等量分箱"思路，简单稳定，不依赖动态最大值（避免单日峰值把其它都压成浅色）
//  - 起点：默认从"今天往前推 52 周"开始（最近一年），与 GitHub 一致
//  - 主题：颜色用 CSS 变量 var(--color-accent) 系列，自动跟随主题切换；无需 JS 干预
//  - 交互：单元格 tap/longpress 触发 triggerEvent，由父页面决定如何响应（弹 tooltip / 跳详情）

/** 单日数据（父页面传入） */
export interface HeatmapDay {
  date: string         // 'YYYY-MM-DD'
  count: number        // 当日记录数
}

/** 单元格视图（组件内部计算后给 wxml） */
interface CellView {
  date: string
  count: number
  level: 0 | 1 | 2 | 3 | 4   // 颜色深浅档（0 最浅）
  today: boolean              // 是否今天（描边高亮）
  future: boolean             // 是否未来（淡化显示）
}

/** 周视图（一列 7 格） */
interface WeekView {
  colIndex: number
  days: CellView[]   // 长度固定 7；缺失日期用 level=0 占位
}

/** 月份标签视图（绝对定位到对应列） */
interface MonthLabelView {
  label: string      // '1月' / '2月' ...
  leftPx: number     // 距格子区左侧的像素偏移
  index: number      // 唯一 key
}

const CELL_SIZE_PX = 11      // 单元格边长（含间距，与 GitHub 一致）
const CELL_GAP_PX = 2        // 单元格间距
const CELL_STRIDE_PX = CELL_SIZE_PX + CELL_GAP_PX   // 每列步长 = 13px

Component({
  properties: {
    /** 数据：每日记录数（父页面聚合好传入） */
    days: {
      type: Array,
      value: [] as HeatmapDay[],
    },
    /** 标题（默认"全年活动"） */
    title: {
      type: String,
      value: '全年活动',
    },
    /** 是否显示标题行 */
    showHeader: {
      type: Boolean,
      value: true,
    },
    /** 是否显示月份标签 */
    showMonthLabels: {
      type: Boolean,
      value: true,
    },
    /** 是否显示星期标签（一/三/五） */
    showWeekLabels: {
      type: Boolean,
      value: true,
    },
    /** 是否显示底部图例 */
    showLegend: {
      type: Boolean,
      value: true,
    },
    /** 是否可横向滚动（小屏模式） */
    scrollable: {
      type: Boolean,
      value: true,
    },
    /** 起始日期（'YYYY-MM-DD'）；缺省取今天往前推 364 天（=53 周 - 1 天） */
    startDate: {
      type: String,
      value: '',
    },
    /** 分档阈值：[一档上限, 二档上限, 三档上限]；count ≤ 上限进该档。
     *  默认 [1,2,3]：count=0→L0, =1→L1, =2→L2, =3→L3, ≥4→L4 */
    thresholds: {
      type: Array,
      value: [1, 2, 3] as number[],
    },
  },

  data: {
    weeks: [] as WeekView[],
    monthLabels: [] as MonthLabelView[],
    summaryText: '',          // "全年 156 条 · 最长连续 23 天"
    gridWidthPx: 0,           // 格子区总宽（驱动 scroll-view 内层宽度）
  },

  observers: {
    /** days / startDate / thresholds 变化都触发重算 */
    'days, startDate, thresholds': function () {
      this.compute()
    },
  },

  lifetimes: {
    attached() {
      this.compute()
    },
  },

  methods: {
    /** 主计算：把 days 聚合成 weeks + 月份标签 + 摘要 */
    compute(): void {
      const days = this.properties.days as HeatmapDay[]
      const thresholds = (this.properties.thresholds as number[]) || [1, 2, 3]
      const start = this.resolveStartDate()

      // 1. 把 days 转成 map：{ 'YYYY-MM-DD': count }
      const countMap: { [date: string]: number } = {}
      for (const d of days) {
        if (d && d.date) {
          countMap[d.date] = (countMap[d.date] || 0) + (d.count || 0)
        }
      }

      // 2. 计算今天（用于 today/future 标记）
      const todayStr = this.formatDate(new Date())

      // 3. 遍历 53 周 × 7 天，构造 weeks
      const weeks: WeekView[] = []
      let totalRecords = 0
      let activeDays = 0
      for (let col = 0; col < 53; col++) {
        const weekDays: CellView[] = []
        for (let row = 0; row < 7; row++) {
          const offsetDays = col * 7 + row
          const cellDate = this.shiftDays(start, offsetDays)
          const count = countMap[cellDate] || 0
          const level = this.countToLevel(count, thresholds)
          if (count > 0) {
            totalRecords += count
            activeDays++
          }
          weekDays.push({
            date: cellDate,
            count,
            level,
            today: cellDate === todayStr,
            future: cellDate > todayStr,
          })
        }
        weeks.push({ colIndex: col, days: weekDays })
      }

      // 4. 月份标签：扫每周的第一天，月份变化时挂一个标签
      const monthLabels: MonthLabelView[] = []
      let lastMonth = -1
      for (let col = 0; col < weeks.length; col++) {
        const firstDayDate = weeks[col].days[0].date
        const month = parseInt(firstDayDate.slice(5, 7), 10)
        if (month !== lastMonth) {
          monthLabels.push({
            label: month + '月',
            leftPx: col * CELL_STRIDE_PX,
            index: monthLabels.length,
          })
          lastMonth = month
        }
      }

      // 5. 摘要文案
      const longestStreak = this.calcLongestStreakInWindow(weeks)
      const summaryText = totalRecords > 0
        ? '全年 ' + totalRecords + ' 条 · ' + activeDays + ' 天活跃 · 最长连续 ' + longestStreak + ' 天'
        : ''

      // 6. 格子区总宽（最右一格的右边缘）
      const gridWidthPx = 53 * CELL_STRIDE_PX + 24   // +24 留右侧 padding

      this.setData({
        weeks,
        monthLabels,
        summaryText,
        gridWidthPx,
      })
    },

    /** 解析起始日期：优先用 property；否则取今天往前推 364 天，并对齐到周日（让今天落在最后一列） */
    resolveStartDate(): string {
      const propStart = this.properties.startDate as string
      if (propStart && /^\d{4}-\d{2}-\d{2}$/.test(propStart)) {
        return propStart
      }
      // 取今天往前推 364 天 = 52 周；再对齐到周日（让格子从周日开始）
      const today = new Date()
      const offsetToSunday = today.getDay()   // 0=周日，1=周一...；要把起点对齐到周日
      const start = new Date(today)
      start.setDate(start.getDate() - 364 - offsetToSunday)
      return this.formatDate(start)
    },

    /** count → level（0-4）；thresholds 是升序的"上限数组" */
    countToLevel(count: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
      if (count <= 0) return 0
      if (count <= thresholds[0]) return 1
      if (thresholds.length >= 2 && count <= thresholds[1]) return 2
      if (thresholds.length >= 3 && count <= thresholds[2]) return 3
      return 4
    },

    /** 在当前 53 周窗口内算最长连续（level > 0 即算"活跃"） */
    calcLongestStreakInWindow(weeks: WeekView[]): number {
      let longest = 0
      let current = 0
      for (const w of weeks) {
        for (const d of w.days) {
          if (d.count > 0) {
            current++
            if (current > longest) longest = current
          } else {
            current = 0
          }
        }
      }
      return longest
    },

    /** 格式化 Date → 'YYYY-MM-DD' */
    formatDate(d: Date): string {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return y + '-' + m + '-' + day
    },

    /** 给定日期字符串 + 偏移天数，返回新日期字符串 */
    shiftDays(dateStr: string, delta: number): string {
      const [y, m, d] = dateStr.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      dt.setDate(dt.getDate() + delta)
      return this.formatDate(dt)
    },

    /** 点击单元格：触发 tap 事件给父页面 */
    onTapCell(e: WechatMiniprogram.TouchEvent) {
      const dataset = e.currentTarget.dataset
      this.triggerEvent('celltap', {
        date: dataset.date as string,
        count: dataset.count as number,
      })
    },

    /** 长按单元格：触发 longpress 事件给父页面 */
    onLongPressCell(e: WechatMiniprogram.TouchEvent) {
      const dataset = e.currentTarget.dataset
      this.triggerEvent('celllongpress', {
        date: dataset.date as string,
        count: dataset.count as number,
      })
    },
  },
})
