# 贡献指南

感谢你对「荧烛微光」的兴趣！本项目欢迎 Issue、Bug 报告、功能建议和 Pull Request。

## 开发前必读

开工前请先读 [`AGENTS.md`](AGENTS.md)——这是项目的开发约定，**所有 PR 都要遵守**。要点：

- 数据读写统一走 `utils/storage.ts`
- 配色只改 `design-tokens.ts` 与 `app.less`，**禁止硬编码 hex**
- **LESS 禁用编译期颜色函数**（`fade()` / `lighten()` / `mix()` 等会真机白屏），透明叠加只用 `color-mix(in srgb, @x N%, transparent)`
- **不用 `?.` / `??`**（ES2019 钉死，真机旧基础库不支持）
- Canvas 严守 dpr 纪律
- 新增视觉效果须 WXSS 与 Canvas **双边同步**（见 [dual-render 纪律](docs/dual-render.md)）
- **合规边界不可破**：无 AI 生成文案、无用户间数据流通、无豆瓣抓取、无付费/广告

## 提交前必跑

```bash
cd app && npm run lint    # 三条构建期 lint 必须全绿
cd app && npx tsc --noEmit  # 类型检查（允许只剩已知第三方声明错误）
```

改动聚合器（`utils/stats.ts` 等）或页面交互后，建议额外跑对应测试套件，确认无回归。

## 提 Issue

- **Bug**：附重现步骤 + 预期 vs 实际行为 + 基础库版本
- **功能建议**：说明场景和动机，最好附简单草图或文案样例

## 提 PR

1. Fork → 建分支 → 改 → 提 PR
2. PR 描述写清「改了什么 / 为什么 / 如何验证」
3. 涉及数据模型改动时，必须同步更新 `AGENTS.md` 的「核心数据模型」段
4. 涉及新页面时，必须在 `app.json` 的 `pages` 数组注册

## 行为准则

保持友善、对事不对人。这个项目是个人作品，review 可能没那么及时，请多包涵。
