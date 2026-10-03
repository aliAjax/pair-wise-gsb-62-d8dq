import { createReducer, on } from '@ngrx/store'
import type { TailingsDataset } from '../domain'
import {
  applyReviewWrite,
  commitConflictDraft,
  isApplied,
  resolveConflictDraft,
  retryPendingWrite,
  stashPendingWrite
} from '../domain/version-chain'
import { seedDataset } from '../data/seed'
import { TailingsActions } from './tailings.actions'

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  notice: string
  noticeKind: 'ok' | 'warn' | 'error'
  selectedAnomalyId: string
  keyword: string
  status: string
  /** 演示开关：下一次保存模拟写入失败，先暂存完整审阅版本 */
  simulateNextFailure: boolean
}

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  loading: false,
  error: '',
  notice: '',
  noticeKind: 'ok',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部',
  simulateNextFailure: false
}

const kindLabel: Record<string, string> = {
  'field-review': '现场复核',
  'opinion-add': '专业意见',
  'opinion-withdraw': '专业意见撤回',
  'plan-save': '处置方案',
  'plan-approve': '方案签批',
  'plan-start': '方案执行',
  'emergency-link': '应急联动',
  'anomaly-close': '关闭异常'
}

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({
    ...state,
    dataset,
    loading: false,
    selectedAnomalyId: dataset.anomalies[0]?.id ?? ''
  })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(TailingsActions.reviewWrite, (state, { write, simulateFailure }) => {
    // 模拟写入失败：完整审阅版本先留存，可稍后恢复重放，不影响已生效版本
    if (state.simulateNextFailure || simulateFailure) {
      const failedAt = new Date().toISOString()
      const dataset = stashPendingWrite(state.dataset, write, '模拟落库失败（网络/存储不可用）', failedAt)
      return {
        ...state,
        dataset,
        simulateNextFailure: false,
        noticeKind: 'error' as const,
        notice: `${kindLabel[write.kind] ?? write.kind}写入失败，完整审阅版本已留存，可在「待恢复写入」中重试（所见V${write.baseVersion}）。`
      }
    }

    const result = applyReviewWrite(state.dataset, write)
    if (isApplied(result)) {
      const target = result.dataset.anomalies.find((item) => item.id === write.anomalyId)
      return {
        ...state,
        dataset: result.dataset,
        noticeKind: 'ok' as const,
        notice: `${kindLabel[write.kind] ?? write.kind}已生效：V${write.baseVersion} → V${target?.version ?? ''}。`
      }
    }
    if (result.conflict) {
      return {
        ...state,
        dataset: result.dataset,
        noticeKind: 'warn' as const,
        notice: `并发冲突：您的保存基于V${result.conflict.baseVersion}，先到版本V${result.conflict.currentVersion}已生效（含签批/审计）；后到内容已保留为冲突草稿，未覆盖任何记录。`
      }
    }
    return { ...state, dataset: result.dataset, noticeKind: 'error' as const, notice: `写入被拒绝：${result.reason}` }
  }),

  on(TailingsActions.retryPendingWrite, (state, { writeId }) => {
    const { dataset, result, pending } = retryPendingWrite(state.dataset, writeId, new Date().toISOString())
    if (isApplied(result)) {
      return { ...state, dataset, noticeKind: 'ok' as const, notice: '已从完整审阅版本恢复并重放成功，链版本仅追加一次。' }
    }
    if (result.conflict) {
      return {
        ...state,
        dataset,
        noticeKind: 'warn' as const,
        notice: '恢复重放时该版本已过期，内容已保留为冲突草稿，未覆盖已生效签批与审计。'
      }
    }
    return {
      ...state,
      dataset,
      noticeKind: 'error' as const,
      notice: `恢复重试仍未成功：${result.reason}（第${pending?.attempts ?? 1}次），完整审阅版本继续保留。`
    }
  }),

  on(TailingsActions.resolveConflictDraft, (state, { draftId }) => ({
    ...state,
    dataset: resolveConflictDraft(state.dataset, draftId),
    noticeKind: 'ok' as const,
    notice: '冲突草稿已标记处理（内容与依据仍留痕可查）。'
  })),

  on(TailingsActions.commitConflictDraft, (state, { draftId }) => {
    const { dataset, result } = commitConflictDraft(state.dataset, draftId, '当前用户', new Date().toISOString())
    if (isApplied(result)) {
      return { ...state, dataset, noticeKind: 'ok' as const, notice: '已对照当前版本核对冲突草稿并作为新版本生效。' }
    }
    return { ...state, dataset, noticeKind: 'error' as const, notice: `冲突草稿提交失败：${result.reason}` }
  }),

  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status })),
  on(TailingsActions.addAudit, (state, { entry }) => ({
    ...state,
    dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] }
  })),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), selectedAnomalyId: seedDataset.anomalies[0].id }))
)
