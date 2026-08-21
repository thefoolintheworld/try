/**
 * backup-restore 验证脚本：导出/导入/schema 校验/原子性
 *
 * 覆盖：
 *   - 导出空数据 / 有数据 → summary 正确
 *   - 导入：魔术字错 / 版本过高 / JSON 坏 / data 缺失 / 字段类型非法 → 全部拒绝且不动 storage
 *   - 导入合法备份 → 覆盖 + schema_version 同步
 *   - round-trip：导出 → 清空 → 导入 → 数据恢复
 *   - buildBackupFilename / writeBackupToFile
 */
import { exportAllData, importAllData, buildBackupFilename, writeBackupToFile } from '../../miniprogram/utils/backup'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ✅ ' + msg) }
  else { fail++; console.error('  ❌ ' + msg) }
}

// @ts-ignore mock 方法
const _wx: any = (globalThis as any).wx

function resetStore() { _wx._reset() }

/** 构造一份合法备份 JSON（默认版本 8、含一条成就）。 */
function mkValidBackup(over: { version?: number; _app?: string; data?: any } = {}): string {
  const payload = {
    _app: over._app ?? 'literary-report-backup',
    version: over.version ?? 8,
    exportedAt: Date.now(),
    data: over.data ?? {
      book_film_data: { 2026: [{ id: 'b1', type: 'book', title: '测试书', author: '作者', rating: 4, finishedDate: '2026-08-01', coverColor: '#000', createdAt: 1 }] },
      wishlist: [{ id: 'w1', title: '想读的书', coverColor: '#000', createdAt: 1 }],
    },
  }
  return JSON.stringify(payload)
}

