#!/usr/bin/env node
/**
 * test/lint-less.js —— 构建期 LESS 颜色函数 lint
 *
 * 防御的 bug：LESS 编译期颜色函数（fade/lighten/darken/...）拿到 var() 或
 *   @color-* 别名（app.less 里 @color-accent = var(--color-accent)）时，
 *   编译期解析不出颜色，真机抛 "Argument cannot be evaluated to a color" 白屏。
 *   2026-08 已因此改过一轮（reading-guide/edit/medals 5 处 fade()）。
 *
 * 规则：禁止在 .less 里调用 LESS 原生编译期颜色函数。透明色叠加的唯一正确
 *   写法是 CSS 原生 color-mix(in srgb, @color-x N%, transparent)，它在
 *   运行时解析 CSS 变量，主题切换自动跟随。详见 AGENTS.md「LESS 颜色函数硬纪律」。
 *
 * 用法：node test/lint-less.js
 *   退出码 0 = 通过；1 = 发现违规。
 *   已注册为 npm script: `npm run lint:less`（见 package.json）。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const LESS_ROOT = path.join(APP_ROOT, 'miniprogram')

// 被禁的 LESS 编译期颜色函数（吃 var() 会炸的）。
// 注意：CSS 原生 color-mix / filter:saturate 不在此列——它们是运行时函数，安全。
const BANNED_FUNCTIONS = [
  'fade', 'fadeout', 'fadein',
  'lighten', 'darken',
  'saturate', 'desaturate',
  'spin',
  'mix', 'average',
  'greyscale', 'contrast',
  'multiply', 'screen', 'overlay', 'softlight', 'hardlight',
  'difference', 'exclusion', 'negation',
]

// 匹配「函数调用」：词界 + 函数名 + 紧跟的 ( 。
// 用 ()? 不贪心，只定位调用点；不解析参数（参数里是否有 var() 是第二层判断，先全禁）。
// 用 \b 防止把 faded/fading 这种英文词误判成 fade(。
const callPattern = new RegExp('(^|[^\\w-])(' + BANNED_FUNCTIONS.join('|') + ')\\s*\\(', 'i')

function walkLess(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkLess(full, out)
    } else if (entry.isFile() && entry.name.endsWith('.less')) {
      out.push(full)
    }
  }
}

function lintFile(file) {
  const rel = path.relative(APP_ROOT, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const violations = []
  lines.forEach((line, idx) => {
    // 跳过纯注释行（// 或 /* */，单行情况）
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    const m = line.match(callPattern)
    if (m) {
      // 误报豁免：CSS 原生 filter 滤镜（如 filter: saturate(1.2)）是运行时滤镜，
      // 不吃颜色变量参数，没有 fade() 那种编译期炸的风险。仅当该行确实是 filter
      // 声明时豁免 saturate（其他被禁函数不在 CSS filter 语法里，不豁免）。
      if (m[2].toLowerCase() === 'saturate' && /\bfilter\s*:/.test(line)) return
      violations.push({
        file: rel,
        line: idx + 1,
        col: (m.index || 0) + m[1].length + 1,
        func: m[2].toLowerCase(),
        snippet: trimmed,
      })
    }
  })
  return violations
}

function main() {
  const files = []
  walkLess(LESS_ROOT, files)
  let totalViolations = 0
  const allViolations = []
  for (const f of files) {
    const v = lintFile(f)
    if (v.length > 0) {
      totalViolations += v.length
      allViolations.push(...v)
    }
  }

  console.log('LESS 颜色函数 lint：扫描 ' + files.length + ' 个 .less 文件')

  if (totalViolations === 0) {
    console.log('✅ 通过：未发现 LESS 编译期颜色函数调用。')
    process.exit(0)
  }

  console.error('❌ 发现 ' + totalViolations + ' 处违规：禁用 LESS 编译期颜色函数（吃 var() 会真机白屏）')
  console.error('   正确写法：color-mix(in srgb, @color-x N%, transparent)')
  console.error('')
  for (const v of allViolations) {
    console.error('  ' + v.file + ':' + v.line + ':' + v.col + '  ' + v.func + '()')
    console.error('    ' + v.snippet)
  }
  console.error('')
  console.error('详见 AGENTS.md「LESS 颜色函数硬纪律」段。')
  process.exit(1)
}

main()
