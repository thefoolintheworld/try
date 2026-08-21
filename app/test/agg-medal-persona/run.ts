/** agg-medal-persona 运行入口：注入 wx mock 后跑 verify.ts。 */
declare const process: { exit(code: number): void }
declare const require: (id: string) => any
import { wx } from './wx-mock'
;(globalThis as any).wx = wx
const mod = require('./verify')
const ok = mod.runAll()
process.exit(ok ? 0 : 1)
