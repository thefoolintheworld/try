// utils/wrapped-poster.ts
// Wrapped 年度回顾 → ReportInstance 转换器：把五幕叙事数据映射成海报卡片。
//
// 设计目标（强化分享传播）：
//   - 与普通报告明确区分的专属视觉：全屏渐变背景 + 大号数字 + 人格色 + 富文本段落。
//   - 复用现有 poster.ts 的 drawCard + TextSegment + ArtFontStyle 管线，不重写富文本。
//   - 五张卡对应五幕：开场大数字 / Top 榜单 / 人格徽章 / 稀有度 / 年度总结。
//   - 卡片配色用 WrappedData 里已有的数据驱动（人格色 / 分类色），不硬编码。
//
// 合规：纯本地数据拼接，无 AI、无外部服务。

import { ReportInstance, ReportCard, TextSegment } from './storage'
import { CardStyle } from './design-tokens'
import {
  WrappedData,
  ActOpening,
  ActTopLists,
  ActPersonality,
  ActRarity,
  ActSummary,
} from './wrapped'
import { loadWrapped } from './wrapped'
import { designTokens } from './design-tokens'

/** Wrapped 海报专属卡片样式工厂：每张卡一个独立的视觉风格。 */

// 开场大数字：暖橙→暖紫渐变（仪式感开场）
function openingStyle(): CardStyle {
  return {
    bgType: 'gradient',
    bgGradient: [designTokens.color.accent, designTokens.color.film],
    textColor: '#FFFFFF',
    titleColor: '#FFFFFF',
    textAlign: 'center',
    fontSizeScale: 1.1,
    padding: 90,
  }
}

// Top 榜单：暖白底（让榜单条清晰可读）
function topListsStyle(): CardStyle {
  return {
    bgType: 'color',
    bgColor: designTokens.color.card,
    textColor: designTokens.color.textPrimary,
    titleColor: designTokens.color.accent,
    textAlign: 'left',
    fontSizeScale: 0.95,
    padding: 80,
  }
}

// 人格徽章：人格色全屏渐变（用人格对应的色相；此处用 accent 作通用底，页面层可覆）
function personalityStyle(): CardStyle {
  return {
    bgType: 'gradient',
    bgGradient: [designTokens.color.book, designTokens.color.film],
    textColor: '#FFFFFF',
    titleColor: '#FFFFFF',
    textAlign: 'center',
    fontSizeScale: 1.15,
    padding: 90,
  }
}

// 稀有度：深色底（衬托「稀有」「独特」的神秘感）
function rarityStyle(): CardStyle {
  return {
    bgType: 'color',
    bgColor: '#2C2A28',  // 与 achv-stars 星辉预设同色，呼应「星空稀有」氛围
    textColor: '#F5C26B', // 星辉金
    titleColor: '#F5C26B',
    textAlign: 'center',
    fontSizeScale: 1.1,
    padding: 90,
  }
}

// 年度总结：暖纸纹底（收尾的温暖感）
function summaryStyle(): CardStyle {
  return {
    bgType: 'color',
    bgColor: designTokens.color.bg,
    textColor: designTokens.color.textPrimary,
    titleColor: designTokens.color.accent,
    textAlign: 'center',
    fontSizeScale: 1,
    padding: 85,
  }
}

/* ============================================================
 * 五幕 → 五张卡的转换
 * ============================================================ */

/** Act 1 开场大数字卡 */
function buildOpeningCard(act: ActOpening): ReportCard {
  const segments: TextSegment[] = [
    { text: '我的 ' + act.year + ' 年度回顾', style: { fontSizeScale: 0.7, align: 'center' } },
    { text: '', style: {} }, // 空行分隔
    { text: String(act.total), style: { fontSizeScale: 3.5, align: 'center', artFont: 'gradient', gradientTo: '#F5D5A8' } },
    { text: '个成就', style: { fontSizeScale: 1.2, align: 'center' } },
    { text: '', style: {} },
    { text: buildOpeningSubtitle(act), style: { fontSizeScale: 0.65, align: 'center' } },
  ]
  return {
    type: 'cover',
    title: act.year + ' 年度回顾',
    content: segments.map(s => s.text).join('\n'),
    segments,
    style: openingStyle(),
  }
}

