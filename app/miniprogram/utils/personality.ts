// utils/personality.ts
// 读者/观者人格徽章：基于一年内成就行为自动颁发一枚"人格标签"。
//
// 设计哲学：
//  - 借鉴 Spotify Listening Personality（16 型）+ GitHub Achievement Badges：
//    不让用户自选，按真实行为算，颁完不可改（一年一颁，每年 12 月随 Wrapped 揭晓）。
//  - 4 个维度 × 高/低二态 → 最多 16 种组合，但实际只精选 8 种有故事的标签，
//    其余回退到最接近的一种（避免"查无此格"的尴尬）。
//
// 维度定义（取一年内的 Item[]）：
//  ① 深度 depth   —— 平均每条 note + understanding 字数（笔记狂 vs 速食派）
//  ② 广度 breadth —— 不同 category 数量（跨界派 vs 专注派）
//  ③ 速度 speed   —— 平均读完用时（startDate→finishedDate 的天数）（速读派 vs 深读派）
//  ④ 复读 rewatch —— 同 title 出现 ≥2 次的比例（复读派 vs 猎奇派）
//
// 注意：
//  - 全部纯函数、无副作用、不读 storage（调用方传 items），方便单测和复用。
//  - 维度阈值用经验值（不是动态分位数），保证结果可解释、年年一致。
//  - 数据不足（<5 条）返回 '观察者'（中性兜底，不强行颁奖）。

import { Item } from './storage'
import { resolveCategory } from './category-meta'

/** 4 个维度的原始得分（0-100 归一化后；便于 UI 画雷达图）*/
export interface PersonalityDimensions {
  /** 深度：平均笔记字数 → 0-100（越长分越高）*/
  depth: number
  /** 广度：涉及的不同 category 数 → 0-100（越多分越高）*/
  breadth: number
  /** 速度：平均读完用时（天）→ 0-100（用时越长分越高 = 慢读 = 深读派倾向）*/
  speed: number
  /** 复读：同 title 重复率 → 0-100（重复越多分越高）*/
  rewatch: number
}

/** 人格类型 id（与 i18n 文案解耦；UI 用 meta 查 label/desc/icon）*/
export type PersonalityType =
  | 'deep-reader'    // 深读派：speed 高 + depth 高
  | 'speed-reader'   // 速食派：speed 低 + breadth 高
  | 'cross-bound'    // 跨界派：breadth 高
  | 'rewatcher'      // 复读派：rewatch 高
  | 'note-fanatic'   // 笔记狂：depth 极高
  | 'explorer'       // 猎奇派：rewatch 低 + breadth 高
  | 'focused'        // 专注派：breadth 低 + depth 中
  | 'observer'       // 观察者：数据不足 / 中性兜底

/** 人格元信息（UI 展示用）*/
export interface PersonalityMeta {
  id: PersonalityType
  /** 主标签（如"深读派"）*/
  label: string
  /** 副标签 / 口号（如"慢即是快"）*/
  tagline: string
  /** 代表 emoji（用作徽章主图）*/
  icon: string
  /** 代表色（徽章主色；驱动内联 style）*/
  color: string
  /** 详细描述（一段话讲清楚为什么是这个人格）*/
  desc: string
  /** P3-1 文学化情感文案：叙事性、第二人称、有情感张力，用于 Wrapped 人格幕 / 报告人格卡 / 陈列柜。
   *  与 desc 互补：desc 是「功能解释」，emotionalCopy 是「情感共鸣」。 */
  emotionalCopy: string
}

/**
 * 维度阈值常量（不是动态分位数，保证可解释 + 跨年一致）。
 *
 * 分两类：
 *  - 维度归一化阈值（calcDimensions 用）：把原始度量线性映射到 0-100。
 *  - 分类判定阈值（classifyPersonality 用）：决定某维度是否触发某人格。
 * 以前两类阈值混在同一对象里且大部分未被引用（误导），现拆开并全部接线，
 * 保证注释、常量、代码三处一致——不再有「写了没用」的死常量。
 */
