import type { ExportLedgerEntry, SupplierLedgerEntry } from '@/data/types'

// 辅助台账：独立于业务数据存放，避免污染各模块清单。
const EXPORT_LEDGER_KEY = 'pharma-cleanroom:annual-review-export-ledger'
const SUPPLIER_LEDGER_KEY = 'pharma-cleanroom:supplier-audit-ledger'

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

/** 年度回顾导出去重台账：同一份回顾重复导出只算一次（内容不变则复用首次记录）。 */
export function exportLedger(): ExportLedgerEntry[] {
  return readJson<ExportLedgerEntry[]>(EXPORT_LEDGER_KEY, [])
}

/**
 * 登记一次导出。
 * @returns 记录 + 是否首次导出（false 表示重复导出，不重复计数）
 */
export function recordExport(
  entry: Omit<ExportLedgerEntry, 'times' | 'exportedAt'> & { exportedAt?: string },
): { entry: ExportLedgerEntry; first: boolean } {
  const ledger = exportLedger()
  const existing = ledger.find((item) => item.reviewId === entry.reviewId && item.hash === entry.hash)
  if (existing) {
    existing.times += 1
    writeJson(EXPORT_LEDGER_KEY, ledger)
    return { entry: existing, first: false }
  }
  const saved: ExportLedgerEntry = {
    ...entry,
    exportedAt: entry.exportedAt ?? new Date().toISOString().slice(0, 10),
    times: 1,
  }
  ledger.push(saved)
  writeJson(EXPORT_LEDGER_KEY, ledger)
  return { entry: saved, first: true }
}

/** 供应商审计台账：年度回顾状态按回顾编号逐条同步。 */
export function supplierLedger(): SupplierLedgerEntry[] {
  return readJson<SupplierLedgerEntry[]>(SUPPLIER_LEDGER_KEY, [])
}

export function upsertSupplierEntry(sync: SupplierLedgerEntry): SupplierLedgerEntry[] {
  const ledger = supplierLedger()
  const index = ledger.findIndex((item) => item.reviewId === sync.reviewId)
  if (index >= 0) {
    ledger[index] = sync
  } else {
    ledger.push(sync)
  }
  writeJson(SUPPLIER_LEDGER_KEY, ledger)
  return ledger
}
