<template>
  <section class="page" data-module="supplieraudit">
    <header class="page-head">
      <div>
        <h2>供应商审计管理</h2>
        <p class="page-desc">维护供应商审计记录，围绕审计编号、供应商名称、物料类别、审计方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记供应商审计记录</button>
        <button class="btn" type="button" @click="exportRows">导出供应商审计清单</button>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无供应商审计数据，可先登记供应商审计记录</td>
        </tr>
      </tbody>
    </table>

    <section class="ledger-block">
      <h3>年度回顾同步台账</h3>
      <p class="muted-text">年度回顾的批准状态实时同步到本台账，作为供应商审计评估质量回顾结论的依据。</p>
      <table class="data-table compact" v-if="reviewLedger.length">
        <thead>
          <tr>
            <th>回顾编号</th><th>回顾年度</th><th>涉及产品</th><th>状态</th><th>审批人</th><th>签署日期</th><th>批次数</th><th>偏差总数</th><th>同步时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviewLedger" :key="item.reviewId" :class="{ 'invalid-row': !item.productValid }">
            <td>{{ item.reviewCode }}</td>
            <td>{{ item.year || '—' }}</td>
            <td :class="{ 'invalid-text': !item.productValid }">{{ item.product }}</td>
            <td>{{ item.status }}</td>
            <td>{{ item.approver || '—' }}</td>
            <td>{{ item.approvedAt || '—' }}</td>
            <td>{{ item.batchCount }}</td>
            <td>{{ item.deviationCount }}</td>
            <td>{{ formatTime(item.syncedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted-text">暂未收到年度回顾状态同步。</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条供应商审计记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listSupplierLedger,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, SupplierLedgerEntry } from '@/data/types'

const meta = moduleMeta('supplieraudit')
const columns = ["审计编号", "供应商名称", "物料类别", "审计方式", "缺陷项数", "审计结论", "整改期限", "审计状态"]
const actions = ["提交审计", "判定通过", "要求整改"]
const statuses = ["待审计", "审计中", "已通过", "需整改"]
const stats = [{"label": "待审计供应商", "value": 0}, {"label": "审计中供应商", "value": 0}, {"label": "需整改供应商数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reviewLedger = ref<SupplierLedgerEntry[]>([])

function formatTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '供应商审计记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
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
    reviewLedger.value = listSupplierLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '供应商审计列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.ledger-block {
  margin-top: 24px;
}
.ledger-block h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.muted-text {
  color: #8a8f99;
  font-size: 12px;
}
.data-table.compact {
  font-size: 12px;
}
.invalid-row {
  background-color: rgba(214, 48, 49, 0.06);
}
.invalid-text {
  color: #d63031;
  font-weight: 600;
}
</style>
