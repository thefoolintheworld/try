# 微信小程序 Canvas 与 WXSS 双渲染一致性的工程实践

> 项目背景：[荧烛微光](../../) 是一个把阅读经历写成文学化叙事报告的微信小程序。报告编辑器里，用户对每个段落都能调字号、颜色、对齐、艺术字，甚至旋转、倾斜、自由布局。这些样式有两个呈现端——**WXSS 预览**（编辑时所见）和 **Canvas 导出**（保存到相册的海报）。本文记录我们如何让两者在比例不同的情况下保持视觉一致。

---

## 一、问题：同一个段，两套引擎，长出来不一样

报告编辑器的核心承诺是「**所见即所得**」——你在预览里把一段文字调成红色、字号放大、旋转 15 度、拖到卡片右下角，导出的海报就得一模一样。

听起来理所当然，做起来处处是坑。因为这两个呈现端的底层完全不同：

| | WXSS 预览 | Canvas 导出 |
|---|---|---|
| 渲染引擎 | WebView 浏览器渲染管线 | Canvas 2D 手工绘制 |
| 比例 | ≈ 1:1（750rpx × 720rpx） | 3:4（600px × 800px） |
| 单位 | rpx / % | px（设计空间 600 宽） |
| 字体 | CSS `font-family` 字符串 | `ctx.font` 字符串 |
| 旋转中心 | 默认 `transform-origin: 50% 50%` | `ctx.rotate()` 绕坐标系原点 |
| 字间距 | CSS `letter-spacing` | `ctx.letterSpacing`（新字段） |

如果两个端各自实现一套样式逻辑，几乎必然出现这种对话：

> **用户**：我在预览里把这段旋转 15 度看着挺合适，导出来怎么歪到一边去了？
> **开发**：（查了半天）哦，Canvas 绕左边转的，CSS 绕中心转的……

这种 bug 用户感知极强，而且很难在测试阶段穷举——你得想到所有「字号 × 对齐 × 旋转」的组合去比对。

---

## 二、解法的核心思想：单一数据源 + 归一化坐标

我们把问题拆成两层：**样式存什么**，和**两端各自怎么渲染**。

### 2.1 样式只存一份

所有段落样式集中在一个 `SegmentStyle` 接口里（`utils/design-tokens.ts`）：

```typescript
export interface SegmentStyle {
  // 视觉属性
  color?: string
  fontSizeScale?: number
  align?: 'left' | 'center' | 'right'
  artFont?: ArtFontStyle
  strokeColor?: string
  // ... 其他艺术字字段
  // P9：视觉变换
  rotate?: number       // 旋转角度（度）
  skew?: number         // 倾斜角度（度）
  fontFamily?: 'sans' | 'serif' | 'kai' | 'mono'
  letterSpacing?: number
  // P10：几何布局（归一化小数 0~1）
  boxX?: number
  boxY?: number
  boxW?: number
}
```

两端共享同一个真相源，合并语义统一走 `mergeSegmentStyle(...layers)`——后层覆盖前层、跳过 undefined（保留既有值）。

这是整个设计的地基。后面所有「一致性」的努力，本质都是「让两端对同一份数据的解读一致」。

### 2.2 几何坐标用小数，不用 rpx/px

这是整个设计的精髓，也是最不直观的一步。

考虑「用户把一段拖到卡片中间」这个操作。预览和导出的比例不同：

```
预览：750rpx 宽 × 720rpx 高
导出：600px 宽 × 800px 高
```

如果存原始 rpx——比如「这段在 left: 375rpx」——预览里是正中间（375 / 750 = 50%），但导出时 375rpx 换算成 px 是多少？比例还不一样，X 方向和 Y 方向的换算系数也不同。结果就是预览拖到中间，导出偏到一边。

**解法：存归一化小数（0~1，相对卡片正文区）。**

```typescript
// 拖到卡片正中间
{ boxX: 0.5, boxY: 0.5, boxW: 0.6 }
```

两端各自乘以自己的正文区尺寸：

