// utils/template-engine.ts
// 模板引擎：把模板里的 {变量} 占位符代入用户数据，生成报告卡片
// 纯函数，不依赖 wx，方便测试和复用
//
// 成就系统主轴下：extractVars 同时计算「书目变量」和「成就变量」两套，并存于同一 map。
// 阅读报告模板用 {bookCount}/{topBook} 等；成就报告模板用 {achievementCount}/{topCategory} 等；
// 混合模板可自由引用任一套变量。这样 8 种卡片类型 + 两套模板族可以无缝复用同一渲染管线。

import { Item, ReportCard, ReportInstance, ReportTemplate, TemplateCardDef } from './storage'
import { calcFootprint, calcQuotes, calcSelectedSummary } from './stats'
import { genId } from './util'
import { getCategoryMeta, resolveCategory } from './category-meta'

/**
 * 把字符串里的 {占位符} 替换成实际值。
 *
 * 支持三种语法（P4 扩展，向后兼容）：
 *   1. 单值占位（原有）：`{varName}` —— 用 vars[varName] 替换；空值保留原样。
 *   2. 条件块（P4）：`{?varName}...content...{/}` —— varName 为空/未定义时整块删除，
 *      否则渲染 content（content 里的普通 {x} 仍替换）。支持嵌套字段的简单判断：
 *      `{?topBook}年度之书：《{topBook}》{/}` —— 没有年度之书时整句消失，不留字面 {topBook}。
 *   3. 循环块（P4）：`{#listVar}...content...{/}` —— listVar 是 vars 里以 `__list__` 前缀
 *      存的对象数组（如 vars['__list__quoteList'] = [{text,book},...]）；循环渲染 content，
 *      每次迭代 content 里的 {field} 取当前元素的属性。数组为空时整块删除。
 *      例：`{#quoteList}「{text}」\n——《{book}》\n\n{/}` —— 有几条金句渲染几条。
 *
 * 条件块和循环块都用 `{/}` 收尾（不区分类型，按开括号类型匹配）。
 * 不支持嵌套同类块（条件里不能再有条件；循环里不能再有循环）——够用且实现简单。
 *
 * @param text 含占位符的模板字符串，如 "你读了 {bookCount} 本书"
 * @param vars 占位符到值的映射，如 { bookCount: 12 }；列表数组用 `__list__` 前缀键存
 * @returns 代入后的字符串；找不到的单值占位符被删除（不留字面 {var}）
 */
export function fillPlaceholders(text: string, vars: Record<string, string | number | object[]>): string {
  // 先处理循环块 {#list}...{/}（必须在单值替换前，因为循环块内有自己的 {field} 命名空间）
  let out = expandBlocks(text, vars, 'loop')
  // 再处理条件块 {?var}...{/}
  out = expandBlocks(out, vars, 'cond')
  // 最后处理剩余的单值占位符 {var}
  // 找不到/空值/数组 → 删除该占位符（不留字面 {var}，避免报告里出现裸花括号）。
  // 模板若想让整段连同前缀文案一起消失，应改用条件块 {?var}...{/} 包裹（块级删除）。
  out = out.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const val = vars[key]
    if (val === undefined || val === null || val === '') return ''
    if (Array.isArray(val)) return ''   // 数组不是单值占位符的合法值，删除
    return String(val)
  })
  return out
}

/** 处理循环块或条件块（按 type 决定匹配哪种开括号）。
 *  用手写扫描而非正则，因为块内可能含 {field} 等花括号，正则难精确匹配最近的 {/}。 */
