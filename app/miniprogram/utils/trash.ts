// utils/trash.ts
// 回收站：软删除 + 30 天自动清理。
//
// 设计要点：
//  - 独立 TRASH_KEY 扁平数组，存储被软删除条目的完整快照 + 元数据
//  - 每条记录含 { id, type, snapshot, deletedAt, autoPurgeAt }；snapshot 是原对象深拷贝
//  - storage.ts 的 deleteXxx 内部调 moveToTrash() 先存快照，再从原表移除（对调用方零侵入）
//  - 一键还原：把 snapshot 写回对应 storage key；同时从 trash 移除
//  - 30 天后自动清理（autoPurgeAt 到期）；应用启动时调一次 autoPurgeExpired()
//  - 与现有 backup.ts 完全兼容：trash 数据也计入备份/恢复（备份时一并导出）
//
// 注意：trash 不参与任何统计、不算入任何"总数"；它只是"删除缓冲"。
// 注意：本模块从 storage 仅做"纯类型导入"（避免运行时循环依赖；
//       storage.ts 反向导入 moveToTrash，运行时单向）。

import type { Item, Wish, Inspiration, Checkin, ReportInstance, ReportTemplate } from './storage'

const TRASH_KEY = 'trash'

/** 安全写入：捕获 wx.setStorageSync 异常，避免抛错冒泡。返回是否写入成功。 */
function safeSetSync(key: string, value: unknown): boolean {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    console.warn('[trash] 写入失败 key=' + key + '：', e)
    return false
  }
}

/** 可被回收的实体类型 */
export type TrashType = 'item' | 'wish' | 'inspiration' | 'checkin' | 'report' | 'template'

/** 单条回收记录 */
export interface TrashEntry {
  id: string                   // 原对象 id（恢复时用它写回原表）
  type: TrashType
  snapshot: unknown            // 完整数据快照（原对象深拷贝；恢复时按类型写回对应表）
  deletedAt: number            // 删除时间戳
  autoPurgeAt: number          // 自动彻底清理时间戳（deletedAt + 30 天）
}

/** 30 天的毫秒数 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/* ============ 核心 API ============ */

/** 把一个对象软删除到回收站。
 *  snapshot 由调用方传入（在删除前已经持有该对象引用，无需 trash 模块知道怎么读）。
 *  幂等：相同 id+type 重复入栈会覆盖旧的（理论上不会发生，但防御一下）。 */
export function moveToTrash(type: TrashType, id: string, snapshot: unknown): boolean {
  if (!id) return false
  const list = loadTrashRaw()
  const now = Date.now()
  // 同 id+type 已存在则覆盖（防重复）
  const filtered = list.filter(e => !(e.id === id && e.type === type))
  filtered.push({
    id,
    type,
    snapshot,
    deletedAt: now,
    autoPurgeAt: now + RETENTION_MS,
  })
  return safeSetSync(TRASH_KEY, filtered)
}

