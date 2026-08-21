/**
 * wx.*StorageSync 的纯 Node 内存 mock（poster-split 测试专用副本）。
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
  getSystemInfoSync(): any {
    return { theme: 'light', SDKVersion: '3.0.0' }
  },
}
