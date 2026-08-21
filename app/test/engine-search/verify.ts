/**
 * engine-search 验证脚本：template-engine + search
 *
 * 覆盖：
 *   - fillPlaceholders 边界（数字 0 / 空串 / 找不到的占位符 / 花括号内非 \w）
 *   - extractVars（含新增的 topBookId/book1Id）
 *   - generateReport（M1：重复标题 bookRef 用 id 不用标题反查）
 *   - searchAll（M2：自定义分类图标 / M3：在读搁置副标题词缀）
 */
import { fillPlaceholders, extractVars, generateReport, cardHasData } from '../../miniprogram/utils/template-engine'
import { getBuiltInTemplates } from '../../miniprogram/utils/built-in-templates'
import { searchAll } from '../../miniprogram/utils/search'
import { Item } from '../../miniprogram/utils/storage'

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
  // 清空各 storage key，避免残留污染 search 测试
  _wx.setStorageSync('book_film_data', {})
  _wx.setStorageSync('wishlist', [])
  _wx.setStorageSync('inspirations', [])
  _wx.setStorageSync('checkins', [])
}

/** 把 items 写进 book_film_data（search 测试用）。 */
function seedItems(items: Item[]) {
  const data: any = {}
  for (const it of items) {
    const y = Number(it.finishedDate.slice(0, 4))
    if (!data[y]) data[y] = []
    data[y].push(it)
  }
  _wx.setStorageSync('book_film_data', data)
}

