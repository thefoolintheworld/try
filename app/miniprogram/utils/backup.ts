// utils/backup.ts
// 数据备份与恢复：把所有本地数据聚合成一份 JSON，支持导出/导入。
//
// 设计动机：
//   - 个人主体小程序，云端无账户体系；用户的成就/愿望/灵感/报告/偏好都存在本地 storage。
//   - 一旦用户换设备、卸载重装、清缓存，数据将彻底丢失（不可恢复是伦理底线问题）。
//   - 提供导出（复制 JSON / 写文件）与导入（粘贴 JSON / 选文件）能力，
//     让用户能在更换设备前自助搬家。
//
// 与 storage.ts 的关系：
//   - 不复用 storage.ts 的常量（那些是内部实现细节），这里独立用字符串字面量
//     读取底层 storage key，避免常量变更时的连锁修改。
//   - 导出全部 key（含 schema_version），导入时按 schema_version 走 storage.ts 的迁移管线。
//
// 数据完整性策略（导入）：
//   - 校验顶层结构（必须是对象 + 含 _app 标识 + version 数字）
//   - 逐 key 校验类型（必须是数组或对象，禁止覆盖为非法类型）
//   - 校验通过后整体覆盖（不做字段级 merge，避免半新半旧的脏状态）
//   - 校验失败时不动任何 storage，返回 { ok:false, msg } 让 UI 报错

/** 当前 schema 版本：与 storage.ts migrateIfNeeded 的最新版本号保持一致。
 *  导入时若备份版本高于当前代码支持的版本，会拒绝（避免降级损坏）。
 *  v7：打卡多分类约束放宽（见 storage.ts migrateToV7）；虽为 no-op 迁移，
 *      版本号仍需同步，避免导出备份的 version 字段落后于实际数据版本。
 *  v8：新增 Item.mood + Item.quoteNotes（见 storage.ts migrateToV8）；同为 no-op anchor，
 *      新字段可选，老数据无需回填；版本号同步同理。 */
const CURRENT_SCHEMA_VERSION = 8

// storage.ts 的迁移缓存重置入口：导入老版本备份后必须调，否则 storage 模块级 migrationDone
// 仍是 true（本次运行期已跑过迁移），后续 loadAll 不会再触发迁移，老版本数据会停在旧 schema。
// backup 不复用 storage 的数据常量（保持运行时单向），但这个生命周期钩子必须显式调。
import { _resetMigrationCache } from './storage'

/** 备份文件/剪贴板里顶层对象的标识符。
 *  用于快速识别"这份 JSON 是不是本应用导出的备份"。 */
const BACKUP_MAGIC = 'literary-report-backup'

/** 备份文件名前缀（写入 wx 文件系统时使用） */
const BACKUP_FILENAME_PREFIX = 'literary-backup'

/** 备份的所有 storage key 列表（顺序固定，便于阅读和版本演进）。
 *  schema_version 是元数据，单独放顶层 version 字段，不在此列表里重复。 */
const BACKUP_KEYS = [
  'book_film_data',      // 成就/书目/观影 主数据
  'report_instances',    // 报告实例
  'report_templates',    // 报告模板（含内置）
  'wishlist',            // 许愿星
  'inspirations',        // 灵感抽屉
  'checkins',            // 每日打卡
  'app_preferences',     // 用户偏好（主题/字体/目标/勋章）
  'trash',               // 回收站（软删除项的 30 天恢复窗口；换设备时一并迁移，否则软删除项在新设备上无法恢复）
] as const

/** 备份顶层结构 */
export interface BackupPayload {
  /** 魔术标识：识别本应用备份 */
  _app: string
  /** 备份生成时的 schema 版本（导出设备代码当时支持的版本） */
  version: number
  /** 导出时间戳（ms） */
  exportedAt: number
  /** 各 storage key 对应的快照数据 */
  data: { [key: string]: unknown }
}

/** 导入结果：成功带覆盖统计，失败带可读原因 */
export interface ImportResult {
  ok: boolean
  msg: string
  /** 成功时：被覆盖的 key 列表（便于 UI 展示"已恢复 X 项数据"） */
  restoredKeys?: string[]
}

/** 导出结果：成功带 JSON 字符串与统计摘要，失败带原因 */
export interface ExportResult {
  ok: boolean
  msg: string
  /** 成功时的 JSON 字符串（已格式化，便于人工核对） */
  json?: string
  /** 成功时的数据计数摘要（成就/报告/愿望/灵感条数；用于 UI 展示） */
  summary?: BackupSummary
}

