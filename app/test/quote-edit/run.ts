/**
 * Node 运行入口：注入 wx mock 后跑 verify.ts 的 runAll。
 * 同 three-state/checkin 同款约定。
 */
declare const process: { exit(code: number): void }
declare const require: (id: string) => any

import { wx } from './wx-mock'

// storage.ts 的模块级代码（migrateIfNeeded）会在 require 时立即读 wx，
// 所以必须在 require(storage) 之前把 wx 挂到全局。
;(globalThis as any).wx = wx

const mod = require('./verify')
const ok = mod.runAll()
process.exit(ok ? 0 : 1)
