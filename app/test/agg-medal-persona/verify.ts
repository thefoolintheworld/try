/**
 * agg-medal-persona 验证脚本：medal-config + personality + streak-protection
 *
 * 覆盖：
 *   - isInUnlockWindow（普通窗口 / 跨年窗口 / 空窗口）
 *   - dateInWindow + countItemsInWindow（新增辅助函数）
 *   - buildMedalRows 限量徽章计数修复（🚨 窗口内录入而非全年累计）
 *   - buildCheckinCategoryMedals（id 稳定、other 排除）
 *   - classifyPersonality 8 类全部覆盖 + MIN_ITEMS 兜底
 *   - calcDimensions 数学（depth/breadth/speed/rewatch）
 *   - calcHabitScore 衰减式 + refreshFreebies 幂等 + 上限
 */
import {
  isInUnlockWindow,
  dateInWindow,
  countItemsInWindow,
  buildMedalRows,
  buildCheckinCategoryMedals,
  SYSTEM_MEDALS,
  getMedalById,
  UnlockWindow,
  SystemMedal,
} from '../../miniprogram/utils/medal-config'
import {
  calcDimensions,
  classifyPersonality,
  analyzePersonality,
  getPersonalityMeta,
} from '../../miniprogram/utils/personality'
import {
  calcHabitScore,
  refreshFreebies,
  getFreebies,
  habitScoreLevel,
} from '../../miniprogram/utils/streak-protection'
import { loadPreferences } from '../../miniprogram/utils/preferences'
import { Item, Checkin } from '../../miniprogram/utils/storage'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

function mk(over: Partial<Item>): Item {
  return {
    id: over.id || 'id-' + Math.random().toString(36).slice(2, 8),
    type: 'book',
    category: 'reading',
    title: over.title || '书',
    author: over.author || '作者',
    genre: over.genre || '小说',
    rating: over.rating ?? 4,
    finishedDate: over.finishedDate || '2026-08-01',
    note: over.note || '',
    coverColor: '#D97A4A',
    createdAt: over.createdAt ?? 1,
    ...over,
  } as Item
}

// @ts-ignore mock
const _wx: any = (globalThis as any).wx
function resetStore() {
  _wx._reset()
  // 给 preferences 一个干净起点（loadPreferences 会自己补默认）
  _wx.setStorageSync('app_preferences', {})
}