function runAll(): boolean {
  console.log('=== 导出 exportAllData ===')
  resetStore()
  {
    const r = exportAllData()
    assert(r.ok === true, '空 storage 导出仍成功')
    assert(!!r.json, '返回 json 字符串')
    assert(r.summary!.achievements === 0 && r.summary!.reports === 0, '空数据 summary 全 0')
    // 解析 JSON 应有合法结构
    const parsed = JSON.parse(r.json!)
    assert(parsed._app === 'literary-report-backup', 'JSON 含魔术字')
    assert(typeof parsed.version === 'number' && parsed.version >= 1, 'JSON 含合法 version')
  }

  {
    resetStore()
    // 造一些数据
    _wx.setStorageSync('book_film_data', { 2026: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] })
    _wx.setStorageSync('report_instances', [{ id: 'r1' }, { id: 'r2' }])
    _wx.setStorageSync('wishlist', [{ id: 'w1' }])
    _wx.setStorageSync('checkins', [{ id: 'c1' }])
    _wx.setStorageSync('app_preferences', { theme: 'dark' })
    const r = exportAllData()
    assert(r.summary!.achievements === 3, 'summary.achievements = 3（yearBucketedLength 累加）')
    assert(r.summary!.reports === 2, 'summary.reports = 2')
    assert(r.summary!.wishes === 1, 'summary.wishes = 1')
    assert(r.summary!.checkins === 1, 'summary.checkins = 1')
    assert(r.summary!.hasPreferences === true, 'summary.hasPreferences = true')
  }

  console.log('=== 导入 importAllData：校验链拒绝路径 ===')
  resetStore()
  {
    // 1. 空字符串
    let r = importAllData('')
    assert(r.ok === false, '空字符串 → 拒绝')
    // 2. 非 JSON
    r = importAllData('not a json')
    assert(r.ok === false && r.msg.includes('JSON'), '非法 JSON → 拒绝且提示格式错误')
    // 3. 魔术字错
    r = importAllData(JSON.stringify({ _app: 'wrong-app', version: 8, data: {} }))
    assert(r.ok === false && r.msg.includes('本应用'), '魔术字错 → 拒绝')
    // 4. 版本过高（> 当前 8）
    r = importAllData(mkValidBackup({ version: 999 }))
    assert(r.ok === false && r.msg.includes('版本'), '版本过高 → 拒绝')
    // 5. 版本非法（负数 / NaN）
    r = importAllData(mkValidBackup({ version: -1 }))
    assert(r.ok === false, '版本负数 → 拒绝')
    r = importAllData(mkValidBackup({ version: NaN }))
    assert(r.ok === false, '版本 NaN → 拒绝')
    // 6. data 字段缺失
    r = importAllData(JSON.stringify({ _app: 'literary-report-backup', version: 8, exportedAt: 1 }))
    assert(r.ok === false && r.msg.includes('data'), 'data 缺失 → 拒绝')
    // 7. data 是数组（非法）
    r = importAllData(JSON.stringify({ _app: 'literary-report-backup', version: 8, data: [] }))
    assert(r.ok === false, 'data 是数组 → 拒绝')
    // 8. 字段类型非法（某 key 是 number）
    r = importAllData(mkValidBackup({ data: { book_film_data: 123 } }))
    assert(r.ok === false && r.msg.includes('类型不合法'), '字段类型非法（number）→ 拒绝')
    // 9. 全部 key 都是 null → 没有有效数据
    r = importAllData(mkValidBackup({ data: { book_film_data: null, wishlist: null } }))
    assert(r.ok === false && r.msg.includes('没有可恢复'), '全部字段 null → 拒绝（空备份）')

    // 关键：所有拒绝路径都不应动 storage
    assert(_wx._store['book_film_data'] === undefined, '所有拒绝路径都未写入 storage')
  }

  console.log('=== 导入 importAllData：成功路径 + 原子覆盖 ===')
  resetStore()
  {
    // 先存一些旧数据
    _wx.setStorageSync('book_film_data', { 2025: [{ id: 'old' }] })
    const r = importAllData(mkValidBackup())
    assert(r.ok === true, '合法备份 → 成功')
    assert(!!r.restoredKeys && r.restoredKeys.length >= 2, '返回 restoredKeys')
    // 数据应被覆盖
    const data = _wx.getStorageSync('book_film_data')
    assert(!!data['2026'] && !data['2025'], '导入后 2025 旧数据被覆盖、2026 新数据生效')
    const wishes = _wx.getStorageSync('wishlist')
    assert(wishes.length === 1 && wishes[0].id === 'w1', 'wishlist 覆盖成功')
    // schema_version 同步成备份版本
    assert(_wx.getStorageSync('schema_version') === 8, 'schema_version 同步成备份版本 8')
  }

  console.log('=== round-trip：导出 → 清空 → 导入 → 数据一致 ===')
  resetStore()
  {
    // 造原始数据
    _wx.setStorageSync('book_film_data', { 2026: [{ id: 'a' }, { id: 'b' }] })
    _wx.setStorageSync('inspirations', [{ id: 'i1', content: '灵感', category: 'random', createdAt: 1 }])
    _wx.setStorageSync('app_preferences', { theme: 'dark', fontSize: 'large' })

    const exported = exportAllData()
    const json = exported.json!

    // 模拟换设备：清空
    resetStore()
    assert(_wx._store['book_film_data'] === undefined, '清空后无数据')

    // 导入
    const r = importAllData(json)
    assert(r.ok === true, 'round-trip 导入成功')
    const data = _wx.getStorageSync('book_film_data')
    assert(!!data['2026'] && data['2026'].length === 2, 'round-trip 成就数据恢复')
    const ins = _wx.getStorageSync('inspirations')
    assert(ins.length === 1 && ins[0].id === 'i1', 'round-trip 灵感恢复')
    const prefs = _wx.getStorageSync('app_preferences')
    assert(prefs.theme === 'dark' && prefs.fontSize === 'large', 'round-trip 偏好恢复')
  }

  console.log('=== 显式 null 字段允许（视为清空该 key）===')
  resetStore()
  {
    _wx.setStorageSync('wishlist', [{ id: 'oldwish' }])
    const r = importAllData(mkValidBackup({
      data: { book_film_data: { 2026: [{ id: 'x' }] }, wishlist: null },
    }))
    assert(r.ok === true, '含 null 字段备份 → 成功')
    // wishlist 被显式 null 覆盖；微信 mock 对 null 是直接存的，实际语义是「清空」
    // （storage.ts 读 wishlist 时会处理空值，这里只验导入不拒绝）
  }

  console.log('=== buildBackupFilename / writeBackupToFile ===')
  {
    const name = buildBackupFilename(new Date(2026, 7, 10, 15, 30, 45).getTime())
    assert(name === 'literary-backup-20260810-153045.json', '文件名格式正确')
    const w = writeBackupToFile('{"test":1}', new Date(2026, 7, 10, 15, 30, 45).getTime())
    assert(w.ok === true && !!w.filePath, '写文件成功')
    assert(w.filePath!.includes('literary-backup-20260810-153045.json'), 'filePath 含文件名')
    // 校验文件确实写入
    const files = _wx._files
    assert(Object.keys(files).length === 1 && Object.values(files)[0] === '{"test":1}', '文件内容正确')
  }

  console.log('')
  console.log('=== 总结：' + pass + ' 通过，' + fail + ' 失败 ===')
  return fail === 0
}

export { runAll }
