/**
 * Node 运行入口：注入 wx mock 后跑 verify.ts 的 runAll。
 * 被 tsc 转译后用 `node run.js` 执行。
 */
declare const process: { exit(code: number): void }
declare const require: (id: string) => any

import { wx } from './wx-mock'

// storage.ts 模块级 migrateIfNeeded 会在 require 时立即读 wx
;(globalThis as any).wx = wx

const mod = require('./verify')
const ok = mod.runAll()
process.exit(ok ? 0 : 1)
