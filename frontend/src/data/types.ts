/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /**
   * 允许的状态流转：仅在需要强制「顺着往下推进、越级拒收」的模块上配置。
   * key 为当前状态，value 为该状态下允许到达的目标状态；未配置的模块沿用通用流转。
   * null 表示该状态是终态，除显式重提外不允许任何动作。
   */
  transitions?: Record<string, string[] | null>
  /** 终态之外允许的「打回」动作目标（如已退回），仅在进行中状态可执行。 */
  rejectActions?: Record<string, string>
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 按产品汇总的年度回顾口径。 */
export type ProductYearSummary = {
  product: string
  valid: boolean
  batchCount: number
  deviationCount: number
}

/** 年度回顾导出去重台账的一条记录。 */
export type ExportLedgerEntry = {
  reviewId: number
  reviewCode: string
  year: string
  hash: string
  exportedAt: string
  operator: string
  times: number
}

/** 同步到供应商审计台账的年度回顾状态。 */
export type SupplierLedgerEntry = {
  reviewId: number
  reviewCode: string
  year: string
  product: string
  productValid: boolean
  status: string
  approver: string
  approvedAt: string
  deviationCount: number
  batchCount: number
  syncedAt: string
}
