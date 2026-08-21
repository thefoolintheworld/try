/**
 * report-edit-transform 验证脚本：PPT 化段落样式扩展（旋转 / 倾斜 / 字体档 / 字间距）
 *
 * 覆盖：
 *   - mergeSegmentStyle：新 4 字段（rotate/skew/fontFamily/letterSpacing）合并 + 后者覆盖前者
 *   - fontFamilyToCss：字体档 → WXSS font-family 字符串映射（楷体/等宽/衬线/无衬线/空）
 *   - buildSegmentViews：transformCss/fontFamilyCss/letterSpacingCss 生成正确
 *     * 回归保护：无新字段时 transformCss='' / fontFamilyCss='' / letterSpacingCss=''（不破坏老报告）
 *     * 旋转 + 倾斜同时设置时 transformCss 含 rotate 与 skewX 两段
 *     * 字间距 1 时 letterSpacingCss=''（正常间距不出 css）
 *     * fontSizeScale 连续值（如 0.85）正确反映到 fontSizeRpx
 *   - 继承链：段未设字段时从卡片投影继承（fontSizeScale/fontFamily 回落）
 *
 * P10 扩展：自由布局（boxX/boxY/boxW 归一化小数坐标，0~1）
 *   - mergeSegmentStyle：新 3 字段合并 + 后者覆盖 + undefined 跳过
 *   - buildSegmentViews：boxCss/isFreePositioned 生成
 *     * 回归保护：无 boxX 时 boxCss='' / isFreePositioned=false（老报告零变化）
 *     * 全字段 → boxCss 含 position:absolute;left/top/width 百分比 / isFreePositioned=true
 *     * 部分缺省（仅 boxX）→ 仍视为自由定位，缺省字段用默认（boxY=0, boxW=1）
 *     * 多段混合：自由段 + 流式段共存各自 boxCss 不污染
 */
