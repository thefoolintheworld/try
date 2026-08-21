// utils/insights.ts
// P2-5 自动元数据洞察：从 Item.createdAt（毫秒时间戳）派生"时段/星期"洞察，
// 给 stats 页加"你最常在深夜阅读"之类的趣味结论。
//
// 设计：
//   - 零字段改动：不引入新存储字段，直接复用 Item.createdAt（addItem 时已写入）。
//   - createdAt 反映"录入时刻"——在小程序语境里≈"完成/记录时刻"，足以推导阅读节律。
//   - 所有函数纯函数、无 wx 依赖，方便测试与海报页复用（与 stats.ts 同样的设计纪律）。

import { Item } from './storage'

/** 把小时（0-23）映射到 4 个时段标签 */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export const TIME_OF_DAY_META: { [k in TimeOfDay]: { label: string; emoji: string } } = {
  morning: { label: '清晨', emoji: '🌅' },     // 5-11
  afternoon: { label: '午后', emoji: '☀️' },   // 12-17
  evening: { label: '夜晚', emoji: '🌆' },     // 18-22
  night: { label: '深夜', emoji: '🌙' },       // 23-4
}

/** 把 Date 的 getHours() 返回值映射到时段 */
export function hourToTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 17) return 'afternoon'
  if (hour >= 18 && hour <= 22) return 'evening'
  return 'night'   // 23-4
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 从时间戳取星期标签（中文） */
export function weekdayLabel(ts: number): string {
  const d = new Date(ts)
  const idx = d.getDay()
  return WEEKDAY_LABELS[idx] || ''
}

/** 时段统计视图（给洞察用） */
export interface TimeStats {
  timeOfDay: TimeOfDay
  label: string
  emoji: string
  count: number
}

/** 洞察条目（stats 页一行一条） */
export interface InsightView {
  key: string
  emoji: string
  text: string   // 完整文案，直接显示
}

/** 按时段聚合计数（返回 4 条，按 count 降序） */
export function calcTimeOfDayStats(items: Item[]): TimeStats[] {
  const counts: { [k in TimeOfDay]: number } = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  for (const it of items) {
    if (typeof it.createdAt !== 'number' || !isFinite(it.createdAt)) continue
    const tod = hourToTimeOfDay(new Date(it.createdAt).getHours())
    counts[tod] += 1
  }
  const result: TimeStats[] = (Object.keys(counts) as TimeOfDay[]).map(k => ({
    timeOfDay: k,
    label: TIME_OF_DAY_META[k].label,
    emoji: TIME_OF_DAY_META[k].emoji,
    count: counts[k],
  }))
  return result.sort((a, b) => b.count - a.count)
}

/** 推导洞察列表（给 stats 页用）。
 *  - 数据量 <5 不出洞察（避免样本太小硬凑结论）
 *  - 返回的洞察都是"有信号"的：占比 ≥40% 或明显极端才显示，否则返回空。
 *  - 文案偏"文学化观察"，不是冷冰冰的数字报表。 */
