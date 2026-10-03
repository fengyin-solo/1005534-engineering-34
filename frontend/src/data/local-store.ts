import { SCHEMA_VERSION, migrateRows } from './migrate'
import { SEED_ROWS } from './seed'
import type { AuditLedgerEntry, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'
const VERSION_KEY = 'pharma-cleanroom:schema-version'
const LEDGER_KEY = 'pharma-cleanroom:supplier-audit-ledger'
const EXPORT_LOG_KEY = 'pharma-cleanroom:annual-review-exports'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

type StoreShape = {
  data: Record<string, EntryRow[]>
  version: number
}

// 读取并迁移存量数据：
// - 全新浏览器：直接播种当前版本的示例数据；
// - 旧版本数据：按旧记录回填迁移到当前版本；
// - 已迁移：原样使用，浏览器里的改动优先。
function readStore(): StoreShape {
  const fallback: StoreShape = { data: clone(SEED_ROWS), version: SCHEMA_VERSION }
  const s = storage()
  if (!s) {
    return fallback
  }

  const version = Number(s.getItem(VERSION_KEY) ?? 1)
  const raw = s.getItem(STORAGE_KEY)
  if (!raw) {
    s.setItem(STORAGE_KEY, JSON.stringify(fallback.data))
    s.setItem(VERSION_KEY, String(SCHEMA_VERSION))
    return fallback
  }

  let parsed: Record<string, EntryRow[]>
  try {
    parsed = JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    s.setItem(STORAGE_KEY, JSON.stringify(fallback.data))
    s.setItem(VERSION_KEY, String(SCHEMA_VERSION))
    return fallback
  }

  if (version >= SCHEMA_VERSION) {
    // 新版本可能新增模块：用种子兜底，浏览器里的改动仍然优先
    return { data: { ...clone(SEED_ROWS), ...parsed }, version }
  }

  const { rows } = migrateRows(parsed)
  const migrated: StoreShape = { data: { ...clone(SEED_ROWS), ...rows }, version: SCHEMA_VERSION }
  s.setItem(STORAGE_KEY, JSON.stringify(migrated.data))
  s.setItem(VERSION_KEY, String(SCHEMA_VERSION))
  // 迁移只落一次：写回后版本号已抬升，再次打开直接走「已迁移」分支
  return migrated
}

let cache: StoreShape | null = null

function store(): StoreShape {
  if (cache === null) {
    cache = readStore()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return store().data
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = { data: next, version: SCHEMA_VERSION }
  const s = storage()
  if (s) {
    s.setItem(STORAGE_KEY, JSON.stringify(next))
    s.setItem(VERSION_KEY, String(SCHEMA_VERSION))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

function readJson<T>(key: string, fallback: T): T {
  const s = storage()
  if (!s) {
    return fallback
  }
  const raw = s.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  const s = storage()
  if (s) {
    s.setItem(key, JSON.stringify(value))
  }
}

// ===== 供应商审计台账：年度回顾状态同步到这里 =====
export function readAuditLedger(): AuditLedgerEntry[] {
  return readJson<AuditLedgerEntry[]>(LEDGER_KEY, [])
}

export function writeAuditLedger(entries: AuditLedgerEntry[]): void {
  writeJson(LEDGER_KEY, entries)
}

// ===== 年度回顾导出记录：用于「同一份回顾重复导出只算一次」 =====
export type AnnualReviewExportLog = Record<string, { exportedAt: string }>

export function readExportLog(): AnnualReviewExportLog {
  return readJson<AnnualReviewExportLog>(EXPORT_LOG_KEY, {})
}

export function writeExportLog(log: AnnualReviewExportLog): void {
  writeJson(EXPORT_LOG_KEY, log)
}

export function storageKey(): string {
  return STORAGE_KEY
}
