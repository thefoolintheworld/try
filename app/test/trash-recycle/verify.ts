/**
 * trash-recycle 验证脚本：软删除 + 30 天清理 + 恢复
 *
 * 覆盖：
 *   - moveToTrash 幂等 + trashCount
 *   - loadTrash 排序 + loadTrashByType 筛选
 *   - purgeFromTrash / clearTrash
 *   - autoPurgeExpired：到期清 / 未到期保留 / 损坏记录（autoPurgeAt 缺失）边界
 *   - restoreFromTrash：正常恢复 / 原表已存在拒绝 / 快照损坏拒绝
 *   - 🚨 NaN 桶 bug：finishedDate 异常时恢复不应进入 "NaN" 年份桶
 */
import {
  moveToTrash,
  loadTrash,
  loadTrashByType,
  purgeFromTrash,
  clearTrash,
  autoPurgeExpired,
  trashCount,
  restoreFromTrash,
  TrashType,
} from '../../miniprogram/utils/trash'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

// @ts-ignore mock
const _wx: any = (globalThis as any).wx
function resetStore() { _wx._reset() }

const DAY = 24 * 60 * 60 * 1000

/** 直接往 trash 存原始数据（绕过 moveToTrash，造边界用）。 */
function rawSetTrash(entries: any[]) {
  _wx.setStorageSync('trash', entries)
}

