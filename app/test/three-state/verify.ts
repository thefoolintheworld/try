/**
 * P1-5 三态状态机 数据层验证脚本（非 wx 环境）
 *
 * 为什么需要这个脚本：
 *   - 微信开发者工具是独立桌面应用，browser-use 测不了 GUI；
 *   - 但三态分流的命门在存储层（isDoneItem 过滤），与 wx 渲染无关；
 *   - 只要 mock 掉 wx.*StorageSync，就能在纯 Node 里跑全部分流边界。
 *
 * 这是「能替代部分 GUI 黑盒测试」的逻辑层实测：覆盖老数据兼容、
 * 四类 load 函数分流、年份桶过滤、updateItemStatus 流转、聚合器继承。
 *
 * 运行：见同目录 verify.run.js（CommonJS 包装，直接 node 跑）
 */
import {
  addItem,
  updateItemStatus,
  loadByYear,
  loadAllBooks,
  loadAllItems,
  loadItemsByYear,
  loadAllAchievements,
  loadAchievementsByYear,
  loadYears,
  ItemStatus,
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
  _resetMigrationCache()   // 让短路标记回到 false，否则跨场景迁移被跳过
}

/** 造一条 Item 输入（最小必填）。 */
function mkInput(over: Partial<Parameters<typeof addItem>[0]> = {}) {
  return {
    type: 'book' as const,
    title: over.title || '某书',
    author: '某作者',
    genre: '',
    category: 'reading' as const,
    rating: over.rating ?? 4,
    finishedDate: over.finishedDate || '2025-06-01',
    note: '',
    ...over,
  }
}

