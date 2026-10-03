import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { runMigrations } from '@/data/migration'
import { syncAllAnnualReviewsToSupplierLedger } from '@/api/local-service'

// 先迁移存量数据（按旧记录回填），再把年度回顾状态对齐到供应商审计台账。
runMigrations()
syncAllAnnualReviewsToSupplierLedger()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