function runAll(): boolean {
  console.log('=== moveToTrash 幂等 + 计数 ===')
  resetStore()
  {
    const snap = { id: 'i1', title: '书', finishedDate: '2026-08-01', coverColor: '#000', createdAt: 1 }
    assert(moveToTrash('item', 'i1', snap) === true, 'moveToTrash 返回 true')
    assert(trashCount() === 1, 'trashCount=1')
    // 同 id+type 再入一次应覆盖（不重复累加）
    moveToTrash('item', 'i1', snap)
    assert(trashCount() === 1, '同 id+type 重复入站幂等覆盖（计数仍 1）')
    assert(moveToTrash('wish', 'w1', { id: 'w1', title: '愿', coverColor: '#000', createdAt: 1 }) === true, '不同类型可并存')
    assert(trashCount() === 2, '两种类型 trashCount=2')
    assert(moveToTrash('item', '', snap) === false, '空 id 拒绝')
  }

  console.log('=== loadTrash 排序 + loadTrashByType ===')
  resetStore()
  {
    // 用显式 deletedAt 区分排序（不依赖真实时间差）
    const now = Date.now()
    rawSetTrash([
      { id: 'a', type: 'item', snapshot: { id: 'a' }, deletedAt: now - 1000, autoPurgeAt: now + 30 * DAY },
      { id: 'b', type: 'item', snapshot: { id: 'b' }, deletedAt: now, autoPurgeAt: now + 30 * DAY },
    ])
    const all = loadTrash()
    assert(all.length === 2, 'loadTrash 全部 2 条')
    // 按删除时间倒序（后删的在前）
    assert(all[0].id === 'b', 'loadTrash 按删除时间倒序')
    const items = loadTrashByType('item')
    assert(items.length === 2, 'loadTrashByType item=2')
    const wishes = loadTrashByType('wish')
    assert(wishes.length === 0, 'loadTrashByType wish=0')
  }

  console.log('=== purgeFromTrash / clearTrash ===')
  resetStore()
  {
    moveToTrash('item', 'a', { id: 'a' })
    moveToTrash('item', 'b', { id: 'b' })
    assert(purgeFromTrash('item', 'a') === true, 'purgeFromTrash a 成功')
    assert(trashCount() === 1, 'purge 后剩 1')
    assert(purgeFromTrash('item', '不存在') === false, 'purge 不存在的 id 返回 false')
    assert(clearTrash() === true, 'clearTrash 成功')
    assert(trashCount() === 0, '清空后 0')
  }

  console.log('=== autoPurgeExpired：到期清 / 未到期保留 ===')
  resetStore()
  {
    const now = Date.now()
    // 一条已过期（autoPurgeAt 在过去）
    rawSetTrash([
      { id: 'expired', type: 'item', snapshot: { id: 'expired' }, deletedAt: now - 40 * DAY, autoPurgeAt: now - 10 * DAY },
      { id: 'fresh', type: 'item', snapshot: { id: 'fresh' }, deletedAt: now - 5 * DAY, autoPurgeAt: now + 25 * DAY },
    ])
    const purged = autoPurgeExpired()
    assert(purged === 1, '清掉 1 条过期的')
    assert(trashCount() === 1, '剩 1 条未过期')
    assert(loadTrash()[0].id === 'fresh', '保留的是 fresh')
  }

  console.log('=== autoPurgeExpired：损坏记录（autoPurgeAt 缺失）保守保留 ===')
  resetStore()
  {
    const now = Date.now()
    rawSetTrash([
      { id: 'corrupt', type: 'item', snapshot: { id: 'corrupt' }, deletedAt: now - 1 * DAY },  // 缺 autoPurgeAt
      { id: 'fresh', type: 'item', snapshot: { id: 'fresh' }, deletedAt: now, autoPurgeAt: now + 30 * DAY },
    ])
    const purged = autoPurgeExpired()
    assert(purged === 0, '损坏记录（autoPurgeAt 缺失）保守保留 → 不清任何')
    assert(trashCount() === 2, '损坏 + 未到期 全部保留')
  }

  console.log('=== autoPurgeExpired：损坏记录 + 已到期合法记录 → 只清到期的 ===')
  resetStore()
  {
    const now = Date.now()
    rawSetTrash([
      { id: 'corrupt', type: 'item', snapshot: { id: 'corrupt' }, deletedAt: now - 40 * DAY },  // 损坏，保留
      { id: 'expired', type: 'item', snapshot: { id: 'expired' }, deletedAt: now - 40 * DAY, autoPurgeAt: now - 10 * DAY },  // 到期，清
    ])
    const purged = autoPurgeExpired()
    assert(purged === 1, '只清 1 条到期合法记录')
    const remain = loadTrash()
    assert(remain.length === 1 && remain[0].id === 'corrupt', '保留的是损坏记录（不清）')
  }

  console.log('=== restoreFromTrash：正常恢复 ===')
  resetStore()
  {
    moveToTrash('wish', 'w1', { id: 'w1', title: '心愿', coverColor: '#000', createdAt: 1 })
    const r = restoreFromTrash('wish', 'w1')
    assert(r.ok === true, '恢复 wish 成功')
    const wishes = _wx.getStorageSync('wishlist')
    assert(Array.isArray(wishes) && wishes.length === 1 && wishes[0].id === 'w1', 'wish 已写回原表')
    assert(trashCount() === 0, '恢复后回收站清空')
  }

  console.log('=== restoreFromTrash：原表已存在同 id 拒绝 ===')
  resetStore()
  {
    _wx.setStorageSync('wishlist', [{ id: 'w1', title: '已存在的愿', coverColor: '#000', createdAt: 1 }])
    moveToTrash('wish', 'w1', { id: 'w1', title: '回收站里的愿', coverColor: '#000', createdAt: 1 })
    const r = restoreFromTrash('wish', 'w1')
    assert(r.ok === false, '原表已存在 → 拒绝恢复')
    assert(trashCount() === 1, '拒绝时回收站记录保留')
    const wishes = _wx.getStorageSync('wishlist')
    assert(wishes[0].title === '已存在的愿', '原表未被覆盖')
  }

  console.log('=== restoreFromTrash：快照损坏拒绝 ===')
  resetStore()
  {
    // wish 快照缺 coverColor → isWishSnapshot 失败
    moveToTrash('wish', 'bad', { id: 'bad', title: '缺字段' } as any)
    const r = restoreFromTrash('wish', 'bad')
    assert(r.ok === false, '快照损坏 → 拒绝')
  }

  console.log('=== 🚨 restoreFromTrash item：finishedDate 异常不应进 NaN 桶 ===')
  resetStore()
  {
    // finishedDate 是空字符串 → slice(0,4)='' → Number('')=NaN → 写进 "NaN" 桶
    moveToTrash('item', 'bad-item', { id: 'bad-item', title: '坏日期', finishedDate: '', coverColor: '#000', createdAt: 1 })
    const r = restoreFromTrash('item', 'bad-item')
    const data = _wx.getStorageSync('book_film_data')
    const hasNaNBucket = data && typeof data === 'object' && 'NaN' in data
    if (r.ok === false && !hasNaNBucket) {
      assert(true, 'finishedDate 异常 → 拒绝恢复（修复后行为）')
    } else {
      // 当前 bug：恢复成功且数据进了 NaN 桶
      console.error('  ❌ 当前 bug：finishedDate 异常被恢复进 "NaN" 桶（数据静默丢失）')
      console.error('     r.ok=' + r.ok + ' msg=' + r.msg)
      console.error('     book_film_data keys=' + Object.keys(data || {}).join(','))
      fail++
    }
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
