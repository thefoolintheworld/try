/**
 * quote-edit 测试用的 wx.*StorageSync 纯 Node 内存 mock。
 * 与 three-state/checkin 同款，保持独立避免跨场景污染。
 */

const store: { [key: string]: any } = {}

export function _rawSet(key: string, value: any) {
  store[key] = JSON.parse(JSON.stringify(value))
}

export function _reset() {
  for (const k of Object.keys(store)) delete store[k]
}

export const wx = {
  getStorageSync(key: string): any {
    const v = store[key]
    return v === undefined ? '' : JSON.parse(JSON.stringify(v))
  },
  setStorageSync(key: string, value: any): void {
    store[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key: string): void {
    delete store[key]
  },
  showToast() {},
  showModal() {},
  getSystemInfoSync() { return { pixelRatio: 2 } },
  _rawSet,
  _reset,
  _store: store,
}