export function calcInsights(items: Item[]): InsightView[] {
  if (!items || items.length < 5) return []
  const validItems = items.filter(it => typeof it.createdAt === 'number' && isFinite(it.createdAt))
  if (validItems.length < 5) return []

  const insights: InsightView[] = []
  const total = validItems.length

  // 1. 时段洞察（最集中的时段）
  const todStats = calcTimeOfDayStats(validItems)
  const topTod = todStats[0]
  if (topTod && topTod.count > 0) {
    const ratio = topTod.count / total
    if (ratio >= 0.4) {
      const meta = TIME_OF_DAY_META[topTod.timeOfDay]
      // 深夜特别给文学化措辞
      const text = topTod.timeOfDay === 'night'
        ? '你最常在深夜记录——' + meta.emoji + ' 那是属于你自己的安静时刻。'
        : topTod.timeOfDay === 'morning'
          ? '你最常在清晨记录——' + meta.emoji + ' 一日之计，你把最好的状态留给了它。'
          : topTod.timeOfDay === 'evening'
            ? '你最常在夜晚记录——' + meta.emoji + ' 卸下白日后，记忆才刚刚开始。'
            : '你最常在午后记录——' + meta.emoji + ' 阳光正好的时候，你最容易被打动。'
      insights.push({ key: 'timeOfDay', emoji: meta.emoji, text })
    }
  }

  // 2. 星期洞察（最活跃的星期几）
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const it of validItems) {
    const idx = new Date(it.createdAt).getDay()
    if (idx >= 0 && idx <= 6) weekdayCounts[idx] += 1
  }
  let topWeekdayIdx = -1
  let topWeekdayCount = 0
  for (let i = 0; i < 7; i++) {
    if (weekdayCounts[i] > topWeekdayCount) {
      topWeekdayCount = weekdayCounts[i]
      topWeekdayIdx = i
    }
  }
  if (topWeekdayIdx >= 0 && topWeekdayCount / total >= 0.25) {
    const isWeekend = topWeekdayIdx === 0 || topWeekdayIdx === 6
    const label = WEEKDAY_LABELS[topWeekdayIdx]
    const text = isWeekend
      ? '你的「' + label + '」最高产——闲暇让人有心情记录。'
      : '你的「' + label + '」最高产——再忙你也愿意为它停下。'
    insights.push({ key: 'weekday', emoji: '🗓️', text })
  }

  // 3. 夜猫子 vs 早起鸟（极端时段占比 ≥30% 才显示）
  // 不用可选链 ?. —— 真机运行时（旧基础库 / IDE 转译）在某些路径下不支持 ES2020 语法，
  // 会抛 "Unexpected token ."。这里用显式查找 + 兜底改写，行为等价。
  const nightEntry = todStats.find(t => t.timeOfDay === 'night')
  const morningEntry = todStats.find(t => t.timeOfDay === 'morning')
  const nightCount = (nightEntry && nightEntry.count) || 0
  const morningCount = (morningEntry && morningEntry.count) || 0
  if (nightCount / total >= 0.3 && nightCount > morningCount) {
    insights.push({ key: 'nightOwl', emoji: '🦉', text: '夜猫子认证：深夜是你的灵感时段。' })
  } else if (morningCount / total >= 0.3 && morningCount > nightCount) {
    insights.push({ key: 'earlyBird', emoji: '🐦', text: '早起鸟认证：清晨是你的高光时段。' })
  }

  // 4. 心境洞察：主导心境 + 心境与时段的交叉（如「深夜多沉思」）
  //    仅统计填了 mood 的条目；主导心境占比 ≥40% 才显示。
  const moodItems = validItems.filter(it => (it.mood || '').trim())
  if (moodItems.length >= 5) {
    const moodFreq = new Map<string, number>()
    moodItems.forEach(it => {
      const m = (it.mood || '').trim()
      moodFreq.set(m, (moodFreq.get(m) || 0) + 1)
    })
    const moodEntries = Array.from(moodFreq.entries()).sort((a, b) => b[1] - a[1])
    const [topMoodWord, topMoodCount] = moodEntries[0]
    const moodTotal = moodItems.length
    if (topMoodCount / moodTotal >= 0.4) {
      insights.push({
        key: 'topMood',
        emoji: '💫',
        text: '你这一年最常标记的心境是「' + topMoodWord + '」——占据了 ' + Math.round(topMoodCount / moodTotal * 100) + '% 的记录。',
      })
    }
    // 心境 × 深夜 交叉：若主导心境在深夜占比明显高于白天，给一句文学化观察
    if (moodEntries.length >= 1 && nightCount >= 3) {
      const nightMoodItems = moodItems.filter(it => {
        const tod = hourToTimeOfDay(new Date(it.createdAt).getHours())
        return tod === 'night'
      })
      const nightMoodFreq = new Map<string, number>()
      nightMoodItems.forEach(it => {
        const m = (it.mood || '').trim()
        nightMoodFreq.set(m, (nightMoodFreq.get(m) || 0) + 1)
      })
      const nightTop = Array.from(nightMoodFreq.entries()).sort((a, b) => b[1] - a[1])[0]
      if (nightTop && nightTop[1] >= 3 && nightTop[0] !== topMoodWord) {
        insights.push({
          key: 'nightMood',
          emoji: '🌙',
          text: '深夜时分，你的心境更常是「' + nightTop[0] + '」——夜晚把柔软的部分留给了你。',
        })
      }
    }
  }

  return insights
}