/** 取回收站全部条目（按删除时间倒序；调用方据此渲染） */
export function loadTrash(): TrashEntry[] {
  const list = loadTrashRaw()
  return list.slice().sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 按类型筛选回收站条目 */
export function loadTrashByType(type: TrashType): TrashEntry[] {
  return loadTrash().filter(e => e.type === type)
}

/** 从回收站彻底删除某条（不可恢复）。返回是否删到了。 */
export function purgeFromTrash(type: TrashType, id: string): boolean {
  const list = loadTrashRaw()
  const next = list.filter(e => !(e.id === id && e.type === type))
  if (next.length < list.length) {
    return safeSetSync(TRASH_KEY, next)
  }
  return false
}

/** 清空整个回收站（用户在设置里点"清空回收站"时调） */
export function clearTrash(): boolean {
  return safeSetSync(TRASH_KEY, [])
}

/** 应用启动时调：自动清理超过 30 天的条目（彻底删除）。 */
export function autoPurgeExpired(): number {
  const list = loadTrashRaw()
  const now = Date.now()
  // 只清「autoPurgeAt 是数字且已到期」的记录；其余全部保留：
  //   - 未到期（autoPurgeAt > now）：正常保留
  //   - autoPurgeAt 缺失/非数字（数据损坏）：保守保留，不静默清掉，交由人工或其它路径处理
  // 用「该清的」反向表达 kept，避免把损坏记录误算进 purgedCount。
  const kept = list.filter(e => !(typeof e.autoPurgeAt === 'number' && e.autoPurgeAt <= now))
  const purgedCount = list.length - kept.length
  if (purgedCount > 0) {
    safeSetSync(TRASH_KEY, kept)
  }
  return purgedCount
}

/** 取回收站当前条数（设置页入口用） */
export function trashCount(): number {
  return loadTrashRaw().length
}

/** 取回收站里某条快照（恢复时用）。无则 null。 */
export function getTrashEntry(type: TrashType, id: string): TrashEntry | null {
  const list = loadTrashRaw()
  return list.find(e => e.id === id && e.type === type) || null
}

/** 从回收站移除某条（恢复成功时调，避免数据双份）。
 *  与 purgeFromTrash 区别：这是"恢复后从回收站摘掉"，purge 是"主动彻底删"。
 *  实现上一样，语义不同。 */
export function removeFromTrash(type: TrashType, id: string): void {
  purgeFromTrash(type, id)
}

/* ============ 内部工具 ============ */

function loadTrashRaw(): TrashEntry[] {
  try {
    const raw = wx.getStorageSync(TRASH_KEY)
    if (!raw || !Array.isArray(raw)) return []
    return raw as TrashEntry[]
  } catch (e) {
    return []
  }
}

/* ============ 类型守卫：给恢复时按类型校验快照用 ============ */

export function isItemSnapshot(s: unknown): s is Item {
  return !!s && typeof s === 'object'
    && typeof (s as Item).title === 'string'
    && typeof (s as Item).finishedDate === 'string'
}

export function isWishSnapshot(s: unknown): s is Wish {
  return !!s && typeof s === 'object'
    && typeof (s as Wish).title === 'string'
    && typeof (s as Wish).coverColor === 'string'
}

export function isInspirationSnapshot(s: unknown): s is Inspiration {
  return !!s && typeof s === 'object'
    && typeof (s as Inspiration).content === 'string'
    && typeof (s as Inspiration).category === 'string'
}

export function isCheckinSnapshot(s: unknown): s is Checkin {
  return !!s && typeof s === 'object'
    && typeof (s as Checkin).date === 'string'
    && typeof (s as Checkin).category === 'string'
}

export function isReportSnapshot(s: unknown): s is ReportInstance {
  return !!s && typeof s === 'object'
    && typeof (s as ReportInstance).title === 'string'
    && Array.isArray((s as ReportInstance).cards)
}

export function isTemplateSnapshot(s: unknown): s is ReportTemplate {
  return !!s && typeof s === 'object'
    && typeof (s as ReportTemplate).name === 'string'
    && Array.isArray((s as ReportTemplate).cards)
}

/** 给 UI 用：把 TrashType 转中文 + emoji */
export function trashTypeMeta(type: TrashType): { label: string; icon: string } {
  switch (type) {
    case 'item':        return { label: '成就', icon: '🏆' }
    case 'wish':        return { label: '愿望', icon: '⭐' }
    case 'inspiration': return { label: '灵感', icon: '🌱' }
    case 'checkin':     return { label: '打卡', icon: '🔥' }
    case 'report':      return { label: '报告', icon: '✦' }
    case 'template':    return { label: '模板', icon: '✎' }
  }
}

/* ============ 恢复逻辑 ============
   直接读写对应 storage key（绕过 storage.ts 的 addItem 等封装，因为恢复的是已经合法
   存在过的快照，不需要再走 finishedDate 校验、coverColor 取色等流程）。
   storage key 名与 storage.ts 严格保持一致（任何 rename 都要同步这里）。 */

const STORAGE_KEY = 'book_film_data'
const REPORT_KEY = 'report_instances'
const TEMPLATE_KEY = 'report_templates'
const WISH_KEY = 'wishlist'
const INSPIRATION_KEY = 'inspirations'
const CHECKIN_KEY = 'checkins'

/** 恢复结果 */
export interface RestoreResult {
  ok: boolean
  msg: string
}

/** 把回收站某条记录恢复到原表。
 *  操作：取快照 → 按类型写回对应 storage key → 从 trash 移除。
 *  如果原表已存在同 id（理论上不会发生），拒绝覆盖，返回 ok:false。 */
export function restoreFromTrash(type: TrashType, id: string): RestoreResult {
  const entry = getTrashEntry(type, id)
  if (!entry) {
    return { ok: false, msg: '回收站里没有这条记录' }
  }
  // 类型校验：快照必须是该类型应有的结构（防止数据损坏）
  const valid = validateSnapshot(type, entry.snapshot)
  if (!valid) {
    return { ok: false, msg: '记录数据已损坏' }
  }
  // 检查目标表是否已有同 id（理论上不会，因为删除时已从原表移除）
  if (existsInOriginal(type, id)) {
    return { ok: false, msg: '原表已存在相同记录（未恢复）' }
  }
  // 按类型写回（writeBack 返回 false 表示存储写入失败——此时不能从回收站摘掉，否则数据彻底丢失）
  const wrote = writeBack(type, entry.snapshot)
  if (!wrote) {
    return { ok: false, msg: '恢复失败：存储空间不足' }
  }
  removeFromTrash(type, id)
  return { ok: true, msg: '已恢复' }
}

/** 按类型校验快照结构 */
function validateSnapshot(type: TrashType, snapshot: unknown): boolean {
  switch (type) {
    case 'item':        return isItemSnapshot(snapshot)
    case 'wish':        return isWishSnapshot(snapshot)
    case 'inspiration': return isInspirationSnapshot(snapshot)
    case 'checkin':     return isCheckinSnapshot(snapshot)
    case 'report':      return isReportSnapshot(snapshot)
    case 'template':    return isTemplateSnapshot(snapshot)
  }
}

/** 检查原表是否已有同 id（防双重恢复）*/
function existsInOriginal(type: TrashType, id: string): boolean {
  switch (type) {
    case 'item': {
      const all = wx.getStorageSync(STORAGE_KEY)
      if (!all || typeof all !== 'object' || Array.isArray(all)) return false
      const allData = all as { [year: string]: Array<{ id: string }> }
      return Object.keys(allData).some(y => (allData[y] || []).some(it => it.id === id))
    }
    case 'wish': {
      const list = safeReadArray(WISH_KEY) as Array<{ id: string }>
      return list.some(w => w.id === id)
    }
    case 'inspiration': {
      const list = safeReadArray(INSPIRATION_KEY) as Array<{ id: string }>
      return list.some(n => n.id === id)
    }
    case 'checkin': {
      const list = safeReadArray(CHECKIN_KEY) as Array<{ id: string }>
      return list.some(c => c.id === id)
    }
    case 'report': {
      const list = safeReadArray(REPORT_KEY) as Array<{ id: string }>
      return list.some(r => r.id === id)
    }
    case 'template': {
      const list = safeReadArray(TEMPLATE_KEY) as Array<{ id: string }>
      return list.some(t => t.id === id)
    }
  }
}

/** 按类型把快照写回原表。返回是否全部写入成功。 */
function writeBack(type: TrashType, snapshot: unknown): boolean {
  switch (type) {
    case 'item': {
      const it = snapshot as Item
      // finishedDate 必须是合法 YYYY-MM-DD：解析出年份后校验范围，
      // 否则数据会进入 "NaN" 桶被永久孤立（storage 层不会按 "NaN" 年份读出，等于静默丢数据）。
      const fd = it.finishedDate
      if (typeof fd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fd)) return false
      const year = Number(fd.slice(0, 4))
      if (!Number.isFinite(year) || year < 1900 || year > 3000) return false
      const all = safeReadAllData()
      if (!all[year]) all[year] = []
      all[year].push(it)
      return safeSetSync(STORAGE_KEY, all)
    }
    case 'wish': {
      const list = safeReadArray(WISH_KEY)
      list.push(snapshot)
      return safeSetSync(WISH_KEY, list)
    }
    case 'inspiration': {
      const list = safeReadArray(INSPIRATION_KEY)
      list.push(snapshot)
      return safeSetSync(INSPIRATION_KEY, list)
    }
    case 'checkin': {
      const list = safeReadArray(CHECKIN_KEY)
      list.push(snapshot)
      return safeSetSync(CHECKIN_KEY, list)
    }
    case 'report': {
      const list = safeReadArray(REPORT_KEY)
      list.push(snapshot)
      return safeSetSync(REPORT_KEY, list)
    }
    case 'template': {
      const list = safeReadArray(TEMPLATE_KEY)
      list.push(snapshot)
      return safeSetSync(TEMPLATE_KEY, list)
    }
  }
  return false
}

/** 安全读扁平数组 storage；格式不对返回空数组 */
function safeReadArray(key: string): unknown[] {
  const raw = wx.getStorageSync(key)
  if (!raw || !Array.isArray(raw)) return []
  return raw as unknown[]
}

/** 安全读 AllData（按年份桶的字典）；格式不对返回空对象 */
function safeReadAllData(): { [year: string]: Item[] } {
  const raw = wx.getStorageSync(STORAGE_KEY)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as { [year: string]: Item[] }
}
