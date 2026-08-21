/**
 * Node 运行入口：注入 wx mock + Page/Component 桩后跑 verify.ts 的 runAll。
 *
 * report-edit.ts 在模块级调用 Page({...})（微信小程序注册页面），
 * Node 环境没有 Page，故 require 之前先挂一个 no-op 桩，让模块能正常加载。
 * 本套件只测纯函数（swapArrayElements/swapCardSegments 等），不执行页面生命周期。
 */
declare const process: { exit(code: number): void }
declare const require: (id: string) => any

import { wx } from './wx-mock'

;(globalThis as any).wx = wx
;(globalThis as any).Page = (opts: any) => { /* 桩：吞掉页面注册 */ }
;(globalThis as any).Component = (opts: any) => { /* 桩 */ }

const mod = require('./verify')
const ok = mod.runAll()
process.exit(ok ? 0 : 1)
