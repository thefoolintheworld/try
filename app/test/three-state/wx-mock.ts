/**
 * wx.*StorageSync 的纯 Node 内存 mock。
 * 只实现 storage.ts 真正用到的几个方法（get/set/remove），其余忽略。
 *
 * 全局对象 wx 在测试入口里注入；storage.ts 的模块级代码（migrateIfNeeded）
 * 会在 require 时立即执行，所以 mock 必须在 require(storage) 之前就位。
 */

const store: { [key: string]: any } = {}

/** 直接写一个键（绕过任何加工），用于造老数据/边界数据。 */
export function _rawSet(key: string, value: any) {
  store[key] = JSON.parse(JSON.stringify(value))
}

/** 直接合并某年份的原始数组到 book_film_data（造边界桶用）。 */
export function _rawMergeYear(year: number, items: any[]) {
  const key = 'book_film_data'
  const existing = store[key] || {}
  existing[year] = [...(existing[year] || []), ...JSON.parse(JSON.stringify(items))]
  store[key] = existing
}

/** 清空整个内存存储。 */
export function _reset() {
  for (const k of Object.keys(store)) delete store[k]
}

export const wx = {
  getStorageSync(key: string): any {
    const v = store[key]
    // 微信语义：未设置返回 ''（空字符串）；storage.ts 都做了 !raw 判断
    return v === undefined ? '' : JSON.parse(JSON.stringify(v))
  },
  setStorageSync(key: string, value: any): void {
    store[key] = JSON.parse(JSON.stringify(value))
  },
  removeStorageSync(key: string): void {
    delete store[key]
  },
  // storage.ts 里没用到其它 wx.*，但防御性补几个避免别处 require 时炸
  showToast() {},
  showModal() {},
  getSystemInfoSync() { return { pixelRatio: 2 } },
  _rawSet,
  _rawMergeYear,
  _reset,
  _store: store,  // 调试用
}
