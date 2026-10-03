import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, ConflictDraft, PendingWrite, TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'
import { applyReview, captureBasis, discardDraft, hydrateDataset, uniqueId } from '../domain/version-chain'
import { TailingsActions } from './tailings.actions'

export type NoticeKind = 'applied' | 'conflict' | 'duplicate' | 'rejected' | 'info'
export interface ReviewNotice {
  kind: NoticeKind
  text: string
}
function notice(kind: NoticeKind, text: string): ReviewNotice {
  return { kind, text }
}

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
  /** 发送失败的写（WAL），含完整审阅版本快照，可恢复重试 */
  pendingWrites: PendingWrite[]
  /** 后到保存产生的冲突草稿（保留依据） */
  conflictDrafts: ConflictDraft[]
  /** 最近一次版本链操作提示（冲突/失败/幂等/拒绝均可见） */
  notice: ReviewNotice | null
}

const hydratedSeed = hydrateDataset(seedDataset)

export const initialTailingsState: TailingsState = {
  dataset: hydratedSeed,
  loading: false,
  error: '',
  selectedAnomalyId: hydratedSeed.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部',
  pendingWrites: [],
  conflictDrafts: [],
  notice: null
}

function makeAudit(entry: Omit<AuditEntry, 'id'>): AuditEntry {
  return { id: uniqueId('AUD'), ...entry }
}

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => {
    const hydrated = hydrateDataset(dataset)
    return { ...state, dataset: hydrated, loading: false, selectedAnomalyId: hydrated.anomalies[0]?.id ?? '' }
  }),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(TailingsActions.hydrateRecovery, (state, { pendingWrites, conflictDrafts }) => ({
    ...state,
    pendingWrites,
    conflictDrafts,
    notice: pendingWrites.length
      ? notice('info', `恢复出 ${pendingWrites.length} 条未完成写，可从完整审阅版本重试`)
      : state.notice
  })),

  // 提交入口：先登记 outbox（待发送，含完整审阅依据），版本链判定在 CommitReview
  on(TailingsActions.submitReview, (state, req) => {
    const anomaly = state.dataset.anomalies.find((item) => item.id === req.anomalyId)
    if (!anomaly) return { ...state, notice: notice('rejected', '异常不存在') }
    // 同一 commandId 已在 outbox：视为重放，不重复登记（链上幂等在 CommitReview 兜底）
    if (state.pendingWrites.some((item) => item.commandId === req.commandId)) return state
    const pending: PendingWrite = {
      commandId: req.commandId,
      anomalyId: req.anomalyId,
      kind: commandKind(req.command.type),
      operator: req.operator,
      baseVersion: req.baseVersion,
      payload: req.command as unknown as Record<string, unknown>,
      status: '待发送',
      attempts: 0,
      lastError: '',
      createdAt: req.createdAt,
      updatedAt: req.createdAt,
      snapshot: captureBasis(anomaly)
    }
    return { ...state, pendingWrites: [pending, ...state.pendingWrites] }
  }),

  on(TailingsActions.commitReview, (state, req) => {
    const result = applyReview(state.dataset, req)
    // 通道已确认，outbox 中对应待办移除（无论 applied/conflict/duplicate）
    const pendingWrites = state.pendingWrites.filter((item) => item.commandId !== req.commandId)

    if (result.outcome === 'applied') {
      return {
        ...state,
        dataset: result.dataset,
        pendingWrites,
        notice: notice('applied', `已生效：V${req.baseVersion} → V${result.headVersion}`)
      }
    }

    if (result.outcome === 'conflict' && result.conflict) {
      // 后到保存：不覆盖已生效签批/审计，保留冲突草稿与依据
      return {
        ...state,
        pendingWrites,
        conflictDrafts: [result.conflict, ...state.conflictDrafts],
        notice: notice('conflict', `${result.reason}；已保留冲突草稿，可对齐后重提`)
      }
    }

    if (result.outcome === 'duplicate') {
      // 重放命中已应用命令：不重复追加结论
      return { ...state, pendingWrites, notice: notice('duplicate', '该操作此前已生效，重放未重复追加结论') }
    }

    // rejected：业务校验未通过（非通道故障），不保留为失败写，仅提示
    return { ...state, pendingWrites, notice: notice('rejected', `操作未生效：${result.reason}`) }
  }),

  on(TailingsActions.writeFailed, (state, { commandId, error }) => {
    const exists = state.pendingWrites.some((item) => item.commandId === commandId)
    if (!exists) return state
    return {
      ...state,
      pendingWrites: state.pendingWrites.map((item) =>
        item.commandId === commandId
          ? { ...item, status: '发送失败' as const, attempts: Math.max(item.attempts, 1), lastError: error, updatedAt: new Date().toISOString() }
          : item
      ),
      notice: notice('rejected', `写入失败：${error}；完整审阅版本已保留，可重试`)
    }
  }),

  on(TailingsActions.retryWrite, (state, { commandId }) => ({
    ...state,
    pendingWrites: state.pendingWrites.map((item) =>
      item.commandId === commandId ? { ...item, status: '待发送' as const, attempts: item.attempts + 1, updatedAt: new Date().toISOString() } : item
    )
  })),

  on(TailingsActions.retryAllWrites, (state) => ({
    ...state,
    pendingWrites: state.pendingWrites.map((item) => ({ ...item, status: '待发送' as const, attempts: item.attempts + 1, updatedAt: new Date().toISOString() }))
  })),

  on(TailingsActions.discardWrite, (state, { commandId }) => {
    const pending = state.pendingWrites.find((item) => item.commandId === commandId)
    if (!pending) return state
    const audit = makeAudit({
      entityId: pending.anomalyId,
      action: '放弃失败写',
      operator: pending.operator,
      detail: `放弃V${pending.baseVersion}未完成写（${pending.kind}，${pending.lastError || '未发送'}），未改动生效版本链`,
      createdAt: new Date().toISOString(),
      baseVersion: pending.snapshot.anomalyVersion,
      version: pending.snapshot.anomalyVersion,
      commandId,
      conflict: true
    })
    return {
      ...state,
      pendingWrites: state.pendingWrites.filter((item) => item.commandId !== commandId),
      dataset: { ...state.dataset, audit: [audit, ...state.dataset.audit] },
      notice: notice('info', '已放弃该失败写，生效版本链未改动')
    }
  }),

  // 冲突草稿重提由 effect 对齐链头并走写通道（submitReview）；此处先标记草稿，
  // 通道结果回到 commitReview：再次冲突会生成新草稿，成功则提示生效。
  on(TailingsActions.resubmitDraft, (state, { draftId }) => {
    const draft = state.conflictDrafts.find((item) => item.id === draftId)
    if (!draft) return state
    return {
      ...state,
      conflictDrafts: state.conflictDrafts.map((item) => item.id === draftId ? { ...item, status: '已重提' as const } : item),
      notice: notice('info', `正在对齐V${draft.headVersion}重新提交草稿…`)
    }
  }),

  on(TailingsActions.discardDraft, (state, { draftId }) => {
    const draft = state.conflictDrafts.find((item) => item.id === draftId)
    if (!draft) return state
    const dataset = discardDraft(state.dataset, draft, new Date().toISOString())
    return {
      ...state,
      dataset,
      conflictDrafts: state.conflictDrafts.map((item) => item.id === draftId ? { ...item, status: '已放弃' as const } : item),
      notice: notice('info', '已放弃冲突草稿，生效版本链未改动')
    }
  }),

  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.clearNotice, (state) => ({ ...state, notice: null })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, () => {
    const seed = hydrateDataset(structuredClone(seedDataset))
    return {
      ...initialTailingsState,
      dataset: seed,
      selectedAnomalyId: seed.anomalies[0]?.id ?? '',
      pendingWrites: [],
      conflictDrafts: [],
      notice: notice('info', '演示数据与版本链已重置（失败写与冲突草稿已清空）')
    }
  })
)

function commandKind(type: string): PendingWrite['kind'] {
  const map: Record<string, PendingWrite['kind']> = {
    submitFieldReview: '现场复核',
    addExpertOpinion: '补充专业意见',
    withdrawExpertOpinion: '撤回专业意见',
    saveDispositionPlan: '提交处置方案',
    approvePlan: '审批处置方案',
    createEmergencyLink: '应急联动',
    closeAnomaly: '关闭异常'
  }
  return map[type] ?? '现场复核'
}
