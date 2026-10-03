import { Injectable, inject } from '@angular/core'
import { Actions, createEffect, ofType, OnInitEffects } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, filter, map, mergeMap, of, switchMap, tap, withLatestFrom } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import { ReviewWriteChannelService } from '../services/review-write.channel'
import type { PendingWrite } from '../domain'
import { commandFromDraft, rebaseDraftRequest, type ReviewCommand, ReviewRequest } from '../domain/version-chain'
import { TailingsActions } from './tailings.actions'
import { selectTailings } from './tailings.selectors'

@Injectable()
export class TailingsEffects implements OnInitEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(TailingsApiService)
  private readonly channel = inject(ReviewWriteChannelService)
  private readonly store = inject(Store)

  ngrxOnInitEffects() {
    return TailingsActions.hydrateRecovery({
      pendingWrites: this.channel.loadPendingWrites(),
      conflictDrafts: this.channel.loadConflictDrafts()
    })
  }

  loadDataset$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.loadDataset),
    switchMap(() => this.api.loadDataset().pipe(
      map((dataset) => TailingsActions.loadDatasetSuccess({ dataset })),
      catchError((error: Error) => of(TailingsActions.loadDatasetFailure({ error: error.message })))
    ))
  ))

  /** 提交审阅写：先走通道，成功发 CommitReview，失败由 outbox 保留含完整依据的待办 */
  submitReview$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.submitReview),
    mergeMap((req) => {
      const request: ReviewRequest = {
        commandId: req.commandId,
        anomalyId: req.anomalyId,
        operator: req.operator,
        baseVersion: req.baseVersion,
        command: req.command,
        createdAt: req.createdAt
      }
      return this.channel.commit(request).pipe(
        map(() => TailingsActions.commitReview(req)),
        catchError((error: Error) => of(TailingsActions.writeFailed({ commandId: req.commandId, error: error.message })))
      )
    })
  ))

  /**
   * 写失败重试：以原 commandId、原所见版本重放。
   * 通道成功后 CommitReview 命中版本链判定：
   * - 链上无此命令且仍在原版本 → applied；
   * - 链上已有该命令（此前实际已落库）→ duplicate，绝不重复追加结论；
   * - 链头已前进 → conflict，转冲突草稿保留依据。
   */
  retryOne$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.retryWrite),
    withLatestFrom(this.store.select(selectTailings)),
    map(([action, state]) => state.pendingWrites.find((item) => item.commandId === action.commandId)),
    filter((pending): pending is PendingWrite => !!pending),
    mergeMap((pending) => this.replay(pending))
  ))

  retryAll$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.retryAllWrites),
    withLatestFrom(this.store.select(selectTailings)),
    mergeMap(([, state]) => state.pendingWrites),
    mergeMap((pending) => this.replay(pending))
  ))

  private replay(pending: PendingWrite) {
    const request: ReviewRequest = {
      commandId: pending.commandId,
      anomalyId: pending.anomalyId,
      operator: pending.operator,
      baseVersion: pending.baseVersion,
      command: pending.payload as unknown as ReviewCommand,
      createdAt: pending.createdAt
    }
    return this.channel.commit(request).pipe(
      map(() => TailingsActions.commitReview({
        commandId: pending.commandId,
        anomalyId: pending.anomalyId,
        operator: pending.operator,
        baseVersion: pending.baseVersion,
        command: pending.payload as unknown as ReviewCommand,
        createdAt: pending.createdAt
      })),
      catchError((error: Error) => of(TailingsActions.writeFailed({ commandId: pending.commandId, error: error.message })))
    )
  }

  /**
   * 冲突草稿重提：对齐当前链头（新 commandId）后走统一写通道；
   * 通道故障时同样进入 outbox，仍可恢复重试。
   */
  resubmitDraft$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.resubmitDraft),
    withLatestFrom(this.store.select(selectTailings)),
    mergeMap(([action, state]) => {
      const draft = state.conflictDrafts.find((item) => item.id === action.draftId)
      if (!draft) return of()
      const request = rebaseDraftRequest(draft, commandFromDraft(draft), new Date().toISOString())
      return of(TailingsActions.submitReview(request))
    })
  ))

  /** outbox / 冲突草稿任一变化都持久化，保证刷新/崩溃后可从完整审阅版本恢复 */
  persistRecovery$ = createEffect(() => this.actions$.pipe(
    ofType(
      TailingsActions.submitReview,
      TailingsActions.commitReview,
      TailingsActions.writeFailed,
      TailingsActions.retryWrite,
      TailingsActions.retryAllWrites,
      TailingsActions.discardWrite,
      TailingsActions.resubmitDraft,
      TailingsActions.discardDraft,
      TailingsActions.hydrateRecovery
    ),
    withLatestFrom(this.store.select(selectTailings)),
    tap(([, state]) => {
      this.channel.savePendingWrites(state.pendingWrites)
      this.channel.saveConflictDrafts(state.conflictDrafts)
    })
  ), { dispatch: false })

  resetDemo$ = createEffect(() => this.actions$.pipe(
    ofType(TailingsActions.resetDemo),
    tap(() => this.channel.clearAll())
  ), { dispatch: false })
}
