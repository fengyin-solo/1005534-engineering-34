<template>
  <section class="page" data-module="annualreview">
    <header class="page-head">
      <div>
        <h2>年度质量回顾管理</h2>
        <p class="page-desc">年度回顾按产品汇总，偏差总数由质量部统计，回顾结论经审批人签署后方可批准。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记年度回顾报告</button>
        <button class="btn" type="button" @click="exportRows">导出年度质量回顾清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前审批人：{{ session.approver }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>按产品汇总</th>
          <th>当前状态</th>
          <th>可执行动作</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'invalid-row': isInvalid(row) }">
          <td v-for="column in columns" :key="column">{{ displayField(row, column) }}</td>
          <td class="summary-cell">
            <div v-for="item in summaryMap.get(Number(row.id)) ?? []" :key="item.product" class="summary-line">
              <span :class="{ 'invalid-text': !item.valid }">{{ item.product }}</span>
              <span>批次 {{ item.batchCount }}</span>
              <span>偏差 {{ item.deviationCount }}（{{ qaDept }}）</span>
            </div>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="actionsFor(row).length">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">终态，无可用动作</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="exportOne(row)">导出本份</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无年度质量回顾数据，可先登记年度回顾报告</td>
        </tr>
      </tbody>
    </table>

    <section v-if="exportLedgerRows.length" class="ledger-block">
      <h3>导出去重台账</h3>
      <p class="muted-text">同一份回顾内容不变时重复导出只计一次，最近导出时间与次数如下。</p>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>回顾编号</th><th>回顾年度</th><th>首次导出日期</th><th>导出次数</th><th>操作人</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in exportLedgerRows" :key="`${item.reviewId}-${item.hash}`">
            <td>{{ item.reviewCode }}</td>
            <td>{{ item.year || '—' }}</td>
            <td>{{ item.exportedAt }}</td>
            <td>{{ item.times }}</td>
            <td>{{ item.operator || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条年度质量回顾记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  annualReviewSummary,
  availableActions,
  downloadTextFile,
  exportAnnualReview,
  listAnnualExportLedger,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { QA_DEPT_NAME, isValidProduct, parseProducts } from '@/data/products'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, ProductYearSummary } from '@/data/types'

const meta = moduleMeta('annualreview')
const columns = ['回顾编号', '回顾年度', '涉及产品', '产品有效性', '批次数', '偏差总数', '统计部门', '回顾结论', '审批人', '批准日期', '数据来源']
const statuses = ['待回顾', '回顾中', '已批准', '已退回']
const qaDept = QA_DEPT_NAME
const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['回顾编号', '回顾年度', '涉及产品']
const exportLedgerRows = ref(listAnnualExportLedger())

const stats = computed(() => [
  { label: '待回顾报告', value: rows.value.filter((row) => row.status === '待回顾').length },
  { label: '回顾中报告', value: rows.value.filter((row) => row.status === '回顾中' || row.status === '已退回').length },
  { label: '已批准报告', value: rows.value.filter((row) => row.status === '已批准').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const summaryMap = computed(() => {
  const map = new Map<number, ProductYearSummary[]>()
  for (const row of rows.value) {
    map.set(Number(row.id), annualReviewSummary(row))
  }
  return map
})

function displayField(row: EntryRow, column: string): string {
  const value = row[column]
  if (value === undefined || value === '') return '—'
  return String(value)
}

function isInvalid(row: EntryRow): boolean {
  return String(row['产品有效性'] ?? '') === '无效' ||
    parseProducts(row['涉及产品']).every((product) => !isValidProduct(product))
}

function actionsFor(row: EntryRow): string[] {
  return availableActions(meta, String(row.status))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  errorMessage.value = ''
  downloadTextFile('年度质量回顾-清单.csv', buildListCsv())
}

function buildListCsv(): string {
  const header = [...columns, '当前状态'].join(',')
  const lines = rows.value.map((row) =>
    [...columns.map((column) => row[column] ?? ''), row.status].join(','),
  )
  return `﻿${[header, ...lines].join('\n')}`
}

function exportOne(row: EntryRow) {
  errorMessage.value = ''
  const result = exportAnnualReview(Number(row.id), session.approver)
  if ('ok' in result && !result.ok) {
    errorMessage.value = result.message
    return
  }
  if ('content' in result) {
    downloadTextFile(result.filename, result.content)
    errorMessage.value = result.first
      ? `已导出并登记（${result.ledger.reviewCode} 首次导出）`
      : `同一份回顾重复导出，台账只计一次（第 ${result.ledger.times} 次下载，仍计首次）`
    exportLedgerRows.value = listAnnualExportLedger()
  }
}

function openCreate() {
  errorMessage.value = '年度回顾报告登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, { operator: session.approver })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    exportLedgerRows.value = listAnnualExportLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '年度质量回顾列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.invalid-row {
  background-color: rgba(214, 48, 49, 0.06);
}
.invalid-text {
  color: #d63031;
  font-weight: 600;
}
.muted-text {
  color: #8a8f99;
  font-size: 12px;
}
.summary-cell {
  min-width: 220px;
}
.summary-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.7;
  flex-wrap: wrap;
}
.ledger-block {
  margin-top: 24px;
}
.ledger-block h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.data-table.compact {
  font-size: 12px;
}
</style>
