/**
 * report-edit-swap 验证脚本：P6 卡片/段落排序的纯函数交换逻辑
 *
 * 覆盖（对应第二批功能 6a/6b）：
 *   - swapArrayElements：基本交换、越界保护、i===j 幂等、不污染原数组
 *   - getCardSegments：有 segments 走 segments；无 segments 按 content 切段构造
 *   - segmentsToContent：纯文本 \n 拼接；图片段 text 为空的处理
 *   - swapCardSegments：交换后 segments + content 同步；越界/同位幂等；图片段保留
 */
import {
  swapArrayElements,
  getCardSegments,
  segmentsToContent,
  swapCardSegments,
} from '../../miniprogram/pages/report-edit/report-edit'
import { ReportCard, TextSegment } from '../../miniprogram/utils/storage'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

function mkCard(over: Partial<ReportCard>): ReportCard {
  return {
    type: 'theme',
    title: over.title || '',
    content: over.content || '',
    ...over,
  } as ReportCard
}

function runAll(): boolean {
  console.log('--- 场景 1：swapArrayElements 基本交换 ---')
  {
    const a = [1, 2, 3, 4]
    const out = swapArrayElements(a, 0, 2)
    assert(JSON.stringify(out) === '[3,2,1,4]', '交换 0↔2 → [3,2,1,4]（实际 ' + JSON.stringify(out) + '）')
    assert(JSON.stringify(a) === '[1,2,3,4]', '原数组不被污染')
  }
  {
    const a = ['x', 'y']
    const out = swapArrayElements(a, 1, 0)
    assert(JSON.stringify(out) === '["y","x"]', '交换 1↔0 → [y,x]')
  }

  console.log('--- 场景 2：swapArrayElements 边界 ---')
  {
    const a = [1, 2, 3]
    assert(JSON.stringify(swapArrayElements(a, 0, 0)) === '[1,2,3]', 'i===j 幂等返回原序副本')
    assert(JSON.stringify(swapArrayElements(a, -1, 1)) === '[1,2,3]', '负索引越界 → 原序')
    assert(JSON.stringify(swapArrayElements(a, 0, 5)) === '[1,2,3]', 'j 越界 → 原序')
    assert(JSON.stringify(swapArrayElements(a, 5, 0)) === '[1,2,3]', 'i 越界 → 原序')
  }

  console.log('--- 场景 3：swapArrayElements 对象数组（段落）---')
  {
    const segs: TextSegment[] = [{ text: 'A' }, { text: 'B' }, { text: 'C' }]
    const out = swapArrayElements(segs, 0, 2)
    assert(out[0].text === 'C' && out[2].text === 'A', '段对象数组交换 0↔2 正确')
    assert(out.length === 3, '段数不变')
  }

  console.log('--- 场景 4：getCardSegments 有 segments 走 segments ---')
  {
    const card = mkCard({ segments: [{ text: '一段' }, { text: '二段' }] })
    const segs = getCardSegments(card)
    assert(segs.length === 2, '有 segments → 返回 2 段')
    assert(segs[0].text === '一段', '第一段文本正确')
    assert(segs !== card.segments, '返回副本（不返原引用）')
  }

  console.log('--- 场景 5：getCardSegments 无 segments 按 content 切段 ---')
  {
    const card = mkCard({ content: '行一\n行二\n行三' })
    const segs = getCardSegments(card)
    assert(segs.length === 3, 'content 3 行 → 3 段')
    assert(segs[0].text === '行一' && segs[2].text === '行三', '按 \\n 切段文本正确')
  }
  {
    // content 含空行 → 也切成段（空行变空 text 段）
    const card = mkCard({ content: 'A\n\nB' })
    const segs = getCardSegments(card)
    assert(segs.length === 3, 'content 含空行 → 3 段（含空 text 段）')
    assert(segs[1].text === '', '中间空行 → 空 text 段')
  }

  console.log('--- 场景 6：segmentsToContent 纯文本拼接 ---')
  {
    const segs: TextSegment[] = [{ text: '甲' }, { text: '乙' }, { text: '丙' }]
    assert(segmentsToContent(segs) === '甲\n乙\n丙', '3 段 \\n 拼接')
  }
  {
    // 图片段 text 为空 → 拼接后该位为空串（content 会丢图，符合设计：图片只在 segments）
    const segs: TextSegment[] = [{ text: '文字段' }, { image: '/path/a.png', text: '' }]
    const c = segmentsToContent(segs)
    assert(c === '文字段\n', '图片段 text 空 → content 该位为空（图信息只在 segments）')
  }

  console.log('--- 场景 7：swapCardSegments 交换后 segments + content 同步 ---')
  {
    const card = mkCard({ content: '甲\n乙\n丙' })  // 无 segments，靠 content 切
    const swapped = swapCardSegments(card, 0, 2)
    assert(swapped.segments !== undefined && swapped.segments!.length === 3, '交换后生成 segments（3 段）')
    assert(swapped.segments![0].text === '丙', '交换 0↔2 后第一段 = 丙')
    assert(swapped.segments![2].text === '甲', '交换 0↔2 后第三段 = 甲')
    assert(swapped.content === '丙\n乙\n甲', 'content 同步重排 = 丙\\n乙\\n甲')
  }

  console.log('--- 场景 8：swapCardSegments 已有 segments 的卡 ---')
  {
    const card = mkCard({
      content: '旧content',
      segments: [{ text: 'S1' }, { text: 'S2' }, { text: 'S3' }],
    })
    const swapped = swapCardSegments(card, 1, 2)
    assert(swapped.segments![1].text === 'S3', '交换 1↔2 后第二段 = S3')
    assert(swapped.segments![2].text === 'S2', '交换 1↔2 后第三段 = S2')
    assert(swapped.content === 'S1\nS3\nS2', 'content 按新段序重建')
  }

  console.log('--- 场景 9：swapCardSegments 边界 ---')
  {
    const card = mkCard({ content: '甲\n乙\n丙' })
    const same = swapCardSegments(card, 1, 1)
    // i===j 幂等：content 不变（无实质交换）
    assert(same.content === '甲\n乙\n丙', 'i===j 幂等 → content 不变')
    // 越界保护
    const oob = swapCardSegments(card, 0, 9)
    assert(oob.content === '甲\n乙\n丙', 'j 越界 → content 不变')
    const neg = swapCardSegments(card, -1, 1)
    assert(neg.content === '甲\n乙\n丙', '负索引 → content 不变')
  }

  console.log('--- 场景 10：swapCardSegments 图片段保留 ---')
  {
    // 含图片段的卡：交换后图片段位置移动，image 字段保留
    const card = mkCard({
      segments: [
        { text: '文字A' },
        { text: '', image: '/img/x.png' },
        { text: '文字B' },
      ],
      content: '文字A\n\n文字B',
    })
    const swapped = swapCardSegments(card, 0, 1)
    assert(swapped.segments![0].image === '/img/x.png', '交换 0↔1 后第一段带上图片')
    assert(swapped.segments![0].text === '', '图片段 text 仍为空')
    assert(swapped.segments![1].text === '文字A', '原文字 A 移到第二位')
    // content 重建：图片段 text 空 → 该位空
    assert(swapped.content === '\n文字A\n文字B', 'content 含图片段位为空（图信息保留在 segments）')
  }

  console.log('--- 场景 11：连续两次交换 = 还原 ---')
  {
    const card = mkCard({ content: '甲\n乙\n丙\n丁' })
    const once = swapCardSegments(card, 0, 3)
    const twice = swapCardSegments(once, 0, 3)
    assert(twice.content === '甲\n乙\n丙\n丁', '同一对连续交换两次 → 还原原序')
    assert(twice.segments!.every((s, i) => s.text === ['甲', '乙', '丙', '丁'][i]), '段序也还原')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