function expandBlocks(
  text: string,
  vars: Record<string, string | number | object[]>,
  type: 'loop' | 'cond',
): string {
  const openTag = type === 'loop' ? '{#' : '{?'
  const closeTag = '{/}'
  let result = ''
  let i = 0
  while (i < text.length) {
    const openIdx = text.indexOf(openTag, i)
    if (openIdx < 0) {
      result += text.slice(i)
      break
    }
    // 把 openTag 之前的部分原样追加
    result += text.slice(i, openIdx)
    // 找最近的 closeTag（不嵌套同类，取第一个即可）
    const closeIdx = text.indexOf(closeTag, openIdx + openTag.length)
    if (closeIdx < 0) {
      // 没有配对的收尾：开括号本身当作普通文本，继续往后扫
      result += text[openIdx]
      i = openIdx + 1
      continue
    }
    // 提取块名（openTag 后到第一个 } ）
    const afterOpen = text.slice(openIdx + openTag.length)
    const nameEnd = afterOpen.indexOf('}')
    if (nameEnd < 0) {
      result += text[openIdx]
      i = openIdx + 1
      continue
    }
    const name = afterOpen.slice(0, nameEnd).trim()
    // content 是 openTag 结束（nameEnd 后那个 }）到 closeTag 之间
    const contentStart = openIdx + openTag.length + nameEnd + 1
    const content = text.slice(contentStart, closeIdx)

    if (type === 'loop') {
      const listKey = '__list__' + name
      const list = vars[listKey]
      if (Array.isArray(list) && list.length > 0) {
        // 循环渲染：每条元素是对象，content 里的 {field} 取元素属性
        for (const item of list) {
          if (item && typeof item === 'object') {
            result += renderLoopItem(content, item as Record<string, unknown>, vars)
          }
        }
      }
      // 数组为空/不存在：整块删除（什么都不追加）
    } else {
      // 条件块：name 是 vars 里的单值键；非空则渲染 content（递归处理里面的 {field}）
      const val = vars[name]
      const truthy = val !== undefined && val !== null && val !== '' && val !== 0
      if (truthy) {
        result += content.replace(/\{(\w+)\}/g, (match, key: string) => {
          const v = vars[key]
          if (v === undefined || v === null || v === '') return match
          if (Array.isArray(v)) return match
          return String(v)
        })
      }
      // 假值：整块删除
    }

    i = closeIdx + closeTag.length
  }
  return result
}

/** 渲染循环块的单个元素：content 里的 {field} 取 item 的属性；
 *  content 里若有不在 item 的键，回退查 vars（允许循环块里引用全局单值变量）。 */
function renderLoopItem(
  content: string,
  item: Record<string, unknown>,
  vars: Record<string, string | number | object[]>,
): string {
  return content.replace(/\{(\w+)\}/g, (match, key: string) => {
    const itemVal = item[key]
    if (itemVal !== undefined && itemVal !== null && itemVal !== '') {
      return String(itemVal)
    }
    // 回退查全局 vars（让循环块也能引用 {year}/{reportTitle} 等全局变量）
    const globalVal = vars[key]
    if (globalVal !== undefined && globalVal !== null && globalVal !== '' && !Array.isArray(globalVal)) {
      return String(globalVal)
    }
    return match
  })
}

/**
 * 从一组成就里提取成就维度的模板变量（成就系统主轴）。
 * 与书目变量并存于同一 vars map，模板可自由混用。
 *
 * 提供的变量：
 *   achievementCount   总成就数
 *   categoryCount      涉及分类数
 *   topCategory        数量最多的分类（标签名）
 *   topCategoryCount   topCategory 的计数
 *   topCategoryIcon    topCategory 的图标
 *   categoryList       分类列表（标签名，顿号分隔）
 *   firstTimeCount     「第一次」分类的成就数
 *   readingCount       阅读成就数
 *   filmCount          观影成就数
 *   otherCount         非阅读非观影的成就数
 *   dateSpan           跨度天数（最早到最晚）
 *   milestone1         评分最高的成就标题（不限分类；用于"里程碑"卡）
 *   milestone1Note     milestone1 的笔记/理解
 *   milestone2         评分次高的成就标题
 *   milestone3         评分第三的成就标题
 *   recentAchievement  最近的成就标题
 */
export function extractAchievementVars(achievements: Item[]): Record<string, string | number> {
  if (achievements.length === 0) {
    return {
      achievementCount: 0, categoryCount: 0, topCategory: '—', topCategoryCount: 0,
      topCategoryIcon: '🏆', categoryList: '', firstTimeCount: 0,
      readingCount: 0, filmCount: 0, otherCount: 0, dateSpan: 0,
      milestone1: '', milestone1Note: '', milestone2: '', milestone3: '',
      recentAchievement: '',
    }
  }

  // 分类聚合
  const catCounts: { [cat: string]: number } = {}
  for (const it of achievements) {
    const cat = resolveCategory(it.category, it.type)
    catCounts[cat] = (catCounts[cat] || 0) + 1
  }
  const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1])
  const topCategoryEntry = catEntries[0]
  const topCategoryMeta = getCategoryMeta(topCategoryEntry[0])
  const categoryList = catEntries.map(([cat, n]) => `${getCategoryMeta(cat).label} ${n}`).join('、')

  // 分类计数
  const readingCount = achievements.filter(it => resolveCategory(it.category, it.type) === 'reading').length
  const filmCount = achievements.filter(it => it.category === 'film').length
  const firstTimeCount = achievements.filter(it => it.category === 'first').length
  const otherCount = achievements.length - readingCount - filmCount

  // 跨度天数
  const dates = achievements.map(it => it.finishedDate).sort()
  const dateSpan = dates.length > 1
    ? Math.round((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000)
    : 0

  // 里程碑：评分降序取前 3（评分相同按日期降序）
  const byScore = [...achievements].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating
    return a.finishedDate < b.finishedDate ? 1 : a.finishedDate > b.finishedDate ? -1 : 0
  })
  const m1 = byScore[0]
  const m2 = byScore[1]
  const m3 = byScore[2]

  // 最近成就（日期降序第一）
  const byDate = [...achievements].sort((a, b) =>
    a.finishedDate < b.finishedDate ? 1 : a.finishedDate > b.finishedDate ? -1 : 0
  )
  const recent = byDate[0]

  return {
    achievementCount: achievements.length,
    categoryCount: catEntries.length,
    topCategory: topCategoryMeta.label,
    topCategoryCount: topCategoryEntry[1],
    topCategoryIcon: topCategoryMeta.icon,
    categoryList,
    firstTimeCount,
    readingCount,
    filmCount,
    otherCount,
    dateSpan,
    milestone1: m1 ? m1.title : '',
    milestone1Note: m1 ? (m1.understanding || m1.note || '') : '',
    milestone2: m2 ? m2.title : '',
    milestone3: m3 ? m3.title : '',
    recentAchievement: recent ? recent.title : '',
  }
}

