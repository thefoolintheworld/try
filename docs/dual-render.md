# 双渲染同源纪律（Dual-Render）

> 报告编辑器最硬的一条不变量：**用户在预览里看到什么样，导出海报就必须长什么样。**

## 问题背景

「荧烛微光」的报告编辑器里，用户对每个段落都能调样式（字号 / 颜色 / 对齐 / 艺术字 / 旋转 / 倾斜 / 字间距 / 自由布局）。这些样式有两处要呈现：

| 渲染端 | 引擎 | 比例 | 用途 |
|---|---|---|---|
| **WXSS 预览** | 浏览器渲染管线（WebView） | ≈ 1:1（750rpx × 720rpx） | 编辑时实时所见 |
| **Canvas 导出** | Canvas 2D 手工绘制 | 3:4（600px × 800px） | 保存到相册的海报 |

两套引擎、比例还不一样。如果各自实现各自的样式逻辑，几乎必然出现「预览里看着挺好，导出来歪了」的 bug——而这种 bug 用户感知极强，且很难在测试阶段穷举。

## 解法：单一数据源 + 归一化坐标

核心思想是**所有样式只存一份**，两个渲染器各自从这一份数据出发，把它翻译成自己的语言。

### 数据层

```
SegmentStyle（定义在 utils/design-tokens.ts）
  ├── 视觉属性：color / fontSizeScale / align / artFont / strokeColor ...
  ├── P9 视觉属性：rotate / skew / fontFamily / letterSpacing
  └── P10 几何属性：boxX / boxY / boxW（归一化小数 0~1）
```

合并语义统一走 `mergeSegmentStyle(...layers)`——后层覆盖前层、跳过 undefined（保留既有值）。这是两侧共享的真相源。

### 关键：几何坐标用小数，不用 rpx/px

这是整个设计的精髓。预览和导出比例不同：

```
预览：750rpx 宽 × 720rpx 高   →  X 缩放 ≈ 1.0 rpx/rpx，Y 缩放 ≈ 1.0
导出：600px 宽 × 800px 高     →  X 缩放 ≈ 0.8 px/rpx，Y 缩放 ≈ 1.11
```

如果存原始 rpx，两边换算系数不同，预览拖到卡片中间的段，导出时会偏到一边。

**解法**：几何字段（`boxX` / `boxY` / `boxW`）存**归一化小数（0~1，相对卡片正文区）**。两边各自乘以自己的正文区尺寸：

```
WXSS：  left: {boxX * 100}%;  top: {boxY * 100}%;  width: {boxW * 100}%;
Canvas：boxLeft = x + boxX * maxW;  boxTop = y + boxY * maxH;  boxWidth = boxW * maxW
```

预览拖到 50% 位置，导出也是 50% 位置，所见即所得。

### 视觉属性的 dual-render

颜色 / 字号 / 对齐这类字段，两边各自换算成自己的语法（WXSS 用 `font-size: N rpx`，Canvas 用 `ctx.font = 'Npx ...'`），但读的是同一份值。

P9 引入的旋转 / 倾斜尤其要注意旋转中心对齐：

- WXSS 默认 `transform-origin: 50% 50%`（元素中心）
- Canvas `ctx.rotate()` 绕当前坐标系原点旋转——所以要 `ctx.translate(到元素中心) → rotate → translate(回)`，并按对齐方式算出真正的水平中心

## 纪律：新增视觉效果必须两边都改

这是把「容易遗漏」变成「流程强制」的关键。本项目规定：

1. 任何 `SegmentStyle` 的新字段，WXSS 侧（`buildSegmentViews`）和 Canvas 侧（`drawSegments`）必须**同步实现**
2. 实现完必须在 `test/report-edit-transform/verify.ts` 加断言
3. `lint:wxml` 会在构建期校验所有 wxml 事件处理器都有对应的 ts 方法，防止「绑了 handler 没写实现」的静默失效

这套纪律在 P9（视觉属性）和 P10（几何属性）两次扩展中被验证有效——两次都顺利加完字段、两边同步、测试通过、老报告零回归。

## 反面案例（真实踩过的坑）

### 旋转中心不一致（P9）

最初 Canvas 侧绕 `drawX`（文字边缘）旋转，WXSS 绕元素中心旋转，导致左对齐文字旋转后位置偏移。修复：Canvas 先按对齐方式算出真正的水平中心，再围绕它转。

### 绝对坐标遇到自动拆卡（P10）

`splitOverflowCards` 会把超长卡的段克隆到拆分卡里。但自由定位段用绝对坐标（`boxX/boxY/boxW`），克隆到拆分卡里坐标会错位。

**解法**：`splitCardIfOverflow` 开头判断——只要卡里有任何自由定位段，整张卡不拆（用户接管排版，不再自动兜底）。

## 一句话总结

> **把样式存一份、用归一化坐标、两侧各自翻译、加测试锁住。** 这就是 dual-render 同源纪律。
