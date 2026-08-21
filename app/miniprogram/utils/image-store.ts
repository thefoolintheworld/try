// utils/image-store.ts
// 成就图片持久化：把用户上传的临时图片保存为小程序永久文件，返回 savedFilePath。
// 项目此前没有任何图片持久化（报告背景图存 tempFilePath，重启失效）—— 这是第一个真正的持久化能力。
//
// 设计：
//   - 用 wx.getFileSystemManager().saveFile（异步回调包成 Promise）。
//   - 返回的 savedFilePath 形如 'wxfile://store_xxx'，preloadImagePath 能直接解析（Image.src 通吃）。
//   - 存储上限 10MB，接近时主动 toast 警告（用 wx.getStorageInfoSync 拿当前占用近似判断）。
//   - 删成就时调 deleteAchievementImage 清文件，避免泄漏（saveFile 不会自动随 storage 清理）。
//   - 失败不抛异常，返回 null（图片不是关键数据，上传失败给 toast 提示即可，不阻断保存成就）。

/** 小程序本地文件存储上限（10MB），接近时警告 */
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024
/** 警告阈值：用到 85% 就提示 */
const STORAGE_WARN_THRESHOLD = STORAGE_LIMIT_BYTES * 0.85

/**
 * 把临时图片路径保存为永久文件。
 * @param tempFilePath wx.chooseImage/chooseMedia 返回的 tempFilePath
 * @returns 成功返回 savedFilePath（'wxfile://store_xxx'）；失败返回 null
 */
export function saveAchievementImage(tempFilePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fs = wx.getFileSystemManager()
      fs.saveFile({
        tempFilePath,
        success: (res) => {
          const savedPath = res.savedFilePath
          // 保存成功后检查存储空间占用，接近上限时提示用户
          checkAndWarnStorage()
          resolve(savedPath)
        },
        fail: (err) => {
          console.warn('[image-store] saveFile 失败', err)
          resolve(null)
        },
      })
    } catch (e) {
      console.warn('[image-store] getFileSystemManager 异常', e)
      resolve(null)
    }
  })
}

/**
 * 删除已保存的成就图片文件。
 * 成就被删除时应调用，避免永久文件泄漏（saveFile 的文件不会随 storage 自动清理）。
 * 静默失败：文件可能已被系统清理或路径无效，删不掉不影响业务。
 */
export function deleteAchievementImage(savedPath: string): void {
  if (!savedPath) return
  // 只清理 saveFile 产生的永久路径（wxfile://store_xxx）；预设 id / 包内路径不删
  if (!isPersistedPath(savedPath)) return
  try {
    const fs = wx.getFileSystemManager()
    fs.removeSavedFile({
      filePath: savedPath,
      fail: () => { /* 静默：文件可能已不存在 */ },
    })
  } catch (e) {
    /* 静默 */
  }
}

/**
 * 判断路径是否是 saveFile 产生的永久路径（需清理）。
 * 永久路径形如 'wxfile://store_xxx' 或 'http://store_xxx'（不同基础库格式略异）。
 * 预设 id（如 'achv-watercolor-sunset'）和包内相对路径（如 '/assets/x.png'）返回 false。
 */
export function isPersistedPath(path: string): boolean {
  if (!path) return false
  // saveFile 产出的路径包含 'store' 标识且不是包内路径（不以 '/' 开头）
  return path.indexOf('store') !== -1 && path.indexOf('://') !== -1
}

/**
 * 检查本地存储占用，接近上限时提示用户。
 * 用 wx.getStorageInfoSync 近似判断（含 storage + 文件存储的总览）。
 */
function checkAndWarnStorage(): void {
  try {
    const info = wx.getStorageInfoSync()
    // currentSize 单位 KB（官方文档），换算成字节
    const usedBytes = (info.currentSize || 0) * 1024
    if (usedBytes >= STORAGE_WARN_THRESHOLD) {
      wx.showToast({
        title: '本地存储快满了，建议清理旧成就图片',
        icon: 'none',
        duration: 3000,
      })
    }
  } catch (e) {
    /* 静默 */
  }
}