function runAll(): boolean {

  /* ============================================================
   * isInUnlockWindow
   * ============================================================ */
  console.log('=== isInUnlockWindow ===')
  {
    // 空窗口：恒为 true
    assert(isInUnlockWindow(new Date('2026-06-15'), undefined) === true, '空窗口恒 true')
    assert(isInUnlockWindow(new Date('2026-06-15'), { startMD: '', endMD: '' }) === true, '空串窗口恒 true')

    // 普通窗口：4-23 单日
    const w: UnlockWindow = { startMD: '04-23', endMD: '04-23' }
    assert(isInUnlockWindow(new Date('2026-04-23T12:00'), w) === true, '4-23 当天在窗口内')
    assert(isInUnlockWindow(new Date('2026-04-22T12:00'), w) === false, '4-22 不在窗口内')
    assert(isInUnlockWindow(new Date('2026-04-24T12:00'), w) === false, '4-24 不在窗口内')

    // 普通窗口：4 月整月
    const w2: UnlockWindow = { startMD: '04-01', endMD: '04-30' }
    assert(isInUnlockWindow(new Date('2026-04-01T00:00'), w2) === true, '4-01 在窗口内（边界含）')
    assert(isInUnlockWindow(new Date('2026-04-30T23:59'), w2) === true, '4-30 在窗口内（边界含）')
    assert(isInUnlockWindow(new Date('2026-03-31T12:00'), w2) === false, '3-31 不在窗口内')
    assert(isInUnlockWindow(new Date('2026-05-01T12:00'), w2) === false, '5-01 不在窗口内')

    // 跨年窗口：12-20 → 01-10
    const w3: UnlockWindow = { startMD: '12-20', endMD: '01-10' }
    assert(isInUnlockWindow(new Date('2026-12-25T12:00'), w3) === true, '12-25 在跨年窗口内')
    assert(isInUnlockWindow(new Date('2027-01-05T12:00'), w3) === true, '01-05 在跨年窗口内')
    assert(isInUnlockWindow(new Date('2026-12-19T12:00'), w3) === false, '12-19 不在窗口内')
    assert(isInUnlockWindow(new Date('2026-06-15T12:00'), w3) === false, '06-15 不在窗口内')

    // 跨年窗口边界
    assert(isInUnlockWindow(new Date('2026-12-20T00:00'), w3) === true, '12-20 起边含')
    assert(isInUnlockWindow(new Date('2027-01-10T23:59'), w3) === true, '01-10 止边含')
    assert(isInUnlockWindow(new Date('2026-12-19T23:59'), w3) === false, '12-19 起边前一天不在')
    assert(isInUnlockWindow(new Date('2027-01-11T00:00'), w3) === false, '01-11 止边后一天不在')
  }

  /* ============================================================
   * dateInWindow + countItemsInWindow
   * ============================================================ */
  console.log('=== dateInWindow + countItemsInWindow ===')
  {
    const w: UnlockWindow = { startMD: '04-23', endMD: '04-23' }
    // 合法日期 + 在窗口
    assert(dateInWindow('2026-04-23', w) === true, '2026-04-23 在 4-23 窗口内')
    assert(dateInWindow('2025-04-23', w) === true, '2025-04-23 也在 4-23 窗口内（年无关）')
    // 合法日期 + 不在窗口
    assert(dateInWindow('2026-04-22', w) === false, '2026-04-22 不在 4-23 窗口')
    assert(dateInWindow('2026-05-23', w) === false, '2026-05-23 不在 4-23 窗口')
    // 非法日期格式保守不计数
    assert(dateInWindow('', w) === false, '空串 → false')
    assert(dateInWindow('not-a-date', w) === false, '非日期串 → false')
    assert(dateInWindow('2026/04/23', w) === false, '斜杠格式 → false（保守）')
    assert(dateInWindow('2026-4-23', w) === false, '月日不补零 → false（保守）')
    // 空窗口：恒 true（与 isInUnlockWindow 一致）
    assert(dateInWindow('2026-04-23', undefined) === true, '空窗口恒 true')
    assert(dateInWindow('2026-04-23', { startMD: '', endMD: '' }) === true, '空串窗口恒 true')

    // 跨年窗口
    const w2: UnlockWindow = { startMD: '12-20', endMD: '01-10' }
    assert(dateInWindow('2026-12-25', w2) === true, '2026-12-25 在跨年窗口')
    assert(dateInWindow('2027-01-05', w2) === true, '2027-01-05 在跨年窗口')
    assert(dateInWindow('2026-06-15', w2) === false, '2026-06-15 不在跨年窗口')

    // countItemsInWindow
    const items: Item[] = [
      mk({ id: 'a', finishedDate: '2026-04-23' }),
      mk({ id: 'b', finishedDate: '2025-04-23' }),   // 不同年也算（年无关）
      mk({ id: 'c', finishedDate: '2026-04-22' }),
      mk({ id: 'd', finishedDate: '2026-04-24' }),
      mk({ id: 'e', finishedDate: '' }),             // 空 → 不计
      mk({ id: 'f', finishedDate: 'invalid' }),      // 非法 → 不计
    ]
    assert(countItemsInWindow(items, w) === 2, '4-23 窗口内 2 条（a + b）')
    assert(countItemsInWindow(items, undefined) === items.length, '空窗口 → 全量')

    // 缺 finishedDate 的条目不计
    const noDate = mk({ id: 'x' })
    delete (noDate as any).finishedDate
    assert(countItemsInWindow([noDate], w) === 0, '无 finishedDate → 不计')
  }

  /* ============================================================
   * buildCheckinCategoryMedals（动态分类连胜勋章）
   * ============================================================ */
  console.log('=== buildCheckinCategoryMedals ===')
  {
    // other 排除
    assert(buildCheckinCategoryMedals('other', '其他', '🔹').length === 0, 'other 不生成勋章')

    // 正常分类：生成 3 枚，id 稳定
    const ms = buildCheckinCategoryMedals('exercise', '运动', '🏃')
    assert(ms.length === 3, '生成 3 枚（7/30/100 天）')
    assert(ms[0].id === 'medal-streak-7-exercise', '7 天勋章 id 稳定')
    assert(ms[1].id === 'medal-streak-30-exercise', '30 天勋章 id 稳定')
    assert(ms[2].id === 'medal-streak-100-exercise', '100 天勋章 id 稳定')
    assert(ms.every(m => m.category === 'checkin:exercise'), 'category 带 checkin: 前缀')
    assert(ms.every(m => m.scope === 'yearly'), 'scope 都是 yearly')
    assert(ms.every(m => m.icon === '🏃'), 'icon 透传')

    // 同分类再生成一次：id 一致（稳定性）
    const ms2 = buildCheckinCategoryMedals('exercise', '运动', '🏃')
    assert(ms2[0].id === ms[0].id, '同分类重复生成 id 一致')

    // 自定义分类也能生成
    const custom = buildCheckinCategoryMedals('custom_xyz', '自定义', '⭐')
    assert(custom.length === 3 && custom[0].id === 'medal-streak-7-custom_xyz', '自定义分类 id 用其 custom_xxx')
  }

  /* ============================================================
   * getMedalById
   * ============================================================ */
  console.log('=== getMedalById ===')
  {
    assert(getMedalById('medal-reading-50') !== null, '内置 id 命中')
    assert(getMedalById('medal-reading-50')!.category === 'reading', '内置 id 字段正确')
    assert(getMedalById('unknown-id') === null, '未知 id 返回 null')
  }

  /* ============================================================
   * 🚨 buildMedalRows 限量徽章计数修复（核心回归测试）
   * ============================================================ */
  console.log('=== 🚨 buildMedalRows：限量徽章窗口内计数（核心修复）===')
  resetStore()
  {
    // 场景：用户今年读了 50 本书，但只有 1 本是在 4-23 当天录入的。
    // 修复前：current = 50（全年累计）→ 进窗口立刻解锁（违背仪式感）
    // 修复后：current = 1（窗口内录入）→ target=1 时恰好解锁
    const items: Item[] = []
    for (let i = 0; i < 49; i++) {
      items.push(mk({ id: 'r' + i, finishedDate: '2026-03-10' }))   // 非 4-23 的书
    }
    items.push(mk({ id: 'r49', finishedDate: '2026-04-23' }))        // 4-23 当天这本

    const prefs = loadPreferences()
    const rows = buildMedalRows(prefs, items, [], [])

    const worldBook = rows.find(r => r.id === 'medal-world-book-day')
    assert(!!worldBook, '世界读书日勋章存在')
    // 关键断言：current 是窗口内录入数（1），不是全年累计（50）
    assert(worldBook!.current === 1, '🚨 修复：世界读书日 current=1（窗口内），不是 50（全年累计）')

    // 4-23 当天在窗口内 → current(1) >= target(1) → 解锁
    // 注意：这个测试只在 4-23 当天跑才能验证 unlocked=true；其它日期 inWindow=false 不解锁。
    // 我们只断言 current 数字正确（与日期无关），unlocked 由 isInUnlockWindow 控制。
    const now = new Date()
    const md = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
    if (md === '04-23') {
      assert(worldBook!.unlocked === true, '（仅 4-23 当天验证）4-23 解锁')
    } else {
      console.log('  [info] 今天 ' + md + ' 不是 04-23，跳过 unlocked 断言')
    }

    // 全民阅读月：4 月累计 3 条阅读成就 → 修复前用全年累计，修复后只用 4 月内的
    const monthItems: Item[] = [
      ...items,                                       // 上面 50 本（其中 49 本 3 月，1 本 4-23）
      mk({ id: 'm1', finishedDate: '2026-04-10' }),
      mk({ id: 'm2', finishedDate: '2026-04-15' }),
    ]
    const prefs2 = loadPreferences()
    const rows2 = buildMedalRows(prefs2, monthItems, [], [])
    const monthMedal = rows2.find(r => r.id === 'medal-national-read-month')
    assert(!!monthMedal, '全民阅读月勋章存在')
    // 4 月窗口内：r49(4-23) + m1(4-10) + m2(4-15) = 3 条
    assert(monthMedal!.current === 3, '🚨 修复：全民阅读月 current=3（4 月内），target=3 → 达成')

    // 跨年窗口勋章（新年开卷 1-01 ~ 1-03）
    const newYearItems: Item[] = [
      mk({ id: 'ny1', finishedDate: '2026-01-01' }),
      mk({ id: 'ny2', finishedDate: '2026-01-02' }),
      mk({ id: 'ny3', finishedDate: '2026-06-15' }),   // 非窗口
    ]
    const prefs3 = loadPreferences()
    const rows3 = buildMedalRows(prefs3, newYearItems, [], [])
    const nyMedal = rows3.find(r => r.id === 'medal-new-year-read')
    assert(!!nyMedal, '新年开卷勋章存在')
    assert(nyMedal!.current === 2, '🚨 修复：新年开卷 current=2（1-01~1-03 内），不是 3')
  }

  /* ============================================================
   * buildMedalRows：非限量勋章计数不受影响
   * ============================================================ */
  console.log('=== buildMedalRows：非限量勋章计数不变（回归保护）===')
  resetStore()
  {
    const items: Item[] = [
      mk({ id: 'a', category: 'reading' }),
      mk({ id: 'b', category: 'reading' }),
      mk({ id: 'c', category: 'film', type: 'film' }),
    ]
    const prefs = loadPreferences()
    const rows = buildMedalRows(prefs, items, [], [])
    const r50 = rows.find(r => r.id === 'medal-reading-50')
    const f24 = rows.find(r => r.id === 'medal-film-24')
    assert(r50!.current === 2, '阅读 50 本 current=2（累计计数不受影响）')
    assert(f24!.current === 1, '观影 24 部 current=1（累计计数不受影响）')
    assert(r50!.target === 50, '默认 target=50')
    assert(r50!.unlocked === false, '2 < 50 未解锁')
  }

  /* ============================================================
   * buildMedalRows：打卡连胜勋章
   * ============================================================ */
  console.log('=== buildMedalRows：打卡连胜勋章 ===')
  resetStore()
  {
    // 连续打卡 7 天
    const dates: string[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 0, 1 + i)   // 2026-01-01 ~ 01-07
      const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      dates.push(s)
    }
    const checkins: Checkin[] = dates.map((d, i) => ({
      id: 'c' + i, date: d, category: 'reading', createdAt: 1,
    } as Checkin))
    const prefs = loadPreferences()
    const rows = buildMedalRows(prefs, [], dates, checkins)
    const s7 = rows.find(r => r.id === 'medal-streak-7')
    const s30 = rows.find(r => r.id === 'medal-streak-30')
    assert(s7!.current === 7, '连续 7 天 current=7')
    assert(s7!.unlocked === true, '7 天连胜解锁')
    assert(s30!.current === 7, '最长连胜 7 → 30 天勋章 current=7')
    assert(s30!.unlocked === false, '7 < 30 未解锁')
  }

  /* ============================================================
   * buildMedalRows：首次解锁写回 unlockedAt
   * ============================================================ */
  console.log('=== buildMedalRows：首次解锁写回 unlockedAt ===')
  resetStore()
  {
    const items: Item[] = []
    for (let i = 0; i < 50; i++) items.push(mk({ id: 'r' + i, category: 'reading' }))
    const prefs = loadPreferences()
    buildMedalRows(prefs, items, [], [])
    const after = loadPreferences()
    assert(!!after.systemMedals['medal-reading-50']?.unlockedAt, '解锁后写回 unlockedAt')
    // 再算一次：unlockedAt 不变（幂等）
    const firstTs = after.systemMedals['medal-reading-50'].unlockedAt
    const prefs2 = loadPreferences()
    buildMedalRows(prefs2, items, [], [])
    const after2 = loadPreferences()
    assert(after2.systemMedals['medal-reading-50'].unlockedAt === firstTs, '重复解锁 unlockedAt 不变（幂等）')
  }

  /* ============================================================
   * calcDimensions 数学
   * ============================================================ */
  console.log('=== calcDimensions 数学 ===')
  {
    // 空数组
    const d0 = calcDimensions([])
    assert(d0.depth === 0 && d0.breadth === 0 && d0.speed === 0 && d0.rewatch === 0, '空数组全 0')

    // 单类、无笔记、无 startDate → depth=0, breadth=0, speed=0, rewatch=0
    const items1 = [mk({}), mk({}), mk({})]
    const d1 = calcDimensions(items1)
    assert(d1.depth === 0, '无笔记 → depth=0')
    assert(d1.breadth === 0, '单类 → breadth=0（1 类 = 0 分）')
    assert(d1.speed === 0, '无 startDate → speed=0')

    // 笔记字数：平均 300 字 → depth=100（封顶）
    const items2 = [
      mk({ note: 'x'.repeat(300) }),
      mk({ note: 'x'.repeat(300) }),
    ]
    assert(calcDimensions(items2).depth === 100, '平均 300 字 → depth=100')

    // 广度：6 类 → 100 分
    const items3: Item[] = [
      mk({ id: '1', category: 'reading' }),
      mk({ id: '2', category: 'film', type: 'film' }),
      mk({ id: '3', category: 'skill' }),
      mk({ id: '4', category: 'game' }),
      mk({ id: '5', category: 'travel' }),
      mk({ id: '6', category: 'exam' }),
    ]
    assert(calcDimensions(items3).breadth === 100, '6 类 → breadth=100')

    // 速度：平均 42 天 → 100 分
    const items4: Item[] = [
      mk({ id: '1', startDate: '2026-01-01', finishedDate: '2026-02-12' }),  // 42 天
    ]
    assert(calcDimensions(items4).speed === 100, '平均 42 天 → speed=100')

    // 复读：2/3 标题重复 → rewatchRate=2/3≈0.67，分=0.67/0.5*100≈133 封顶 100
    const items5: Item[] = [
      mk({ id: '1', title: '活着' }),
      mk({ id: '2', title: '活着' }),
      mk({ id: '3', title: '围城' }),
    ]
    // titleCount: '活着'=2, '围城'=1；rewatchTitles=1 ('活着'), totalTitles=2 → rate=0.5 → 100 分
    assert(calcDimensions(items5).rewatch === 100, '一半标题重复 → rewatch=100')

    // startDate 在 finishedDate 之后（脏数据）→ daysBetween 返回负数 → 不计入 speed
    const items6: Item[] = [
      mk({ id: '1', startDate: '2026-12-31', finishedDate: '2026-01-01' }),
    ]
    assert(calcDimensions(items6).speed === 0, 'startDate 晚于 finishedDate → 不计入 speed')
  }

  /* ============================================================
   * classifyPersonality 8 类
   * ============================================================ */
  console.log('=== classifyPersonality：MIN_ITEMS 兜底 ===')
  {
    assert(classifyPersonality([]) === 'observer', '空数组 → observer')
    assert(classifyPersonality([mk({})]) === 'observer', '1 条 → observer（< MIN_ITEMS=5）')
    assert(classifyPersonality([mk({}), mk({}), mk({}), mk({})]) === 'observer', '4 条 → observer（仍不足 5）')
  }

  console.log('=== classifyPersonality：note-fanatic（depth≥80 覆盖一切）===')
  {
    // 平均笔记 240 字 → depth = 240/300*100 = 80
    const items: Item[] = []
    for (let i = 0; i < 5; i++) items.push(mk({ id: 'n' + i, note: 'x'.repeat(240) }))
    assert(classifyPersonality(items) === 'note-fanatic', 'depth=80 → note-fanatic')
  }

  console.log('=== classifyPersonality：rewatcher（rewatch≥40）===')
  {
    // 一半重复 → rewatch=100 ≥40；但要先排除 depth≥80（note-fanatic 优先）
    const items: Item[] = [
      mk({ id: '1', title: '活着' }),
      mk({ id: '2', title: '活着' }),
      mk({ id: '3', title: '围城' }),
      mk({ id: '4', title: '围城' }),
      mk({ id: '5', title: '呐喊' }),
    ]
    // titleCount: 活着=2, 围城=2, 呐喊=1；rewatchTitles=2, total=3 → rate=0.67 → 100
    assert(classifyPersonality(items) === 'rewatcher', 'rewatch=100 → rewatcher')
  }

  console.log('=== classifyPersonality：cross-bound / explorer（breadth≥60 按 rewatch 二分）===')
  {
    // 4 类 → breadth = (4-1)/(6-1)*100 = 60；每条唯一标题避免 rewatch 暴涨抢断
    const base: Item[] = [
      mk({ id: '1', category: 'reading', title: 'A' }),
      mk({ id: '2', category: 'film', type: 'film', title: 'B' }),
      mk({ id: '3', category: 'skill', title: 'C' }),
      mk({ id: '4', category: 'game', title: 'D' }),
      mk({ id: '5', category: 'reading', title: 'E' }),
    ]
    // 全部唯一标题 → rewatch=0 < 20 → explorer
    assert(classifyPersonality(base) === 'explorer', 'breadth=60 + rewatch<20 → explorer')

    // 加重复标题让 rewatch 落在 [20,40)（否则 ≥40 会进 rewatcher）。
    // 设计：7 条 4 类，唯一标题 6 个（A 重复 2 次），totalTitles=6，rewatchTitles=1 → rate=1/6≈0.167
    // → score=0.167/0.5*100≈33 → rewatch≈33 ∈ [20,40)，配合 breadth≥60 进 cross-bound
    const crossItems: Item[] = [
      mk({ id: '1', category: 'reading', title: 'A' }),
      mk({ id: '2', category: 'film', type: 'film', title: 'B' }),
      mk({ id: '3', category: 'skill', title: 'C' }),
      mk({ id: '4', category: 'game', title: 'D' }),
      mk({ id: '5', category: 'reading', title: 'A' }),  // A 重复
      mk({ id: '6', category: 'reading', title: 'E' }),
      mk({ id: '7', category: 'reading', title: 'F' }),
    ]
    assert(classifyPersonality(crossItems) === 'cross-bound', 'breadth=60 + rewatch∈[20,40) → cross-bound')
  }

  console.log('=== classifyPersonality：deep-reader（speed≥50 + depth≥40）===')
  {
    // 单类 + 长 startDate→finishedDate（42 天 → speed=100）+ 笔记 120 字（depth=40）
    // 每条唯一标题避免 rewatch 干扰
    const items: Item[] = []
    for (let i = 0; i < 5; i++) {
      items.push(mk({
        id: 'd' + i,
        category: 'reading',
        title: 'D' + i,
        startDate: '2026-01-01',
        finishedDate: '2026-02-12',
        note: 'x'.repeat(120),
      }))
    }
    // breadth=0（单类）→ 不进 cross-bound 分支；speed=100≥50 + depth=40≥40 → deep-reader
    assert(classifyPersonality(items) === 'deep-reader', 'speed=100 + depth=40 → deep-reader')
  }

  console.log('=== classifyPersonality：focused（breadth<40）===')
  {
    // 单类、无笔记、无 startDate、唯一标题 → 各维度都 0
    // 0<80 排除 note-fanatic；0<40 排除 rewatcher；0<60 排除 cross-bound；
    // speed=0<50 排除 deep-reader；speed=0<30 但 breadth=0<40 排除 speed-reader；
    // breadth=0<40 → focused
    const items: Item[] = []
    for (let i = 0; i < 5; i++) items.push(mk({ id: 'f' + i, category: 'reading', title: 'F' + i }))
    assert(classifyPersonality(items) === 'focused', '单类 + 无笔记 + 无速度 + 唯一标题 → focused')
  }

  console.log('=== analyzePersonality + getPersonalityMeta ===')
  {
    const items: Item[] = []
    for (let i = 0; i < 10; i++) items.push(mk({ id: 'n' + i, note: 'x'.repeat(300) }))
    const result = analyzePersonality(items)
    assert(result.type === 'note-fanatic', 'analyzePersonality: type 正确')
    assert(result.sufficient === true, 'sufficient=true（10≥5）')
    assert(result.total === 10, 'total=10')
    assert(result.meta.id === 'note-fanatic', 'meta.id 与 type 一致')
    assert(!!result.meta.label && !!result.meta.emotionalCopy, 'meta 有 label + emotionalCopy')

    // getPersonalityMeta 兜底
    assert(getPersonalityMeta('observer' as any).id === 'observer', 'getPersonalityMeta 命中 observer')
  }

  /* ============================================================
   * calcHabitScore 衰减式
   * ============================================================ */
  console.log('=== calcHabitScore 衰减式 ===')
  {
    // 空 → 0
    assert(calcHabitScore([]) === 0, '空数组 → 0')

    // 最近 60 天每天都打 → 应接近 100（不是精确 100 因为浮点）
    const dates: string[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const DAY_MS = 24 * 60 * 60 * 1000
    for (let i = 0; i < 60; i++) {
      const d = new Date(today.getTime() - i * DAY_MS)
      const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      dates.push(s)
    }
    const perfect = calcHabitScore(dates)
    assert(perfect === 100, '连续 60 天每天打卡 → 100（满分）')

    // 只今天打 → 比较低（1 个权重 / 完美累计权重）
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    const onlyToday = calcHabitScore([todayStr])
    assert(onlyToday >= 1 && onlyToday <= 5, '只今天打 1 天 → 低分（1-5）实际=' + onlyToday)

    // 同一天多条打卡算 1 条（去重）
    const dup = calcHabitScore([todayStr, todayStr, todayStr])
    assert(dup === onlyToday, '同一天多条 → 去重，与单条分数相同')

    // 越近权重越高：今天打 vs 一个月前打
    const monthAgo = new Date(today.getTime() - 30 * DAY_MS)
    const monthAgoStr = monthAgo.getFullYear() + '-' + String(monthAgo.getMonth() + 1).padStart(2, '0') + '-' + String(monthAgo.getDate()).padStart(2, '0')
    const scoreToday = calcHabitScore([todayStr])
    const scoreMonthAgo = calcHabitScore([monthAgoStr])
    assert(scoreToday > scoreMonthAgo, '今天打的权重 > 一个月前打的权重')
  }

  /* ============================================================
   * habitScoreLevel 文案
   * ============================================================ */
  console.log('=== habitScoreLevel ===')
  {
    assert(habitScoreLevel(100).label === '习惯大师', '100 → 习惯大师')
    assert(habitScoreLevel(90).label === '习惯大师', '90 → 习惯大师')
    assert(habitScoreLevel(70).label === '稳定保持', '70 → 稳定保持')
    assert(habitScoreLevel(40).label === '渐入佳境', '40 → 渐入佳境')
    assert(habitScoreLevel(10).label === '初养成', '10 → 初养成')
    assert(habitScoreLevel(0).label === '待加油', '0 → 待加油')
  }

  /* ============================================================
   * refreshFreebies 幂等 + 上限
   * ============================================================ */
  console.log('=== refreshFreebies 幂等 + 上限 ===')
  resetStore()
  {
    // 第一次发：0 → 1
    const n1 = refreshFreebies()
    assert(n1 === 1, '首次发券 → 1 张')
    // 同月再调：幂等不变
    const n2 = refreshFreebies()
    assert(n2 === 1, '同月再调 → 仍 1 张（幂等）')
    assert(getFreebies() === 1, 'getFreebies 一致 = 1')

    // 模拟跨月：手动改 lastFreebieMonth 触发再发
    const prefs = loadPreferences()
    prefs.lastFreebieMonth = '2020-01'   // 强制变成"旧月份"
    _wx.setStorageSync('app_preferences', prefs)
    const n3 = refreshFreebies()
    assert(n3 === 2, '换月再发 → 2 张')

    // 攒到上限 3：再模拟两次换月
    const p2 = loadPreferences()
    p2.lastFreebieMonth = '2020-01'
    _wx.setStorageSync('app_preferences', p2)
    assert(refreshFreebies() === 3, '第三次发券 → 3 张')
    const p3 = loadPreferences()
    p3.lastFreebieMonth = '2020-01'
    _wx.setStorageSync('app_preferences', p3)
    assert(refreshFreebies() === 3, '🚨 第四次发券 → 仍 3 张（不超上限）')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
