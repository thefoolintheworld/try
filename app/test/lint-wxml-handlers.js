#!/usr/bin/env node
/**
 * test/lint-wxml-handlers.js —— 构建期「WXML 事件处理器绑定」lint
 *
 * 防御的 bug：微信小程序里，wxml 写 `bindtap="onFoo"` 但 ts 里没有 `onFoo` 方法时，
 *   平台**不报错**——只是点击静默失效（真机上表现为「点了没反应」）。tsc 类型检查
 *   看不到 wxml 字符串绑定，所以这类「绑定悬空」完全不会被现有构建期检查发现。
 *   尤其在新增交互（如 P6 拖拽排序加了一批 catchtouchmove / catchtouchstart）后，
 *   手滑把方法名写错（onSegDragMove 写成 onSegDragMvoe）会无声炸掉交互。
 *
 * 规则：扫每个页面的 .wxml，抽出所有 `bind*` / `catch*` / `mut-bind*` 的处理器名，
 *   到同目录同名 .ts 里找定义。任一处理器在 ts 里找不到即报错退出。
 *
 * 边界与豁免：
 *   - 动态绑定 `bindtap="{{cond ? 'a' : 'b'}}"`：当前项目无此用法（全静态字符串），
 *     若将来出现，扫描器会跳过（不解析 {{}} 内表达式，宁可漏报也不误报）。
 *   - 组件自带事件（navigation-bar 的 bindback）由组件定义，不在页面 ts 里——
 *     用豁免清单 SKIP_HANDLERS 显式排除（按「处理器名」豁免，跨页面生效）。
 *   - 行尾带 `// lint-wxml-handlers: allow` 注释可豁免该 .wxml 文件全部处理器
 *     （保留出口；目前无豁免文件）。
 *
 * 用法：node test/lint-wxml-handlers.js
 *   退出码 0 = 通过；1 = 发现悬空绑定。
 *   已注册为 npm script: `npm run lint:wxml`（见 package.json）。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const PAGES_ROOT = path.join(APP_ROOT, 'miniprogram', 'pages')

// 跨页面豁免：这些处理器由复用组件（navigation-bar 等）定义，不在页面 ts 里。
// 按需追加，命名尽量具体避免误豁免。
const SKIP_HANDLERS = new Set([
  'onBack',      // navigation-bar 组件的 bindback，页面通常也定义了；但即使页面没定义也算合规
])

/** 抽出 .wxml 里所有事件处理器引用。
 *  匹配 (bind|catch|mut-bind)<event>="<handler>" 形态，返回 handler 名数组。
 *  跳过值含 {{ 的（动态绑定，本扫描器不解析）。*/
function extractHandlers(wxmlContent, fileRel) {
  const handlers = []
  // (?:bind|catch|mut-bind) 后跟事件名（小写字母与连字符），等号，引号内 handler 名
  const re = /(?:bind|catch|mut-bind)([a-zA-Z][a-zA-Z-]*)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(wxmlContent)) !== null) {
    const handler = m[2]
    if (handler.includes('{{')) continue  // 动态绑定，跳过
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(handler)) continue  // 非合法标识符（含空格等），跳过
    handlers.push(handler)
  }
  return handlers
}

/** 抽出 .ts 文件里定义的方法名（Page({...}) / Component({...}) 内的标识符）。
 *  启发式：匹配「行首 2 空格缩进 + 标识符 + (」形态的方法定义。
 *  也匹配导出的顶层 function（用于跨页面复用的纯函数处理器，少见但兜底）。
 *  返回 Set<string>。*/
function extractTsMethods(tsContent) {
  const methods = new Set()
  // 方法定义：行首恰好 2 空格 + 标识符 + (  （Page/Component 内方法都是这个缩进）
  let m
  const reMethod = /\n  ([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g
  while ((m = reMethod.exec(tsContent)) !== null) {
    methods.add(m[1])
  }
  // 也认箭头函数字段：行首 2 空格 + 标识符 + : ... =>（少见，兜底）
  const reArrow = /\n  ([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*[^\n=]*=>/g
  while ((m = reArrow.exec(tsContent)) !== null) {
    methods.add(m[1])
  }
  return methods
}

/** 收集 pages/ 下所有含 .wxml 的页面目录。*/
function collectPages() {
  const pages = []
  if (!fs.existsSync(PAGES_ROOT)) return pages
  for (const dir of fs.readdirSync(PAGES_ROOT)) {
    const wxml = path.join(PAGES_ROOT, dir, dir + '.wxml')
    const ts = path.join(PAGES_ROOT, dir, dir + '.ts')
    if (fs.existsSync(wxml) && fs.existsSync(ts)) {
      pages.push({ dir, wxml, ts })
    }
  }
  return pages
}

function main() {
  const pages = collectPages()
  if (pages.length === 0) {
    console.log('WXML 处理器 lint：未找到页面，跳过。')
    return 0
  }

  const errors = []
  let totalBindings = 0
  let totalPages = pages.length

  for (const { dir, wxml, ts } of pages) {
    const wxmlContent = fs.readFileSync(wxml, 'utf8')
    // 文件级豁免：行尾注释
    if (/\/\/\s*lint-wxml-handlers:\s*allow/.test(wxmlContent)) continue
    const tsContent = fs.readFileSync(ts, 'utf8')
    const handlers = extractHandlers(wxmlContent, dir)
    const tsMethods = extractTsMethods(tsContent)
    // 每个 handler 引用查重（一个页面可能多次引用同名 handler，只报一次）
    const seen = new Set()
    for (const h of handlers) {
      totalBindings++
      if (seen.has(h)) continue
      seen.add(h)
      if (SKIP_HANDLERS.has(h)) continue
      if (!tsMethods.has(h)) {
        errors.push(`  ${dir}/${dir}.wxml: 处理器「${h}」未在 ${dir}.ts 中定义`)
      }
    }
  }

  console.log('WXML 处理器 lint：扫描 ' + totalPages + ' 个页面，' + totalBindings + ' 处事件绑定。')
  if (errors.length === 0) {
    console.log('✅ 通过：所有 wxml 事件处理器都在对应 ts 中定义。')
    return 0
  }
  console.error('❌ 发现 ' + errors.length + ' 处悬空事件绑定（真机上点击静默失效）：')
  for (const e of errors) console.error(e)
  return 1
}

const code = main()
if (typeof process !== 'undefined' && process && typeof process.exit === 'function') {
  process.exit(code)
}