function buildOpeningSubtitle(act: ActOpening): string {
  const parts: string[] = []
  if (act.bookCount > 0) parts.push('读了 ' + act.bookCount + ' 本')
  if (act.filmCount > 0) parts.push('看了 ' + act.filmCount + ' 部')
  if (act.otherCount > 0) parts.push('记录 ' + act.otherCount + ' 件')
  const sub = parts.join(' · ') || '这一年'
  return sub + '\n平均评分 ' + act.avgRatingText + ' · 最长连续 ' + act.longestStreak + ' 天'
}

/** Act 2 Top 榜单卡 */
function buildTopListsCard(act: ActTopLists): ReportCard {
  const segments: TextSegment[] = [
    { text: '这一年，你最常沉浸的方向', style: { fontSizeScale: 0.7, align: 'left' } },
    { text: '', style: {} },
  ]
  // 分类排行（前 3）
  act.topCategories.slice(0, 3).forEach((cat, i) => {
    segments.push({
      text: (i + 1) + '. ' + cat.label + ' ' + cat.icon + '  ×' + cat.count,
      style: { fontSizeScale: 0.85, align: 'left' },
    })
  })
  // 最高分一条
  if (act.topRated.length > 0) {
    const top = act.topRated[0]
    segments.push({ text: '', style: {} })
    segments.push({
      text: '最高分 · ' + top.title + ' ' + String(top.rating) + '★',
      style: { fontSizeScale: 0.8, align: 'left' },
    })
  }
  // 最活跃月份
  if (act.peakMonth) {
    segments.push({
      text: '最拼的月份 · ' + act.peakMonth.month + ' 月（' + act.peakMonth.count + ' 条）',
      style: { fontSizeScale: 0.8, align: 'left' },
    })
  }
  return {
    type: 'overview',
    title: '年度榜单',
    content: segments.map(s => s.text).join('\n'),
    segments,
    style: topListsStyle(),
  }
}

/** Act 3 人格徽章卡 */
function buildPersonalityCard(act: ActPersonality): ReportCard {
  const label = act.meta ? act.meta.label : '读者'
  const dims = act.dims
  const emotional = act.meta && act.meta.emotionalCopy ? act.meta.emotionalCopy : ''
  const segments: TextSegment[] = [
    { text: '你的读者人格', style: { fontSizeScale: 0.7, align: 'center' } },
    { text: '', style: {} },
    { text: label, style: { fontSizeScale: 2.4, align: 'center', artFont: 'glow' } },
    { text: '', style: {} },
  ]
  // 文学化情感文案（比干巴巴的维度数字更适合分享传播）
  if (emotional) {
    // 长文案拆两句换行，视觉透气
    const lines = emotional.length > 40 ? emotional.split('。').filter(s => s.trim()).map(s => s + '。') : [emotional]
    lines.forEach(line => {
      segments.push({ text: line, style: { fontSizeScale: 0.62, align: 'center' } })
    })
    segments.push({ text: '', style: {} })
  }
  if (dims) {
    segments.push({
      text: '深度 ' + dims.depth + ' · 广度 ' + dims.breadth + '\n速度 ' + dims.speed + ' · 重温 ' + dims.rewatch,
      style: { fontSizeScale: 0.55, align: 'center' },
    })
  }
  return {
    type: 'theme',
    title: '读者人格 · ' + label,
    content: segments.map(s => s.text).join('\n'),
    segments,
    style: personalityStyle(),
  }
}

