// components/empty-state/empty-state.ts
// 通用空态组件：统一各页面的「无数据」展示样式（图标 + 标题 + 副标题 + 可选按钮）。
// 替代 21 个页面里各自重写的 .empty-state/.empty 样式，改一处全跟随。
//
// 用法（页面 wxml）：
//   <empty-state icon="🌱" title="养成树还在沉睡" desc="{{emptyHint}}" />
//   <empty-state icon="🏆" title="记录你的第一个成就" desc="..." btnText="＋ 记录" bind:btntap="onTapAdd" />
//
// 事件：点按钮时触发 btntap（页面用 bind:btntap 接收）。不传 btnText 则不显示按钮。

Component({
  properties: {
    /** 大图标 emoji（如 🌱 💭 🏅）*/
    icon: { type: String, value: '' },
    /** 主标题 */
    title: { type: String, value: '' },
    /** 副标题/描述（可多行；传 \n 换行）*/
    desc: { type: String, value: '' },
    /** 按钮文案（不传则不显示按钮）*/
    btnText: { type: String, value: '' },
  },
  methods: {
    onTapBtn() {
      this.triggerEvent('btntap')
    },
  },
})
