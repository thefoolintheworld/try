// utils/data-dirty.ts
// 数据脏标记：避免页面 onShow 时无脑全量重算。
// 写入/删除/迁移数据的操作调用 markDirty('achievements') 标记某实体脏了；
// 页面 onShow 用 isDirty('achievements') 检查（命中则重算并清标记），跳过无谓重算。
//
// 设计：
//   - 脏状态挂在 getApp().globalData.__dirty（不入 storage，纯内存）
//   - 提供 markDirty / isDirty / clearDirty 三个纯函数
//   - 单一字符串字段（'achievements' / 'reports' / 'wishes' / 'inspirations' / 'checkins' / 'templates' / 'preferences'）
//   - 页面 onShow 检查自己关心的字段，命中就 refresh + clearDirty；未命中跳过 refresh（纯内存读，开销可忽略）

export type DirtyField =
  | 'achievements' | 'reports' | 'wishes' | 'inspirations'
  | 'checkins' | 'templates' | 'preferences'

declare const getApp: {
  (opts?: { allowDefault?: boolean }): {
    globalData: { __dirty?: Record<string, true | undefined> }
  }
}

function getDirtyMap(): Record<string, true | undefined> | undefined {
  try {
    const app = getApp({ allowDefault: true })
    if (!app.globalData) app.globalData = {}
    if (!app.globalData.__dirty) app.globalData.__dirty = {}
    return app.globalData.__dirty
  } catch (e) {
    // getApp 在 app onLaunch 前调用会抛错（理论上不会发生在页面 onShow 里）
    return undefined
  }
}

/** 标记某实体数据已变（saveItem / deleteItem / saveReport 等写入操作调用）*/
export function markDirty(field: DirtyField): void {
  const map = getDirtyMap()
  if (map) map[field] = true
}

/** 检查某实体是否脏（命中返回 true 并自动清除标记）*/
export function isDirty(field: DirtyField): boolean {
  const map = getDirtyMap()
  if (!map || !map[field]) return false
  delete map[field]
  return true
}

/** 检查任一给定字段是否脏（命中不清除，让调用方决定后续）*/
export function anyDirty(fields: DirtyField[]): boolean {
  const map = getDirtyMap()
  if (!map) return false
  return fields.some(f => !!map[f])
}

/** 清除指定字段的脏标记 */
export function clearDirty(field: DirtyField): void {
  const map = getDirtyMap()
  if (map) delete map[field]
}
