// utils/preferences.ts
// 用户偏好持久化（主题、字体等应用级设置）
// 与业务数据（storage.ts 的 book_film_data）分开存放，避免相互污染。
//
// 设计：
//   - 单独的 storage key（'app_preferences'），单独的 schema_version 不需要
//     （结构稳定且字段都可选）。
//   - 提供 load/save + 各字段的便捷 getter/setter，避免调用方直接碰底层。
//   - 主题模式支持 'light' / 'dark' / 'auto'（auto = 跟随系统）。

import { markDirty } from './data-dirty'
import { CheckinGoal } from './checkin-goal'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type FontTitleStyle = 'sans' | 'serif'
/** 暗色子方案：neutral 中性深灰（Apple式）/ warm 暖墨（文学）/ oled 纯黑（省电）*/
export type DarkVariant = 'neutral' | 'warm' | 'oled'
/** 成就墙列数：single 单列（横向大卡）/ double 双列（横向小卡）*/
export type WallLayout = 'single' | 'double'

/** 连胜保护券虚拟填上的打卡日期记录（手动用券保住连胜时生成）。
 *  scope 区分全局（'__global__'）或某分类 id；date 是被虚拟填上的断档日。
 *  仅用于 calcCurrentStreakLenient 的输入合并，不计入真实打卡/总天数/历史最长。 */
export interface ProtectedDateEntry {
  scope: string   // '__global__' 或分类 id（如 'reading'）
  date: string    // 'YYYY-MM-DD' 被虚拟填上的那天
}

/** P2-7 列表页视图模式：
 *  - list：横向卡片（默认，信息密度高）
 *  - grid：紧凑 2 列网格（封面 + 标题，扫视友好）
 *  - gallery：大封面 2 列画廊（视觉优先，适合有图的成就） */
export type ListViewMode = 'list' | 'grid' | 'gallery'

export interface AppPreferences {
  /** 主题模式：light 显式亮 / dark 显式暗 / auto 跟随系统 */
  themeMode: ThemeMode
  /** 标题字体：sans 无衬线（现代）/ serif 衬线（文学）*/
  titleFont: FontTitleStyle
  /** 暗色子方案（仅 themeMode 解析为 dark 时生效）*/
  darkVariant: DarkVariant
  /** 首页成就墙「置顶展示」的成就 id 列表（按用户勾选顺序，最多 6 条有效）。
   *  空数组 → 首页展示最新 6 条（默认）；非空 → 按该顺序展示。 */
  pinnedAchievements: string[]
  /** 首页成就墙列数布局：double 双列（默认，紧凑）/ single 单列（宽松好阅读）*/
  wallLayout: WallLayout
  /** P2-7 列表页视图模式：list 横向卡（默认）/ grid 紧凑网格 / gallery 大封面画廊 */
  listViewMode: ListViewMode
  /** 年度目标：分类 id → 该分类今年目标条数（如 { reading: 50, film: 24 }）。
   *  空对象 → 未设目标（首页不显示进度条）；某分类缺失 → 该分类无目标。 */
  annualGoals: { [category: string]: number }
  /** 年度关键词（用户手动改写优先；为空时由算法推导并回填此处）。
   *  与 annualKeywordYear 配对：跨年时年份不匹配会触发重算。 */
  annualKeyword: string
  /** 当前年度关键词对应的年份；≠ 今年 → refresh 时重算并覆盖。 */
  annualKeywordYear: number
  /** 系统勋章状态：{ 勋章id: { target, unlockedAt? } }。
   *  target=用户改过的目标值（缺省用 medal-config.defaultTarget）；
   *  unlockedAt=首次达成的时间戳（首页/设置页据此显示已解锁；首次达成时写回）。 */
  systemMedals: { [id: string]: { target: number; unlockedAt?: number } }
  /** 连胜保护券功能总开关（默认开启；用户可在设置里关掉） */
  streakProtectionEnabled?: boolean
  /** 当前持有的保护券数量（每月发 1 张，上限 3 张；断了自动消耗 1 张挡一刀） */
  streakFreebies?: number
  /** 上一次发券的月份 'YYYY-MM'（用于判断"是否该发新券"——月份切换即发） */
  lastFreebieMonth?: string
  /** 保护券虚拟填上的打卡日期（连胜保护用）。手动用券保住连胜时 push 一条。
   *  仅合并进 calcCurrentStreakLenient 的输入，不影响真实打卡/总天数/历史最长。 */
  protectedCheckinDates?: ProtectedDateEntry[]
  /** 用户自定义打卡分类（与 checkin-presets 的预设合并使用）。
   *  用户在打卡页「＋」入口新建；每项 { id, label, icon }。id 与预设不可冲突。 */
  customCheckinCategories?: { id: string; label: string; icon: string }[]
  /** 打卡频率目标：分类 id → { frequency, timesPerPeriod }（第二批功能 1）。
   *  frequency=daily/weekly/monthly；timesPerPeriod=整周期目标次数（≥1）。
   *  缺省/某分类缺失 → 该分类无目标（不展示进度，行为同现在）。 */
  checkinGoals?: { [categoryId: string]: CheckinGoal }
  /** 隐藏的打卡分类 id 数组（第二批功能 2）：
   *  用户主动「隐藏」的预设/自定义分类，从「今日打卡」行消失但已有打卡记录保留。
   *  预设是硬编码常量无法真删，只能加入此列表隐藏；可在设置页恢复。 */
  disabledCheckinCategories?: string[]
  /** 用户自定义灵感分类（与 inspiration-presets 的预设合并使用）。
   *  用户在灵感页「＋新建分类」入口新建；每项 { id, label, icon }。id 与预设不可冲突。 */
  customInspirationCategories?: { id: string; label: string; icon: string }[]
  /** 用户自定义许愿星分类（与成就分类 PRESET_CATEGORIES 合并使用）。
   *  用户在许愿星页「＋新建分类」入口新建；每项 { id, label, icon }。id 与预设不可冲突。 */
  customWishCategories?: { id: string; label: string; icon: string }[]
}

