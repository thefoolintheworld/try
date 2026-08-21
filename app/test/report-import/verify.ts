/**
 * report-import 验证脚本：parseImportedText 粗排启发式
 *
 * 覆盖（对应第二批功能 5）：
 *   - 基础切卡：多段 → cover + N 张 body + ending
 *   - 空文案兜底：cover + 一张占位 theme + ending
 *   - 首段短标题识别 → 并入第二段所在卡（作 cardTitle）
 *   - 卡片类型推断：含「金句」→ quote；《》≥2 → favorite；否则 theme
 *   - 段落富文本：每张卡的 segments 反映单换行结构（一行一段）
 *   - ending 自动落款日期；cover 用标题；标题兜底「我的报告」
 *   - templateId='__import__'，bookIds 空；\r\n/\r 换行归一化；空行修剪
 */
import { parseImportedText } from '../../miniprogram/utils/report-import'
import { ReportInstance } from '../../miniprogram/utils/storage'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

/** 取出所有非 cover/ending 的 body 卡。 */
function bodyCards(r: ReportInstance) {
  return r.cards.filter(c => c.type !== 'cover' && c.type !== 'ending')
}

function runAll(): boolean {
  console.log('--- 场景 1：基础多段切卡 ---')
  {
    const text = '今年的春天来得晚。\n\n我在三月的雨里读完了《追忆似水年华》。\n\n合上书的那一刻，窗外忽然放晴。'
    const r = parseImportedText(text, '春日札记')
    // cover + 3 body + ending = 5
    assert(r.cards.length === 5, '3 段文案 → cover+3 body+ending = 5 张卡（实际 ' + r.cards.length + '）')
    assert(r.title === '春日札记', 'ReportInstance.title 用传入标题')
    assert(r.templateId === '__import__', 'templateId 标记为 __import__')
    assert(r.bookIds.length === 0, 'bookIds 为空（导入报告不关联书）')
    assert(r.cards[0].type === 'cover', '首卡强制 cover')
    assert(r.cards[r.cards.length - 1].type === 'ending', '末卡强制 ending')
    assert(r.cards[0].title === '春日札记', 'cover 卡标题用报告标题')
    // 3 段 body 都应为 theme（无金句词、无书名号密集）
    const bodies = bodyCards(r)
    assert(bodies.length === 3, 'body 卡 = 3 张')
    assert(bodies.every(c => c.type === 'theme'), '无特征词的段都推断为 theme')
    // 第二段含《》但只 1 个，不触发 favorite
    assert(bodies[1].type === 'theme', '仅 1 个《》不触发 favorite（需 ≥2）')
  }

  console.log('--- 场景 2：空文案兜底 ---')
  {
    const r = parseImportedText('', '空标题测试')
    // cover + 1 张占位 theme + ending = 3
    assert(r.cards.length === 3, '空文案 → cover+占位 theme+ending = 3 张卡（实际 ' + r.cards.length + '）')
    assert(r.title === '空标题测试', '空文案时标题仍用传入值')
    const bodies = bodyCards(r)
    assert(bodies.length === 1, '空文案 body 卡 = 1 张（占位提示）')
    assert(bodies[0].content.length > 0, '占位 theme 卡有提示文案')
  }

  console.log('--- 场景 3：标题兜底「我的报告」---')
  {
    const r = parseImportedText('一些正文。', '')
    assert(r.title === '我的报告', '传入空标题 → 兜底「我的报告」')
    assert(r.cards[0].title === '我的报告', 'cover 卡标题也走兜底')
    assert(parseImportedText('x', '   ').title === '我的报告', '传入纯空格标题 → 兜底')
  }

  console.log('--- 场景 4：首段短标题识别并入第二段 ---')
  {
    // 第一段「代跋」≤20 字、无标点、无换行 → 当副标题挂到第一张 body 卡
    const text = '代跋\n\n这是正文的开始，比较长的一段话，应该独立成卡。\n\n第二段正文，同样较长。'
    const r = parseImportedText(text, '某书')
    const bodies = bodyCards(r)
    // 副标题被吞掉一张：原 3 段 → 第一段并掉 → body 2 张
    assert(bodies.length === 2, '首段短标题被识别 → body 从 3 张变 2 张（实际 ' + bodies.length + '）')
    assert(bodies[0].title === '代跋', '第一张 body 卡的 title 挂上副标题「代跋」')
    assert(bodies[1].title === '', '其余 body 卡 title 为空')
  }

  console.log('--- 场景 4b：首段长或有标点则不识别为副标题 ---')
  {
    // 第一段含句号 → 不当副标题
    const text = '这是第一段，但它有句号。\n\n第二段。\n\n第三段。'
    const r = parseImportedText(text, '某书')
    const bodies = bodyCards(r)
    assert(bodies.length === 3, '首段含句号 → 不并入 → body 仍 3 张（实际 ' + bodies.length + '）')
    assert(bodies.every(c => c.title === ''), '含标点时所有 body 卡 title 为空')
  }
  {
    // 第一段超 20 字 → 不当副标题
    const text = '这是一段非常非常非常非常非常非常非常非常长的开头段落，超过二十个字。\n\n第二段。\n\n第三段。'
    const r = parseImportedText(text, '某书')
    const bodies = bodyCards(r)
    assert(bodies.length === 3, '首段 >20 字 → 不并入 → body 仍 3 张（实际 ' + bodies.length + '）')
  }

  console.log('--- 场景 5：卡片类型推断（favorite / quote）---')
  {
    const text = '本年度最爱的两本：《百年孤独》和《霍乱时期的爱情》。\n\n记一句金句：世界上只有一种英雄主义。\n\n一段普通的感悟。'
    const r = parseImportedText(text, '年度')
    const bodies = bodyCards(r)
    assert(bodies.length === 3, '3 段 → 3 张 body 卡')
    assert(bodies[0].type === 'favorite', '《》≥2 的段 → favorite')
    assert(bodies[1].type === 'quote', '含「金句」词 → quote')
    assert(bodies[2].type === 'theme', '普通段 → theme')
  }

  console.log('--- 场景 6：段落富文本（一行一段）---')
  {
    // 单段内含多个换行 → 每行一个 segment
    const text = '第一行\n第二行\n第三行'
    const r = parseImportedText(text, '多行测试')
    const bodies = bodyCards(r)
    assert(bodies.length === 1, '单段 → 1 张 body 卡')
    const segs = bodies[0].segments || []
    assert(segs.length === 3, '3 行 → 3 个 segment（实际 ' + segs.length + '）')
    assert(segs[0].text === '第一行' && segs[2].text === '第三行', 'segment 文本按行保留')
    assert(bodies[0].content === '第一行\n第二行\n第三行', 'content = 行用 \\n 拼接')
  }

  console.log('--- 场景 7：ending 自动落款日期 ---')
  {
    const r = parseImportedText('一段正文。', '某报告')
    const ending = r.cards[r.cards.length - 1]
    assert(ending.type === 'ending', '末卡是 ending')
    // format YYYY-MM-DD
    assert(/^\d{4}-\d{2}-\d{2}$/.test(ending.content), 'ending 内容是 YYYY-MM-DD 日期（实际 ' + ending.content + '）')
  }

  console.log('--- 场景 8：换行归一化与空白修剪 ---')
  {
    // \r\n 与 \r 都应被归一化为 \n；首尾空白修剪
    const text = '  \r\n第一段。\r\n\r\n第二段。  '
    const r = parseImportedText(text, '换行测试')
    const bodies = bodyCards(r)
    assert(bodies.length === 2, '\\r\\n 与 \\r 归一化后按空行切 2 段（实际 ' + bodies.length + '）')
    assert(bodies[0].content === '第一段。', '首尾空白已修剪')
  }

  console.log('--- 场景 9：连续空行归并为一个间隔 ---')
  {
    // 首段带句号（避开副标题识别），中间多个空行应被 \n{2,} 合并为一个分隔
    const text = '第一段正文。\n\n\n\n第二段正文。'
    const r = parseImportedText(text, '空行测试')
    const bodies = bodyCards(r)
    assert(bodies.length === 2, '连续空行视为一段间隔 → 2 张 body 卡（实际 ' + bodies.length + '）')
    // 段内空行已被 filter 掉
    for (const c of bodies) {
      const segs = c.segments || []
      assert(segs.every(s => s.text.length > 0), 'body 卡无空 segment')
    }
  }

  console.log('--- 场景 10：单段无空行 → 一张 body 卡 ---')
  {
    const r = parseImportedText('唯一的一段正文，没有空行分隔。', '单段')
    const bodies = bodyCards(r)
    assert(bodies.length === 1, '单段无空行 → 1 张 body 卡')
    assert(r.cards.length === 3, 'cover + 1 body + ending = 3 张')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
