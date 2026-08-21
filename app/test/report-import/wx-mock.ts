/**
 * wx.*StorageSync 的纯 Node 内存 mock（report-import 测试专用副本）。
 * 与 three-state/wx-mock.ts 同构，刻意独立一份避免测试目录间相互依赖。
 *
 * storage.ts 的模块级代码（migrateIfNeeded）会在 require 时立即读 wx，
 * 所以必须在 require(storage) 之前把 wx 挂到全局。
 */
const store: { [key: string]: any } = {}

/** 直接写一个键（绕过加工），用于造老数据/边界数据。 */
export function _rawSet(key: string, value: any) {
  store[key] = JSON.parse(JSON.stringify(value))
}

/** 清空整个内存存储。 */
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