const STORAGE_KEY = 'app_preferences'

const DEFAULT_PREFERENCES: AppPreferences = {
  themeMode: 'light',
  titleFont: 'sans',
  darkVariant: 'neutral',
  pinnedAchievements: [],
  wallLayout: 'double',
  listViewMode: 'list',
  annualGoals: {},
  annualKeyword: '',
  annualKeywordYear: 0,
  systemMedals: {},
  // 连胜保护券字段缺省视为「未启用具体状态」：
  //   - streakProtectionEnabled 缺省 = true（isProtectionEnabled 判 !== false）
  //   - streakFreebies 缺省 = 0（getFreebies 用 || 0 兜底）
  //   - lastFreebieMonth 缺省 = ''（refreshFreebies 据此判断「该发本月券」）
  streakProtectionEnabled: true,
  streakFreebies: 0,
  lastFreebieMonth: '',
  protectedCheckinDates: [],
}

/** 清洗 annualGoals：剔除非数字 / 负数 / NaN 的条目，保留合法的分类→目标映射 */
function sanitizeAnnualGoals(raw: { [k: string]: unknown }): { [category: string]: number } {
  const out: { [category: string]: number } = {}
  for (const k of Object.keys(raw)) {
    const v = raw[k]
    if (typeof v === 'number' && !isNaN(v) && v >= 0) {
      out[k] = Math.floor(v)
    }
  }
  return out
}

/** 清洗 systemMedals：每个值必须是 { target: 正整数, unlockedAt?: 正数 }；
 *  非法结构整条丢弃（保守，宁可丢用户的非法输入也不留脏数据）。 */
function sanitizeSystemMedals(raw: unknown): { [id: string]: { target: number; unlockedAt?: number } } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = raw as { [k: string]: unknown }
  const out: { [id: string]: { target: number; unlockedAt?: number } } = {}
  for (const id of Object.keys(src)) {
    const v = src[id]
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const o = v as { target?: unknown; unlockedAt?: unknown }
    if (typeof o.target !== 'number' || isNaN(o.target) || o.target < 0) continue
    const target = Math.floor(o.target)
    const entry: { target: number; unlockedAt?: number } = { target }
    if (typeof o.unlockedAt === 'number' && !isNaN(o.unlockedAt) && o.unlockedAt > 0) {
      entry.unlockedAt = o.unlockedAt
    }
    out[id] = entry
  }
  return out
}

