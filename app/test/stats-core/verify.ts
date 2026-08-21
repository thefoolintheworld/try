/**
 * stats-core 验证脚本：覆盖 stats.ts 关键纯函数
 *
 * 重点：刚改过的 calcCurrentStreak 拆分（Strict/Lenient）、calcAnnualKeywords 滑窗切词、
 * calcOverview/calcQuotes/calcMoodStats/calcAuthorStats 的边界。
 * 纯函数测试——注入 wx mock 只为让 storage 模块级代码加载不炸。
 */
import {
  calcOverview,
  calcLongestStreak,
  calcCurrentStreakStrict,
  calcCurrentStreakLenient,
  countByCategory,
  calcGenreStats,
  calcMonthlyStats,
  calcRatingDist,
  calcTopItems,
  calcQuotes,
  calcAuthorStats,
  calcSingleAuthor,
  calcAnnualKeywords,
  calcMoodStats,
  topMood,
} from '../../miniprogram/utils/stats'
import { Item } from '../../miniprogram/utils/storage'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

/** 造一条 Item（最小必填 + 可覆盖）。 */
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
    createdAt: over.createdAt ?? Date.now(),
    ...over,
  } as Item
}

function runAll(): boolean {
  console.log('=== calcOverview ===')
  {
    const o = calcOverview([])
    assert(o.total === 0 && o.avgRatingText === '0.0', '空数组 → total=0 avgText=0.0')
    assert(o.bookCount === 0 && o.filmCount === 0 && o.longestStreak === 0, '空数组所有计数为 0')

    const items = [
      mk({ type: 'book', rating: 4, finishedDate: '2026-08-01' }),
      mk({ type: 'book', rating: 5, finishedDate: '2026-08-02' }),
      mk({ type: 'film', rating: 0, finishedDate: '2026-08-02' }),  // 同日 0 分
    ]
    const o2 = calcOverview(items)
    assert(o2.total === 3, 'total = 3')
    assert(o2.bookCount === 2 && o2.filmCount === 1, 'bookCount=2 filmCount=1')
    // 平均分只算 rating>0 的（与 calcAuthorStats 同口径），即 (4+5)/2 = 4.5
    assert(o2.avgRatingText === '4.5', 'avgRating 只算 rating>0：(4+5)/2 = 4.5')
    assert(o2.avgRating === 4.5, 'avgRating 浮点 = 4.5')
    assert(o2.uniqueDays === 2, 'uniqueDays = 2（8-01 + 8-02）')
    assert(o2.longestStreak === 2, 'longestStreak = 2（8-01, 8-02 连续）')

    // 全 0 分：avgRating 应为 0 且 text 为 '0.0'
    const allZero = [mk({ rating: 0 }), mk({ rating: 0 })]
    const o3 = calcOverview(allZero)
    assert(o3.avgRating === 0 && o3.avgRatingText === '0.0', '全 0 分 → avgRating=0, text=0.0')
  }

  console.log('=== calcLongestStreak ===')
  {
    assert(calcLongestStreak([]) === 0, '空 → 0')
    assert(calcLongestStreak(['2026-08-01']) === 1, '单日 → 1')
    assert(calcLongestStreak(['2026-08-01', '2026-08-01']) === 1, '同日去重 → 1')
    assert(calcLongestStreak(['2026-08-01', '2026-08-02', '2026-08-03']) === 3, '连续 3 天 → 3')
    assert(calcLongestStreak(['2026-08-01', '2026-08-03', '2026-08-04']) === 2, '中间断 → 取最长段 2')
    // 乱序输入应仍正确（内部排序）
    assert(calcLongestStreak(['2026-08-03', '2026-08-01', '2026-08-02']) === 3, '乱序输入 → 仍 3')
    // 跨月跨年
    assert(calcLongestStreak(['2026-12-31', '2027-01-01']) === 2, '跨年 12-31 → 01-01 → 2')
  }

  console.log('=== calcCurrentStreakStrict（今天没记录就归 0）===')
  {
    // 注意：本测试依赖「今天」实际日期。用今天/昨天构造数据。
    const today = new Date()
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
    const todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate())
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
    d.setDate(d.getDate() - 1)
    const yesterdayStr = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

    assert(calcCurrentStreakStrict([]) === 0, 'Strict 空 → 0')
    assert(calcCurrentStreakStrict([yesterdayStr]) === 0, 'Strict 只有昨天 → 0（今天必须有）')
    assert(calcCurrentStreakStrict([todayStr]) === 1, 'Strict 只有今天 → 1')
    // 今天 + 连续往回 4 天
    const dates: string[] = [todayStr]
    for (let i = 1; i <= 4; i++) {
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
      t.setDate(t.getDate() - i)
      dates.push(t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()))
    }
    assert(calcCurrentStreakStrict(dates) === 5, 'Strict 今天+4 天往回 → 5')
  }

  console.log('=== calcCurrentStreakLenient（昨天也算，打卡宽容）===')
  {
    const today = new Date()
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
    const todayStr = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate())
    const mkD = (delta: number) => {
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
      t.setDate(t.getDate() + delta)
      return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate())
    }
    const yesterdayStr = mkD(-1)
    const twoDaysAgoStr = mkD(-2)

    assert(calcCurrentStreakLenient([]) === 0, 'Lenient 空 → 0')
    assert(calcCurrentStreakLenient([todayStr]) === 1, 'Lenient 今天 → 1')
    assert(calcCurrentStreakLenient([yesterdayStr]) === 1, 'Lenient 只有昨天 → 1（宽容）')
    assert(calcCurrentStreakLenient([twoDaysAgoStr]) === 0, 'Lenient 只有前天 → 0（昨天今天都没）')
    assert(calcCurrentStreakLenient([yesterdayStr, todayStr]) === 2, 'Lenient 昨+今 → 2')
    assert(calcCurrentStreakLenient([twoDaysAgoStr, yesterdayStr]) === 2, 'Lenient 前天+昨天（今天没打）→ 2 宽容救回')
  }

  console.log('=== countByCategory ===')
  {
    assert(Object.keys(countByCategory([])).length === 0, '空 → 空对象')
    const items = [
      mk({ category: 'reading' }),
      mk({ category: 'reading' }),
      mk({ category: 'film' }),
      mk({ category: undefined, type: 'film' }),  // 缺分类的 film 应归 'film'
      mk({ category: undefined, type: 'book' }),  // 缺分类的 book 应归 'reading'
    ]
    const c = countByCategory(items)
    assert(c['reading'] === 3, 'reading=3（含 2 显式 + 1 缺省 book）')
    assert(c['film'] === 2, 'film=2（含 1 显式 + 1 缺省 film）')
  }

  console.log('=== calcGenreStats ===')
  {
    assert(calcGenreStats([]).length === 0, '空 → 空数组')
    const items = [
      mk({ genre: '科幻' }), mk({ genre: '科幻' }), mk({ genre: '小说' }),
      mk({ genre: '' }),  // 空 genre 应回退「未分类」
    ]
    const g = calcGenreStats(items, 6)
    assert(g[0].name === '科幻' && g[0].count === 2, '科幻 top1 count=2')
    const hasUnset = g.some(x => x.name === '未分类')
    assert(hasUnset, '空 genre → 未分类 收录')
  }

  console.log('=== calcMonthlyStats ===')
  {
    assert(calcMonthlyStats([]).length === 0, '空 → 空')
    const items = [
      mk({ finishedDate: '2026-01-15' }),
      mk({ finishedDate: '2026-01-20' }),
      mk({ finishedDate: '2026-08-01' }),
    ]
    const m = calcMonthlyStats(items)
    const jan = m.find(x => x.month === 1)
    assert(!!jan && jan.count === 2, '1 月 count=2')
    const aug = m.find(x => x.month === 8)
    assert(!!aug && aug.count === 1, '8 月 count=1')
  }

  console.log('=== calcRatingDist ===')
  {
    const items = [
      mk({ rating: 5 }), mk({ rating: 5 }), mk({ rating: 4 }), mk({ rating: 0 }),
    ]
    const d = calcRatingDist(items)
    const five = d.find(x => x.rating === 5)
    assert(!!five && five.count === 2, '5 分 count=2')
    // 0 分应被过滤（未评分不计入分布）
    const zero = d.find(x => x.rating === 0)
    assert(!zero, '0 分不计入分布')
  }

  console.log('=== calcTopItems / calcQuotes ===')
  {
    const items = [
      mk({ id: 'a', rating: 5, title: '高分书' }),
      mk({ id: 'b', rating: 3, title: '中分书', quotes: ['金句一', '  金句二  '] }),
      mk({ id: 'c', rating: 4, title: '无金句书', quotes: [] }),
    ]
    const top = calcTopItems(items, 2)
    assert(top.length === 2 && top[0].id === 'a', 'Top2 按评分降序，第一是 a')
    const q = calcQuotes(items)
    assert(q.length === 2, 'calcQuotes 拍平 2 条')
    assert(q[0].text === '金句一' && q[0].bookTitle === '中分书', '第一条带来源')
    assert(q[1].text === '金句二', '第二条 trim 后无前后空格')
  }

  console.log('=== calcAuthorStats / calcSingleAuthor ===')
  {
    const items = [
      mk({ author: '张三', rating: 4, finishedDate: '2026-01-01', title: '甲' }),
      mk({ author: '张三', rating: 5, finishedDate: '2026-02-01', title: '乙' }),
      mk({ author: '  ', rating: 5, title: '丙' }),  // 空 author 应跳过
      mk({ author: '李四', rating: 0, finishedDate: '2026-03-01', title: '丁' }),
    ]
    const stats = calcAuthorStats(items)
    assert(stats.length === 2, '两位有效作者（空 author 跳过）')
    const zs = stats.find(s => s.author === '张三')!
    assert(zs.count === 2, '张三 count=2')
    assert(zs.avgRating === 4.5, '张三 avgRating=4.5')
    // 作品按完成日降序（最新在前）
    assert(zs.books[0].title === '乙' && zs.books[1].title === '甲', '作品按完成日降序')
    const ls = stats.find(s => s.author === '李四')!
    assert(ls.avgRating === 0, '李四只有 0 分作品 → avgRating=0')
    // calcSingleAuthor
    assert(calcSingleAuthor(items, '张三')?.count === 2, 'calcSingleAuthor 找到张三')
    assert(calcSingleAuthor(items, '不存在') === null, 'calcSingleAuthor 找不到 → null')
    assert(calcSingleAuthor(items, '') === null, 'calcSingleAuthor 空 author → null')
  }

  console.log('=== calcAnnualKeywords（新滑窗切词）===')
  {
    // 数据 <3 直接返空
    assert(calcAnnualKeywords([mk({})]).length === 0, '<3 条 → 空数组')
    // 3 条同分类 → 至少返回该分类的气质词
    const items3 = [
      mk({ category: 'reading' }), mk({ category: 'reading' }), mk({ category: 'reading' }),
    ]
    const kw = calcAnnualKeywords(items3)
    assert(kw.length > 0 && kw.length <= 5, '3 条同分类 → 返回 1-5 个候选')
    assert(kw.some(w => w === '阅读' || w === '沉静' || w === '思辨'), '包含 reading 气质词')

    // 滑窗切词：长段「深度思考」应能切出「深度/思考」候选（旧版会整段丢弃）
    const itemsWithLong = [
      mk({ note: '这本书让我深度思考了很多问题' }),
      mk({ note: '深度思考是稀缺能力' }),
      mk({ note: '我们都该练习深度思考' }),
    ]
    const kw2 = calcAnnualKeywords(itemsWithLong)
    // 「深度」和「思考」应都被切出来并出现 ≥2 次
    const hasDepth = kw2.includes('深度') || kw2.includes('思考')
    assert(hasDepth, '滑窗从「深度思考」切出 实词（旧版会整段丢）')
  }

  console.log('=== calcMoodStats / topMood ===')
  {
    assert(calcMoodStats([]).length === 0, '空 → 空')
    const items = [
      mk({ mood: '平静' }), mk({ mood: '平静' }), mk({ mood: '振奋' }),
      mk({ mood: '' }), mk({ mood: undefined }),  // 无心境不计
    ]
    const ms = calcMoodStats(items)
    assert(ms.length === 2, '两种心境')
    assert(ms[0].mood === '平静' && ms[0].count === 2, '主导心境=平静 count=2')
    // ratio 是占「有心境总数」的比例
    const pingjing = ms.find(m => m.mood === '平静')!
    const total = ms.reduce((s, m) => s + m.count, 0)
    assert(Math.abs(pingjing.ratio - 2 / total) < 0.001, 'ratio = count/有心境总数')

    const top = topMood(items)
    assert(!!top && top.mood === '平静', 'topMood = 平静')
    assert(topMood([mk({ mood: '' })]) === null, '全无心境 → topMood null')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