export function runAll() {
  console.log('\n=== 场景 1：老数据兼容（无 status 字段）===')
  resetStore()
  {
    // 直接写入一条「无 status」的原始数据，模拟老用户存储
    // @ts-ignore mock
    wx._rawSet('book_film_data', {
      2025: [{
        id: 'old1', type: 'book', title: '老书', author: '老作者',
        category: 'reading', rating: 4, finishedDate: '2025-03-10',
        note: '', coverColor: '#D97A4A', createdAt: Date.now(),
        // 故意不写 status
      }],
    })
    const ach = loadAllAchievements()
    const items = loadAllItems()
    assert(ach.length === 1, '老数据无 status → loadAllAchievements 视为 done 返回 1 条（得 ' + ach.length + '）')
    assert(items.length === 1, '老数据无 status → loadAllItems 返回 1 条')
    assert((ach[0] as any).status === undefined, '老数据 status 字段保持 undefined（不强行写入）')
  }

  console.log('\n=== 场景 2：四类 load 函数分流 ===')
  resetStore()
  {
    const a = addItem(mkInput({ title: '完成A', status: 'done' as ItemStatus, finishedDate: '2025-01-01' }))!
    addItem(mkInput({ title: '在读B', status: 'reading' as ItemStatus, finishedDate: '2025-02-01' }))!
    addItem(mkInput({ title: '搁置C', status: 'abandoned' as ItemStatus, finishedDate: '2025-03-01' }))!
    const d = addItem(mkInput({ title: '完成D', status: 'done' as ItemStatus, finishedDate: '2025-04-01' }))!
    void a; void d

    const allItems = loadAllItems()      // 公开全量
    const achAll = loadAllAchievements() // 公开只 done

    assert(allItems.length === 4, 'loadAllItems 全量 = 4（含在读/搁置）')
    assert(achAll.length === 2, 'loadAllAchievements 只 done = 2（在读/搁置被过滤）')
    assert(achAll.every(i => i.title === '完成A' || i.title === '完成D'), '成就里只剩完成 A/D')

    // 按年份
    const yItems = loadItemsByYear(2025)
    const yAch = loadAchievementsByYear(2025)
    assert(yItems.length === 4, 'loadItemsByYear(2025) 全量 = 4')
    assert(yAch.length === 2, 'loadAchievementsByYear(2025) 只 done = 2')
    assert(loadByYear(2025).length === 4, 'loadByYear(2025) 全量 = 4（与 loadItemsByYear 一致）')
  }

  console.log('\n=== 场景 3：年份桶过滤（某年全 reading → loadYears 隐藏该年）===')
  resetStore()
  {
    // 2025 有一条 done
    addItem(mkInput({ title: '完成2025', status: 'done' as ItemStatus, finishedDate: '2025-05-01' }))
    // 2026 全部 reading（不该污染年份列表）
    // @ts-ignore mock
    wx._rawMergeYear(2026, [{
      id: 'r1', type: 'book', title: '在读2026', author: 'x', category: 'reading',
      rating: 3, finishedDate: '2026-01-01', note: '', coverColor: '#D97A4A',
      createdAt: Date.now(), status: 'reading',
    }])

    const years = loadYears()
    assert(years.includes(2025), 'loadYears 含 2025（有 done）')
    assert(!years.includes(2026), 'loadYears 不含 2026（全 reading，桶被过滤）')

    // 但用户在 list 页应能看到 2026（用 loadItemYears / loadItemsByYear）
    const y2026Items = loadItemsByYear(2026)
    assert(y2026Items.length === 1, 'loadItemsByYear(2026) 仍能取到在读项（list 页用）')
  }

  console.log('\n=== 场景 4：updateItemStatus 流转（done→reading 改 finishedDate）===')
  resetStore()
  {
    const created = addItem(mkInput({ title: '流转测试', status: 'done' as ItemStatus, finishedDate: '2025-01-01' }))
    assert(created !== null, 'addItem 返回非 null')
    const id = created!.id

    // done → reading，提供新日期
    const ok = updateItemStatus(id, 'reading', '2025-09-20')
    assert(ok === true, 'updateItemStatus(done→reading) 返回 true')
    const after = loadAllBooks().find(i => i.id === id)!
    assert(after.status === 'reading', '流转后 status = reading')
    assert(after.finishedDate === '2025-09-20', '流转后 finishedDate 更新为 2025-09-20（得 ' + after.finishedDate + '）')

    // 现在它应该从成就里消失
    const achAfter = loadAllAchievements()
    assert(!achAfter.some(i => i.id === id), '流转成 reading 后，从成就里消失')
    const itemsAfter = loadAllItems()
    assert(itemsAfter.some(i => i.id === id), '但仍在全量列表里')

    // 非法 status
    const bad = updateItemStatus(id, 'wtf' as any)
    assert(bad === false, '非法 status 返回 false（拒绝写入）')
  }

  console.log('\n=== 场景 5：聚合器继承（模拟一个用 loadAchievements* 的统计）===')
  resetStore()
  {
    // 5 条 done，3 条 reading —— 模拟统计「读完书数」
    for (let i = 1; i <= 5; i++) {
      const r = addItem(mkInput({ title: '完成' + i, status: 'done' as ItemStatus, finishedDate: `2025-0${i}-15` }))
      assert(r !== null, `addItem 完成${i} 成功`)
    }
    for (let i = 1; i <= 3; i++) {
      const r = addItem(mkInput({ title: '在读' + i, status: 'reading' as ItemStatus, finishedDate: `2025-0${i}-20` }))
      assert(r !== null, `addItem 在读${i} 成功`)
    }
    // 一个典型聚合器（如 stats）只用 loadAchievements*
    const aggregated = loadAchievementsByYear(2025)
    assert(aggregated.length === 5, '聚合器读到 5 条 done（reading 不污染，得 ' + aggregated.length + '）')
    assert(aggregated.every(i => i.status === 'done'), '聚合器结果全部 status=done')
  }

  console.log('\n=== 场景 6：边界 —— 完全没有数据 ===')
  resetStore()
  {
    assert(loadAllAchievements().length === 0, '空存储 → loadAllAchievements 返回空')
    assert(loadAllItems().length === 0, '空存储 → loadAllItems 返回空')
    assert(loadYears().length === 0, '空存储 → loadYears 返回空')
  }

  console.log(`\n=== 总结：${pass} 通过，${fail} 失败 ===`)
  return fail === 0
}