import {
  mergeSegmentStyle,
  resolveStyle,
  SegmentStyle,
} from '../../miniprogram/utils/design-tokens'
import {
  buildSegmentViews,
  fontFamilyToCss,
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
  console.log('--- 场景 1：mergeSegmentStyle 新 4 字段合并 ---')
  {
    const base: SegmentStyle = { rotate: 10, skew: 5, fontFamily: 'kai', letterSpacing: 1.5 }
    const merged = mergeSegmentStyle(base)
    assert(merged.rotate === 10, 'rotate 单层保留 = 10')
    assert(merged.skew === 5, 'skew 单层保留 = 5')
    assert(merged.fontFamily === 'kai', 'fontFamily 单层保留 = kai')
    assert(merged.letterSpacing === 1.5, 'letterSpacing 单层保留 = 1.5')
  }
  {
    // 后者覆盖前者
    const a: SegmentStyle = { rotate: 10, fontFamily: 'serif' }
    const b: SegmentStyle = { rotate: 30, skew: -5 }
    const merged = mergeSegmentStyle(a, b)
    assert(merged.rotate === 30, 'rotate 后者覆盖 → 30')
    assert(merged.skew === -5, 'skew 来自后者 = -5')
    assert(merged.fontFamily === 'serif', 'fontFamily 来自前者（后者没设）= serif')
  }
  {
    // 空层安全
    const merged = mergeSegmentStyle(null, undefined, {})
    assert(merged.rotate === undefined, '空层合并 rotate = undefined')
    assert(merged.fontFamily === undefined, '空层合并 fontFamily = undefined')
  }

  console.log('--- 场景 2：fontFamilyToCss 字体档映射 ---')
  {
    assert(fontFamilyToCss('kai') === '"KaiTi", "STKaiti", "楷体", "Kaiti SC", cursive', 'kai → 楷体字体栈')
    assert(fontFamilyToCss('mono') === '"Courier New", "Menlo", monospace', 'mono → 等宽字体栈')
    assert(fontFamilyToCss('serif') === 'var(--font-serif)', 'serif → CSS 变量')
    assert(fontFamilyToCss('sans') === 'var(--font-sans)', 'sans → CSS 变量')
    assert(fontFamilyToCss(undefined) === '', 'undefined → 空串（回落默认）')
  }

  console.log('--- 场景 3：buildSegmentViews 回归保护（无新字段不破坏老报告）---')
  {
    const rs = resolveStyle()
    const card = mkCard({ content: '普通段落' })
    const views = buildSegmentViews(card, rs)
    assert(views.length === 1, '单段内容 → 1 个视图')
    const v = views[0]
    assert(v.transformCss === '', '无 rotate/skew → transformCss = 空串')
    assert(v.fontFamilyCss === '', '无 fontFamily → fontFamilyCss = 空串')
    assert(v.letterSpacingCss === '', '无 letterSpacing → letterSpacingCss = 空串')
    assert(v.fontSizeRpx === 32, '默认字号基准 32rpx（实际 ' + v.fontSizeRpx + '）')
  }

  console.log('--- 场景 4：buildSegmentViews 旋转 + 倾斜生成 transformCss ---')
  {
    const rs = resolveStyle()
    const segs: TextSegment[] = [{ text: '标题', style: { rotate: 15, skew: -8 } }]
    const card = mkCard({ segments: segs })
    const views = buildSegmentViews(card, rs)
    const v = views[0]
    assert(v.transformCss === 'rotate(15deg) skewX(-8deg)', 'rotate+skew → transformCss 含两段（实际 "' + v.transformCss + '"）')
    assert(v.hasOwnStyle === true, '有 rotate/skew → hasOwnStyle = true')
  }
  {
    // 仅旋转
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { rotate: 90 } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.transformCss === 'rotate(90deg)', '仅旋转 → 只含 rotate（实际 "' + v.transformCss + '"）')
  }
  {
    // 仅倾斜
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { skew: 12 } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.transformCss === 'skewX(12deg)', '仅倾斜 → 只含 skewX（实际 "' + v.transformCss + '"）')
  }
  {
    // rotate=0 + skew=0 → transformCss 空（0 视为无变换）
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { rotate: 0, skew: 0 } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.transformCss === '', 'rotate=0/skew=0 → transformCss 空串')
  }

  console.log('--- 场景 5：buildSegmentViews 字体档生成 fontFamilyCss ---')
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { fontFamily: 'kai' } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.fontFamilyCss === '"KaiTi", "STKaiti", "楷体", "Kaiti SC", cursive', 'fontFamily=kai → 楷体栈')
  }
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { fontFamily: 'mono' } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.fontFamilyCss === '"Courier New", "Menlo", monospace', 'fontFamily=mono → 等宽栈')
    assert(v.hasOwnStyle === true, '设了 fontFamily → hasOwnStyle = true')
  }

  console.log('--- 场景 6：buildSegmentViews 字间距生成 letterSpacingCss ---')
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { letterSpacing: 2 } }] })
    const v = buildSegmentViews(card, rs)[0]
    // fontRpx=32, mult=2 → round(32*(2-1)*0.5) = 16rpx
    assert(v.letterSpacingCss === '16rpx', 'letterSpacing=2 → 16rpx（实际 "' + v.letterSpacingCss + '"）')
  }
  {
    // letterSpacing=1 → 空串（正常间距不出 css）
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { letterSpacing: 1 } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.letterSpacingCss === '', 'letterSpacing=1 → 空串（正常间距）')
  }
  {
    // letterSpacing=0.6 → 负值（收紧）
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { letterSpacing: 0.6 } }] })
    const v = buildSegmentViews(card, rs)[0]
    // fontRpx=32, mult=0.6 → round(32*(0.6-1)*0.5) = round(-6.4) = -6rpx
    assert(v.letterSpacingCss === '-6rpx', 'letterSpacing=0.6 → 收紧 -6rpx（实际 "' + v.letterSpacingCss + '"）')
  }

  console.log('--- 场景 7：fontSizeScale 连续值反映到 fontSizeRpx ---')
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { fontSizeScale: 0.85 } }] })
    const v = buildSegmentViews(card, rs)[0]
    // BASE_BODY_FONT_RPX=32 * 0.85 = 27.2 → round = 27rpx
    assert(v.fontSizeRpx === 27, 'fontSizeScale=0.85 连续值 → 27rpx（实际 ' + v.fontSizeRpx + '）')
  }
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: 'x', style: { fontSizeScale: 1.5 } }] })
    const v = buildSegmentViews(card, rs)[0]
    // 32 * 1.5 = 48rpx
    assert(v.fontSizeRpx === 48, 'fontSizeScale=1.5 → 48rpx（实际 ' + v.fontSizeRpx + '）')
  }

  console.log('--- 场景 8：继承链（段未设字段时从卡片投影继承）---')
  {
    // 卡片级 fontSizeScale=1.3，段未设 → 段继承 1.3
    const rs = resolveStyle({ fontSizeScale: 1.3 })
    const card = mkCard({ segments: [{ text: '继承字号' }] })
    const v = buildSegmentViews(card, rs)[0]
    // 32 * 1.3 = 41.6 → round = 42rpx
    assert(v.fontSizeRpx === 42, '段未设 fontSizeScale → 继承卡片 1.3 → 42rpx（实际 ' + v.fontSizeRpx + '）')
  }
  {
    // 卡片级 fontSizeScale=1.3，段设 0.9 → 段覆盖
    const rs = resolveStyle({ fontSizeScale: 1.3 })
    const card = mkCard({ segments: [{ text: 'x', style: { fontSizeScale: 0.9 } }] })
    const v = buildSegmentViews(card, rs)[0]
    // 32 * 0.9 = 28.8 → round = 29rpx
    assert(v.fontSizeRpx === 29, '段设 0.9 覆盖卡片 1.3 → 29rpx（实际 ' + v.fontSizeRpx + '）')
  }

  console.log('--- 场景 9：多段混合（有样式段 + 无样式段共存不互相污染）---')
  {
    const rs = resolveStyle()
    const segs: TextSegment[] = [
      { text: '普通段', style: { align: 'center' } },
      { text: '旋转段', style: { rotate: 45, fontFamily: 'serif', letterSpacing: 1.8 } },
      { text: '纯文本段' },
    ]
    const card = mkCard({ segments: segs })
    const views = buildSegmentViews(card, rs)
    assert(views.length === 3, '3 段 → 3 个视图')
    assert(views[0].transformCss === '' && views[0].fontFamilyCss === '', '段0 普通 → 无 transform/font')
    assert(views[1].transformCss === 'rotate(45deg)', '段1 旋转 → 含 rotate')
    assert(views[1].fontFamilyCss === 'var(--font-serif)', '段1 serif → 衬线变量')
    assert(views[1].letterSpacingCss !== '', '段1 letterSpacing=1.8 → 非空')
    assert(views[2].transformCss === '' && views[2].fontFamilyCss === '' && views[2].letterSpacingCss === '', '段2 纯文本 → 全空')
  }

  console.log('--- 场景 10（P10）：mergeSegmentStyle 新 boxX/boxY/boxW 合并 ---')
  {
    const base: SegmentStyle = { boxX: 0.2, boxY: 0.3, boxW: 0.6 }
    const merged = mergeSegmentStyle(base)
    assert(merged.boxX === 0.2, 'boxX 单层保留 = 0.2')
    assert(merged.boxY === 0.3, 'boxY 单层保留 = 0.3')
    assert(merged.boxW === 0.6, 'boxW 单层保留 = 0.6')
  }
  {
    // 后者覆盖前者
    const a: SegmentStyle = { boxX: 0.2, boxY: 0.3, boxW: 0.6 }
    const b: SegmentStyle = { boxX: 0.5, boxW: 0.8 }
    const merged = mergeSegmentStyle(a, b)
    assert(merged.boxX === 0.5, 'boxX 后者覆盖 → 0.5')
    assert(merged.boxW === 0.8, 'boxW 后者覆盖 → 0.8')
    assert(merged.boxY === 0.3, 'boxY 来自前者（后者没设）= 0.3')
  }
  {
    // undefined 跳过：传 undefined 字段不应清掉既有值（mergeSegmentStyle 的语义就是「跳过 undefined」，
    // 所以 report-edit.ts 里关闭自由布局才需要专门的 clearSegBoxPos 显式 delete，而不是靠 applySegmentStylePatch）
    const a: SegmentStyle = { boxX: 0.5, boxY: 0.5, boxW: 0.5 }
    const b: SegmentStyle = { boxX: undefined as any }
    const merged = mergeSegmentStyle(a, b)
    assert(merged.boxX === 0.5, 'boxX undefined 跳过 → 既有 0.5 保留（证明需要 clearSegBoxPos）')
    assert(merged.boxY === 0.5 && merged.boxW === 0.5, 'boxY/boxW 不受 undefined 影响')
  }

  console.log('--- 场景 11（P10）：buildSegmentViews 回归保护（无 boxX 不破坏老报告）---')
  {
    const rs = resolveStyle()
    const card = mkCard({ content: '普通段落' })
    const views = buildSegmentViews(card, rs)
    const v = views[0]
    assert(v.boxCss === '', '无 boxX → boxCss = 空串（流式渲染）')
    assert(v.isFreePositioned === false, '无 boxX → isFreePositioned = false')
  }

  console.log('--- 场景 12（P10）：buildSegmentViews 全字段 boxX/boxY/boxW → boxCss ---')
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: '自由段', style: { boxX: 0.5, boxY: 0.3, boxW: 0.7 } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.isFreePositioned === true, 'boxX 非缺省 → isFreePositioned = true')
    assert(v.boxCss === 'position: absolute; left: 50%; top: 30%; width: 70%;',
      '全字段 → boxCss 含 position/left50%/top30%/width70%（实际 "' + v.boxCss + '"）')
    assert(v.hasOwnStyle === true, '设了 boxX → hasOwnStyle = true')
  }

  console.log('--- 场景 13（P10）：buildSegmentViews 部分缺省（仅 boxX）用默认补齐 ---')
  {
    const rs = resolveStyle()
    const card = mkCard({ segments: [{ text: '仅 X', style: { boxX: 0.4 } }] })
    const v = buildSegmentViews(card, rs)[0]
    assert(v.isFreePositioned === true, '仅 boxX 非缺省 → 仍视为自由定位')
    // boxY 缺省 → top:0%；boxW 缺省 → width:100%
    assert(v.boxCss === 'position: absolute; left: 40%; top: 0%; width: 100%;',
      '仅 boxX=0.4 → 缺省 boxY=0 boxW=1（实际 "' + v.boxCss + '"）')
  }

  console.log('--- 场景 14（P10）：多段混合 自由段 + 流式段共存不污染 ---')
  {
    const rs = resolveStyle()
    const segs: TextSegment[] = [
      { text: '流式段' },
      { text: '自由段', style: { boxX: 0.1, boxY: 0.1, boxW: 0.6, rotate: 5 } },
      { text: '又一流式段' },
    ]
    const card = mkCard({ segments: segs })
    const views = buildSegmentViews(card, rs)
    assert(views.length === 3, '3 段 → 3 个视图')
    assert(views[0].boxCss === '' && views[0].isFreePositioned === false, '段0 流式 → boxCss 空 / isFreePositioned=false')
    assert(views[1].isFreePositioned === true, '段1 自由 → isFreePositioned=true')
    const seg1BoxCss = views[1].boxCss || ''
    assert(seg1BoxCss.indexOf('left: 10%') >= 0 && seg1BoxCss.indexOf('width: 60%') >= 0,
      '段1 boxCss 含 left10% width60%（实际 "' + seg1BoxCss + '"）')
    assert(views[1].transformCss === 'rotate(5deg)', '段1 自由定位 + 旋转 → transformCss 仍生效（定位与变换正交）')
    assert(views[2].boxCss === '' && views[2].isFreePositioned === false, '段2 流式 → boxCss 空（不被段1污染）')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