```typescript
// WXSS 预览侧（buildSegmentViews）
const leftPct = Math.round(merged.boxX * 100)   // 50
const topPct = Math.round(merged.boxY * 100)    // 50
const widthPct = Math.round(merged.boxW * 100)  // 60
boxCss = `position: absolute; left: ${leftPct}%; top: ${topPct}%; width: ${widthPct}%;`

// Canvas 导出侧（drawSegments）
const boxLeft = x + merged.boxX * maxW    // x + 0.5 * maxW
const boxTop = y + merged.boxY * maxH     // y + 0.5 * maxH
const boxWidth = merged.boxW * maxW       // 0.6 * maxW
```

预览里 50% 是卡片中间，导出里 50% 也是卡片中间。两边各自换算，但都指向「相对位置」这个同一个语义。**所见即所得自动成立，不需要手动同步比例。**

这个思路的好处是：以后就算预览或导出改了比例（比如导出支持 1:1 方形海报），坐标代码一行都不用改——小数天然比例无关。

---

## 三、视觉属性的 dual-render：以旋转为例

几何属性靠归一化坐标解决，视觉属性（颜色 / 字号 / 旋转）则要靠**两边各自正确翻译同一份值**。这里最容易翻车的是旋转中心。

### 3.1 踩过的坑：旋转中心不一致

最初 Canvas 侧的旋转代码是这样：

```typescript
// 错误版本：绕 drawX（文字起点）旋转
ctx.translate(drawX, curY + lineH / 2)
ctx.rotate(deg * Math.PI / 180)
ctx.translate(-drawX, -(curY + lineH / 2))
drawArtText(ctx, line, drawX, curY, ...)
```

但 WXSS 默认 `transform-origin: 50% 50%`——绕元素中心旋转。对于**左对齐**文字，`drawX` 恰好是文字左边缘，绕它旋转和绕中心旋转结果差很多：

```
左对齐文字「读书」
  绕左边缘转 15°：     读书↗     （整段往右上甩）
  绕中心转 15°：        读书       （原地微微倾斜）
```

预览（绕中心）和导出（绕左边缘）明显不一致。

### 3.2 修复：Canvas 也按对齐方式算真正的水平中心

```typescript
// 正确版本：按对齐方式算出真正的水平中心
const lineWidth = ctx.measureText(line).width
const centerX = segAlign === 'center' ? drawX
  : segAlign === 'right' ? drawX - lineWidth / 2
  : drawX + lineWidth / 2
const centerY = curY + lineH / 2
ctx.translate(centerX, centerY)
if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180)
if (skewDeg) ctx.transform(1, 0, skewTan, 1, 0, 0)  // skewX 平行四边形错切
ctx.translate(-centerX, -centerY)
drawArtText(ctx, line, drawX, curY, ...)
```

关键改动：先用 `ctx.measureText(line).width` 量出这一行的实际像素宽，再按对齐方式算出真正的水平中心。这样 Canvas 的旋转中心和 WXSS 的 `transform-origin: 50% 50%` 语义对齐了。

倾斜（skew）用的是 `ctx.transform(1, 0, skewTan, 1, 0, 0)`，对应 CSS 的 `skewX()`——同一个变换矩阵，两边天然一致。

---

## 四、自由布局的额外挑战：拆卡会破坏绝对坐标

P10 加了段落自由布局（拖位置 + 拖角改宽）后，又冒出一个新问题。

海报导出时，如果一张卡的段太多，`splitOverflowCards` 会把它拆成多张「（续）」卡，把段按预算切块克隆过去。这对流式布局是完美的——段就是按顺序堆，切开不影响。

但自由定位段用的是绝对坐标（`boxX/boxY/boxW`），克隆到拆分卡里，坐标参考系变了，段会错位：

```
原卡：段 A 在 boxY=0.8（接近底部）
拆分卡 1（续）：段 A 还在 boxY=0.8 —— 但拆分卡是张新卡，0.8 的位置可能根本没内容
```

### 解法：有自由定位段的卡，干脆不拆

```typescript
// utils/poster.ts · splitCardIfOverflow
export function splitCardIfOverflow(card: ReportCard, budget: number): ReportCard[] {
  if (card.type === 'cover' || card.type === 'ending') return [card]
  // ...
  // P10：自由定位段用绝对坐标，拆卡会让坐标错位 → 有自由定位段的卡不拆
  if (segs.some(s => s.style && s.style.boxX !== undefined)) return [card]
  if (segs.length <= budget) return [card]
  // ... 按 budget 切块
}
```

