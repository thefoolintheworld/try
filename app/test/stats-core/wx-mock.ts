/** stats-core 测试用 wx mock（storage 模块加载时需要，但纯函数测试不实际用 wx）。 */
const store: { [key: string]: any } = {}
export function _reset() { for (const k of Object.keys(store)) delete store[k] }
export const wx = {
  getStorageSync(key: string): any { const v = store[key]; return v === undefined ? '' : JSON.parse(JSON.stringify(v)) },
  setStorageSync(key: string, value: any): void { store[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key: string): void { delete store[key] },
  showToast() {}, showModal() {}, getSystemInfoSync() { return { pixelRatio: 2 } },
  _reset, _store: store,
}
