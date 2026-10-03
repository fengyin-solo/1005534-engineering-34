import {
  listRows,
  readAuditLedger,
  readExportLog,
  saveRows,
  writeAuditLedger,
  writeExportLog,
} from '@/data/local-store'
import {
  INVALID_PRODUCT_VALUE,
  PRODUCT_NAMES,
  isKnownProductSet,
  normalizeProductSet,
  productNamesOf,
} from '@/data/products'
import { countDeviationsByProduct } from '@/data/migrate'
import type {
  ActionResult,
  AnnualReviewExportResult,
  AuditLedgerEntry,
  EntryRow,
} from '@/data/types'

const ANNUAL_KEY = 'annualreview'
const DEVIATION_KEY = 'deviation'

function text(value: unknown): string {
  return String(value ?? '').trim()
}

function nowLabel(): string {
  return new Date().toISOString()
}

function reviews(): EntryRow[] {
  return listRows(ANNUAL_KEY)
}

function findReview(id: number): EntryRow | undefined {
  return reviews().find((row) => Number(row.id) === id)
}

function isPending(status: string): boolean {
  return status !== '已批准'
}

function isAbnormal(row: EntryRow): boolean {
  return row.status === '已退回' || normalizeProductSet(row['涉及产品']) === INVALID_PRODUCT_VALUE
}

function withDerived(row: EntryRow): EntryRow {
  return { ...row, pending: isPending(String(row.status)), abnormal: isAbnormal(row) }
}

function persist(rows: EntryRow[]): void {
  saveRows(ANNUAL_KEY, rows.map(withDerived))
}

// ===== 供应商审计台账同步 =====
function toLedgerEntry(row: EntryRow): AuditLedgerEntry {
  return {
    reviewId: Number(row.id),
    reviewNo: text(row['回顾编号']),
    year: text(row['回顾年度']),
    products: normalizeProductSet(row['涉及产品']),
    deviationTotal: toCount(row['偏差总数']),
    conclusion: text(row['回顾结论']),
    approver: text(row['审批人']),
    status: text(row.status),
    abnormal: isAbnormal(row),
    updatedAt: nowLabel(),
  }
}

// 年度回顾每次状态/字段变化都全量重推台账：以回顾编号为唯一键，旧条目覆盖，不留双份。
export function syncAuditLedger(): AuditLedgerEntry[] {
  const current = new Map<number, AuditLedgerEntry>(
    readAuditLedger().map((entry) => [entry.reviewId, entry]),
  )
  for (const row of reviews()) {
    current.set(Number(row.id), toLedgerEntry(row))
  }
  const entries = [...current.values()].sort((a, b) => a.reviewId - b.reviewId)
  writeAuditLedger(entries)
  return entries
}

export function auditLedgerEntries(): AuditLedgerEntry[] {
  return syncAuditLedger()
}

// ===== 按产品汇总（年度回顾按产品汇总） =====
export type ProductSummary = {
  product: string
  reviewCount: number
  batchCount: number
  deviationTotal: number
  approvedCount: number
}

export function summarizeByProduct(): ProductSummary[] {
  const rows = reviews()
  return PRODUCT_NAMES.map((product) => {
    const matched = rows.filter((row) =>
      productNamesOf(row['涉及产品']).includes(product),
    )
    return {
      product,
      reviewCount: matched.length,
      batchCount: matched.reduce((sum, row) => sum + toCount(row['批次数']), 0),
      deviationTotal: matched.reduce((sum, row) => sum + toCount(row['偏差总数']), 0),
      approvedCount: matched.filter((row) => row.status === '已批准').length,
    }
  })
}

function toCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0
}

// ===== 签署回顾结论：回顾结论要经审批人签 =====
export function signReview(
  id: number,
  payload: { approver: string; conclusion: string },
): ActionResult {
  const approver = payload.approver.trim()
  const conclusion = payload.conclusion.trim()
  if (!approver) {
    return { ok: false, message: '审批人为空：回顾结论必须由审批人签署后才能批准' }
  }
  if (!conclusion) {
    return { ok: false, message: '回顾结论为空：请先填写结论再由审批人签署' }
  }
  const rows = reviews()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的年度回顾报告` }
  }
  const current = String(rows[index].status)
  if (current === '已批准') {
    return { ok: false, message: '年度回顾报告已批准，签署内容不可再改' }
  }
  rows[index] = { ...rows[index], 审批人: approver, 回顾结论: conclusion }
  persist(rows)
  syncAuditLedger()
  return { ok: true, message: `回顾结论已由审批人「${approver}」签署` }
}

// ===== 偏差总数由质量部统计：按涉及产品从偏差台账计数回填 =====
export function applyQaDeviationStats(id: number): ActionResult {
  const rows = reviews()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的年度回顾报告` }
  }
  const row = rows[index]
  if (!isKnownProductSet(row['涉及产品'])) {
    return {
      ok: false,
      message: `涉及产品「${text(row['涉及产品']) || '空'}」超出产品目录范围，按无效值处理，质量部无法统计偏差总数`,
    }
  }
  if (String(row.status) === '已批准') {
    return { ok: false, message: '年度回顾报告已批准，偏差总数不可再改' }
  }
  const counts = countDeviationsByProduct(listRows(DEVIATION_KEY))
  const total = productNamesOf(row['涉及产品']).reduce(
    (sum, name) => sum + (counts.get(name) ?? 0),
    0,
  )
  rows[index] = { ...row, 偏差总数: total }
  persist(rows)
  syncAuditLedger()
  return { ok: true, message: `质量部已按涉及产品完成偏差统计，偏差总数回填为 ${total}` }
}

// 批准前置校验：涉及产品必须在目录内，且结论已由审批人签署
export function approvalBlocked(row: EntryRow): string | null {
  if (!isKnownProductSet(row['涉及产品'])) {
    return `涉及产品「${text(row['涉及产品']) || '空'}」超出范围，按无效值处理，不能批准`
  }
  if (!text(row['审批人']) || !text(row['回顾结论'])) {
    return '回顾结论尚未经审批人签署，请先「签署回顾结论」再批准'
  }
  return null
}

// ===== 年度回顾导出：同一份回顾重复导出只算一次 =====
export function exportAnnualReviews(): AnnualReviewExportResult {
  const rows = reviews()
  const log = readExportLog()
  // 重复导出：CSV 只含首次导出之后新增的回顾；同一份回顾重复导出只计一次
  const header = ['编号', '回顾编号', '回顾年度', '涉及产品', '批次数', '偏差总数', '回顾结论', '审批人', '当前状态'].join(',')
  const lines: string[] = [header]
  let exported = 0
  let skipped = 0

  const nextLog = { ...log }
  for (const row of rows) {
    const key = String(row.id)
    if (nextLog[key]) {
      skipped++
      continue
    }
    const fields = ['回顾编号', '回顾年度', '涉及产品', '批次数', '偏差总数', '回顾结论', '审批人']
    lines.push([row.id, ...fields.map((field) => text(row[field])), row.status].join(','))
    nextLog[key] = { exportedAt: nowLabel() }
    exported++
  }
  writeExportLog(nextLog)

  return {
    filename: '年度质量回顾-清单.csv',
    content: `﻿${lines.join('\n')}`,
    exported,
    skippedDuplicates: skipped,
    firstTime: skipped === 0 && exported === rows.length,
  }
}