这是一个有意思的权衡——**自由布局本质是「用户接管排版」，那就不再自动兜底拆卡**。用户自己保证内容不超长，换取绝对的排版自由。这和 Canva / Figma 里「自动布局」与「自由画布」的关系类似：要么让系统帮你排（流式，可自动拆），要么你自己排（自由，不自动拆）。

顺带，`measureTotalHeight`（预测量卡片高度）也要排除自由定位段——它们不参与流式栈高度计算，否则会把居中栈顶算偏：

```typescript
// 自由定位段不参与栈高
if (seg.style && seg.style.boxX !== undefined) continue
```

---

## 五、把「容易遗漏」变成「流程强制」

技术方案有了，但人是会犯错的。下次再加一个视觉效果（比如文字描边、阴影），怎么保证又同步改了两边？

我们用三条纪律把这个变成流程：

### 5.1 抽公共函数，消除重复

流式段和自由定位段的文字绘制逻辑抽成了 `drawSegmentTextBlock`——设置字体、折行、P9 transform 包裹、绘制，都在这一个函数里。流式路径和自由路径都调它，区别只是传入的盒子坐标不同（流式用 curY 当前位置，自由用绝对 boxLeft/boxTop）。

这样 P9 的旋转/倾斜包裹只需要写一遍，两边自动一致。

### 5.2 测试锁住关键不变量

`test/report-edit-transform/verify.ts` 里有 60+ 条断言，专门测样式合并和视图生成。每加一个视觉属性，就在这里加一组断言：

```typescript
// 回归保护：无新字段时不破坏老报告
const v = buildSegmentViews(card, rs)[0]
assert(v.transformCss === '', '无 rotate/skew → transformCss = 空串')

// 旋转 + 倾斜同时设置
const card = mkCard({ segments: [{ text: 'x', style: { rotate: 15, skew: -8 } }] })
assert(v.transformCss === 'rotate(15deg) skewX(-8deg)', '含两段')

// P10 自由布局：缺省值正确补齐
const card = mkCard({ segments: [{ text: 'x', style: { boxX: 0.4 } }] })
assert(v.boxCss === 'position: absolute; left: 40%; top: 0%; width: 100%;',
  '仅 boxX → boxY/boxW 用默认')
```

这些断言跑在纯 Node 环境（零依赖），每次改动几秒钟就能验证。

### 5.3 构建期 lint 防静默失效

`lint:wxml` 扫所有页面的 `.wxml`，抽出 `bind*`/`catch*` 事件处理器，到同名 `.ts` 里找定义——找不到就报错退出。这条 lint 专门防一种 bug：wxml 里写了 `bindtap="onSegBoxDragStart"` 但 ts 里忘了写这个方法。微信小程序平台**不会报错**，真机上就是手势点了没反应，极难发现。

加 P10 的 5 个手势 handler 时，这条 lint 立刻派上用场——它一次扫了全项目 413 处事件绑定，确认所有 handler 都有定义。

---

## 六、效果与反思

这套 dual-render 同源纪律经历了 P9（视觉属性：rotate/skew/fontFamily/letterSpacing）和 P10（几何属性：boxX/boxY/boxW）两次扩展验证：

- 两次都顺利加完字段、两边同步实现、测试通过
- **老报告零回归**——所有新字段都是可选的，缺省即走原有流式堆叠，老数据不需要迁移
- 全项目 12 套测试 / 565 条断言全绿

回头看，整个设计的关键决策其实就两条：

1. **样式存一份**（单一数据源），避免两套实现各漂各的
2. **几何坐标用小数**（归一化），自动绕开比例不一致

剩下的（旋转中心对齐、抽公共函数、测试锁不变量、lint 防静默失效）都是在这两条地基上的工程加固。

---

## 七、一句话总结

> **把样式存一份、用归一化坐标、两侧各自翻译、加测试锁住。**

这套方法论不限于微信小程序——任何「同一份数据要喂给两套渲染引擎」的场景（比如 Web 预览 + PDF 导出、设计工具的画布 + 导出）都可以套用。

---

*本文来自 [荧烛微光](../../) 项目的开发实践。项目开源，欢迎交流。*
