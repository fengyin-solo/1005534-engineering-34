import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    // 年度回顾批准需要审批人签署：默认带入当前审批人身份，可在会话中切换。
    approver: '质量负责人·李华',
    shiftLabel: '白班 08:00-20:00',
    scope: '制药企业洁净区与批生产记录管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canApprove: (state) => state.approver.trim().length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setApprover(name: string) {
      this.approver = name
    },
  },
})
