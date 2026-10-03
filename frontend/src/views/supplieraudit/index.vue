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

    <h3 class="subhead">年度回顾同步台账</h3>
    <p class="page-desc ledger-hint">年度回顾的状态变化自动同步到本台账，以回顾编号为唯一键覆盖更新；涉及产品超出目录范围的按无效值标红。</p>
    <table class="data-table">
      <thead>
        <tr>
          <th>回顾编号</th>
          <th>回顾年度</th>
          <th>涉及产品</th>
          <th>偏差总数</th>
          <th>回顾结论</th>
          <th>审批人</th>
          <th>回顾状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in ledger" :key="String(entry.reviewId)">
          <td>{{ entry.reviewNo }}</td>
          <td>{{ entry.year }}</td>
          <td :class="{ 'error-text': entry.products === '无效产品' }">{{ entry.products }}</td>
          <td>{{ entry.deviationTotal }}</td>
          <td>{{ entry.conclusion || '—' }}</td>
          <td>{{ entry.approver || '未签署' }}</td>
          <td>{{ entry.status }}</td>
        </tr>
        <tr v-if="!ledger.length">
          <td colspan="7" class="empty-state">台账暂无年度回顾记录</td>
        </tr>
      </tbody>
    </table>

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
  moduleMeta,
  runAction as applyAction,
  supplierAuditLedger,
} from '@/api/local-service'
import type { AuditLedgerEntry, EntryRow } from '@/data/types'

const meta = moduleMeta('supplieraudit')
const columns = ["审计编号", "供应商名称", "物料类别", "审计方式", "缺陷项数", "审计结论", "整改期限", "审计状态"]
const actions = ["提交审计", "判定通过", "要求整改"]
const statuses = ["待审计", "审计中", "已通过", "需整改"]
const stats = [{"label": "待审计供应商", "value": 0}, {"label": "审计中供应商", "value": 0}, {"label": "需整改供应商数", "value": 0}]

const rows = ref<EntryRow[]>([])
const ledger = ref<AuditLedgerEntry[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
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
    ledger.value = supplierAuditLedger()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '供应商审计列表读取失败'
  }
}

onMounted(reload)
</script>