/** 数据计数摘要：导出/导入时展示给用户"即将备份多少条" */
export interface BackupSummary {
  achievements: number   // 成就条数（book_film_data 数组长度）
  reports: number        // 报告实例数
  wishes: number         // 许愿星条数
  inspirations: number   // 灵感条数
  checkins: number       // 打卡天数
  hasTemplates: boolean  // 是否含模板（数量意义不大，只标 yes/no）
  hasPreferences: boolean // 是否含偏好
}

/* ============================================================
 * 导出
 * ============================================================ */

/** 把当前 storage 里所有备份数据聚合成一份 JSON 字符串。
 *  即使某些 key 不存在（老用户没写过），也以 null 占位写入，保持结构完整。
 *  返回 { ok, msg, json, summary }；当前实现不会失败（最坏情况是空数据）。 */
export function exportAllData(): ExportResult {
  try {
    const data: { [key: string]: unknown } = {}
    for (const key of BACKUP_KEYS) {
      // 微信语义：未设置的 key getStorageSync 返回 ''（空字符串）。
      // 导入侧类型校验只接受 数组/对象/null，空字符串会被判非法类型导致整次导入失败。
      // 所以这里把「空串（未设置）」归一成 null 写入备份，与「显式存了 null」语义合并，
      // 让导入侧的「null 视为清空该 key」分支统一处理。
      const value = wx.getStorageSync(key)
      data[key] = value === '' ? null : value
    }
    const payload: BackupPayload = {
      _app: BACKUP_MAGIC,
      version: CURRENT_SCHEMA_VERSION,
      exportedAt: Date.now(),
      data,
    }
    const json = JSON.stringify(payload, null, 2)
    const summary = buildSummary(data)
    return { ok: true, msg: '导出成功', json, summary }
  } catch (e) {
    return { ok: false, msg: '导出失败：' + describeError(e) }
  }
}

/** 从已有 data 对象统计计数摘要（导出/导入共用）。
 *  容错：每个字段缺失或非数组时记为 0/false，不抛错。 */
function buildSummary(data: { [key: string]: unknown }): BackupSummary {
  return {
    // book_film_data 是按年份分桶的对象（Record<number, Item[]>），不是扁平数组；
    // 单独用 yearBucketedLength 把所有年份桶里的 Item 累加（否则 arrayLength 会算成 0）。
    achievements: yearBucketedLength(data['book_film_data']),
    reports: arrayLength(data['report_instances']),
    wishes: arrayLength(data['wishlist']),
    inspirations: arrayLength(data['inspirations']),
    checkins: arrayLength(data['checkins']),
    hasTemplates: hasContent(data['report_templates']),
    hasPreferences: hasContent(data['app_preferences']),
  }
}

