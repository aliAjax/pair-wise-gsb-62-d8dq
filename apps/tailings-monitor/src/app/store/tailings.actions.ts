import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { AuditEntry, ConflictDraft, PendingWrite, TailingsDataset } from '../domain'
import type { ReviewCommand } from '../domain/version-chain'

/**
 * 版本链写动作。
 * submitReview 携带 commandId/operator/baseVersion，由 effect 统一走写通道：
 * 先到版本生效，后到版本转冲突草稿；失败写进入 outbox 可恢复重试；重放按 commandId 幂等。
 */
export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Hydrate Recovery': props<{ pendingWrites: PendingWrite[]; conflictDrafts: ConflictDraft[] }>(),

    'Submit Review': props<{
      commandId: string
      anomalyId: string
      operator: string
      baseVersion: number
      command: ReviewCommand
      createdAt: string
    }>(),
    /** 通道发送成功（或离线接受）：以命令方式应用版本链，冲突/幂等在此判定 */
    'Commit Review': props<{
      commandId: string
      anomalyId: string
      operator: string
      baseVersion: number
      command: ReviewCommand
      createdAt: string
    }>(),
    /** 写失败：按 commandId 将 outbox 待办标记为发送失败（保留完整审阅版本快照） */
    'Write Failed': props<{ commandId: string; error: string }>(),
    /** 从 outbox 恢复重试（重放按 commandId 去重，绝不重复追加结论） */
    'Retry Write': props<{ commandId: string }>(),
    'Retry All Writes': emptyProps(),
    /** 放弃失败写，仅留审计，不推进版本链 */
    'Discard Write': props<{ commandId: string }>(),
    /** 冲突草稿重提：对齐当前链头版本后再次提交 */
    'Resubmit Draft': props<{ draftId: string }>(),
    'Discard Draft': props<{ draftId: string }>(),

    'Select Anomaly': props<{ anomalyId: string }>(),
    'Clear Notice': emptyProps(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    'Reset Demo': emptyProps()
  }
})
