// utils/tag-presets.ts
// 情绪与五感标签预设：录入成就时快速点选的情感/感官记忆词。
// 启用 Item.tags 字段（storage.ts 已预留但此前未启用）。
//
// 设计：
//   - 标签是自由 string[]，预设只是快捷输入入口，用户也能自定义任意词。
//   - 分两组：情绪（成就给你的感受）+ 五感（那一刻的感官记忆）。
//   - 不与分类耦合——任何分类的成就都能挂任何标签（一本书可以「醍醐灌顶」也可以「咖啡香」）。
//   - 预设词覆盖中文阅读/观影/生活成就的常见情感光谱，参考豆瓣书评 tag + StoryGraph mood。

/** 标签分组视图模型（录入页按分组展示预设 chip） */
export interface TagGroup {
  /** 分组 id（用于 wxml 渲染 key） */
  id: string
  /** 分组显示名 */
  label: string
  /** 该分组的预设标签词 */
  tags: string[]
}

/** 情绪标签：成就带给你的感受。覆盖正/负/中性情感光谱。 */
export const EMOTION_TAGS: string[] = [
  '醍醐灌顶', '意难平', '热血沸腾', '治愈温暖',
  '豁然开朗', '怅然若失', '心潮澎湃', '若有所思',
  '相见恨晚', '五味杂陈', '久久不能平静', '会心一笑',
]

/** 五感标签：那一刻的感官记忆。让回忆立体起来。 */
export const SENSE_TAGS: string[] = [
  '咖啡香', '油墨味', '雨声', '阳光', '深夜静谧',
  '海风', '老唱片', '烟火气', '清晨', '炉火',
]

/** 分好组的预设标签（录入页循环渲染用） */
export const PRESET_TAG_GROUPS: TagGroup[] = [
  { id: 'emotion', label: '情绪', tags: EMOTION_TAGS },
  { id: 'sense', label: '五感', tags: SENSE_TAGS },
]

/** 所有预设标签的扁平集合（用于判断某标签是不是预设、去重等） */
export const ALL_PRESET_TAGS: string[] = PRESET_TAG_GROUPS.reduce(
  (acc, g) => acc.concat(g.tags),
  [] as string[]
)

/** 判断一个标签是否是预设词（用于 UI 决定要不要标「自定义」标记） */
export function isPresetTag(tag: string): boolean {
  return ALL_PRESET_TAGS.indexOf(tag) !== -1
}

/* ============================================================
 * P3-1 心境单选候选（Item.mood 用）
 * ============================================================
 * mood 与 tags 的语义区分：
 *   - tags（多选）= 这本书/这件事的属性标签（醍醐灌顶、咖啡香、叙事节奏…），持久、可多个。
 *   - mood（单选）= 读完/做完那一刻的主导心境，瞬时、只有一个。
 * 候选词从 EMOTION_TAGS 取一个适合「瞬时心境」的子集（去掉偏「属性」的词如"相见恨晚"，
 * 留下偏「此刻感受」的），再加一个空选项让用户可以不选。
 * 设计：单选语义，UI 上是 chip 单选组（不是 tags 的多选 chip 组）。 */
export const MOOD_OPTIONS: string[] = [
  '醍醐灌顶',
  '意难平',
  '治愈温暖',
  '豁然开朗',
  '怅然若失',
  '心潮澎湃',
  '若有所思',
  '五味杂陈',
  '久久不能平静',
  '会心一笑',
]

/** 空选项标识（UI 上显示「无」，存储上不写入 mood 字段即 undefined）*/
export const MOOD_NONE = '无'