/**
 * 从一组书里提取所有可用的模板变量
 * 这是模板代入的数据源——所有占位符对应的真实值都从这里来
 *
 * 成就系统主轴：同时计算「书目变量」和「成就变量」并存于同一 map。
 * 阅读报告模板用书目变量，成就报告模板用成就变量，混合模板可自由引用。
 */
export function extractVars(
  books: Item[],
  reportTitle: string,
  year: number
): Record<string, string | number | object[]> {
  const summary = calcSelectedSummary(books)
  const footprint = calcFootprint(books)
  const quotes = calcQuotes(books)

  // 评分最高 / 年度之书
  const topBook = summary.topBook

  // 主题相关：选取评分最高或最近一本有 understanding 的书作为"主题书"
  const themeBook = books.find(it => it.understanding && it.understanding.trim()) || topBook

  // 地点
  const places = summary.places
  const topPlace = footprint.length > 0 ? footprint[0].place : ''
  const topPlaceCount = footprint.length > 0 ? footprint[0].count : 0

  // 旅程：取前 2 条有地点的书（向后兼容旧模板的单值 place1/book1 等）
  const journeyBooks = books.filter(it => (it.readingPlace || '').trim()).slice(0, 2)

  // 金句：取前 2 条（向后兼容旧模板的 quote1/quote2 单值）
  const quote1 = quotes.length > 0 ? quotes[0] : null
  const quote2 = quotes.length > 1 ? quotes[1] : null

  // P4 列表变量（给循环块 {#list}...{/} 用；记录多时不截断）：
  //   __list__quoteList    全部金句 [{text, book}]
  //   __list__journeyList  全部带地点的书 [{place, book}]
  //   __list__topBooks     全部书按评分降序 [{title, author, note}]
  // 用 __list__ 前缀避免与单值变量命名空间冲突；fillPlaceholders 的循环块按前缀查。
  const quoteList = quotes.map(q => ({ text: q.text, book: q.bookTitle }))
  const journeyList = books
    .filter(it => (it.readingPlace || '').trim())
    .map(it => ({ place: it.readingPlace || '', book: it.title }))
  const topBooks = [...books].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating
    return a.finishedDate < b.finishedDate ? 1 : a.finishedDate > b.finishedDate ? -1 : 0
  }).map(it => ({
    title: it.title,
    author: it.author,
    note: (it.understanding || it.note || '').slice(0, 60),
  }))

  const bookVars: Record<string, string | number | object[]> = {
    // 报告元信息
    reportTitle,
    year,

    // 总览
    bookCount: summary.bookCount,
    avgRating: summary.avgRatingText,
    topGenre: summary.topGenre,
    placeCount: summary.placeCount,

    // 足迹
    places: places.join('、'),
    topPlace,
    topPlaceCount,

    // 年度之书
    topBook: topBook ? topBook.title : '',
    topBookAuthor: topBook ? topBook.author : '',
    topBookNote: topBook ? (topBook.understanding || topBook.note || '') : '',
    // 以下两个 id 字段不作为模板占位符（模板文案用标题），仅供 generateReport 内部关联 bookRef 用，
    // 避免重复标题时用「标题字符串反查 books」关联到错误的书（不同作者的同名作品）。
    topBookId: topBook ? topBook.id : '',

    // 主题
    themeGenre: summary.topGenre,
    themeBook: themeBook ? themeBook.title : '',
    themeSentence: themeBook ? (themeBook.understanding || themeBook.note || '') : '',

    // 旅程（前两条带地点的书）
    place1: journeyBooks.length > 0 ? (journeyBooks[0].readingPlace || '') : '',
    book1: journeyBooks.length > 0 ? journeyBooks[0].title : '',
    book1Id: journeyBooks.length > 0 ? journeyBooks[0].id : '',
    place2: journeyBooks.length > 1 ? (journeyBooks[1].readingPlace || '') : '',
    book2: journeyBooks.length > 1 ? journeyBooks[1].title : '',

    // 金句
    quote1: quote1 ? quote1.text : '',
    quoteBook1: quote1 ? quote1.bookTitle : '',
    quote2: quote2 ? quote2.text : '',
    quoteBook2: quote2 ? quote2.bookTitle : '',

    // P4 列表变量（循环块专用；单值变量已覆盖旧模板）
    '__list__quoteList': quoteList,
    '__list__journeyList': journeyList,
    '__list__topBooks': topBooks,
  }

  // 追加成就变量（并存；books 语义上即"选中的成就"，含阅读成就）
  const achievementVars = extractAchievementVars(books)
  return { ...bookVars, ...achievementVars }
}

