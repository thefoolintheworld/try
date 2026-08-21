// utils/reading-guide.ts
// P3-2 共读问题模板：预设问题库，按书类型/心境分类，引导用户结构化自问自答。
//
// 设计：
//   - 纯本地「预设问题 + 思考角度清单」，不涉及用户间交互（避开「用户间数据流通」合规红线）。
//   - 本质是「单用户的结构化自问自答模板」——帮用户把模糊感受落成可写的文字。
//   - 问题分四组：通用 / 文学向（reading/film）/ 非虚构向 / 心境联动。
//   - 用户回答写进 Item.understanding（复用现有字段，不新增存储）。
//   - 零合规风险：纯静态字符串，无 AI、无外部服务。

/** 单个引导问题 */
export interface GuideQuestion {
  /** 问题正文 */
  text: string
  /** 分组标签（通用 / 文学 / 非虚构 / 心境）*/
  group: 'common' | 'narrative' | 'nonfiction' | 'mood'
  /** 推荐的思考角度提示（一句话，给用户思路）*/
  hint?: string
}

/** 通用问题：适用于任何分类的成就 */
const COMMON_QUESTIONS: GuideQuestion[] = [
  { text: '读完一周后，你最记得哪个场景？', group: 'common', hint: '记忆筛过的，往往是真正触动你的部分。' },
  { text: '如果推荐给一个朋友，你会怎么说？', group: 'common', hint: '用一句话把它讲明白。' },
  { text: '它和你之前读过的哪本最像，又哪里不同？', group: 'common' },
  { text: '一年后再看，你希望还记得它的什么？', group: 'common' },
]

/** 文学/叙事类问题：reading/film 用（偏情节/人物/视角）*/
const NARRATIVE_QUESTIONS: GuideQuestion[] = [
  { text: '主角的哪个决定让你最意外？', group: 'narrative', hint: '想想那个转折点发生时你的反应。' },
  { text: '叙事视角如何影响你的阅读体验？', group: 'narrative' },
  { text: '哪个角色最像你，或最不像你？', group: 'narrative', hint: '投射与反差都是认识自己的镜子。' },
  { text: '如果你是作者，会给它换一个怎样的结局？', group: 'narrative' },
  { text: '它的开头和结尾，哪个更打动你？', group: 'narrative' },
]

/** 非虚构/成长类问题：skill/travel/exam 等用（偏行动/反思）*/
const NONFICTION_QUESTIONS: GuideQuestion[] = [
  { text: '哪个观点你想反驳？', group: 'nonfiction', hint: '反对的声音往往最值得记下来。' },
  { text: '这本书改变了你什么行动？', group: 'nonfiction' },
  { text: '它解决了你的哪个困惑，又留下哪个新困惑？', group: 'nonfiction' },
  { text: '哪个章节你最想重读？', group: 'nonfiction' },
]

/** 心境联动问题：按心境词索引（与 tag-presets MOOD_OPTIONS 对齐）*/
const MOOD_QUESTIONS: { [mood: string]: GuideQuestion[] } = {
  '意难平': [
    { text: '这本书哪里让你最放不下？', group: 'mood', hint: '放不下的，往往是没说完的话。' },
    { text: '如果是你，你会怎么选？', group: 'mood' },
  ],
  '感动': [
    { text: '哪个细节让你眼眶一热？', group: 'mood' },
    { text: '它让你想立刻对谁说点什么？', group: 'mood' },
  ],
  '深思': [
    { text: '它把你引向了一个什么样新问题？', group: 'mood' },
    { text: '你想反驳它的哪个观点？', group: 'mood' },
  ],
  '震撼': [
    { text: '它颠覆了你原来的哪个认知？', group: 'mood' },
    { text: '哪一段让你合上书愣了几秒？', group: 'mood' },
  ],
  '共鸣': [
    { text: '它说中了你心里哪句没说出口的话？', group: 'mood' },
    { text: '哪一段像是在写你自己？', group: 'mood' },
  ],
  '治愈': [
    { text: '它抚平了你心里的哪道皱褶？', group: 'mood' },
  ],
  '怅然': [
    { text: '它让你想起了哪段已经过去的事？', group: 'mood' },
  ],
  '平静': [
    { text: '它给了你一种什么样的安静？', group: 'mood' },
  ],
}

/** 文学类分类判定：reading/film 走叙事向问题 */
function isNarrativeCategory(category: string): boolean {
  return category === 'reading' || category === 'film'
}

/** 分组标签的中文显示名 */
export const GROUP_LABELS: { [k in GuideQuestion['group']]: string } = {
  common: '通用',
  narrative: '叙事向',
  nonfiction: '非虚构向',
  mood: '心境联动',
}

/** 取某本书/某条成就的推荐引导问题列表。
 *  组装顺序：心境联动（若有）→ 分类专属（文学/非虚构）→ 通用兜底。
 *  返回去重后的问题数组（按组排列），给 reading-guide 页渲染用。
 *  参数 category 和 mood 都可选；缺省返回通用组。 */
export function getGuideQuestions(opts?: { category?: string; mood?: string }): GuideQuestion[] {
  const out: GuideQuestion[] = []
  const seen = new Set<string>()

  const pushUnique = (qs: GuideQuestion[]) => {
    for (const q of qs) {
      if (!seen.has(q.text)) {
        seen.add(q.text)
        out.push(q)
      }
    }
  }

  // 1. 心境联动（最贴合当下情绪，排最前）
  if (opts && opts.mood) {
    const pool = MOOD_QUESTIONS[opts.mood]
    if (pool) pushUnique(pool)
  }
  // 2. 分类专属
  if (opts && opts.category) {
    pushUnique(isNarrativeCategory(opts.category) ? NARRATIVE_QUESTIONS : NONFICTION_QUESTIONS)
  }
  // 3. 通用兜底
  pushUnique(COMMON_QUESTIONS)

  return out
}