/** 清洗 streakFreebies：必须是 0-3 的整数（MAX_FREEBIES=3 在 streak-protection 里定义，
 *  这里独立硬编码上限做防御；超出范围夹到 0-3，非法类型归 0）。 */
function sanitizeStreakFreebies(raw: unknown): number {
  if (typeof raw !== 'number' || isNaN(raw)) return 0
  const n = Math.floor(raw)
  if (n < 0) return 0
  if (n > 3) return 3
  return n
}

/** 清洗 protectedCheckinDates：必须是数组，每项 { scope: 非空字符串, date: 'YYYY-MM-DD' }，
 *  非法项丢弃，返回清洗后的新数组（去重：同 scope+date 只留一条）。 */
function sanitizeProtectedDates(raw: unknown): ProtectedDateEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ProtectedDateEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const e = item as { scope?: unknown; date?: unknown }
    if (typeof e.scope !== 'string' || !e.scope) continue
    if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue
    const key = e.scope + '|' + e.date
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ scope: e.scope, date: e.date })
  }
  return out
}

/** 清洗 checkinGoals：必须是 plain object，每个值 { frequency: 合法枚举, timesPerPeriod: 正整数 }；
 *  非法条目整条丢弃。频率枚举与 checkin-goal.ts 的 CheckinFrequency 保持一致。 */
function sanitizeCheckinGoals(raw: unknown): { [categoryId: string]: CheckinGoal } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = raw as { [k: string]: unknown }
  const out: { [categoryId: string]: CheckinGoal } = {}
  for (const id of Object.keys(src)) {
    if (!id || typeof id !== 'string') continue
    const v = src[id]
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const o = v as { frequency?: unknown; timesPerPeriod?: unknown }
    if (o.frequency !== 'daily' && o.frequency !== 'weekly' && o.frequency !== 'monthly') continue
    if (typeof o.timesPerPeriod !== 'number' || isNaN(o.timesPerPeriod)) continue
    const n = Math.floor(o.timesPerPeriod)
    if (n < 1) continue
    out[id] = { frequency: o.frequency, timesPerPeriod: n }
  }
  return out
}

/** 清洗 disabledCheckinCategories：必须是字符串数组，去重保留顺序。 */
function sanitizeDisabledCheckin(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    if (typeof id !== 'string' || !id.trim()) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 清洗自定义分类列表（打卡/灵感/许愿星共用同一形状）：必须是数组，每项 { id:非空字符串, label:非空字符串, icon:字符串 }；
 *  同批去重（id 唯一）。与预设的去重交给各 presets 的 getAll* 函数（后者覆盖前者——预设不可被自定义覆盖）。 */
function sanitizeCustomCategoryList(raw: unknown): { id: string; label: string; icon: string }[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: { id: string; label: string; icon: string }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const o = item as { id?: unknown; label?: unknown; icon?: unknown }
    if (typeof o.id !== 'string' || !o.id.trim()) continue
    if (typeof o.label !== 'string' || !o.label.trim()) continue
    if (typeof o.icon !== 'string') continue
    const id = o.id.trim()
    if (seen.has(id)) continue   // 同批去重
    seen.add(id)
    out.push({ id, label: o.label.trim(), icon: o.icon })
  }
  return out
}

/**
 * 读偏好。结构兼容老版本：缺字段补默认，多余字段忽略。
 */
