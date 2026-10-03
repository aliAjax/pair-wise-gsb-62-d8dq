import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { AuditEntry, TailingsDataset } from '../domain'
import type { ReviewWrite, WriteKind } from '../domain/version-chain'

/** 统一写入信封：每个动作记录所见版本与窗口时间戳，失败可完整恢复 */
type WriteProps = { write: ReviewWrite<WriteKind>; simulateFailure: boolean }

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Review Write': props<WriteProps>(),
    'Review Write Rejected': props<{ reason: string }>(),
    'Retry Pending Write': props<{ writeId: string }>(),
    'Resolve Conflict Draft': props<{ draftId: string }>(),
    'Commit Conflict Draft': props<{ draftId: string }>(),
    'Select Anomaly': props<{ anomalyId: string }>(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    'Reset Demo': emptyProps()
  }
})
