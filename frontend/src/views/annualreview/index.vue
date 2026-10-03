<template>
  <section class="page" data-module="annualreview">
    <header class="page-head">
      <div>
        <h2>年度质量回顾管理</h2>
        <p class="page-desc">年度回顾按涉及产品汇总；偏差总数由质量部按产品统计回填，回顾结论经审批人签署后方可批准，状态只允许逐级推进。</p>
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
    </p>

    <p v-if="invalidCount > 0" class="error-text">
      有 {{ invalidCount }} 份回顾的涉及产品超出产品目录范围，已按无效值处理，不能批准，请先更正产品。
    </p>

    <h3 class="subhead">按涉及产品汇总</h3>
    <table class="data-table summary-table">
      <thead>
        <tr>
          <th>涉及产品</th>
          <th>回顾报告数</th>
          <th>批次数合计</th>
          <th>偏差总数（质量部统计）</th>
          <th>已批准数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in productSummary" :key="item.product">
          <td>{{ item.product }}</td>
          <td>{{ item.reviewCount }}</td>
          <td>{{ item.batchCount }}</td>
          <td>{{ item.deviationTotal }}</td>
          <td>{{ item.approvedCount }}</td>
        </tr>
      </tbody>
    </table>

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
          <td v-for="column in columns" :key="column">
            <template v-if="column === '涉及产品'">
              <span :class="{ 'error-text': !isValidProduct(row[column]) }">{{ formatCell(row[column]) }}</span>
            </template>
            <template v-else-if="column === '审批人' || column === '回顾结论'">
              {{ formatCell(row[column]) }}
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无年度质量回顾数据，可先登记年度回顾报告</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条年度质量回顾记录</span>
      <span v-if="exportNotice" class="export-notice">{{ exportNotice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  applyQaDeviationStats,
  signReview,
  summarizeByProduct,
} from '@/api/annual-review'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { isKnownProductSet } from '@/data/products'
import type { AnnualReviewExportResult } from '@/data/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('annualreview')
const columns = ["回顾编号", "回顾年度", "涉及产品", "批次数", "偏差总数", "回顾结论", "审批人", "回顾状态"]
// 动作按钮按当前状态出现：状态机只允许逐级推进，越级动作不给入口，直接调接口也会被服务层拒收
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  "待回顾": ["提交回顾", "签署回顾结论", "质量部统计偏差"],
  "回顾中": ["签署回顾结论", "质量部统计偏差", "批准回顾", "退回修改"],
  "已退回": ["签署回顾结论", "质量部统计偏差", "重新提交"],
  "已批准": [],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const exportNotice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statuses = meta.statuses
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待回顾报告', value: rows.value.filter((row) => row.status === '待回顾').length },
  { label: '回顾中报告', value: rows.value.filter((row) => ['回顾中', '已退回'].includes(String(row.status))).length },
  { label: '已批准报告', value: rows.value.filter((row) => row.status === '已批准').length },
])
const invalidCount = computed(
  () => rows.value.filter((row) => !isKnownProductSet(row['涉及产品'])).length,
)
const productSummary = computed(() => summarizeByProduct())

function actionsFor(row: EntryRow): string[] {
  return ACTIONS_BY_STATUS[String(row.status)] ?? []
}

function isValidProduct(value: unknown): boolean {
  return isKnownProductSet(value)
}

function formatCell(value: unknown): string {
  const text = String(value ?? '').trim()
  return text ? text : '—'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  errorMessage.value = ''
  exportNotice.value = ''
  const result = downloadEntries(meta.key) as AnnualReviewExportResult
  // 同一份回顾重复导出只算一次：第一次全量，之后只出新增部分
  exportNotice.value = `本次新导出 ${result.exported} 份；重复导出跳过 ${result.skippedDuplicates} 份（同一份回顾只计一次）`
  reload()
}

function openCreate() {
  errorMessage.value = '年度回顾报告登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '签署回顾结论') {
    sign(row)
    return
  }
  if (action === '质量部统计偏差') {
    const result = applyQaDeviationStats(Number(row.id))
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    exportNotice.value = result.message
    reload()
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// 回顾结论要经审批人签：签署不改变状态，只是批准的前置
function sign(row: EntryRow) {
  const approver = window.prompt('请输入审批人（签署后不可由他人代签）：', String(row['审批人'] ?? ''))
  if (approver === null) {
    return
  }
  const conclusion = window.prompt('请输入年度回顾结论：', String(row['回顾结论'] ?? ''))
  if (conclusion === null) {
    return
  }
  const result = signReview(Number(row.id), { approver, conclusion })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  exportNotice.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '年度质量回顾列表读取失败'
  }
}

onMounted(reload)
</script>
