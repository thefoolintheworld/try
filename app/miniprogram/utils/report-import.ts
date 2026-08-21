// utils/report-import.ts
// 报告文案导入 + 粗略排版（第二批功能 5）。
//
// 设计：
//   - 用户把已经写好的文案粘贴进文本框，本模块做「第一次粗略排版」：
//     按段落结构切成多张卡片，每张卡的正文按行切成 TextSegment 段落富文本。
//   - 纯启发式（非 AI），规则简单透明：
//       1. 按「连续两个以上换行」（空行）切成卡片段。
//       2. 首段短（≤20 字、无句号）→ 当作标题，并到下一张卡或独立成 cover 卡。
//       3. 每张卡按单换行 \n 切段 → 每行一个 TextSegment。
//       4. 卡片 type 轻量推断：含「金句/摘录/引用」字样 → quote；书名号《》≥2 → favorite；否则 theme。
//       5. 首卡强制 cover（用用户填的标题）；末卡强制 ending（自动加日期落款）。
//   - 生成的 ReportInstance 直接构造 segments 数组（不走 template-engine），
//     report-edit 的 buildSegmentViews 已支持「有 segments 按 segments 渲染」。
//   - 合规：不调用任何外部 AI 服务，纯本地字符串处理（符合 AGENTS.md 边界）。

import { ReportInstance, ReportCard, TextSegment, CardType } from './storage'
import { genId, formatDate } from './util'

/** 把粘贴的文案粗排成 ReportInstance。
 *  @param text 用户粘贴的文案（允许含多段、换行）
 *  @param title 报告标题（用户单独填的；作为 cover 卡标题 + ReportInstance.title）
 *  @returns ReportInstance（未保存；调用方负责 saveReport）
 */
export function parseImportedText(text: string, title: string): ReportInstance {
  const cleanTitle = (title || '').trim() || '我的报告'
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

  // 按空行（连续 ≥2 个换行）切成卡片段
  const chunkStrs = raw.length > 0 ? raw.split(/\n{2,}/).map(s => s.trim()).filter(s => s.length > 0) : []

  const cards: ReportCard[] = []

  // —— cover 卡：用标题 ——
  cards.push(buildCard('cover', cleanTitle, [seg(cleanTitle)], cleanTitle))

  if (chunkStrs.length === 0) {
    // 空文案：给一张占位 theme 卡，提示用户在编辑器里补充
    cards.push(buildCard('theme', '', [seg('在这里写下你想记录的内容……')], '在这里写下你想记录的内容……'))
  } else {
    // 处理首段短标题：若第一段短且无标点，当作副标题并入第二段所在卡
    let bodyChunks = chunkStrs
    let subtitle = ''
    if (chunkStrs.length >= 2) {
      const first = chunkStrs[0]
      if (first.length <= 20 && !/[。，；！？.,!?;]/.test(first) && !first.includes('\n')) {
        subtitle = first
        bodyChunks = chunkStrs.slice(1)
      }
    }

    for (let i = 0; i < bodyChunks.length; i++) {
      const chunk = bodyChunks[i]
      const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      const segments: TextSegment[] = lines.map(l => seg(l))
      const content = lines.join('\n')
      const type = guessCardType(chunk)
      // 卡片标题留空（用户可在编辑器里加）；副标题若有挂在第一张 body 卡
      const cardTitle = (subtitle && i === 0) ? subtitle : ''
      cards.push(buildCard(type, cardTitle, segments, content, cardTitle))
    }
  }

  // —— ending 卡：自动落款 ——
  const today = formatDate(new Date())
  cards.push(buildCard('ending', '', [seg(today)], today))

  const now = Date.now()
  return {
    id: genId(),
    title: cleanTitle,
    templateId: '__import__',   // 标记来源是导入（非任何内置/自定义模板）
    bookIds: [],
    cards,
    createdAt: now,
    updatedAt: now,
  }
}

/** 构造一张卡（content 与 segments 同步；title 可空）。 */
function buildCard(type: CardType, title: string, segments: TextSegment[], content: string, displayTitle?: string): ReportCard {
  const card: ReportCard = {
    type,
    title: (displayTitle !== undefined ? displayTitle : title) || '',
    content,
    segments,
  }
  return card
}

/** 造一个默认样式的段落。 */
function seg(text: string): TextSegment {
  return { text }
}

/** 轻量推断卡片类型（基于文案特征词）。 */
function guessCardType(chunk: string): CardType {
  // 金句特征
  if (/金句|摘录|引用|记住这句|这句/.test(chunk)) return 'quote'
  // 书名号密集 → 最爱/年度之书
  const bookMarkCount = (chunk.match(/《/g) || []).length
  if (bookMarkCount >= 2) return 'favorite'
  // 默认主题卡
  return 'theme'
}
