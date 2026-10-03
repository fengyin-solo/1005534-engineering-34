import type { EntryRow, ProductYearSummary } from '@/data/types'

/**
 * 产品主数据：全平台「同一套」产品取值。年度回顾、批生产记录、投诉等多处取到的涉及产品，
 * 归一到这份主数据；不在册的名称一律按无效值处理，不允许临时自造产品名。
 */
export const PRODUCT_CATALOG: string[] = [
  '氯化钠注射液(100ml:0.9g)',
  '葡萄糖注射液(250ml:12.5g)',
  '注射用头孢曲松钠(1.0g)',
  '维生素C片(0.1g)',
  '阿莫西林胶囊(0.25g)',
]

// 旧记录里可能出现的同一产品的不同写法：迁移时统一归一到主数据名称。
const PRODUCT_ALIASES: Record<string, string> = {
  氯化钠注射液: '氯化钠注射液(100ml:0.9g)',
  生理盐水: '氯化钠注射液(100ml:0.9g)',
  '0.9%氯化钠注射液': '氯化钠注射液(100ml:0.9g)',
  葡萄糖注射液: '葡萄糖注射液(250ml:12.5g)',
  注射用头孢曲松钠: '注射用头孢曲松钠(1.0g)',
  头孢曲松钠: '注射用头孢曲松钠(1.0g)',
  维生素C片: '维生素C片(0.1g)',
  维C片: '维生素C片(0.1g)',
  阿莫西林胶囊: '阿莫西林胶囊(0.25g)',
}

export const INVALID_PRODUCT = '无效值'
export const QA_DEPT_NAME = '质量部'

/** 归一单个产品名：别名→主数据；不在册→无效值。空白也按无效值。 */
export function normalizeProduct(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text) return INVALID_PRODUCT
  if (PRODUCT_CATALOG.includes(text)) return text
  if (PRODUCT_ALIASES[text]) return PRODUCT_ALIASES[text]
  return INVALID_PRODUCT
}

export function isValidProduct(name: string): boolean {
  return PRODUCT_CATALOG.includes(name)
}

/** 涉及产品字段按逗号/顿号/分号/斜杠拆成多个产品，逐项归一、去重、保序。 */
export function parseProducts(raw: unknown): string[] {
  const text = String(raw ?? '')
  const parts = text.split(/[,，、;；/]/).map((part) => part.trim()).filter(Boolean)
  const result: string[] = []
  for (const part of parts) {
    const canonical = normalizeProduct(part)
    if (!result.includes(canonical)) result.push(canonical)
  }
  return result.length > 0 ? result : [INVALID_PRODUCT]
}

/** 从日期/年度字段取四位年份；取不到返回空串。 */
export function extractYear(raw: unknown): string {
  const match = /(19|20)\d{2}/.exec(String(raw ?? ''))
  return match ? match[0] : ''
}

/** 某年度某产品的批次数：批生产记录里产品归一后一致、且批号登记年份匹配的记录数。 */
export function countBatches(batchRows: EntryRow[], product: string, year: string): number {
  return batchRows.filter((row) => {
    if (normalizeProduct(row['产品名称']) !== product) return false
    if (year && extractYear(row['起始时间']) !== year) return false
    return true
  }).length
}

/**
 * 偏差总数（质量部口径）：偏差台账中已提交质量部统计的偏差（非「待处理」草稿态）。
 * 能从偏差编号/日期解析出年份时按年度过滤；旧记录缺年份时不计入具体年度，由调用方决定回退口径。
 */
export function countQaDeviations(deviationRows: EntryRow[], year: string): number {
  return deviationRows.filter((row) => {
    if (String(row.status) === '待处理') return false
    const rowYear = extractYear(row['偏差编号']) || extractYear(row['起始时间'])
    if (year && rowYear && rowYear !== year) return false
    return true
  }).length
}

/**
 * 年度回顾按产品汇总：每个涉及产品一行，批次数取自批生产记录，
 * 偏差总数为质量部统计口径；产品超出范围按无效值单独成行。
 */
export function summarizeByProduct(
  products: string[],
  year: string,
  batchRows: EntryRow[],
  deviationRows: EntryRow[],
): ProductYearSummary[] {
  return products.map((product) => ({
    product,
    valid: isValidProduct(product),
    batchCount: isValidProduct(product) ? countBatches(batchRows, product, year) : 0,
    deviationCount: countQaDeviations(deviationRows, year),
  }))
}

/** 汇总表的稳定文本指纹：同一份回顾内容不变，重复导出只算一次。 */
export function reviewFingerprint(row: EntryRow, summary: ProductYearSummary[]): string {
  const body = summary
    .map((item) => `${item.product}|${item.valid ? 1 : 0}|${item.batchCount}|${item.deviationCount}`)
    .join(';')
  return [
    row['回顾编号'],
    row['回顾年度'],
    row.status,
    row['回顾结论'],
    row['审批人'],
    row['批准日期'],
    body,
  ].join('#')
}
