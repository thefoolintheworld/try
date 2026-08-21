/**
 * poster-split 验证脚本：P6 超长拆卡纯函数
 *
 * 覆盖（功能 4 循环块 × 功能 6 导出交叉点）：
 *   - splitCardIfOverflow：段数 ≤ 预算返回单卡；> 预算按预算切块
 *   - 段来源：有 segments 走 segments；无 segments 按 content 的 \n 切
 *   - 续卡标题加「（续）」；type/style/bookRef 继承；content/segments 同步重建
 *   - 封面/落款卡不拆（即便段多）
 *   - 自定义预算生效
 *   - splitOverflowCards：整份报告扁平化拆分
 */
import {
  splitCardIfOverflow,
  splitOverflowCards,
  SEGMENT_BUDGET_PER_CARD,
} from '../../miniprogram/utils/poster'
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
  console.log('--- 场景 1：默认预算 SEGMENT_BUDGET_PER_CARD = 6 ---')
  {
    assert(SEGMENT_BUDGET_PER_CARD === 6, '默认预算 = 6 段/卡')
  }

  console.log('--- 场景 2：段数 ≤ 预算 → 返回单卡（不拆）---')
  {
    const card = mkCard({ content: '一\n二\n三' })  // 3 段
    const out = splitCardIfOverflow(card)
    assert(out.length === 1, '3 段 ≤ 6 → 返回 1 张（不拆）')
    assert(out[0] === card, '不拆时返回原卡引用（避免无谓复制）')
  }
  {
    const card = mkCard({ content: '一\n二\n三\n四\n五\n六' })  // 6 段 = 预算
    assert(splitCardIfOverflow(card).length === 1, '6 段 = 预算 → 不拆（边界 ≤）')
  }

  console.log('--- 场景 3：段数 > 预算 → 按预算切块 ---')
  {
    // 13 段 → ceil(13/6) = 3 块（6+6+1）
    const lines: string[] = []
    for (let i = 1; i <= 13; i++) lines.push('第' + i + '条金句 ——《书' + i + '》')
    const card = mkCard({ type: 'quote', title: '字里行间', content: lines.join('\n') })
    const out = splitCardIfOverflow(card)
    assert(out.length === 3, '13 段 → 3 张卡（6+6+1）（实际 ' + out.length + '）')
    assert(out[0].type === 'quote', '拆分卡继承原 type（quote）')
    assert(out[0].title === '字里行间', '第一张标题保持原样')
    assert(out[1].title === '字里行间（续）', '第二张标题加「（续）」')
    assert(out[2].title === '字里行间（续）', '第三张标题也加「（续）」')
    // 各卡段数
    const seg0 = out[0].segments!
    const seg1 = out[1].segments!
    const seg2 = out[2].segments!
    assert(seg0.length === 6 && seg1.length === 6 && seg2.length === 1, '三张卡段数 6/6/1')
    assert(seg0[0].text === '第1条金句 ——《书1》', '第一张首段正确')
    assert(seg2[0].text === '第13条金句 ——《书13》', '第三张（末块）首段 = 第13条')
  }

  console.log('--- 场景 4：有 segments 的卡走 segments ---')
  {
    const segs: TextSegment[] = []
    for (let i = 0; i < 10; i++) segs.push({ text: 'S' + i })
    const card = mkCard({
      type: 'journey',
      title: '在路上',
      content: '旧content',
      segments: segs,
      bookRef: 'book-xyz',
    })
    const out = splitCardIfOverflow(card)
    assert(out.length === 2, '10 段 → 2 张卡（6+4）')
    assert(out[0].segments!.length === 6, '第一张 6 段')
    assert(out[1].segments!.length === 4, '第二张 4 段')
    assert(out[0].bookRef === 'book-xyz' && out[1].bookRef === 'book-xyz', '拆分卡继承 bookRef')
    // 各卡 content 按块段重建
    assert(out[0].content === 'S0\nS1\nS2\nS3\nS4\nS5', '第一张 content 按块段重建')
    assert(out[1].content === 'S6\nS7\nS8\nS9', '第二张 content 按块段重建')
  }

  console.log('--- 场景 5：封面/落款卡不拆 ---')
  {
    // 封面卡 20 段 → 仍单卡（语义上封面是一张）
    const lines = Array.from({ length: 20 }, (_, i) => '段' + i).join('\n')
    const cover = mkCard({ type: 'cover', title: '我的报告', content: lines })
    assert(splitCardIfOverflow(cover).length === 1, '封面卡 20 段 → 仍 1 张（不拆）')
    const ending = mkCard({ type: 'ending', title: '', content: lines })
    assert(splitCardIfOverflow(ending).length === 1, '落款卡 20 段 → 仍 1 张（不拆）')
  }

  console.log('--- 场景 6：自定义预算 ---')
  {
    const card = mkCard({ content: '一\n二\n三\n四' })  // 4 段
    assert(splitCardIfOverflow(card, 2).length === 2, '4 段 / 预算 2 → 2 张（2+2）')
    assert(splitCardIfOverflow(card, 3).length === 2, '4 段 / 预算 3 → 2 张（3+1）')
    assert(splitCardIfOverflow(card, 4).length === 1, '4 段 / 预算 4 → 1 张（边界 ≤）')
    assert(splitCardIfOverflow(card, 10).length === 1, '4 段 / 预算 10 → 1 张')
  }

  console.log('--- 场景 7：style 字段继承到拆分卡 ---')
  {
    const card = mkCard({
      type: 'theme',
      title: '主题卡',
      content: '一\n二\n三\n四\n五\n六\n七\n八',  // 8 段
      style: { bgType: 'color', bgColor: '#FF0000', textColor: '#00FF00' },
    })
    const out = splitCardIfOverflow(card)
    assert(out.length === 2, '8 段 → 2 张卡')
    assert(out[0].style !== undefined && out[1].style !== undefined, '两张卡都带 style')
    assert(out[0].style!.bgColor === '#FF0000' && out[1].style!.bgColor === '#FF0000', 'style.bgColor 继承')
  }

  console.log('--- 场景 8：图片段参与计数且不丢图 ---')
  {
    // 8 个段，第 4 个是图片段
    const segs: TextSegment[] = [
      { text: '文1' }, { text: '文2' }, { text: '文3' },
      { text: '', image: '/img/a.png' },
      { text: '文5' }, { text: '文6' }, { text: '文7' }, { text: '文8' },
    ]
    const card = mkCard({ type: 'theme', title: '图文卡', segments: segs })
    const out = splitCardIfOverflow(card)  // 默认 6
    assert(out.length === 2, '8 段 → 2 张卡（6+2）')
    // 第一张含前 6 段（含图片段）
    const found = (out[0].segments || []).some(s => s.image === '/img/a.png')
    assert(found, '图片段保留在第一张（不丢图）')
  }

  console.log('--- 场景 9：splitOverflowCards 扁平化整份报告 ---')
  {
    const cards: ReportCard[] = [
      mkCard({ type: 'cover', title: '封面', content: '标题' }),
      mkCard({ type: 'quote', title: '金句', content: Array.from({ length: 13 }, (_, i) => 'Q' + i).join('\n') }),
      mkCard({ type: 'theme', title: '主题', content: '一段\n二段' }),
      mkCard({ type: 'ending', title: '', content: '日期' }),
    ]
    const out = splitOverflowCards(cards)
    // 封面(1) + 金句13段拆成3 + 主题2段不拆(1) + 落款(1) = 1+3+1+1 = 6
    assert(out.length === 6, '4 张卡（金句 13 段）→ 扁平化 6 张（1+3+1+1）（实际 ' + out.length + '）')
    assert(out[0].type === 'cover', '扁平化后首张仍是 cover')
    assert(out[5].type === 'ending', '扁平化后末张仍是 ending')
    // 中间 4 张都是 quote 的拆分（index 1,2,3）
    assert(out[1].type === 'quote' && out[2].type === 'quote' && out[3].type === 'quote', '金句拆成 3 张 quote 卡')
    assert(out[4].type === 'theme', '主题卡保持原位（不拆）')
  }

  console.log('--- 场景 10：所有卡段数都少 → 返回与输入等长 ---')
  {
    const cards: ReportCard[] = [
      mkCard({ type: 'cover', content: 'a' }),
      mkCard({ type: 'theme', content: 'b\nc' }),
    ]
    const out = splitOverflowCards(cards)
    assert(out.length === 2, '两张都不超 → 返回 2 张')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
