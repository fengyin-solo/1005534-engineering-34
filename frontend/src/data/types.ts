/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

// 状态流转表：只有显式列出的「当前状态 + 动作」才允许推进；没登记的（含越级）一律拒收。
export type TransitionMap = Record<string, Record<string, string>>

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
  // 不改变状态的动作（如签署结论、质量部统计偏差总数）：不进状态机，但仍受业务校验约束。
  statelessActions?: string[]
  transitions?: TransitionMap
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

// 供应商审计台账里的年度回顾同步条目
export type AuditLedgerEntry = {
  reviewId: number
  reviewNo: string
  year: string
  products: string
  deviationTotal: number | string
  conclusion: string
  approver: string
  status: string
  abnormal: boolean
  updatedAt: string
}

// 年度回顾导出结果：同一份回顾重复导出只计一次。
export type AnnualReviewExportResult = {
  filename: string
  content: string
  exported: number
  skippedDuplicates: number
  firstTime: boolean
}
