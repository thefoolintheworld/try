// utils/util.ts
// 通用小函数

import { designTokens } from './design-tokens'

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date | number): string {
  const d = date instanceof Date ? date : new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 生成简单唯一 id
 */
export function genId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`
}

/**
 * 从 coverPalette 里按 index 取一个代表色
 */
export function pickCoverColor(index: number): string {
  const palette = designTokens.coverPalette
  return palette[index % palette.length]
}

/**
 * 校验日期格式是否为 YYYY-MM-DD
 */
export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}
