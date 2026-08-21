// utils/inspiration-presets.ts
// 灵感抽屉的分类预设：给灵感记录打标签，方便归类与筛选。
// 模仿 category-meta.ts 的常量导出模式；与成就分类（reading/film）完全无关，独立词表。

export interface InspirationCategoryMeta {
  id: string       // 分类标识（存进 Inspiration.category）
  label: string    // 用户可见名称
  icon: string     // emoji 图标（列表/筛选条用）
}

/** 预设灵感分类：覆盖最常见的闪念类型。
 *  用户从添加行的 chip 里选其一；不强制——但 Inspiration.category 必填，默认 'idea'。 */
export const INSPIRATION_CATEGORIES: InspirationCategoryMeta[] = [
  { id: 'idea',     label: '点子',   icon: '💡' },
  { id: 'writing',  label: '写作',   icon: '✍️' },
  { id: 'memo',     label: '备忘',   icon: '📌' },
  { id: 'quote',    label: '摘抄',   icon: '📖' },
  { id: 'thought',  label: '随想',   icon: '🍃' },
]

/** 默认分类（用户没选时落到这里） */
export const DEFAULT_INSPIRATION_CATEGORY = 'idea'

/** 合并预设 + 用户自定义灵感分类，返回完整列表（预设在前，自定义在后）。
 *  自定义 id 若与预设冲突，自定义那条被忽略（预设为准）。给灵感页 chip 行、分类筛选条用。
 *  模式与 checkin-presets.getAllCheckinCategories 一致。 */
export function getAllInspirationCategories(custom?: { id: string; label: string; icon: string }[]): InspirationCategoryMeta[] {
  const presetIds = new Set(INSPIRATION_CATEGORIES.map(c => c.id))
  const customList = (custom || []).filter(c => !presetIds.has(c.id))
  return [...INSPIRATION_CATEGORIES, ...customList]
}

/** 在「预设 + 自定义」合并列表里按 id 查；找不到回退到默认（保留原始 id，便于自定义分类显示正确 label/icon） */
export function findInspirationCategory(id: string, custom?: { id: string; label: string; icon: string }[]): InspirationCategoryMeta {
  const all = getAllInspirationCategories(custom)
  const found = all.find(c => c.id === id)
  if (found) return found
  return { id, label: id, icon: '🍃' }
}

/** 按 id 取分类元信息；未知 id 回退到默认分类（兼容老数据/自定义） */
export function getInspirationCategoryMeta(id: string): InspirationCategoryMeta {
  const found = INSPIRATION_CATEGORIES.find(c => c.id === id)
  if (found) return found
  return { id, label: id, icon: '🍃' }
}
