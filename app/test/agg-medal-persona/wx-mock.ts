/** agg-medal-persona 测试用 wx mock。
 *  - preferences / systemMedals 写回需要完整 storage mock。
 *  - streak-protection 的 refreshFreebies 会真实读写 app_preferences，故需深拷贝往返。 */
const store: { [key: string]: any } = {}
export function _reset() { for (const k of Object.keys(store)) delete store[k] }
export const wx = {
  getStorageSync(key: string): any { const v = store[key]; return v === undefined ? '' : JSON.parse(JSON.stringify(v)) },
  setStorageSync(key: string, value: any): void { store[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key: string): void { delete store[key] },
  showToast() {}, showModal() {}, getSystemInfoSync() { return { pixelRatio: 2 } },
  _reset, _store: store,
}