/** 安全取数组长度：非数组返回 0 */
function arrayLength(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

/** 统计按年份分桶的数据（如 book_film_data = Record<number, Item[]>）的总条数：
 *  遍历每个年份桶，累加桶内数组长度。非对象或桶非数组时容错为 0。 */
function yearBucketedLength(v: unknown): number {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return 0
  let total = 0
  for (const key of Object.keys(v as object)) {
    const bucket = (v as { [k: string]: unknown })[key]
    if (Array.isArray(bucket)) total += bucket.length
  }
  return total
}

/** 判断一个 storage 值是否有内容（数组非空 / 对象有键）。
 *  用于模板和偏好这种"有无"比"多少"更重要的字段。 */
function hasContent(v: unknown): boolean {
  if (v == null) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return false
}

/* ============================================================
 * 导入
 * ============================================================ */

/** 把一份备份 JSON 字符串恢复到本地 storage（整体覆盖）。
 *  校验链：能解析 → 顶层结构对 → 魔术字对 → 版本可接受 → 每个 key 类型合法。
 *  任何一步失败都不动 storage（原子性：要么全成功要么全不动）。 */
export function importAllData(json: string): ImportResult {
  if (!json || typeof json !== 'string') {
    return { ok: false, msg: '备份内容为空' }
  }
  let payload: BackupPayload
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, msg: '备份格式不正确（不是有效对象）' }
    }
    payload = parsed as BackupPayload
  } catch (e) {
    return { ok: false, msg: '备份内容无法解析（JSON 格式错误）' }
  }

  // 魔术字校验：必须是本应用导出的备份
  if (payload._app !== BACKUP_MAGIC) {
    return { ok: false, msg: '这不是本应用的备份文件' }
  }

  // 版本校验：备份版本必须是 1..CURRENT 之间的正整数
  if (typeof payload.version !== 'number'
      || isNaN(payload.version)
      || payload.version < 1
      || payload.version > CURRENT_SCHEMA_VERSION) {
    return { ok: false, msg: '备份版本不受支持（v' + String(payload.version) + '），请升级小程序后再导入' }
  }

  // data 字段必须是对象
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    return { ok: false, msg: '备份内容损坏（data 字段缺失）' }
  }

  // 逐 key 类型校验：只允许数组或纯对象；非法类型的 key 直接拒绝整次导入
  // （保守策略：宁可拒绝也不留半新半旧的脏状态）
  const dataObj = payload.data as { [key: string]: unknown }
  const validKeys: string[] = []
  for (const key of BACKUP_KEYS) {
    if (!(key in dataObj)) continue  // 备份里缺该 key：允许（视为该 key 没数据）
    const v = dataObj[key]
    if (v == null) continue          // 显式 null：允许（视为清空该 key）
    if (Array.isArray(v) || (typeof v === 'object' && !Array.isArray(v))) {
      validKeys.push(key)
    } else {
      return { ok: false, msg: '备份内容损坏（字段 ' + key + ' 类型不合法）' }
    }
  }

  // 至少要有任意一个有效 key，否则视为空备份
  if (validKeys.length === 0) {
    return { ok: false, msg: '备份里没有可恢复的数据' }
  }

  // 原子写入：先全部写入临时缓存，全部成功后再确认。
  // 由于 wx.setStorageSync 没有事务，这里采用"先写后不可回滚"的策略——
  // 但因为前面已经做了严格类型校验，写入失败的概率极低；
  // 真要失败也只影响当前正在写的那个 key（其它 key 已经写入生效）。
  const restored: string[] = []
  try {
    for (const key of validKeys) {
      wx.setStorageSync(key, dataObj[key])
      restored.push(key)
    }
    // schema_version 同步成备份里的版本号，让 storage.ts 下次启动时跑迁移管线
    // （如果备份版本比当前老，会自动升级；如果相同则跳过）。
    // 关键：必须同时重置 storage 的迁移短路缓存——本次运行期 migrateIfNeeded 已跑过一次
    // 把 migrationDone 置 true，导入后若不重置，后续 loadAll 会跳过迁移，老版本数据停在旧 schema。
    wx.setStorageSync('schema_version', payload.version)
    _resetMigrationCache()
    return {
      ok: true,
      msg: '已恢复 ' + String(restored.length) + ' 项数据',
      restoredKeys: restored,
    }
  } catch (e) {
    return {
      ok: false,
      msg: '写入失败（已恢复 ' + String(restored.length) + ' 项）：' + describeError(e),
      restoredKeys: restored.length > 0 ? restored : undefined,
    }
  }
}

/* ============================================================
 * 文件落地（可选）：把 JSON 写到用户可访问的文件
 * ============================================================ */

/** 生成带时间戳的备份文件名，如 literary-backup-20260810-153012.json */
export function buildBackupFilename(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => (n < 10 ? '0' + String(n) : String(n))
  const y = String(d.getFullYear())
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  return BACKUP_FILENAME_PREFIX + '-' + y + m + day + '-' + hh + mm + ss + '.json'
}

/** 把 JSON 字符串写入小程序的本地文件系统（用户可后续通过文件助手分享/保存）。
 *  返回 { ok, msg, filePath? }。失败时给出可读原因。
 *  注意：wx 本地文件无法被用户直接看到，需要通过 wx.shareFileMessage 或 saveImageToPhotosAlbum 类
 *  的 API 转交；这里只负责写文件，分享由调用方按需触发。 */
export function writeBackupToFile(json: string, now: number): WriteFileResult {
  try {
    const fs = wx.getFileSystemManager()
    const filename = buildBackupFilename(now)
    // wx.env.USER_DATA_PATH 是小程序可读写的用户数据目录
    const filePath = (wx.env as { USER_DATA_PATH: string }).USER_DATA_PATH + '/' + filename
    fs.writeFileSync(filePath, json, 'utf8')
    return { ok: true, msg: '已保存到文件', filePath, filename }
  } catch (e) {
    return { ok: false, msg: '写文件失败：' + describeError(e) }
  }
}

export interface WriteFileResult {
  ok: boolean
  msg: string
  filePath?: string
  filename?: string
}

/* ============================================================
 * 工具：把异常对象变成可读字符串
 * ============================================================ */
function describeError(e: unknown): string {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  try {
    return JSON.stringify(e)
  } catch (_) {
    return String(e)
  }
}
