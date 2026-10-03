import {
  INVALID_PRODUCT_VALUE,
  PRODUCT_CATALOG,
  normalizeProductSet,
  productNamesOf,
} from './products'
import type { EntryRow } from './types'

// 本地数据结构版本：老浏览器里 localStorage 存的是旧版结构，读取时按版本逐级迁移、回填。
export const SCHEMA_VERSION = 2

const FALLBACK_YEAR = String(new Date().getFullYear() - 1)

function isLegacyPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.includes('样例')
}

function isValidYear(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!/^\d{4}$/.test(text)) {
    return false
  }
  const year = Number(text)
  return year >= 2000 && year <= new Date().getFullYear() + 1
}

// 按旧记录稳定回填：同一条记录多次迁移结果一致，不依赖随机数。
function fallbackName(index: number): string {
  return PRODUCT_CATALOG[index % PRODUCT_CATALOG.length].name
}

function toCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0
}

// 与 toCount 的区别：非数字返回 null（迁移时要回填），0 是合法值不能当缺失
function toCountOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
  const text = String(value ?? '').trim()
  if (text === '' || !/^\d+$/.test(text)) return null
  return Number(text)
}

// 偏差台账按产品计数（质量部统计口径）：只统计目录内产品，无效产品不摊给任何产品。
export function countDeviationsByProduct(rows: EntryRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const name of productNamesOf(row['涉及产品'])) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

// v1 -> v2：
// 1) 偏差补「涉及产品」字段（质量部才能按产品统计偏差总数）；
// 2) 年度回顾按旧记录回填回顾年度/涉及产品/批次数/偏差总数/审批人，超范围产品按无效值；
// 3) 重算 pending/abnormal。
export function migrateRows(
  data: Record<string, EntryRow[]>,
): { rows: Record<string, EntryRow[]>; changed: number } {
  let changed = 0
  const next: Record<string, EntryRow[]> = {}

  for (const [key, rows] of Object.entries(data)) {
    next[key] = rows.map((row) => ({ ...row }))
  }

  const deviations = next['deviation'] ?? []
  deviations.forEach((row, index) => {
    if (typeof row['涉及产品'] === 'undefined' || isLegacyPlaceholder(row['涉及产品'])) {
      row['涉及产品'] = fallbackName(index)
      changed++
    } else {
      const normalized = normalizeProductSet(row['涉及产品'])
      if (normalized !== String(row['涉及产品'])) {
        row['涉及产品'] = normalized
        changed++
      }
    }
  })

  const deviationCounts = countDeviationsByProduct(deviations)
  const reviews = next['annualreview'] ?? []
  reviews.forEach((row, index) => {
    // 涉及产品：多处取到的必须属于同一套，统一过目录归一化
    if (typeof row['涉及产品'] === 'undefined' || isLegacyPlaceholder(row['涉及产品'])) {
      row['涉及产品'] = fallbackName(index)
      changed++
    } else {
      const normalized = normalizeProductSet(row['涉及产品'])
      if (normalized !== String(row['涉及产品'])) {
        row['涉及产品'] = normalized
        changed++
      }
    }

    if (!isValidYear(row['回顾年度'])) {
      row['回顾年度'] = FALLBACK_YEAR
      changed++
    }

    const rawBatch = String(row['批次数'] ?? '').trim()
    const batchCount = toCountOrNull(row['批次数'])
    if (rawBatch === '' || isLegacyPlaceholder(row['批次数']) || batchCount === null) {
      // 缺字段 / 旧占位 / 非法数字：按记录编号稳定回填，同一条旧记录每次迁移结果一致
      row['批次数'] = 12 + ((Number(row.id) * 7) % 24)
      changed++
    } else if (row['批次数'] !== batchCount) {
      row['批次数'] = batchCount
      changed++
    }

    const rawDeviationTotal = String(row['偏差总数'] ?? '').trim()
    const deviationCount = toCountOrNull(row['偏差总数'])
    if (rawDeviationTotal === '' || isLegacyPlaceholder(row['偏差总数']) || deviationCount === null) {
      const names = productNamesOf(row['涉及产品'])
      row['偏差总数'] = names.reduce((sum, name) => sum + (deviationCounts.get(name) ?? 0), 0)
      changed++
    } else if (row['偏差总数'] !== deviationCount) {
      row['偏差总数'] = deviationCount
      changed++
    }

    if (isLegacyPlaceholder(row['审批人'])) {
      // 旧记录没有签署信息：保持空，由审批人补签，绝不伪造签名
      row['审批人'] = ''
      changed++
    }
    if (isLegacyPlaceholder(row['回顾结论'])) {
      row['回顾结论'] = ''
      changed++
    }

    const status = String(row.status ?? '')
    const validStatuses = ['待回顾', '回顾中', '已批准', '已退回']
    if (!validStatuses.includes(status)) {
      row.status = '待回顾'
      changed++
    }
    const pending = row.status !== '已批准'
    const abnormal =
      row.status === '已退回' || normalizeProductSet(row['涉及产品']) === INVALID_PRODUCT_VALUE
    if (row.pending !== pending || row.abnormal !== abnormal) {
      row.pending = pending
      row.abnormal = abnormal
      changed++
    }
  })

  return { rows: next, changed }
}