/** 维度归一化阈值：原始度量 → 0-100 分的线性映射参考点。 */
const NORM_THRESHOLDS = {
  /** 深度：平均笔记字数达到此值 → depth 满分 100（线性，封顶）。*/
  depthHigh: 300,
  /** 广度：不同 category 数。1 类→0 分，6 类→100 分（线性，差 5 类跨满）。*/
  breadthFull: 6,
  /** 速度：平均读完天数。0 天→0 分（速读）；42 天→100 分（线性，慢读倾向）。*/
  speedFull: 42,
  /** 复读：重复率。0%→0 分；50%→100 分（线性）。*/
  rewatchFull: 0.5,
}
/** 分类判定阈值（0-100 维度得分 → 触发某人格的下限）。与 classifyPersonality 一一对应。 */
const CLASSIFY_THRESHOLDS = {
  depthNoteFanatic: 80,   // 笔记狂：depth ≥80
  rewatchRewatcher: 40,   // 复读派：rewatch ≥40
  breadthCross: 60,       // 跨界/猎奇派：breadth ≥60
  rewatchExplorerMax: 20, // 猎奇派：rewatch <20（在 breadth ≥60 时二分）
  speedDeep: 50,          // 深读派：speed ≥50
  depthDeepMin: 40,       // 深读派：还要 depth ≥40
  speedSpeedReaderMax: 30,// 速食派：speed <30
  breadthSpeedReaderMin: 40, // 速食派：还要 breadth ≥40
  breadthFocusedMax: 40,  // 专注派：breadth <40
}

/** 数据门槛：少于这个数不颁奖（中性兜底） */
const MIN_ITEMS = 5

/**
 * 计算 4 维原始得分（0-100）。
 * 输入：一年内的 Item[]。
 * 输出：每维一个 0-100 整数；维度越高代表该倾向越强。
 */
export function calcDimensions(items: Item[]): PersonalityDimensions {
  if (!items || items.length === 0) {
    return { depth: 0, breadth: 0, speed: 0, rewatch: 0 }
  }

  // ① 深度：平均每条 (note + understanding) 字数
  let totalChars = 0
  for (const it of items) {
    const noteLen = (it.note || '').length
    const understandLen = (it.understanding || '').length
    totalChars += noteLen + understandLen
  }
  const avgChars = totalChars / items.length
  // 0 字→0 分；depthHigh 字→100 分（线性，封顶）
  const depth = clampPct((avgChars / NORM_THRESHOLDS.depthHigh) * 100)

  // ② 广度：涉及的不同 category 数（含 undefined 回退到 'reading'）
  const cats = new Set<string>()
  for (const it of items) {
    cats.add(resolveCategory(it.category, it.type))
  }
  const catCount = cats.size
  // 1 类→0 分；breadthFull 类→100 分（线性）
  const breadth = clampPct(((catCount - 1) / (NORM_THRESHOLDS.breadthFull - 1)) * 100)

  // ③ 速度：平均读完用时（天）。仅算有 startDate 的条目。
  let durTotal = 0
  let durCount = 0
  for (const it of items) {
    if (it.startDate && it.finishedDate) {
      const days = daysBetween(it.startDate, it.finishedDate)
      if (days >= 0 && days < 365 * 2) {   // 剔除脏数据（负数/超两年）
        durTotal += days
        durCount += 1
      }
    }
  }
  const avgDays = durCount > 0 ? durTotal / durCount : 0
  // 0 天→0 分（速读）；speedFull 天→100 分（线性，慢读倾向）
  const speed = clampPct((avgDays / NORM_THRESHOLDS.speedFull) * 100)

  // ④ 复读：同 title 出现 ≥2 次的条目占比
  const titleCount: { [t: string]: number } = {}
  for (const it of items) {
    const t = (it.title || '').trim()
    if (t) titleCount[t] = (titleCount[t] || 0) + 1
  }
  let rewatchTitles = 0
  let totalTitles = 0
  for (const t of Object.keys(titleCount)) {
    totalTitles += 1
    if (titleCount[t] >= 2) rewatchTitles += 1
  }
  const rewatchRate = totalTitles > 0 ? rewatchTitles / totalTitles : 0
  // 0% → 0 分；rewatchFull（50%）→ 100 分（线性）
  const rewatch = clampPct((rewatchRate / NORM_THRESHOLDS.rewatchFull) * 100)

  return {
    depth: Math.round(depth),
    breadth: Math.round(breadth),
    speed: Math.round(speed),
    rewatch: Math.round(rewatch),
  }
}

