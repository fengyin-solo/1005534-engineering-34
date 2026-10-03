import { listRows, saveRows } from '@/data/local-store'
import {
  INVALID_PRODUCT,
  QA_DEPT_NAME,
  extractYear,
  isValidProduct,
  normalizeProduct,
} from '@/data/products'
import type { EntryRow } from '@/data/types'

// 数据结构版本：升级存量迁移时递增；旧版本 localStorage 数据按顺序迁移并回填。
export const SCHEMA_VERSION = 2
const SCHEMA_KEY = 'pharma-cleanroom:schema-version'

function getStoredVersion(): number {
  if (typeof window === 'undefined' || !window.localStorage) return SCHEMA_VERSION
  const raw = window.localStorage.getItem(SCHEMA_KEY)
  const value = Number.parseInt(raw ?? '0', 10)
  return Number.isFinite(value) ? value : 0
}

function setStoredVersion(version: number): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SCHEMA_KEY, String(version))
  }
}

const BACKFILL_MARK = '存量迁移回填'
const OLD_PLACEHOLDER_RE = /^年度质量回顾样例\d+$/

/** v2：年度回顾口径升级——产品归一主数据、批次数/偏差总数按旧记录回填、审批签署字段补齐。 */
function migrateAnnualReviewV2(): void {
  const rows = listRows('annualreview')
  if (rows.length === 0) return
  const batchRows = listRows('batchrecord')
  const deviationRows = listRows('deviation')
  const year = String(rows[0]?.['回顾年度'] ?? '').match(/(19|20)\d{2}/)?.[0] ?? ''

  const migrated = rows.map((row) => {
    const next: EntryRow = { ...row }
    const oldProducts = String(row['涉及产品'] ?? '')
    const isPlaceholder = OLD_PLACEHOLDER_RE.test(oldProducts)

    // 涉及产品：按旧记录里的写法归一到主数据；超范围/占位写法按无效值。
    const normalized = normalizeProduct(oldProducts)
    if (normalized !== oldProducts.trim()) {
      next['涉及产品'] = normalized
    }
    if (!isValidProduct(String(next['涉及产品']))) {
      next['涉及产品'] = INVALID_PRODUCT
      next['产品有效性'] = '无效'
    } else {
      next['产品有效性'] = '有效'
    }

    // 批次数：按旧批生产记录回填（产品一致、年度一致的批记录条数）。
    const oldBatchCount = Number.parseInt(String(row['批次数'] ?? ''), 10)
    if (!Number.isFinite(oldBatchCount) || OLD_PLACEHOLDER_RE.test(String(row['批次数']))) {
      const product = String(next['涉及产品'])
      const reviewYear = extractYear(row['回顾年度']) || year
      next['批次数'] = isValidProduct(product)
        ? batchRows.filter((b) => {
            if (normalizeProduct(b['产品名称']) !== product) return false
            const batchYear = extractYear(b['起始时间'])
            return reviewYear ? batchYear === reviewYear : true
          }).length
        : 0
      next['数据来源'] = BACKFILL_MARK
    }

    // 偏差总数：由质量部统计，按旧偏差台账（非待处理草稿）回填。
    if (OLD_PLACEHOLDER_RE.test(String(row['偏差总数'] ?? ''))) {
      const reviewYear = extractYear(row['回顾年度']) || year
      next['偏差总数'] = deviationRows.filter((d) => {
        if (String(d.status) === '待处理') return false
        const deviationYear = extractYear(d['偏差编号'])
        return reviewYear && deviationYear ? deviationYear === reviewYear : true
      }).length
      next['统计部门'] = QA_DEPT_NAME
      next['数据来源'] = BACKFILL_MARK
    }

    // 回顾年度：占位写法没有真实年度信息，回填为无效值，避免误统计。
    if (!extractYear(row['回顾年度'])) {
      next['回顾年度'] = INVALID_PRODUCT
    }
    return next
  })

  saveRows('annualreview', migrated)
}

/** v2：批生产记录的产品名称同步归一，保证多处取到的属于同一套产品。 */
function migrateBatchRecordV2(): void {
  const rows = listRows('batchrecord')
  if (rows.length === 0) return
  let changed = false
  const migrated = rows.map((row) => {
    const normalized = normalizeProduct(row['产品名称'])
    if (normalized === String(row['产品名称'] ?? '').trim()) return row
    changed = true
    return { ...row, 产品名称: normalized }
  })
  if (changed) saveRows('batchrecord', migrated)
}

/**
 * 执行存量迁移：从本地记录的版本号逐级升级到当前版本。
 * 全新播种的数据本身就是当前版本，直接写版本号、不做改动。
 */
export function runMigrations(): void {
  const version = getStoredVersion()
  if (version >= SCHEMA_VERSION) return

  if (version < 2) {
    migrateBatchRecordV2()
    migrateAnnualReviewV2()
  }

  setStoredVersion(SCHEMA_VERSION)
}

export function currentSchemaVersion(): number {
  return getStoredVersion()
}
