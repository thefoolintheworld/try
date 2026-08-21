// utils/category-meta.ts
// 成就分类元数据：预设分类的标签/图标/配色，以及自定义分类的派色规则。
// 成就系统主轴下，每条 Item 都带 category 字段；本文件是「分类 → 用户可见元信息」的单一数据源。
// 首页仪表盘、成就墙筛选、编辑页分类选择器、报告生成时的成就分组都从这里读。

import { designTokens } from './design-tokens'

export interface CategoryMeta {
  id: string       // 分类标识（存进 Item.category）；预设用语义 id，自定义用用户输入的字符串
  label: string    // 用户可见名称
  icon: string     // emoji 图标
  color: string    // 代表色（列表角标/筛选 chip 配色）
}

/** 预设分类：阅读/观影 与 技能/游戏/旅行/考试/第一次 平级 */
export const PRESET_CATEGORIES: CategoryMeta[] = [
  { id: 'reading', label: '阅读',   icon: '📖', color: '#6B8E5A' },
  { id: 'film',    label: '观影',   icon: '🎬', color: '#8B6F9C' },
  { id: 'skill',   label: '技能',   icon: '🎯', color: '#E8A33D' },
  { id: 'game',    label: '游戏',   icon: '🎮', color: '#D97A4A' },
  { id: 'travel',  label: '旅行',   icon: '✈️', color: '#5B8FA8' },
  { id: 'exam',    label: '考试',   icon: '📝', color: '#C26B6B' },
  { id: 'first',   label: '第一次', icon: '🌟', color: '#A88B5C' },
]

/** 自定义分类默认图标 */
export const CUSTOM_CATEGORY_ICON = '🏆'

const PRESET_MAP: { [id: string]: CategoryMeta } = PRESET_CATEGORIES.reduce(
  (m, c) => { m[c.id] = c; return m },
  {} as { [id: string]: CategoryMeta },
)

/** 字符串 hash → coverPalette 取色（自定义分类派稳定色） */
function hashColor(s: string): string {
  const palette = designTokens.coverPalette
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  const idx = Math.abs(h) % palette.length
  return palette[idx]
}

/**
 * 解析一条成就/愿望的有效分类 id（全局单一真相源，杜绝双口径默认值）。
 *
 * 历史背景：早期代码里散落两种默认值写法——
 *   - `it.category || 'reading'`（聚合口径）：把缺分类的 film 错算成 reading
 *   - `it.category || (it.type === 'film' ? 'film' : 'reading')`（完整口径）
 * migrateToV4 保证老 Item 都补了 category，所以两种写法在真实数据上结果一致；
 * 但只要哪天出现 category 为空的 Item（自定义分类被删等），就会静默不一致。
 * 此函数统一走完整口径，把约定变成唯一入口，新增代码一律用它而不是手写三元。
 *
 * 愿望侧：Wish 没有 type 字段，传 undefined 即可（自动回落到 'reading'）。
 */
export function resolveCategory(category: string | undefined, type?: string): string {
  if (category) return category
  return type === 'film' ? 'film' : 'reading'
}

/** 取某分类的元信息：预设命中返回预设；自定义分类派 icon+color，label 用分类字符串本身 */
export function getCategoryMeta(category: string): CategoryMeta {
  const preset = PRESET_MAP[category]
  if (preset) return preset
  return {
    id: category,
    label: category,
    icon: CUSTOM_CATEGORY_ICON,
    color: hashColor(category || 'custom'),
  }
}

/** 判断某分类是否为预设（用于编辑页区分「自定义分类」分支） */
export function isPresetCategory(category: string): boolean {
  return !!PRESET_MAP[category]
}

/** 合并预设分类 + 用户自定义分类（许愿星侧用），返回完整列表。
 *  自定义分类若与预设 id 冲突则被忽略（预设为准）。每项补齐 color（自定义派稳定色）。
 *  与 checkin-presets.getAllCheckinCategories / inspiration-presets.getAllInspirationCategories 同模式。 */
export function getAllCategoriesWithCustom(custom?: { id: string; label: string; icon: string }[]): CategoryMeta[] {
  const presetIds = new Set(PRESET_CATEGORIES.map(c => c.id))
  const customList = (custom || [])
    .filter(c => !presetIds.has(c.id))
    .map(c => ({
      id: c.id,
      label: c.label,
      icon: c.icon || CUSTOM_CATEGORY_ICON,
      color: hashColor(c.id || 'custom'),
    }))
  return [...PRESET_CATEGORIES, ...customList]
}

/** 在「预设 + 自定义」合并列表里按 id 查；找不到回落到 getCategoryMeta（派色兜底）。
 *  确保用户自定义分类显示用户给的 label/icon，而不是拿 id 当 label。 */
export function findCategoryWithCustom(id: string, custom?: { id: string; label: string; icon: string }[]): CategoryMeta {
  const all = getAllCategoriesWithCustom(custom)
  const found = all.find(c => c.id === id)
  if (found) return found
  return getCategoryMeta(id)
}
