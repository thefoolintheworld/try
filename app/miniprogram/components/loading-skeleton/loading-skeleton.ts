// components/loading-skeleton/loading-skeleton.ts
// 通用加载骨架屏：列表/卡片/统计三种预设形状，灰条占位 + shimmer 扫光动画。
// 用法（页面 wxml）：
//   <loading-skeleton wx:if="{{loading}}" type="list" />
//   <loading-skeleton wx:if="{{loading}}" type="card" count="3" />
//   <loading-skeleton wx:if="{{loading}}" type="stats" />
// 配色走 --color-card-soft（与各页面卡片底色同源），主题切换自动跟随。
// 注意：本组件只负责「显示骨架」，最小展示时间和切换逻辑由各页面自己控制（见接入约定）。

Component({
  properties: {
    /** 骨架形状预设：list（列表项）/ card（卡片网格）/ stats（统计概览）*/
    type: { type: String, value: 'list' },
    /** list/card 模式下的占位条数（默认 5 / 3）*/
    count: { type: Number, value: 0 },
  },
  data: {
    items: [] as number[],
  },
  observers: {
    'type, count': function (type: string, count: number) {
      const n = count > 0 ? count : (type === 'card' ? 3 : 5)
      this.setData({ items: Array.from({ length: n }, (_, i) => i) })
    },
  },
  lifetimes: {
    attached() {
      const n = this.data.count > 0 ? this.data.count : (this.data.type === 'card' ? 3 : 5)
      this.setData({ items: Array.from({ length: n }, (_, i) => i) })
    },
  },
})