function runAll(): boolean {
  console.log('=== fillPlaceholders 边界 ===')
  {
    const vars = { name: '张三', count: 0, empty: '', missing: undefined as any }
    assert(fillPlaceholders('你好 {name}', vars) === '你好 张三', '基本替换')
    // 数字 0 应代入成 '0'（不是空值）
    assert(fillPlaceholders('共 {count} 本', vars) === '共 0 本', '数字 0 正确代入')
    // 空串：占位符被删除（不留字面 {empty}，避免报告里出现裸花括号）
    assert(fillPlaceholders('「{empty}」', vars) === '「」', '空串占位符被删除')
    // undefined：占位符被删除
    assert(fillPlaceholders('{missing}', vars) === '', 'undefined 占位符被删除')
    // 找不到的占位符被删除（不留字面量）
    assert(fillPlaceholders('{notExist}', vars) === '', '未知占位符被删除')
    // 多个找不到的占位符都被删除
    assert(fillPlaceholders('前 {a} 中 {b} 后', vars) === '前  中  后', '多个未知占位符都被删除')
  }

  console.log('=== extractVars 含 topBookId / book1Id ===')
  {
    const items = [
      mk({ id: 'b1', title: '高分书', rating: 5, readingPlace: '北京' }),
      mk({ id: 'b2', title: '中分书', rating: 3, readingPlace: '上海' }),
    ]
    const vars = extractVars(items, '我的报告', 2026)
    assert(typeof vars.topBookId === 'string', 'topBookId 是字符串')
    assert(vars.topBookId === 'b1', 'topBookId = 评分最高的 b1')
    assert(typeof vars.book1Id === 'string', 'book1Id 是字符串')
    // journeyBooks = books.filter(readingPlace).slice(0,2)，第一本是 b1
    assert(vars.book1Id === 'b1', 'book1Id = 第一本带地点的 b1')

    // 空数组
    const emptyVars = extractVars([], '空报告', 2026)
    assert(emptyVars.topBookId === '', '空数组 topBookId = 空串')
    assert(emptyVars.book1Id === '', '空数组 book1Id = 空串')
  }

  console.log('=== 🚨 generateReport：M1 重复标题 bookRef 用 id 关联 ===')
  {
    // 两本同标题不同 id 不同作者的书
    const items = [
      mk({ id: 'a1', title: '活着', author: '余华', rating: 5 }),
      mk({ id: 'a2', title: '活着', author: '另一作者', rating: 3 }),
    ]
    // 找一个含 favorite 卡的内置模板
    const tpls = getBuiltInTemplates()
    const tpl = tpls.find((t: any) => t.cards.some((c: any) => c.type === 'favorite'))
    if (!tpl) {
      console.log('  ⚠️ 跳过：没有含 favorite 卡的内置模板')
    } else {
      const report = generateReport(tpl, items, '测试报告', 2026)
      const favCard = report.cards.find(c => c.type === 'favorite')
      assert(!!favCard && !!favCard!.bookRef, 'favorite 卡有 bookRef')
      // topBook = 评分最高的 a1（活着），bookRef 应指向 a1 不是 a2
      assert(favCard!.bookRef === 'a1', 'M1 修复：bookRef 指向评分最高的 a1（不是第一个 find 命中的）')
    }
  }

  console.log('=== cardHasData：按卡片类型 + 数据判断是否生成 ===')
  {
    const fullVars = {
      placeCount: 3,
      '__list__quoteList': [{ text: 'a', book: 'b' }],
      '__list__journeyList': [{ place: '北京', book: '活着' }],
      topBook: '活着',
      milestone1: '跑完半马',
    }
    // 叙事骨架卡永远保留
    assert(cardHasData({ type: 'cover', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'cover 永远保留')
    assert(cardHasData({ type: 'overview', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'overview 永远保留')
    assert(cardHasData({ type: 'theme', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'theme 永远保留')
    assert(cardHasData({ type: 'ending', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'ending 永远保留')
    // 数据增强卡：有数据 → 保留
    assert(cardHasData({ type: 'footprint', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'footprint 有地点 → 保留')
    assert(cardHasData({ type: 'quote', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'quote 有金句 → 保留')
    assert(cardHasData({ type: 'journey', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'journey 有旅程 → 保留')
    assert(cardHasData({ type: 'favorite', titleTemplate: '', contentTemplate: '' }, fullVars) === true, 'favorite 有 topBook → 保留')

    // 数据增强卡：无数据 → 跳过
    const emptyVars = {
      placeCount: 0,
      '__list__quoteList': [] as any[],
      '__list__journeyList': [] as any[],
      topBook: '',
      milestone1: '',
    }
    assert(cardHasData({ type: 'footprint', titleTemplate: '', contentTemplate: '' }, emptyVars) === false, 'footprint 无地点 → 跳过')
    assert(cardHasData({ type: 'quote', titleTemplate: '', contentTemplate: '' }, emptyVars) === false, 'quote 无金句 → 跳过')
    assert(cardHasData({ type: 'journey', titleTemplate: '', contentTemplate: '' }, emptyVars) === false, 'journey 无旅程 → 跳过')
    assert(cardHasData({ type: 'favorite', titleTemplate: '', contentTemplate: '' }, emptyVars) === false, 'favorite 无 topBook 无 milestone → 跳过')
    // 骨架卡即便全空也保留
    assert(cardHasData({ type: 'cover', titleTemplate: '', contentTemplate: '' }, emptyVars) === true, 'cover 即便全空也保留')

    // favorite 用 milestone1 兜底（成就模板没有 topBook 只有 milestone1）
    assert(cardHasData({ type: 'favorite', titleTemplate: '', contentTemplate: '' }, { topBook: '', milestone1: '跑完半马' }) === true,
      'favorite 无 topBook 但有 milestone1 → 保留（成就模板兼容）')
  }

  console.log('=== 🚨 generateReport：按真实数据伸缩（跳过空卡）===')
  {
    // 选一个覆盖所有卡片类型的内置模板（文学散文风 builtin-literary 含 cover/overview/footprint/favorite/theme/quote/journey/ending）
    const tpls = getBuiltInTemplates()
    const tpl = tpls.find((t: any) => t.id === 'builtin-literary') as any
    if (!tpl) {
      console.log('  ⚠️ 跳过：找不到 builtin-literary 模板')
    } else {
      // —— 场景 A：1 本无地点无金句的书 ——
      const sparse = [mk({ id: 'sp1', title: '孤独的书', rating: 4, readingPlace: '', quotes: [] })]
      const reportA = generateReport(tpl, sparse, '稀疏报告', 2026)
      const typesA = reportA.cards.map(c => c.type)
      assert(typesA.indexOf('cover') >= 0, '稀疏：cover 仍生成')
      assert(typesA.indexOf('overview') >= 0, '稀疏：overview 仍生成')
      assert(typesA.indexOf('theme') >= 0, '稀疏：theme 仍生成')
      assert(typesA.indexOf('ending') >= 0, '稀疏：ending 仍生成')
      assert(typesA.indexOf('favorite') >= 0, '稀疏：favorite 仍生成（有 topBook）')
      assert(typesA.indexOf('footprint') < 0, '稀疏：footprint 被跳过（无阅读地点）')
      assert(typesA.indexOf('quote') < 0, '稀疏：quote 被跳过（无金句）')
      assert(typesA.indexOf('journey') < 0, '稀疏：journey 被跳过（无带地点的书）')
      // 残留检查：所有生成卡的 content 都不含裸 { 字面量
      const hasBraceA = reportA.cards.some(c => (c.content + c.title).indexOf('{') >= 0)
      assert(!hasBraceA, '稀疏：生成卡里没有裸花括号 { 占位符残留')

      // —— 场景 B：多本有地点有金句的书 ——
      const rich = [
        mk({ id: 'r1', title: '书一', rating: 5, readingPlace: '北京', quotes: ['金句一'] }),
        mk({ id: 'r2', title: '书二', rating: 4, readingPlace: '上海', quotes: ['金句二'] }),
      ]
      const reportB = generateReport(tpl, rich, '丰富报告', 2026)
      const typesB = reportB.cards.map(c => c.type)
      assert(typesB.indexOf('footprint') >= 0, '丰富：footprint 仍生成（有地点）')
      assert(typesB.indexOf('quote') >= 0, '丰富：quote 仍生成（有金句）')
      assert(typesB.indexOf('journey') >= 0, '丰富：journey 仍生成（有带地点的书）')
      assert(reportB.cards.length > reportA.cards.length, '丰富报告卡数 > 稀疏报告卡数（按数据伸缩）')
      const hasBraceB = reportB.cards.some(c => (c.content + c.title).indexOf('{') >= 0)
      assert(!hasBraceB, '丰富：生成卡里没有裸花括号 { 占位符残留')
    }
  }

  console.log('=== searchAll 基本搜索 ===')
  resetStore()
  {
    seedItems([
      mk({ id: 's1', title: '深度工作', author: 'Cal Newport', note: '关于专注' }),
      mk({ id: 's2', title: '活着', author: '余华', note: '深度描写苦难' }),
    ])
    const r1 = searchAll('深度')
    assert(r1.length === 2, '"深度" 命中 2 条')
    assert(r1.some(x => x.id === 's1'), '包含标题命中的 s1')
    assert(r1.some(x => x.id === 's2'), '包含笔记命中的 s2')

    // 标题命中应 rank 靠前
    const s1Result = r1.find(x => x.id === 's1')
    const s2Result = r1.find(x => x.id === 's2')
    assert((s1Result!.rank) <= (s2Result!.rank), '标题命中（s1）rank ≤ 笔记命中（s2）')

    // 空关键词
    assert(searchAll('').length === 0, '空关键词 → 空')
    assert(searchAll('   ').length === 0, '纯空格 → 空')

    // 大小写不敏感
    const r2 = searchAll('CAL')
    assert(r2.length === 1 && r2[0].id === 's1', '大小写不敏感命中 CAL → s1')
  }

  console.log('=== 🚨 M2 search：分类图标走 getCategoryMeta 单一真相源 ===')
  resetStore()
  {
    // 用预设分类验证（reading → 📖）：旧版硬编码 categoryToIcon 用 switch 写死，
    // 新版改走 getCategoryMeta —— 若 category-meta.ts 调整图标，搜索会自动跟随。
    // 注：getCategoryMeta 对未知/自定义分类回落 CUSTOM_CATEGORY_ICON='🏆'（这是
    // 整个项目的统一默认，列表/详情/搜索三处一致，不存在不一致 bug）。
    seedItems([
      mk({ id: 'p1', title: '阅读集', category: 'reading' }),
      mk({ id: 'p2', title: '观影集', category: 'film', type: 'film' }),
    ])
    const r1 = searchAll('阅读集')
    const hit1 = r1.find(x => x.id === 'p1')
    assert(!!hit1 && hit1!.icon === '📖', 'reading 分类图标 = 📖（来自 getCategoryMeta 预设）')
    const r2 = searchAll('观影集')
    const hit2 = r2.find(x => x.id === 'p2')
    assert(!!hit2 && hit2!.icon === '🎬', 'film 分类图标 = 🎬（来自 getCategoryMeta 预设）')
    // 自定义分类回落 🏆（验证与列表页一致）
    seedItems([mk({ id: 'p3', title: '摄影集', category: 'photography' })])
    const r3 = searchAll('摄影集')
    const hit3 = r3.find(x => x.id === 'p3')
    assert(!!hit3 && hit3!.icon === '🏆', '自定义分类回落 🏆（与列表页 getCategoryMeta 一致）')
  }

  console.log('=== 🚨 M3 search：在读/搁置副标题加状态词缀 ===')
  resetStore()
  {
    seedItems([
      mk({ id: 'r1', title: '在读书', status: 'reading', finishedDate: '2026-03-01' }),
      mk({ id: 'a1', title: '搁置书', status: 'abandoned', finishedDate: '2026-02-01' }),
      mk({ id: 'd1', title: '完成书', status: 'done', finishedDate: '2026-04-01' }),
    ])
    const r = searchAll('书')
    const reading = r.find(x => x.id === 'r1')
    const abandoned = r.find(x => x.id === 'a1')
    const done = r.find(x => x.id === 'd1')
    assert(!!reading && reading!.subtitle.includes('📖 在读'), '在读书副标题含「📖 在读」')
    assert(!!reading && reading!.subtitle.includes('加入 2026-03-01'), 'M3 修复：在读书日期带「加入」词缀（消歧）')
    assert(!!abandoned && abandoned!.subtitle.includes('🗂️ 搁置'), '搁置书副标题含「🗂️ 搁置」')
    assert(!!abandoned && abandoned!.subtitle.includes('搁置 2026-02-01'), 'M3 修复：搁置书日期带「搁置」词缀')
    assert(!!done && !done!.subtitle.includes('加入') && !done!.subtitle.includes('搁置'), '完成书日期无词缀（原样）')
  }

  console.log('=== searchAll 跨实体（愿望/灵感/打卡）===')
  resetStore()
  {
    _wx.setStorageSync('wishlist', [
      { id: 'w1', title: '想读深度工作', coverColor: '#000', createdAt: 1 },
    ])
    _wx.setStorageSync('inspirations', [
      { id: 'i1', content: '深度思考的灵感', category: 'random', createdAt: 1 },
    ])
    _wx.setStorageSync('checkins', [
      { id: 'c1', date: '2026-08-01', category: 'checkin:reading', note: '深度阅读打卡', createdAt: 1 },
    ])
    const r = searchAll('深度')
    assert(r.some(x => x.type === 'wish' && x.id === 'w1'), '命中愿望')
    assert(r.some(x => x.type === 'inspiration' && x.id === 'i1'), '命中灵感')
    assert(r.some(x => x.type === 'checkin' && x.id === 'c1'), '命中打卡')
  }

  console.log('=== P4 条件块 + 循环块（模板引擎扩展）===')
  {
    // 条件块：var 非空 → 渲染 content；var 空 → 整块删除
    assert(fillPlaceholders('{?topBook}年度之书：《{topBook}》{/}', { topBook: '活着' }) === '年度之书：《活着》',
      '条件块真值分支：topBook 非空时渲染 content 并替换 {topBook}')
    assert(fillPlaceholders('{?topBook}年度之书：《{topBook}》{/}', { topBook: '' }) === '',
      '条件块假值分支：topBook 为空时整块删除（不留字面 {topBook}）')
    assert(fillPlaceholders('前缀{?topBook}中间{/}后缀', { topBook: '' }) === '前缀后缀',
      '条件块假值：块外文本保留，块内整段删除')
    // 条件块 content 里的其它变量也正常替换
    assert(fillPlaceholders('{?flag}{year} 年读了 {n} 本{/}', { flag: 1, year: 2026, n: 10 }) === '2026 年读了 10 本',
      '条件块 content 内的其它变量正常替换')

    // 循环块：listVar 非空 → 循环渲染；空 → 整块删除
    const vars1: Record<string, string | number | object[]> = {
      '__list__quoteList': [
        { text: '金句一', book: '书A' },
        { text: '金句二', book: '书B' },
        { text: '金句三', book: '书C' },
      ],
    }
    const out1 = fillPlaceholders('{#quoteList}「{text}」\n——《{book}》\n\n{/}', vars1)
    assert(out1 === '「金句一」\n——《书A》\n\n「金句二」\n——《书B》\n\n「金句三」\n——《书C》\n\n',
      '循环块：数组 3 条 → 渲染 3 段，每段 {text}/{book} 取元素属性')
    // 循环块空数组 → 整块删除
    const out2 = fillPlaceholders('前{#quoteList}「{text}」{/}后', { '__list__quoteList': [] })
    assert(out2 === '前后', '循环块空数组：整块删除，块外文本保留')
    // 循环块内可引用全局变量（回退查 vars）
    const vars3: Record<string, string | number | object[]> = {
      year: 2026,
      '__list__topBooks': [{ title: '活着' }, { title: '围城' }],
    }
    const out3 = fillPlaceholders('{#topBooks}{year}·《{title}》\n{/}', vars3)
    assert(out3 === '2026·《活着》\n2026·《围城》\n', '循环块内 {year} 回退查全局变量')
    // 向后兼容：纯单值占位符仍工作（无块语法）
    assert(fillPlaceholders('读了 {bookCount} 本', { bookCount: 5 }) === '读了 5 本',
      '向后兼容：无块语法的纯单值占位符正常工作')
  }

  console.log('=== P4 extractVars 列表变量 + generateReport 无字面占位符 ===')
  {
    // 1 本书场景：生成报告后任何 card.content 不含字面 {xxx}
    const oneBook = mk({ id: 'b1', title: '活着', author: '余华', quotes: ['人是为活着本身而活着'], rating: 5, readingPlace: '' })
    const tpl = getBuiltInTemplates()[0]   // 文学散文风（已改用循环/条件块）
    const report1 = generateReport(tpl, [oneBook], '我的报告', 2026)
    const literalPlaceholder = report1.cards.some(c => /\{[?#\w]+\}/.test(c.content) || /\{\/\}/.test(c.content))
    assert(!literalPlaceholder, '1 本书：生成后所有卡片 content 无字面 {占位符}/{块标记} 残留')
    // 金句卡应含这条金句
    const quoteCard = report1.cards.find(c => c.type === 'quote')!
    assert(quoteCard.content.indexOf('人是为活着本身而活着') >= 0, '1 本书：金句卡含该书金句')

    // 0 本书场景：数据增强卡（footprint/quote/journey/favorite）全部跳过，只剩叙事骨架
    const report0 = generateReport(tpl, [], '空报告', 2026)
    const types0 = report0.cards.map(c => c.type)
    assert(types0.indexOf('cover') >= 0, '0 本书：cover 骨架卡仍生成')
    assert(types0.indexOf('ending') >= 0, '0 本书：ending 骨架卡仍生成')
    assert(types0.indexOf('footprint') < 0, '0 本书：footprint 卡被跳过（无地点，不再生成空内容卡）')
    assert(types0.indexOf('quote') < 0, '0 本书：quote 卡被跳过（无金句）')
    assert(types0.indexOf('journey') < 0, '0 本书：journey 卡被跳过（无旅程）')
    assert(types0.indexOf('favorite') < 0, '0 本书：favorite 卡被跳过（无 topBook/milestone）')
    // 骨架卡也无字面占位符残留
    const literal0 = report0.cards.some(c => /\{[?#\w]+\}/.test(c.content) || /\{\/\}/.test(c.content))
    assert(!literal0, '0 本书：骨架卡 content 无字面 {占位符}/{块标记} 残留')

    // 30 本书 + 多条金句：金句卡含全部金句（不截断到 2 条）
    const manyBooks: Item[] = []
    for (let i = 0; i < 30; i++) {
      manyBooks.push(mk({
        id: 'mb' + i, title: '书' + i, author: '作者' + i,
        quotes: ['第' + i + '条金句'], rating: 4,
        readingPlace: i % 2 === 0 ? '地点' + i : '',
      }))
    }
    const report30 = generateReport(tpl, manyBooks, '大报告', 2026)
    const quoteCard30 = report30.cards.find(c => c.type === 'quote')!
    // 30 本书每本 1 条金句 = 30 条；循环块应全部渲染
    let quoteCount = 0
    for (const b of manyBooks) {
      if (b.quotes && quoteCard30.content.indexOf(b.quotes[0]) >= 0) quoteCount++
    }
    assert(quoteCount === 30, '30 本书各 1 条金句：金句卡全部渲染（不截断到 2 条），命中 ' + quoteCount + '/30')
    // journey 卡含全部带地点的书（偶数 i 有地点 = 15 本）
    const journeyCard30 = report30.cards.find(c => c.type === 'journey')!
    let journeyCount = 0
    for (const b of manyBooks) {
      if (b.readingPlace && journeyCard30.content.indexOf(b.readingPlace) >= 0) journeyCount++
    }
    assert(journeyCount === 15, '30 本书（15 本带地点）：旅程卡全部渲染带地点的书，命中 ' + journeyCount + '/15')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
