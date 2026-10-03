import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  INVALID_PRODUCT,
  QA_DEPT_NAME,
  extractYear,
  isValidProduct,
  parseProducts,
  reviewFingerprint,
  summarizeByProduct,
} from '@/data/products'
import {
  exportLedger,
  recordExport,
  supplierLedger,
  upsertSupplierEntry,
} from '@/data/ledgers'
import type {
  ActionResult,
  EntryRow,
  ExportLedgerEntry,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ProductYearSummary,
  SupplierLedgerEntry,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  return meta ?? throwMissingModule(key)
}

function throwMissingModule(key: string): ModuleMeta {
  throw new Error(`没有登记名为 ${key} 的业务模块`)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 某模块某记录在当前状态下可执行的动作：配置了 transitions 的模块严格按状态流过滤，越级不展示。 */
export function availableActions(meta: ModuleMeta, status: string): string[] {
  if (!meta.transitions) return meta.actions
  const allowedTargets = meta.transitions[status]
  if (!allowedTargets) return []
  return meta.actions.filter((action) => {
    const target = meta.actionTargets[action]
    return allowedTargets.includes(target)
  })
}

/** 年度回顾按产品汇总：涉及产品多处取到同一套，批次/偏差由台账统计，超范围按无效值。 */
export function annualReviewSummary(row: EntryRow): ProductYearSummary[] {
  const year = extractYear(row['回顾年度'])
  const products = parseProducts(row['涉及产品'])
  return summarizeByProduct(products, year, listRows('batchrecord'), listRows('deviation'))
}

/** 汇总口径是否与行内已固化的批次数/偏差总数一致；迁移回填后的数据用于审批前核对。 */
export function reviewConsistent(row: EntryRow, summary: ProductYearSummary[]): boolean {
  const validRows = summary.filter((item) => item.valid)
  if (validRows.length === 0) return false
  const totalBatches = validRows.reduce((sum, item) => sum + item.batchCount, 0)
  const totalDeviations = validRows[0]?.deviationCount ?? 0
  return (
    Number(row['批次数'] ?? -1) === totalBatches &&
    Number(row['偏差总数'] ?? -1) === totalDeviations
  )
}

type RunActionOptions = {
  operator?: string
}

export function runAction(
  key: string,
  id: number,
  action: string,
  options: RunActionOptions = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  // 状态流卡口：配置了 transitions 的模块，只允许顺着推进，越级拒收。
  if (meta.transitions) {
    const allowedTargets = meta.transitions[current]
    if (!allowedTargets) {
      return { ok: false, message: `${meta.entity}当前状态「${current}」为终态，不能执行「${action}」` }
    }
    if (!allowedTargets.includes(target)) {
      return {
        ok: false,
        message: `状态越级拒收：${meta.entity}不能从「${current}」直接流转到「${target}」，请按「${meta.statuses.join('→')}」顺序推进`,
      }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  // 年度回顾专属卡口：批准前必须结论齐备、产品在册、统计口径一致，批准时由审批人签署。
  if (key === 'annualreview') {
    const gate = checkAnnualReviewGate(rows[index], action, options.operator ?? '')
    if (!gate.ok) return gate
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    // 年度回顾以「已批准」为办结态：已退回仍需修改重提，计入待处理。
    pending: key === 'annualreview' ? target !== '已批准' : target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }

  if (key === 'annualreview') {
    if (action === '批准回顾') {
      updated['审批人'] = options.operator || String(rows[index]['审批人'] ?? '')
      updated['批准日期'] = new Date().toISOString().slice(0, 10)
      updated['回顾结论'] = String(rows[index]['回顾结论'] ?? '').trim()
    }
    if (action === '提交回顾') {
      // 重提时以台账最新口径固化批次数与偏差总数，保证签的内容与台账一致。
      const summary = annualReviewSummary(updated)
      const validRows = summary.filter((item) => item.valid)
      if (validRows.length > 0) {
        updated['批次数'] = validRows.reduce((sum, item) => sum + item.batchCount, 0)
        updated['偏差总数'] = validRows[0]?.deviationCount ?? updated['偏差总数']
        updated['统计部门'] = QA_DEPT_NAME
      }
    }
  }

  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  if (key === 'annualreview') {
    syncSupplierLedger(updated)
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function checkAnnualReviewGate(row: EntryRow, action: string, operator: string): ActionResult {
  if (action !== '批准回顾') return { ok: true, message: '' }

  const year = extractYear(row['回顾年度'])
  if (!year) {
    return { ok: false, message: '批准被拦：回顾年度不是有效四位年份，无法批准' }
  }
  const products = parseProducts(row['涉及产品'])
  if (products.every((product) => product === INVALID_PRODUCT)) {
    return { ok: false, message: '批准被拦：涉及产品超出在册范围（无效值），请先更正涉及产品' }
  }
  const conclusion = String(row['回顾结论'] ?? '').trim()
  if (!conclusion || /^年度质量回顾样例\d+$/.test(conclusion)) {
    return { ok: false, message: '批准被拦：回顾结论尚未填写，结论齐备后才能送审批人签署' }
  }
  if (!operator.trim()) {
    return { ok: false, message: '批准被拦：缺少审批人身份，无法签署' }
  }
  const summary = annualReviewSummary(row)
  if (!reviewConsistent(row, summary)) {
    const validRows = summary.filter((item) => item.valid)
    const expectBatches = validRows.reduce((sum, item) => sum + item.batchCount, 0)
    const expectDeviations = validRows[0]?.deviationCount ?? 0
    return {
      ok: false,
      message: `批准被拦：汇总口径与报告不一致（批次数应为 ${expectBatches}、偏差总数应为 ${expectDeviations}，由${QA_DEPT_NAME}统计），请先重新提交同步`,
    }
  }
  return { ok: true, message: '' }
}

/** 年度回顾状态同步到供应商审计台账：按回顾编号 upsert，产品是否在册一并带出。 */
function syncSupplierLedger(row: EntryRow): SupplierLedgerEntry[] {
  const products = parseProducts(row['涉及产品'])
  const summary = annualReviewSummary(row)
  const validRows = summary.filter((item) => item.valid)
  const entry: SupplierLedgerEntry = {
    reviewId: Number(row.id),
    reviewCode: String(row['回顾编号'] ?? ''),
    year: extractYear(row['回顾年度']),
    product: products.join('、'),
    productValid: products.every((product) => isValidProduct(product)),
    status: String(row.status),
    approver: String(row['审批人'] ?? ''),
    approvedAt: String(row['批准日期'] ?? ''),
    deviationCount: Number(row['偏差总数'] ?? validRows[0]?.deviationCount ?? 0),
    batchCount: Number(row['批次数'] ?? validRows.reduce((sum, item) => sum + item.batchCount, 0)),
    syncedAt: new Date().toISOString(),
  }
  return upsertSupplierEntry(entry)
}

export function listSupplierLedger(): SupplierLedgerEntry[] {
  return supplierLedger()
}

/** 应用启动/迁移后调用：把当前年度回顾全量状态对齐到供应商审计台账。 */
export function syncAllAnnualReviewsToSupplierLedger(): void {
  for (const row of listRows('annualreview')) {
    syncSupplierLedger(row)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export type AnnualExportResult = {
  filename: string
  content: string
  first: boolean
  ledger: ExportLedgerEntry
}

/**
 * 年度回顾单份导出：同一份回顾（内容指纹不变）重复导出只算一次，
 * 重复导出仍给出文件，但台账只记首次，返回提示。
 */
export function exportAnnualReview(id: number, operator = ''): AnnualExportResult | ActionResult {
  const rows = listRows('annualreview')
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的年度回顾报告` }
  }
  const summary = annualReviewSummary(row)
  const header = ['回顾编号', '回顾年度', '涉及产品', '产品有效性', '批次数', '偏差总数', '统计部门', '回顾结论', '审批人', '批准日期', '当前状态']
  const validProducts = parseProducts(row['涉及产品'])
  const validRows = summary.filter((item) => item.valid)
  const line = [
    row['回顾编号'],
    row['回顾年度'],
    validProducts.join('、'),
    validProducts.every((product) => isValidProduct(product)) ? '有效' : '无效',
    row['批次数'],
    row['偏差总数'],
    row['统计部门'] ?? QA_DEPT_NAME,
    row['回顾结论'],
    row['审批人'],
    row['批准日期'],
    row.status,
  ].join(',')
  const summaryLines = summary
    .map((item) => ['', '', item.product, item.valid ? '有效' : '无效', item.batchCount, item.deviationCount, QA_DEPT_NAME].join(','))
    .join('\n')
  const content = `﻿${[header.join(','), line, summaryLines].filter(Boolean).join('\n')}`

  const fingerprint = reviewFingerprint(row, summary)
  const { entry, first } = recordExport({
    reviewId: Number(row.id),
    reviewCode: String(row['回顾编号'] ?? ''),
    year: extractYear(row['回顾年度']),
    hash: fingerprint,
    operator,
  })

  return {
    filename: `年度质量回顾-${String(row['回顾编号'] ?? id)}.csv`,
    content,
    first,
    ledger: entry,
  }
}

export function listAnnualExportLedger(): ExportLedgerEntry[] {
  return exportLedger()
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadTextFile(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
