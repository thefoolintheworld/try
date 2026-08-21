// utils/error-boundary.ts
// 页面级错误边界：包住 refresh() 的重活，捕获异常后设 loadError 状态，
// 让 wxml 显示「加载失败 + 重试」而非静默卡在骨架屏或白屏。
//
// 用法（页面 ts）：
//   import { safeRefresh } from '../../utils/error-boundary'
//
//   refresh() {
//     safeRefresh(this, () => {
//       // 原来的重活（聚合计算、storage 读取等）
//       this.setData({ ... })
//     })
//   },
//
//   onRetry() {
//     this.setData({ loadError: false })
//     this.refresh()
//   },
//
// wxml 约定：loading 期间显示骨架；loadError 期间显示 empty-state（btnText="重试" bind:btntap="onRetry"）。
// 页面需要在 data 里声明 loadError: false。

/** 包住页面 refresh 逻辑；抛错时设 loadError 并打印日志（便于真机调试时在 console 看到）*/
export function safeRefresh(
  page: { setData?: (d: { [k: string]: unknown }) => void } | null | undefined,
  fn: () => void
): void {
  try {
    fn()
  } catch (e) {
    console.error('[error-boundary] refresh 抛错', e)
    // 用 setData 而非直接改 data，确保 wxml 立即反映
    if (page && typeof page.setData === 'function') {
      page.setData({
        loadError: true,
        loading: false,
        loadingMore: false,
      })
    }
  }
}