/** Act 4 稀有度卡 */
function buildRarityCard(act: ActRarity): ReportCard {
  const segments: TextSegment[] = [
    { text: '在所有的读者里', style: { fontSizeScale: 0.7, align: 'center' } },
    { text: '', style: {} },
    { text: '前 ' + act.topPercent + '%', style: { fontSizeScale: 2.8, align: 'center', artFont: 'metallic' } },
    { text: '', style: {} },
    { text: act.sentence, style: { fontSizeScale: 0.8, align: 'center' } },
  ]
  return {
    type: 'favorite',
    title: '稀有度',
    content: segments.map(s => s.text).join('\n'),
    segments,
    style: rarityStyle(),
  }
}

/** Act 5 年度总结卡。
 *  year 由 wrappedToReport 透传（来自 WrappedData.year），用真实回顾年份而非「当前」年份——
 *  否则跨年查看历史回顾时会显示错年份（如 2026 年初看 2025 回顾，文案会变成「这是我的 2026 年」）。 */
function buildSummaryCard(act: ActSummary, year: number): ReportCard {
  const segments: TextSegment[] = [
    { text: '这是我的 ' + year + ' 年', style: { fontSizeScale: 0.75, align: 'center' } },
    { text: '', style: {} },
  ]
  if (act.keywords.length > 0) {
    segments.push({
      text: act.keywords.join(' · '),
      style: { fontSizeScale: 1.1, align: 'center', artFont: 'handwritten' },
    })
    segments.push({ text: '', style: {} })
  }
  // 年度主导心境：给总结幕一句情感锚点（无心境数据则跳过）
  if (act.topMood) {
    segments.push({
      text: '这一年你的底色是「' + act.topMood.mood + '」',
      style: { fontSizeScale: 0.8, align: 'center', color: '#8B7D6E' },
    })
    segments.push({ text: '', style: {} })
  }
  if (act.highlight) {
    const hl = act.highlight
    segments.push({
      text: '最难忘 ·《' + hl.title + '》',
      style: { fontSizeScale: 0.85, align: 'center' },
    })
    if (hl.note) {
      const notePreview = hl.note.length > 40 ? hl.note.slice(0, 40) + '…' : hl.note
      segments.push({
        text: '「' + notePreview + '」',
        style: { fontSizeScale: 0.7, align: 'center' },
      })
    }
  }
  segments.push({ text: '', style: {} })
  segments.push({
    text: '—— 敬这一年读过的每一页',
    style: { fontSizeScale: 0.65, align: 'center' },
  })
  return {
    type: 'ending',
    title: '年度总结',
    content: segments.map(s => s.text).join('\n'),
    segments,
    style: summaryStyle(),
  }
}

/* ============================================================
 * 主入口：WrappedData → ReportInstance
 * ============================================================ */

/** 把 WrappedData 五幕转成 5 张海报卡片（ReportInstance）。
 *  poster.ts 接到这个对象后，走与普通报告完全相同的 drawCard + 长图拼接 + 存相册流程。 */
export function wrappedToReport(data: WrappedData): ReportInstance {
  const cards: ReportCard[] = [
    buildOpeningCard(data.opening),
    buildTopListsCard(data.topLists),
    buildPersonalityCard(data.personality),
    buildRarityCard(data.rarity),
    buildSummaryCard(data.summary, data.year),
  ]
  return {
    id: 'wrapped-' + data.year,
    title: data.year + ' 年度回顾',
    templateId: 'wrapped',
    bookIds: [],
    cards,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 便捷封装：直接按年份加载 WrappedData 并转成 ReportInstance。
 *  poster.ts 的 wrappedYear 分支调这个即可。 */
export function loadWrappedReport(year: number): ReportInstance | null {
  const data = loadWrapped(year)
  if (!data.sufficient) return null
  return wrappedToReport(data)
}

// 显式导出 Act 类型，避免 wrapped-poster 的消费者重复 import（TS tree-shake 友好）
export type { ActOpening, ActTopLists, ActPersonality, ActRarity, ActSummary }