/**
 * 判断一张模板卡是否有数据支撑（没有则跳过，避免生成空内容卡）。
 *
 * 叙事骨架卡（cover/overview/theme/ending）永远保留——即使数据少，报告也要有开头总览主题结尾。
 * 数据增强卡（footprint/quote/journey/favorite）只在对应数据存在时生成：
 *   - footprint：需要有阅读地点（placeCount > 0）
 *   - quote：需要有金句（__list__quoteList 非空）
 *   - journey：需要有带地点的书（__list__journeyList 非空）
 *   - favorite：需要有年度之书或里程碑（topBook 或 milestone1 非空）
 * 跳过的卡用户仍可在编辑器里手动加回（report-edit 已有 onAddCardByType）。
 *
 * @param def 模板卡片定义
 * @param vars extractVars 算出的变量 map
 * @returns true = 该卡有数据，应生成；false = 该卡缺数据，跳过
 */
export function cardHasData(def: TemplateCardDef, vars: Record<string, string | number | object[]>): boolean {
  switch (def.type) {
    case 'footprint': {
      const n = vars.placeCount
      return typeof n === 'number' && n > 0
    }
    case 'quote': {
      const list = vars['__list__quoteList']
      return Array.isArray(list) && list.length > 0
    }
    case 'journey': {
      const list = vars['__list__journeyList']
      return Array.isArray(list) && list.length > 0
    }
    case 'favorite': {
      const topBook = vars.topBook
      const milestone1 = vars.milestone1
      const hasTopBook = typeof topBook === 'string' && topBook.length > 0
      const hasMilestone = typeof milestone1 === 'string' && milestone1.length > 0
      return hasTopBook || hasMilestone
    }
    // cover/overview/theme/ending 永远保留
    default:
      return true
  }
}

/**
 * 根据模板 + 书生成完整的报告实例
 * @param template 选用的模板
 * @param books 选中的书
 * @param reportTitle 报告标题（用户输入或默认）
 * @param year 报告年份
 * @returns ReportInstance 实例（卡片文案已代入，用户可在此基础上修改）
 */
export function generateReport(
  template: ReportTemplate,
  books: Item[],
  reportTitle: string,
  year: number
): ReportInstance {
  const vars = extractVars(books, reportTitle, year)

  // 先按数据过滤：跳过没有数据支撑的卡（footprint 无地点、quote 无金句、journey 无旅程、
  // favorite 无年度之书/里程碑）。叙事骨架卡（cover/overview/theme/ending）永远保留。
  const cards: ReportCard[] = template.cards.filter(def => cardHasData(def, vars)).map(def => {
    const title = fillPlaceholders(def.titleTemplate, vars)
    const content = fillPlaceholders(def.contentTemplate, vars)
    const card: ReportCard = {
      type: def.type,
      title: title.trim(),
      content,
      // S4：把模板级 style 预设带到生成的卡片（深拷贝避免引用共享）
      style: def.style ? JSON.parse(JSON.stringify(def.style)) : undefined,
    }
    // 单本书卡片关联 bookRef：用 id 精确关联，避免重复标题时反查命中错误的书。
    if (def.type === 'favorite' && vars.topBookId) {
      card.bookRef = String(vars.topBookId)
    } else if (def.type === 'journey' && vars.book1Id) {
      card.bookRef = String(vars.book1Id)
    }
    return card
  })

  const now = Date.now()
  return {
    id: genId(),
    title: reportTitle,
    templateId: template.id,
    bookIds: books.map(it => it.id),
    cards,
    createdAt: now,
    updatedAt: now,
  }
}
