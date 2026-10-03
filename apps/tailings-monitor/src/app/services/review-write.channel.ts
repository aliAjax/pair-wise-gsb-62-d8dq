import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, of, throwError } from 'rxjs'
import type { ConflictDraft, PendingWrite } from '../domain'
import type { ReviewRequest } from '../domain/version-chain'

const OUTBOX_KEY = 'tailings.review.outbox.v1'
const DRAFTS_KEY = 'tailings.review.conflicts.v1'

/**
 * 审阅写通道：所有版本链写请求先落本地 WAL（由 reducer 保存、本服务持久化），
 * 再发往服务端；发送失败保留完整审阅版本快照，可随时从 outbox 恢复重试。
 */
@Injectable({ providedIn: 'root' })
export class ReviewWriteChannelService {
  private readonly http = inject(HttpClient)
  private readonly baseUrl = (globalThis as { __TAILINGS_API__?: string }).__TAILINGS_API__ ?? '/api'

  /** 故障演练开关：开启后写入全部失败（服务端不可达场景），outbox 保留可重试 */
  failureDrill = false

  /**
   * 提交一次审阅写。无服务端时按离线接受处理（本地版本链生效）；
   * 故障演练开启时抛错，调用方据此保留待办。
   */
  commit(request: ReviewRequest): Observable<void> {
    if (this.failureDrill) {
      return throwError(() => new Error('写入通道中断（故障演练），完整审阅版本已保留'))
    }
    return this.http.post<void>(`${this.baseUrl}/tailings/review`, request).pipe(
      catchError(() => of(undefined)) // 离线/无后端：本地生效，outbox 随即清除
    )
  }

  loadPendingWrites(): PendingWrite[] {
    return readJson(OUTBOX_KEY, [])
  }

  savePendingWrites(writes: PendingWrite[]): void {
    writeJson(OUTBOX_KEY, writes)
  }

  loadConflictDrafts(): ConflictDraft[] {
    return readJson(DRAFTS_KEY, [])
  }

  saveConflictDrafts(drafts: ConflictDraft[]): void {
    writeJson(DRAFTS_KEY, drafts)
  }

  clearAll(): void {
    try {
      localStorage.removeItem(OUTBOX_KEY)
      localStorage.removeItem(DRAFTS_KEY)
    } catch {
      /* 存储不可用时静默降级为内存态 */
    }
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时静默降级 */
  }
}
