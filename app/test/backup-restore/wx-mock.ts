/** backup-restore 测试用 wx mock（含文件系统 mock 给 writeBackupToFile 用）。 */
const store: { [key: string]: any } = {}
const files: { [path: string]: string } = {}
export function _reset() {
  for (const k of Object.keys(store)) delete store[k]
  for (const k of Object.keys(files)) delete files[k]
}
export const wx = {
  getStorageSync(key: string): any { const v = store[key]; return v === undefined ? '' : JSON.parse(JSON.stringify(v)) },
  setStorageSync(key: string, value: any): void { store[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync(key: string): void { delete store[key] },
  showToast() {}, showModal() {}, getSystemInfoSync() { return { pixelRatio: 2 } },
  env: { USER_DATA_PATH: '/tmp/userdata' },
  getFileSystemManager() {
    return {
      writeFileSync(path: string, content: string, _encoding?: string) { files[path] = content },
      readFile(path: string) { return { data: files[path] } },
    }
  },
  _reset, _store: store, _files: files,
}