/**
 * 把维度得分判成人格类型（主标签）。
 * 判定优先级（避免多维度都高时的歧义）：
 *   1) 数据不足 → observer
 *   2) depth 极高（≥80）→ note-fanatic（笔记狂，覆盖一切）
 *   3) rewatch 高 → rewatcher
 *   4) breadth 高 → cross-bound 或 explorer（按 rewatch 二分）
 *   5) speed 高 + depth 高 → deep-reader
 *   6) speed 低 + breadth 高 → speed-reader
 *   7) breadth 低 → focused
 *   8) 兜底 → observer
 */
export function classifyPersonality(items: Item[]): PersonalityType {
  if (!items || items.length < MIN_ITEMS) return 'observer'

  const d = calcDimensions(items)
  const T = CLASSIFY_THRESHOLDS

  // 1) 笔记狂：depth 极高，覆盖其它一切（笔记本身是行为里最重的信号）
  if (d.depth >= T.depthNoteFanatic) return 'note-fanatic'

  // 2) 复读派：rewatch 显著
  if (d.rewatch >= T.rewatchRewatcher) return 'rewatcher'

  // 3) 跨界派 / 猎奇派：breadth 高时按 rewatch 二分
  if (d.breadth >= T.breadthCross) {
    return d.rewatch < T.rewatchExplorerMax ? 'explorer' : 'cross-bound'
  }

  // 4) 深读派：speed 高 + depth 也偏高
  if (d.speed >= T.speedDeep && d.depth >= T.depthDeepMin) return 'deep-reader'

  // 5) 速食派：speed 低 + breadth 偏高（读得快还跨界）
  if (d.speed < T.speedSpeedReaderMax && d.breadth >= T.breadthSpeedReaderMin) return 'speed-reader'

  // 6) 专注派：breadth 低（领域集中）
  if (d.breadth < T.breadthFocusedMax) return 'focused'

  // 7) 兜底
  return 'observer'
}

