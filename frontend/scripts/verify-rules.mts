/**
 * 业务规则验证（node 直跑，不落仓库脚本）：用内存版 localStorage 装载"旧版本"数据，
 * 验证存量迁移回填、越级拒收、审批签署、按产品汇总、导出去重、供应商台账同步。
 */
globalThis.window = {
  localStorage: (() => {
    const store = new Map()
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      _store: store,
    }
  })(),
}

const APPROVER = '质量负责人·王审批'

const assertions = []
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  assertions.push({ name, pass, actual, expected })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : `\n    expected=${JSON.stringify(expected)}\n    actual=  ${JSON.stringify(actual)}`}`)
}

// —— 构造"上线前"的旧记录：schema 版本 1，产品别名/占位写法，批次/偏差是占位文本 ——
window.localStorage.setItem('pharma-cleanroom:schema-version', '1')
window.localStorage.setItem('pharma-cleanroom:entries', JSON.stringify({
  batchrecord: [
    { id: 1, status: '已复核', pending: false, abnormal: false, 批号: 'BR-2025-010', 产品名称: '生理盐水', 生产工序: '配液', 起始时间: '2025-03-01' },
    { id: 2, status: '已复核', pending: false, abnormal: false, 批号: 'BR-2025-011', 产品名称: '氯化钠注射液', 生产工序: '配液', 起始时间: '2025-04-01' },
    { id: 3, status: '已复核', pending: false, abnormal: false, 批号: 'BR-2025-012', 产品名称: '葡萄糖注射液', 生产工序: '配液', 起始时间: '2025-05-01' },
  ],
  deviation: [
    { id: 1, status: '调查中', pending: true, abnormal: true, 偏差编号: 'DEVI-2025-010' },
    { id: 2, status: '已关闭', pending: false, abnormal: false, 偏差编号: 'DEVI-2025-011' },
    { id: 3, status: '待处理', pending: true, abnormal: false, 偏差编号: 'DEVI-2025-012' },
  ],
  annualreview: [
    { id: 1, status: '待回顾', pending: true, abnormal: false, 回顾编号: 'ANNU-2025-100', 回顾年度: '2025', 涉及产品: '生理盐水', 批次数: '年度质量回顾样例1', 偏差总数: '年度质量回顾样例1', 回顾结论: '', 审批人: '' },
    { id: 2, status: '回顾中', pending: true, abnormal: false, 回顾编号: 'ANNU-2025-101', 回顾年度: '2025', 涉及产品: '葡萄糖注射液(250ml:12.5g)', 批次数: 1, 偏差总数: 2, 回顾结论: '', 审批人: '' },
    { id: 3, status: '回顾中', pending: true, abnormal: false, 回顾编号: 'ANNU-2025-102', 回顾年度: '2025', 涉及产品: '未在册的自造产品', 批次数: 0, 偏差总数: 2, 回顾结论: '', 审批人: '' },
    { id: 4, status: '已批准', pending: false, abnormal: false, 回顾编号: 'ANNU-2024-100', 回顾年度: '2024', 涉及产品: '氯化钠注射液(100ml:0.9g)', 批次数: 0, 偏差总数: 0, 回顾结论: '旧年度已签结论', 审批人: '前任负责人', 批准日期: '2025-01-10' },
  ],
  supplieraudit: [],
}))

await import('@/data/migration.ts').then(async (m) => {
  m.runMigrations()
  check('迁移后数据结构版本为 2', m.currentSchemaVersion(), 2)
})

const store = await import('@/data/local-store.ts')
const service = await import('@/api/local-service.ts')

// 与 main.ts 一致：迁移后把全部年度回顾状态同步到供应商审计台账。
service.syncAllAnnualReviewsToSupplierLedger()

// —— 迁移回填校验 ——
const reviews = store.listRows('annualreview')
const r1 = reviews.find((r) => r.id === 1)
check('存量迁移：产品别名归一到主数据', r1['涉及产品'], '氯化钠注射液(100ml:0.9g)')
check('存量迁移：批次数按旧批记录回填（2 条氯化钠 2025）', r1['批次数'], 2)
check('存量迁移：偏差总数按质量部口径回填（待处理不计）', r1['偏差总数'], 2)
check('存量迁移：标注回填来源与统计部门', [r1['数据来源'], r1['统计部门']], ['存量迁移回填', '质量部'])

const r3 = reviews.find((r) => r.id === 3)
check('存量迁移：超范围产品按无效值', r3['涉及产品'], '无效值')

const batches = store.listRows('batchrecord')
check('存量迁移：批记录产品名同步归一', batches.map((b) => b['产品名称']), [
  '氯化钠注射液(100ml:0.9g)',
  '氯化钠注射液(100ml:0.9g)',
  '葡萄糖注射液(250ml:12.5g)',
])

// —— 越级拒收 ——
let res = service.runAction('annualreview', 1, '批准回顾', { operator: APPROVER })
check('越级拒收：待回顾不能直接批准', res.ok, false)
res = service.runAction('annualreview', 1, '退回修改', { operator: APPROVER })
check('越级拒收：待回顾不能直接退回', res.ok, false)

// —— 正常推进：提交回顾（重算并固化口径）——
res = service.runAction('annualreview', 1, '提交回顾', { operator: APPROVER })
check('顺序推进：待回顾→回顾中', [res.ok, store.listRows('annualreview').find((r) => r.id === 1).status], [true, '回顾中'])

// —— 批准卡口：结论为空时拒签 ——
res = service.runAction('annualreview', 1, '批准回顾', { operator: APPROVER })
check('批准卡口：缺回顾结论拒收', res.ok, false)
const rowsNow = store.listRows('annualreview')
rowsNow.find((r) => r.id === 1)['回顾结论'] = '全年质量稳定，符合标准。'
store.saveRows('annualreview', rowsNow)

// —— 批准卡口：缺审批人身份拒签 ——
res = service.runAction('annualreview', 1, '批准回顾', { operator: '' })
check('批准卡口：缺审批人身份拒收', res.ok, false)

// —— 正式批准：审批人签署 + 批准日期 ——
res = service.runAction('annualreview', 1, '批准回顾', { operator: APPROVER })
check('批准通过：签署', [res.ok, store.listRows('annualreview').find((r) => r.id === 1).status], [true, '已批准'])
const approved = store.listRows('annualreview').find((r) => r.id === 1)
check('批准签署：审批人写入', approved['审批人'], APPROVER)
check('批准签署：批准日期回填（今天）', approved['批准日期'], new Date().toISOString().slice(0, 10))

// —— 终态拒收 ——
res = service.runAction('annualreview', 1, '退回修改', { operator: APPROVER })
check('终态拒收：已批准不能退回', res.ok, false)

// —— 超范围产品批准拒收 ——
store.listRows('annualreview').find((r) => r.id === 3)['回顾结论'] = '无效产品也要签'
res = service.runAction('annualreview', 3, '批准回顾', { operator: APPROVER })
check('批准卡口：涉及产品无效值拒收', res.ok, false)

// —— 退回流：回顾中→已退回→回顾中——
res = service.runAction('annualreview', 2, '退回修改', { operator: APPROVER })
check('顺序推进：回顾中→已退回', [res.ok, store.listRows('annualreview').find((r) => r.id === 2).status], [true, '已退回'])
res = service.runAction('annualreview', 2, '批准回顾', { operator: APPROVER })
check('越级拒收：已退回不能直接批准', res.ok, false)
res = service.runAction('annualreview', 2, '提交回顾', { operator: APPROVER })
check('顺序推进：已退回重新提交→回顾中', [res.ok, store.listRows('annualreview').find((r) => r.id === 2).status], [true, '回顾中'])
// 再走一次退回，确认已退回仍计入待处理（不是办结态）
service.runAction('annualreview', 2, '退回修改', { operator: APPROVER })
check('待处理口径：已退回 pending 仍为 true', store.listRows('annualreview').find((r) => r.id === 2).pending, true)
service.runAction('annualreview', 2, '提交回顾', { operator: APPROVER })

// —— 按产品汇总口径 ——
const r1again = store.listRows('annualreview').find((r) => r.id === 1)
const summary = service.annualReviewSummary(r1again)
check('按产品汇总：有效产品行数与批次/偏差口径', summary, [{
  product: '氯化钠注射液(100ml:0.9g)',
  valid: true,
  batchCount: 2,
  deviationCount: 2,
}])

// —— 导出去重：同一份重复导出只算一次 ——
const first = service.exportAnnualReview(1, APPROVER)
const second = service.exportAnnualReview(1, APPROVER)
check('导出：首次标记 first=true', first.first, true)
check('导出：同一份重复导出 first=false（只算一次）', second.first, false)
check('导出：台账记录次数累加到 2', second.ledger.times, 2)
const ledger = service.listAnnualExportLedger()
check('导出：去重台账只有 1 条（按回顾+内容指纹）', ledger.length, 1)

// —— 供应商审计台账同步 ——
const supplierLedgerRows = service.listSupplierLedger()
const syncRow = supplierLedgerRows.find((s) => s.reviewId === 1)
check('台账同步：批准状态同步到供应商审计', syncRow.status, '已批准')
check('台账同步：审批人/批次/偏差带出', [syncRow.approver, syncRow.batchCount, syncRow.deviationCount], [APPROVER, 2, 2])
const syncInvalid = supplierLedgerRows.find((s) => s.reviewId === 3)
check('台账同步：无效产品标记带出', syncInvalid.productValid, false)
const r2Status = store.listRows('annualreview').find((r) => r.id === 2).status
check('台账同步：重提后状态更新（upsert 而非新增）', [
  supplierLedgerRows.filter((s) => s.reviewId === 2).length,
  supplierLedgerRows.find((s) => s.reviewId === 2).status,
], [1, r2Status])

const failed = assertions.filter((a) => !a.pass)
console.log(`\n${assertions.length - failed.length}/${assertions.length} 通过`)
if (failed.length) process.exit(1)