export function loadPreferences(): AppPreferences {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES }
    const obj = raw as Partial<AppPreferences>
    return {
      themeMode: obj.themeMode === 'dark' || obj.themeMode === 'auto' || obj.themeMode === 'light'
        ? obj.themeMode
        : DEFAULT_PREFERENCES.themeMode,
      titleFont: obj.titleFont === 'serif' || obj.titleFont === 'sans'
        ? obj.titleFont
        : DEFAULT_PREFERENCES.titleFont,
      darkVariant: obj.darkVariant === 'neutral' || obj.darkVariant === 'warm' || obj.darkVariant === 'oled'
        ? obj.darkVariant
        : DEFAULT_PREFERENCES.darkVariant,
      pinnedAchievements: Array.isArray(obj.pinnedAchievements)
        ? obj.pinnedAchievements.filter((id): id is string => typeof id === 'string')
        : DEFAULT_PREFERENCES.pinnedAchievements,
      wallLayout: obj.wallLayout === 'single' || obj.wallLayout === 'double'
        ? obj.wallLayout
        : DEFAULT_PREFERENCES.wallLayout,
      listViewMode: obj.listViewMode === 'list' || obj.listViewMode === 'grid' || obj.listViewMode === 'gallery'
        ? obj.listViewMode
        : DEFAULT_PREFERENCES.listViewMode,
      // annualGoals：必须是 plain object（分类 id → 数字）；逐项校验 value 为 number
      annualGoals: (obj.annualGoals && typeof obj.annualGoals === 'object' && !Array.isArray(obj.annualGoals))
        ? sanitizeAnnualGoals(obj.annualGoals)
        : DEFAULT_PREFERENCES.annualGoals,
      annualKeyword: typeof obj.annualKeyword === 'string'
        ? obj.annualKeyword
        : DEFAULT_PREFERENCES.annualKeyword,
      annualKeywordYear: typeof obj.annualKeywordYear === 'number' && !isNaN(obj.annualKeywordYear)
        ? obj.annualKeywordYear
        : DEFAULT_PREFERENCES.annualKeywordYear,
      systemMedals: sanitizeSystemMedals(obj.systemMedals),
      customCheckinCategories: sanitizeCustomCategoryList(obj.customCheckinCategories),
      checkinGoals: sanitizeCheckinGoals(obj.checkinGoals),
      disabledCheckinCategories: sanitizeDisabledCheckin(obj.disabledCheckinCategories),
      customInspirationCategories: sanitizeCustomCategoryList(obj.customInspirationCategories),
      customWishCategories: sanitizeCustomCategoryList(obj.customWishCategories),
      // 连胜保护券字段（必须显式读出，否则 updatePreferences 写入的值会在下次读时被吞掉，
      // 导致连胜保护功能在生产里完全失效——保护券永远攒不起来）。
      streakProtectionEnabled: obj.streakProtectionEnabled !== false,  // 缺省/非 false 都视为 true
      streakFreebies: sanitizeStreakFreebies(obj.streakFreebies),
      lastFreebieMonth: typeof obj.lastFreebieMonth === 'string' ? obj.lastFreebieMonth : '',
      protectedCheckinDates: sanitizeProtectedDates(obj.protectedCheckinDates),
    }
  } catch (e) {
    return { ...DEFAULT_PREFERENCES }
  }
}

/**
 * 写偏好（整体覆盖）。
 */
export function savePreferences(prefs: AppPreferences): void {
  try {
    wx.setStorageSync(STORAGE_KEY, prefs)
    markDirty('preferences')
  } catch (e) {
    /* 静默失败：偏好不是关键数据 */
  }
}

/**
 * 局部更新某字段，自动合并写回。
 */
export function updatePreferences(patch: Partial<AppPreferences>): AppPreferences {
  const current = loadPreferences()
  const next: AppPreferences = { ...current, ...patch }
  savePreferences(next)
  return next
}

/**
 * 查询系统当前是否深色模式（用于 themeMode='auto' 时解析成实际生效色）。
 * 基础库 2.11+ 支持 wx.getSystemInfoSync().theme；老基础库回退到浅色。
 */
export function isSystemDark(): boolean {
  try {
    const info = wx.getSystemInfoSync()
    // 兼容字段：新版本 theme:'dark'|'light'，老版本无此字段
    if ((info as { theme?: string }).theme === 'dark') return true
    return false
  } catch (e) {
    return false
  }
}

/**
 * 把 themeMode 解析成实际生效的明暗（auto 会展开成 light 或 dark）。
 * 用于给 page 注入 class。
 */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'auto') return isSystemDark() ? 'dark' : 'light'
  return mode
}
