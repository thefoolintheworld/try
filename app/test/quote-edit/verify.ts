/**
 * 金句正文编辑验证脚本（editQuoteText / editQuoteTextByIndex）
 *
 * 为什么需要这个脚本：
 *   - 历史发现的 bug：editQuoteText 用 indexOf 定位，重复金句只改第一条；
 *   - 新增 editQuoteTextByIndex 按 index 定位，且正确处理「重复金句共享 quoteNotes key」；
 *   - 这套边界纯逻辑层（无 wx 渲染），用 wx mock 就能在 Node 里全覆盖。
 *
 * 覆盖场景：
 *   1. 基本改正文 + quoteNotes key 迁移（单条金句）
 *   2. 重复金句改第一条 → 第二条不变，quoteNotes key 不迁移（仍指向旧文本给第二条用）
 *   3. 重复金句改第二条 → 第一条不变，quoteNotes key 不迁移
 *   4. 重复金句改到「无其它同文本」时 → quoteNotes key 迁移跟着走
 *   5. 空文本 / 越界 / 幂等 no-op / 找不到 item 的边界
 *   6. 旧入口 editQuoteText 仍可用（向后兼容）
 */
import {
  addItem,
  updateItem,
  loadById,
  editQuoteText,
  editQuoteTextByIndex,
  _resetMigrationCache,
} from '../../miniprogram/utils/storage'

let pass = 0
let fail = 0

function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

function resetStore() {
  // @ts-ignore mock
  wx._reset()
  _resetMigrationCache()
}

/** 造一条带金句 + quoteNotes 的成就。 */
function mkItemWithQuotes(quotes: string[], quoteNotes?: { [k: string]: string }) {
  const it = addItem({
    type: 'book',
    category: 'reading',
    title: '测书',
    author: '作者',
    genre: '小说',
    rating: 4,
    finishedDate: '2026-08-01',
    note: '',
    quotes,
    quoteNotes,
  })
  if (!it) throw new Error('addItem 返回 null')
  return it.id
}

function runAll(): boolean {
  console.log('=== 场景 1：基本改正文 + quoteNotes key 迁移（单条）===')
  resetStore()
  {
    const id = mkItemWithQuotes(['旧文本'], { '旧文本': '第 12 页' })
    const ok = editQuoteTextByIndex(id, 0, '新文本')
    assert(ok === true, 'editQuoteTextByIndex 返回 true')
    const it = loadById(id)!
    assert(it.quotes![0] === '新文本', 'quotes[0] 改成新文本')
    assert(!!(it.quoteNotes && it.quoteNotes['新文本'] === '第 12 页'), 'quoteNotes key 迁到新文本')
    assert(!it.quoteNotes || it.quoteNotes['旧文本'] === undefined, '旧 key 已删除')
  }

  console.log('=== 场景 2：重复金句改第一条 → quoteNotes key 不迁移（留给第二条）===')
  resetStore()
  {
    const id = mkItemWithQuotes(['共享文本', '共享文本'], { '共享文本': '第 5 页' })
    const ok = editQuoteTextByIndex(id, 0, '改第一条')
    assert(ok === true, '改第一条返回 true')
    const it = loadById(id)!
    assert(it.quotes![0] === '改第一条', 'quotes[0] 已改')
    assert(it.quotes![1] === '共享文本', 'quotes[1] 保持不变（关键修复点）')
    assert(!!(it.quoteNotes && it.quoteNotes['共享文本'] === '第 5 页'), 'quoteNotes 旧 key 保留（给第二条用）')
    assert(!it.quoteNotes || it.quoteNotes['改第一条'] === undefined, '新文本没有继承注释（共享语义）')
  }

  console.log('=== 场景 3：重复金句改第二条 → quoteNotes key 同样不迁移 ===')
  resetStore()
  {
    const id = mkItemWithQuotes(['共享文本', '共享文本'], { '共享文本': '第 5 页' })
    const ok = editQuoteTextByIndex(id, 1, '改第二条')
    assert(ok === true, '改第二条返回 true')
    const it = loadById(id)!
    assert(it.quotes![1] === '改第二条', 'quotes[1] 已改')
    assert(it.quotes![0] === '共享文本', 'quotes[0] 保持不变')
    assert(!!(it.quoteNotes && it.quoteNotes['共享文本'] === '第 5 页'), 'quoteNotes 旧 key 保留（给第一条用）')
  }

  console.log('=== 场景 4：改到「无其它同文本」时 quoteNotes key 迁移跟着走 ===')
  resetStore()
  {
    // quotes = [A, B, A]，改 index=2 那条 A 成 C；还有 index=0 仍是 A，不迁移
    const id = mkItemWithQuotes(['A', 'B', 'A'], { 'A': '注A', 'B': '注B' })
    const ok1 = editQuoteTextByIndex(id, 2, 'C')
    assert(ok1 === true, '改 index=2 返回 true')
    let it = loadById(id)!
    assert(it.quotes![2] === 'C', 'quotes[2] 改成 C')
    assert(!!(it.quoteNotes && it.quoteNotes['A'] === '注A'), 'A 的注释保留（index=0 仍是 A）')
    // 现在再改 index=0 那条 A 成 D；没有其它 A 了，注释应迁移
    const ok2 = editQuoteTextByIndex(id, 0, 'D')
    assert(ok2 === true, '改 index=0 返回 true')
    it = loadById(id)!
    assert(it.quotes![0] === 'D', 'quotes[0] 改成 D')
    assert(!!(it.quoteNotes && it.quoteNotes['D'] === '注A'), 'A 的注释迁到 D（无其它同文本）')
    assert(!it.quoteNotes || it.quoteNotes['A'] === undefined, 'A 的旧 key 已删')
  }

  console.log('=== 场景 5：边界 —— 空文本 / 越界 / 幂等 / 找不到 item ===')
  resetStore()
  {
    const id = mkItemWithQuotes(['原文'])
    assert(editQuoteTextByIndex(id, 0, '   ') === false, '空文本（trim 后）返回 false')
    assert(editQuoteTextByIndex(id, 0, '原文') === true, '与原文一致 → 幂等 true')
    const it0 = loadById(id)!
    assert(it0.quotes![0] === '原文', '幂等不改变 quotes')
    assert(editQuoteTextByIndex(id, -1, '新') === false, '负 index 返回 false')
    assert(editQuoteTextByIndex(id, 99, '新') === false, '越界 index 返回 false')
    assert(editQuoteTextByIndex(id, 1.5, '新') === false, '非整数 index 返回 false')
    assert(editQuoteTextByIndex('不存在的id', 0, '新') === false, '找不到 item 返回 false')
  }

  console.log('=== 场景 6：旧入口 editQuoteText 仍可用（向后兼容）===')
  resetStore()
  {
    const id = mkItemWithQuotes(['旧入口文本'], { '旧入口文本': '注' })
    const ok = editQuoteText(id, '旧入口文本', '新入口文本')
    assert(ok === true, 'editQuoteText 返回 true')
    const it = loadById(id)!
    assert(it.quotes![0] === '新入口文本', '旧入口也改正文')
    assert(!!(it.quoteNotes && it.quoteNotes['新入口文本'] === '注'), '旧入口也迁移 key')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
