// utils/note-prompts.ts
// 短评引导 Prompt：录入页笔记框上方随机显示一句，帮用户破冰动笔。
//
// 设计：
//   - 用户对着空白笔记框常常卡壳；给一句轻量提问当"钩子"，降低录入摩擦（参考 Day One Prompts / Daily_You）。
//   - 全分类通用：reading/film/skill/... 都能用。措辞偏"成就/作品"中性词，不绑死"书"。
//   - 只是建议，不强制——点 ✨ 可换一句，用户也可直接无视写自己的。
//   - 纯静态字符串数组，无外部依赖；录入页 onLoad 随机抽一条，存到 data.notePrompt。
//
// P3 升级（T2-6）：按分类 + 心境动态选 Prompt。
//   - 文学/观影类推叙事向提问；技能/旅行类推行动向提问。
//   - 用户选了心境（如「意难平」）则优先推与该心境契合的提问。
//   - 纯本地映射表，无 AI。

/** 全分类通用的短评 Prompt 列表（录入页随机抽一条显示在笔记框上方） */
export const NOTE_PROMPTS: string[] = [
  '这一刻最打动你的是什么？',
  '如果只能推荐给一个人，会是谁？',
  '它让你想到了过去的哪段经历？',
  '完成后，你和之前的自己有什么不同？',
  '最难忘的一个细节是什么？',
  '它让你想立刻去做的一件事是？',
  '如果要给它起个绰号，会叫什么？',
  '它解决了你的哪个困惑？',
  '哪一刻让你觉得"值了"？',
  '如果只能记住一句话，会是哪句？',
  '它让你重新看待了什么？',
  '谁最应该和你一起经历它？',
  '它让你想起了哪首歌或哪种天气？',
  '再过一年，你希望还记得它的什么？',
  '它给了你一个什么样的"词条"？',
]

/** 叙事类分类专属 Prompt（reading / film）：偏情节/人物/视角的提问 */
const NARRATIVE_PROMPTS: string[] = [
  '主角的哪个决定让你最意外？',
  '叙事视角如何影响你的阅读体验？',
  '哪个场景你想反复重读/重看？',
  '如果你是作者，会给它换一个怎样的结局？',
  '哪个角色最像你，或最不像你？',
  '它的开头和结尾，哪个更打动你？',
]

/** 行动类分类专属 Prompt（skill / travel / game / exam / first-time / 自定义）：偏行动/成长的提问 */
const ACTION_PROMPTS: string[] = [
  '这个过程里，你突破了哪个瓶颈？',
  '如果重来一次，你会从哪一步开始？',
  '它让你解锁了哪个新能力？',
  '最难的瞬间是怎么熬过来的？',
  '它改变了你接下来的哪个计划？',
  '下次你想挑战什么？',
]

/** 心境专属 Prompt：键 = 心境词（与 tag-presets 的 MOOD_OPTIONS 对齐），值 = 契合该心境的提问。
 *  心境是瞬时情绪，提问应顺着这种情绪走（意难平→追细节，平静→感受氛围，感动→记细节）。 */
const MOOD_PROMPTS: { [mood: string]: string[] } = {
  '感动': ['哪个细节让你眼眶一热？', '它让你想立刻对谁说点什么？'],
  '震撼': ['它颠覆了你原来的哪个认知？', '哪一段让你合上书/关掉屏幕愣了几秒？'],
  '意难平': ['这本书哪里让你最放不下？', '如果是你，你会怎么选？'],
  '平静': ['它给了你一种什么样的安静？', '哪个画面你想留在脑海里？'],
  '热血': ['它点燃了你去做什么的冲动？', '哪一句让你想拍桌子？'],
  '深思': ['它把你引向了一个什么样新问题？', '你想反驳它的哪个观点？'],
  '治愈': ['它抚平了你心里的哪道皱褶？', '哪个瞬间让你松了口气？'],
  '怅然': ['它让你想起了哪段已经过去的事？', '故事的哪个余味还在你心里？'],
  '惊喜': ['它在哪里出乎了你的意料？', '哪个反转你最没料到？'],
  '共鸣': ['它说中了你心里哪句没说出口的话？', '哪一段像是在写你自己？'],
}

/** 叙事类分类判定：reading/film 走叙事向提问 */
function isNarrativeCategory(category: string): boolean {
  return category === 'reading' || category === 'film'
}

/** 从数组里随机抽一个元素。空数组兜底返回 undefined。 */
export function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr || arr.length === 0) return undefined
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 专门给录入页用：抽一条 prompt，永不返回 undefined（兜底返回首条） */
export function pickNotePrompt(): string {
  return pickRandom(NOTE_PROMPTS) || NOTE_PROMPTS[0] || ''
}

/** P3 上下文感知选 Prompt（T2-6）：按心境 > 分类 > 通用 三级优先。
 *  - 有心境且命中 MOOD_PROMPTS → 从该心境专属池抽（最贴合当下情绪）
 *  - 否则按分类：reading/film → 叙事池；其它 → 行动池
 *  - 都没有命中或池为空 → 回退通用池
 *  参数都可选；缺省即纯随机通用 Prompt（与原 pickNotePrompt 行为兼容）。
 *  永不返回 undefined（兜底返回通用首条）。 */
export function pickContextualNotePrompt(opts?: { category?: string; mood?: string }): string {
  // 1. 心境优先
  if (opts && opts.mood) {
    const pool = MOOD_PROMPTS[opts.mood]
    if (pool && pool.length > 0) {
      return pickRandom(pool) || pool[0]
    }
  }
  // 2. 分类次之
  if (opts && opts.category) {
    const catPool = isNarrativeCategory(opts.category) ? NARRATIVE_PROMPTS : ACTION_PROMPTS
    if (catPool.length > 0) {
      return pickRandom(catPool) || catPool[0]
    }
  }
  // 3. 通用兜底
  return pickRandom(NOTE_PROMPTS) || NOTE_PROMPTS[0] || ''
}

