// utils/checkin-presets.ts
// 每日打卡的分类预设：给打卡记录打一个轻量动作标签，方便归类与连续天数可视化。
// 模仿 inspiration-presets.ts 的常量导出模式；与成就分类（reading/film/skill…）部分重叠但词表独立——
// 打卡场景偏「每日动作」（读书/运动/冥想…），成就场景偏「完成的事物」（读了一本书/看了一部片）。

export interface CheckinCategoryMeta {
  id: string       // 分类标识（存进 Checkin.category）
  label: string    // 用户可见名称
  icon: string     // emoji 图标（打卡页 chip / 列表标签用）
}

/** 预设打卡分类：覆盖最常见的每日习惯动作。
 *  用户从打卡页的 chip 里选其一；不强制——但 Checkin.category 必填，默认 'reading'。
 *  词表与成就分类有意不同（成就用 reading/film/skill，打卡用更日常的动作词）。
 *  注：「其它」预设已于 2026-08 移除——它强制用户为完成全勤打卡而打不需要的项，体验差。
 *  老数据里 category='other' 的打卡记录仍由下方兜底逻辑保留（显示原 id 当 label，不强行映射成别的分类）。 */
export const CHECKIN_CATEGORIES: CheckinCategoryMeta[] = [
  { id: 'reading',   label: '阅读',   icon: '📖' },
  { id: 'film',      label: '观影',   icon: '🎬' },
  { id: 'skill',     label: '学习',   icon: '🎯' },
  { id: 'exercise',  label: '运动',   icon: '🏃' },
  { id: 'meditation',label: '冥想',   icon: '🧘' },
]

/** 默认分类（用户没选时落到这里） */
export const DEFAULT_CHECKIN_CATEGORY = 'reading'

/** 按 id 取分类元信息；未知 id（含已移除的 'other' 老数据、未注册的自定义 id）回退保留原 id 当 label。
 *  这样老 'other' 记录在历史列表/日历仍能正常显示一行，但不会出现在「今日打卡」chip 行
 *  （今日行只遍历 getAllCheckinCategories = 预设+自定义，'other' 已不在预设里）。 */
export function getCheckinCategoryMeta(id: string): CheckinCategoryMeta {
  const found = CHECKIN_CATEGORIES.find(c => c.id === id)
  if (found) return found
  // 未知 id：保留原始 id 作为 label（兼容老数据/已删的自定义分类），用通用图标
  return { id, label: id, icon: '✦' }
}

/** 合并预设 + 用户自定义打卡分类，返回完整列表（预设在前，自定义在后）。
 *  自定义 id 若与预设冲突，自定义那条被忽略（预设为准）。给打卡页 chip 行、成就分类遍历用。
 *  disabled（第二批功能 2）：用户主动隐藏的分类 id 集合，从这里过滤掉（不显示在「今日打卡」行），
 *  但已有打卡记录仍保留显示（靠 getCheckinCategoryMeta 兜底）。 */
export function getAllCheckinCategories(
  custom?: { id: string; label: string; icon: string }[],
  disabled?: string[],
): CheckinCategoryMeta[] {
  const presetIds = new Set(CHECKIN_CATEGORIES.map(c => c.id))
  const customList = (custom || []).filter(c => !presetIds.has(c.id))
  const merged = [...CHECKIN_CATEGORIES, ...customList]
  if (!disabled || disabled.length === 0) return merged
  const disabledSet = new Set(disabled)
  return merged.filter(c => !disabledSet.has(c.id))
}

/** 在「预设 + 自定义」合并列表里按 id 查；找不到回落到保留原 id 的兜底（与 getCheckinCategoryMeta 一致，
 *  但会先查自定义，确保自定义分类显示正确 label/icon）。disabled 仅影响「列表展示」，
 *  查找（含被隐藏分类的老记录显示）不应被 disabled 拦截——这里不传 disabled。 */
export function findCheckinCategory(id: string, custom?: { id: string; label: string; icon: string }[]): CheckinCategoryMeta {
  const all = getAllCheckinCategories(custom)
  const found = all.find(c => c.id === id)
  if (found) return found
  return { id, label: id, icon: '✦' }
}