/** 人格元信息查找表（与 classifyPersonality 输出对齐） */
const PERSONALITY_META: Record<PersonalityType, PersonalityMeta> = {
  'deep-reader': {
    id: 'deep-reader',
    label: '深读派',
    tagline: '慢即是快',
    icon: '🐢',
    color: '#6B8E5A',
    desc: '你读书不快，但每一本都读到骨头里。一本三周，三周一本书。',
    emotionalCopy: '你是那种会把一本书读三遍、每次都在不同页码停留的人。别人的书单是一列快进的标题，你的书单是一串被翻软了的书脊。',
  },
  'speed-reader': {
    id: 'speed-reader',
    label: '速食派',
    tagline: '阅尽千帆',
    icon: '🏃',
    color: '#E8A33D',
    desc: '你 devour 书的速度让人眼花。类型广、节奏快，图书馆应该给你办 VIP。',
    emotionalCopy: '你像候鸟一样掠过一片又一片文字的田野，不为任何一本停留太久。不是不深情——而是你想在有限的一年里，尽可能多地和这个世界打个照面。',
  },
  'cross-bound': {
    id: 'cross-bound',
    label: '跨界派',
    tagline: '万物皆通',
    icon: '🌈',
    color: '#8B6F9C',
    desc: '你的兴趣没有边界——小说、技能、电影、游戏，一年下来像逛了五座博物馆。',
    emotionalCopy: '你不相信领域之间真的有墙。一本小说接着一本编程书，一部纪录片连着一部推理——你在不同的世界之间搭桥，桥搭多了，自己也就成了路口。',
  },
  'rewatcher': {
    id: 'rewatcher',
    label: '复读派',
    tagline: '温故知新',
    icon: '🔁',
    color: '#D97A4A',
    desc: '好书看一遍不够。你反复回到那些熟悉的标题，每次都读出新东西。',
    emotionalCopy: '你以为自己是在重温旧书，其实是在和曾经的自己重逢。同一本书，二十岁读和三十岁读是两本书——你比谁都清楚这件事。',
  },
  'note-fanatic': {
    id: 'note-fanatic',
    label: '笔记狂',
    tagline: '字字珠玑',
    icon: '✍️',
    color: '#A88B5C',
    desc: '你的笔记比正文还长。每一条成就都附一段心流，一年下来写了一本书。',
    emotionalCopy: '你不是在记录一本书，你是在和它对话。那些密密麻麻的批注，是你留在书页边缘的指纹——多年后翻开，还能认出当时那个被打动的自己。',
  },
  'explorer': {
    id: 'explorer',
    label: '猎奇派',
    tagline: '永远尝鲜',
    icon: '🧭',
    color: '#5B8FA8',
    desc: '你几乎不重读，永远在找下一个新世界。一年里没几个重复标题。',
    emotionalCopy: '你的书架永远在更新，像一个不肯停泊的港口。不是喜新厌旧——是你相信下一个转角还有没见过的风景，而你不想错过任何一次心动。',
  },
  'focused': {
    id: 'focused',
    label: '专注派',
    tagline: '深耕一域',
    icon: '🎯',
    color: '#C26B6B',
    desc: '你的成就高度集中在少数几个领域。挖井不半途，一年凿到水。',
    emotionalCopy: '别人在撒网，你在打井。你知道真正的深度只属于肯在一件事上留下时间的人——这一年你把同一个问题翻来覆去地看，直到看出了别人看不见的东西。',
  },
  'observer': {
    id: 'observer',
    label: '观察者',
    tagline: '静待花开',
    icon: '🌱',
    color: '#8B7D6E',
    desc: '今年的记录还不多，人格还在成型。多记几条，明年这时候再来揭晓。',
    emotionalCopy: '这一年你留白比落笔多，但这没什么不好——有些读者是在沉默里读完一年的。等你准备好的时候，书架会替你说话。',
  },
}

/** 取人格元信息（永远有兜底，不会返回 undefined） */
export function getPersonalityMeta(id: PersonalityType): PersonalityMeta {
  return PERSONALITY_META[id] || PERSONALITY_META['observer']
}

/** 一站式：给一年数据，直接拿到 { 类型 + 元信息 + 四维得分 }（UI 唯一需要的入口）*/
export interface PersonalityResult {
  type: PersonalityType
  meta: PersonalityMeta
  dims: PersonalityDimensions
  /** 数据是否充足（≥MIN_ITEMS）；不足时 UI 可提示"明年再来"*/
  sufficient: boolean
  /** 一年内的成就总数（驱动 UI 文案 + 稀有度计算）*/
  total: number
}

export function analyzePersonality(items: Item[]): PersonalityResult {
  const sufficient = items.length >= MIN_ITEMS
  const type = classifyPersonality(items)
  const dims = calcDimensions(items)
  return {
    type,
    meta: getPersonalityMeta(type),
    dims,
    sufficient,
    total: items.length,
  }
}

/* ============================================================
 * 工具函数
 * ============================================================ */

/** 把 0-100 范围之外的值夹到 [0,100]（线性映射后可能超） */
function clampPct(v: number): number {
  if (v < 0) return 0
  if (v > 100) return 100
  return v
}

/** 算两个 'YYYY-MM-DD' 之间的天数（含当天起算；负值表示 startDate 在 finishedDate 之后，返回原值由调用方剔除）*/
function daysBetween(startStr: string, endStr: string): number {
  const start = parseYMD(startStr)
  const end = parseYMD(endStr)
  if (!start || !end) return -1
  const MS = 24 * 60 * 60 * 1000
  return Math.round((end.getTime() - start.getTime()) / MS)
}

/** 'YYYY-MM-DD' → Date（本地中午，避免 DST 漂移）*/
function parseYMD(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (isNaN(y) || isNaN(mo) || isNaN(d)) return null
  return new Date(y, mo - 1, d, 12, 0, 0, 0)
}
