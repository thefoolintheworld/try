#!/usr/bin/env node
/**
 * test/lint-aggregator-inputs.js —— 构建期「聚合器数据源」lint
 *
 * 防御的 bug：状态机三态（reading/done/abandoned）下，聚合器（stats/wrapped/
 *   personality/insights/medal-config 等算年度回顾/统计的纯函数）必须只吃 done 态成就。
 *   storage.ts 的 `loadItems*` / `loadByYear` 系列返回**全量**（含在读/搁置），
 *   一旦被聚合器误用，未完成态的 finishedDate/createdAt 会污染统计：
 *     - 年度计数把"在读"也算进去 → wrapped 年份对不上
 *     - calcQuotes 把搁置书里的金句也算进去 → 金句墙混入未读
 *     - calcOverview 的 totalCount 失真 → 人格判断错位
 *   正确数据源是 `loadAchievements*`（loadAllAchievements / loadAchievementsByYear）。
 *
 * 规则：在「聚合器」文件里禁止 import / 调用以下 storage 函数：
 *   loadAllItems / loadItemsByYear / loadByYear / loadByCategoryAndYear
 *   列表页（list）、搜索（search）确实需要全量，它们不在禁用清单的目标文件里。
 *
 * 用法：node test/lint-aggregator-inputs.js
 *   退出码 0 = 通过；1 = 发现违规。
 *   已注册为 npm script: `npm run lint:agg`（见 package.json）。
 *
 * 误报豁免：行尾带 `// lint-aggregator-inputs: allow` 注释时跳过本行
 *   （目前无豁免点；保留出口以备未来确有正当场景）。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const APP_ROOT = path.resolve(__dirname, '..')
const UTILS_ROOT = path.join(APP_ROOT, 'miniprogram', 'utils')

// 这些 storage 函数返回「含在读/搁置」的全量 Item，聚合器不能用。
// （loadAllBooks / loadAll / loadRecent / loadByIds / loadById 形态上是「按 id 取」
//   或「取所有原始记录」，不是「按完成态过滤」的入口，且 loadAllBooks 内部被
//   loadAllAchievements 复用——把它们留给 storage.ts 自身用，不进禁单。）
const BANNED_CALLS = [
  'loadAllItems',
  'loadItemsByYear',
  'loadByYear',
  'loadByCategoryAndYear',
]

// 聚合器白名单：只算「跨实体统计 / 年度回顾 / 人格 / 洞察 / 关键词」这类纯算法 utils。
// list.ts / search.ts / dashboard.ts / pages/* 不在此列——
//   list/search 本来就要展示在读搁置；dashboard 收口的是首页快照，调用方明确要全量计数时不在此禁。
//   storage.ts 自身是定义点，当然不在禁单。
const AGGREGATOR_FILES = [
  'stats.ts',
  'personality.ts',
  'wrapped.ts',
  'insights.ts',
  'medal-config.ts',
  'on-this-day.ts',
  'category-meta.ts',
  'design-tokens.ts',
  'template-engine.ts',
  'note-prompts.ts',
]

// 同时捕获 import 语句和普通调用两种形态。
// import { loadByYear, X } from '...'
// const x = loadByYear(...)
const callPattern = new RegExp('(^|[^\\w-])(' + BANNED_CALLS.join('|') + ')\\s*[\\(\\},]', 'g')

function lintFile(file) {
  const rel = path.relative(APP_ROOT, file).replace(/\\/g, '/')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const violations = []
  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    // 豁免：行尾显式 allow 注释
    if (/lint-aggregator-inputs:\s*allow\b/.test(line)) return
    // 跳过纯注释行的字面提及（如本文件头说明里就写了这些名字）
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    let m
    callPattern.lastIndex = 0
    while ((m = callPattern.exec(line)) !== null) {
      violations.push({
        file: rel,
        line: idx + 1,
        col: (m.index || 0) + m[1].length + 1,
        func: m[2],
        snippet: trimmed,
      })
    }
  })
  return violations
}

function main() {
  const allViolations = []
  let scanned = 0
  for (const name of AGGREGATOR_FILES) {
    const full = path.join(UTILS_ROOT, name)
    if (!fs.existsSync(full)) continue
    scanned++
    const v = lintFile(full)
    allViolations.push(...v)
  }

  console.log('聚合器数据源 lint：扫描 ' + scanned + ' 个 utils 聚合器文件')
  console.log('   禁用函数：' + BANNED_CALLS.join(', '))

  if (allViolations.length === 0) {
    console.log('✅ 通过：聚合器未误用 loadItems*/loadByYear 系（应该用 loadAchievements*）。')
    process.exit(0)
  }

  console.error('❌ 发现 ' + allViolations.length + ' 处违规：聚合器不能吃「含在读/搁置」的全量 Item')
  console.error('   正确数据源：loadAllAchievements / loadAchievementsByYear（只返回 status===done）')
  console.error('   详见 AGENTS.md「三态状态机的读取层过滤约定」段。')
  console.error('')
  for (const v of allViolations) {
    console.error('  ' + v.file + ':' + v.line + ':' + v.col + '  ' + v.func + '()')
    console.error('    ' + v.snippet)
  }
  console.error('')
  console.error('如确有正当场景（如新加的列表页混入聚合器），行尾加 // lint-aggregator-inputs: allow 豁免。')
  process.exit(1)
}

main()
