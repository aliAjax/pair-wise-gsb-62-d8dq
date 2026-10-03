import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map, take } from 'rxjs'
import type { Anomaly, ConflictDraft, DispositionPlan, ExpertOpinion, FieldReview, PendingWrite } from '../domain'
import { newCommandId, type ReviewCommand } from '../domain/version-chain'
import { ReviewWriteChannelService } from '../services/review-write.channel'
import { TailingsActions } from '../store/tailings.actions'
import { selectAnomalies, selectConflictDrafts, selectFilteredAnomalies, selectNotice, selectPendingWrites, selectSelectedAnomaly, selectTailings } from '../store/tailings.selectors'

@Component({
  selector: 'app-anomaly-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>待现场复核</span><strong>{{ count('待现场复核') }}</strong><small>不得直接关闭</small></article>
        <article><span>调查与审批</span><strong>{{ count('原因调查中') + count('待负责人审批') }}</strong><small>多专业意见并存</small></article>
        <article><span>应急联动</span><strong>{{ count('应急联动') }}</strong><small>重大异常强制联动</small></article>
        <article><span>已关闭</span><strong>{{ count('已关闭') }}</strong><small>具备复测与签批</small></article>
      </div>
      <div class="toolbar">
        <mat-form-field appearance="outline"><mat-label>搜索异常</mat-label><input matInput [(ngModel)]="localKeyword" (ngModelChange)="updateKeyword($event)" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>状态</mat-label><mat-select [(ngModel)]="localStatus" (ngModelChange)="updateStatus($event)"><mat-option value="全部">全部</mat-option><mat-option *ngFor="let item of statuses" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field>
        <mat-form-field appearance="outline" class="actor"><mat-label>审阅员窗口</mat-label><mat-select [(ngModel)]="operator"><mat-option *ngFor="let name of operators" [value]="name">{{ name }}</mat-option></mat-select></mat-form-field>
        <div class="drills">
          <mat-checkbox [(ngModel)]="staleWindow" [disabled]="!viewedVersion">旧窗口（所见停在V{{ viewedVersion || '?' }}）</mat-checkbox>
          <mat-checkbox [ngModel]="failureDrill" (ngModelChange)="failureDrill = $event">故障演练：写入中断</mat-checkbox>
        </div>
      </div>
      <div class="split">
        <table mat-table [dataSource]="filtered$ | async" class="panel">
          <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>异常</th><td mat-cell *matCellDef="let row"><b>{{ row.title }}</b><small class="sub">{{ row.id }} · {{ row.pointId }}</small></td></ng-container>
          <ng-container matColumnDef="severity"><th mat-header-cell *matHeaderCellDef>级别</th><td mat-cell *matCellDef="let row"><span class="severity" [class.major]="row.severity === '重大'">{{ row.severity }}</span></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row">{{ row.status }}</td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}<small class="sub">{{ row.chain.length }}个修订</small></td></ng-container>
          <ng-container matColumnDef="open"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button (click)="select(row.id)">审阅</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected]="row.id === (selected$ | async)?.id"></tr>
        </table>
        <div class="panel detail" *ngIf="selected$ | async as selected">
          <div class="detail-head"><div><span>{{ selected.id }} · 当前 V{{ selected.version }}（本窗口基于V{{ baseVersionOf(selected) }}）</span><h2>{{ selected.title }}</h2><p>{{ selected.observedValue }}</p></div><span class="severity" [class.major]="selected.severity === '重大'">{{ selected.severity }}</span></div>

          <div class="notice" *ngIf="(notice$ | async) as notice" [class]="'notice ' + notice.kind">
            <b>{{ labelOf(notice.kind) }}</b><span>{{ notice.text }}</span><button mat-button (click)="clearNotice()">×</button>
          </div>

          <ng-container *ngIf="(pendingFor(selected) | async) as pendings">
            <div class="outbox" *ngIf="pendings.length">
              <div class="band-head"><h3>失败写恢复（{{ pendings.length }}）</h3><div><button mat-button color="primary" (click)="retryAll()">全部重试</button></div></div>
              <article *ngFor="let pending of pendings">
                <header><b>{{ pending.kind }} · {{ pending.operator }}</b><span class="tag">所见V{{ pending.baseVersion }} · 尝试{{ pending.attempts }}次 · {{ pending.status }}</span></header>
                <p class="error">{{ pending.lastError || '等待发送' }}</p>
                <dl class="basis"><dt>完整审阅版本</dt><dd>异常V{{ pending.snapshot.anomalyVersion }}（{{ pending.snapshot.status }}）</dd><dt>方案</dt><dd>{{ pending.snapshot.planLifecycle }} {{ pending.snapshot.planDigest || '（无）' }}</dd><dt>生效意见</dt><dd>{{ pending.snapshot.activeOpinionIds.join('、') || '无' }}</dd><dt>最近复核</dt><dd>{{ pending.snapshot.latestFieldReview || '无' }}</dd></dl>
                <div class="row-actions"><button mat-flat-button color="primary" (click)="retry(pending.commandId)">从该版本恢复重试</button><button mat-button (click)="discardWrite(pending.commandId)">放弃</button></div>
              </article>
            </div>
          </ng-container>

          <ng-container *ngIf="(draftsFor(selected) | async) as drafts">
            <div class="conflicts" *ngIf="drafts.length">
              <div class="band-head"><h3>冲突草稿（{{ drafts.length }}，先到版本已生效）</h3></div>
              <article *ngFor="let draft of drafts">
                <header><b>{{ draft.kind }} · {{ draft.operator }} · 草稿{{ draft.status }}</b><span class="tag warn">所见V{{ draft.baseVersion }}，链头已到V{{ draft.headVersion }}</span></header>
                <p>{{ draft.detail }}</p>
                <dl class="basis"><dt>保留依据</dt><dd>异常V{{ draft.basis.anomalyVersion }}（{{ draft.basis.status }}）</dd><dt>方案</dt><dd>{{ draft.basis.planLifecycle }} {{ draft.basis.planDigest || '（无）' }}</dd><dt>生效意见</dt><dd>{{ draft.basis.activeOpinionIds.join('、') || '无' }}</dd><dt>最近复核</dt><dd>{{ draft.basis.latestFieldReview || '无' }}</dd></dl>
                <div class="row-actions" *ngIf="draft.status === '待处理'"><button mat-flat-button color="primary" (click)="resubmit(draft.id)">对齐V{{ draft.headVersion }}重提</button><button mat-button (click)="discardDraft(draft.id)">放弃</button></div>
              </article>
            </div>
          </ng-container>

          <h3>统一版本链</h3>
          <div class="chain">
            <div class="revision" *ngFor="let rev of chainOf(selected)">
              <div class="rev-head"><span class="v">V{{ rev.version }}</span><b>{{ rev.kind }}</b><em>{{ rev.operator }}</em><small>基于V{{ rev.baseVersion }} · {{ rev.createdAt.replace('T', ' ').slice(5, 16) }}</small></div>
              <p>{{ rev.summary }}</p>
              <div class="effect" *ngFor="let effect of rev.effects"><span [class.invalidated]="effect.result === '失效重算'">{{ effect.result === '失效重算' ? '方案立即失效重算' : '执行中：保留原依据并追加复核' }}</span>{{ effect.reason }}</div>
            </div>
          </div>

          <h3>现场复核</h3>
          <div class="review-form"><mat-form-field appearance="outline" class="wide"><mat-label>现场观察</mat-label><textarea matInput rows="2" [(ngModel)]="fieldForm.observed"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>证据清单</mat-label><input matInput [(ngModel)]="fieldForm.evidence" /></mat-form-field><mat-form-field appearance="outline"><mat-label>重新评估</mat-label><input matInput [(ngModel)]="fieldForm.reassessment" /></mat-form-field><button mat-flat-button color="primary" (click)="submitReview(selected)">提交复核版本</button></div>
          <div class="records" *ngFor="let review of selected.fieldReviews" [class.followup]="review.kind === '意见联动复核'"><b>{{ review.inspector }} · V{{ review.version }} <span class="tag" *ngIf="review.kind === '意见联动复核'">意见联动追加</span></b><p>{{ review.observed }}</p><span>{{ review.reassessment }} · {{ review.evidence }}</span><small *ngIf="review.supersededBasis">冻结原依据 V{{ review.supersededBasis.basisVersion }}：{{ review.supersededBasis.opinionIds.join('、') || '无意见' }}，签批{{ review.supersededBasis.approvedBy }}</small></div>

          <h3>专业意见</h3>
          <div class="opinion-form"><mat-form-field appearance="outline"><mat-label>专业</mat-label><mat-select [(ngModel)]="opinionForm.discipline"><mat-option *ngFor="let item of disciplines" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>意见</mat-label><input matInput [(ngModel)]="opinionForm.content" /></mat-form-field><button mat-button (click)="addOpinion(selected)">补充意见</button></div>
          <div class="opinions"><article *ngFor="let opinion of selected.opinions"><b>{{ opinion.discipline }}专家 {{ opinion.specialist }} <span class="tag warn" *ngIf="opinion.withdrawnAt">已撤回</span></b><span>{{ opinion.conclusion }}<small *ngIf="opinion.baseVersion !== undefined"> · 基于V{{ opinion.baseVersion }}</small></span><p>{{ opinion.content }}</p><button *ngIf="!opinion.withdrawnAt" mat-button (click)="withdrawOpinion(selected, opinion.id)">撤回该意见</button></article></div>

          <h3>处置方案与会签</h3>
          <div class="plan-state">
            <div><span class="lifecycle" [class]="'lifecycle ' + lifecycleClass(selected.plan.lifecycle)">{{ selected.plan.lifecycle || '待审批' }}</span><b *ngIf="selected.plan.basis">依据冻结于 V{{ selected.plan.basis.basisVersion }}（签批{{ selected.plan.basis.approvedBy }}，{{ selected.plan.basis.opinionIds.length }}条意见）</b></div>
            <p class="invalid" *ngIf="selected.plan.invalidReason">已失效：{{ selected.plan.invalidReason }}（{{ selected.plan.invalidAt?.replace('T', ' ').slice(5, 16) }}），请据最新意见重算重提。</p>
          </div>
          <div class="plan-form"><mat-form-field appearance="outline"><mat-label>措施</mat-label><mat-select [(ngModel)]="planForm.action"><mat-option *ngFor="let item of actions" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline"><mat-label>责任方</mat-label><input matInput [(ngModel)]="planForm.owner" /></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>关闭条件</mat-label><textarea matInput rows="2" [(ngModel)]="planForm.conditions"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>截止</mat-label><input matInput type="datetime-local" [(ngModel)]="planForm.deadline" /></mat-form-field><button mat-button (click)="savePlan(selected)">{{ (selected.plan.lifecycle === '已失效') ? '重算并提交新方案' : '提交审批' }}</button></div>
          <div class="approval-band"><div><b>{{ selected.plan.approvedBy || '尚未审批' }}</b><span>{{ selected.plan.conditions }}</span></div><button mat-flat-button color="primary" [disabled]="!canApprove(selected)" (click)="approve(selected)">负责人审批</button><button mat-button color="warn" [disabled]="selected.status === '已关闭'" (click)="emergency(selected)">应急联动</button><button mat-button [disabled]="(selected.plan.lifecycle ?? '待审批') !== '执行中'" (click)="close(selected)">关闭异常</button></div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 14px; }.metrics article { padding: 16px 18px; border-right: 1px solid #e2e7e6; }.metrics article:last-child { border: 0; }.metrics span, .metrics strong, .metrics small { display: block; }.metrics span { color: #72807d; font-size: 12px; }.metrics strong { font-size: 26px; color: #245060; margin: 6px 0; }.metrics small { color: #98a4a0; font-size: 10px; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; flex-wrap: wrap; }.toolbar .actor { width: 150px; }.drills { display: grid; gap: 4px; margin-left: 8px; font-size: 12px; color: #4b5a57; }
    .split { display: grid; grid-template-columns: minmax(600px,1fr) 560px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; } table { width: 100%; }.selected { background: #eef5f4; }.sub { display: block; color: #7c8986; font-size: 10px; margin-top: 3px; }.severity { padding: 3px 7px; border-radius: 3px; background: #f7edd6; color: #8e681d; font-size: 11px; }.severity.major { background: #fae7e5; color: #a23b34; }
    .detail { padding: 16px; max-height: calc(100vh - 190px); overflow-y: auto; }.detail-head { display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid #e1e6e5; padding-bottom: 12px; }.detail-head span { color: #74827f; font-size: 10px; }.detail-head h2 { margin: 4px 0; font-size: 18px; }.detail-head p { margin: 0; color: #65736f; font-size: 12px; }.detail h3 { font-size: 13px; margin: 16px 0 8px; }
    .notice { display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin: 10px 0; border-left: 3px solid; font-size: 12px; }.notice span { flex: 1; }.notice.applied { background: #e9f5ec; border-color: #3e8e57; color: #27603b; }.notice.conflict { background: #fdf1e3; border-color: #c77f2e; color: #8a5417; }.notice.duplicate { background: #eef1fb; border-color: #5a6fb2; color: #35447e; }.notice.rejected { background: #fbecea; border-color: #c0534a; color: #8e2f28; }.notice.info { background: #eef3f2; border-color: #5f8089; color: #3a5760; }.notice button { min-width: 0; line-height: 1; }
    .outbox, .conflicts { border: 1px solid #e0d5c2; margin-bottom: 10px; }.outbox article, .conflicts article { padding: 9px 10px; border-top: 1px solid #ece2d0; }.outbox article:first-of-type, .conflicts article:first-of-type { border-top: 0; }.band-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #faf4e8; }.band-head h3 { margin: 0; font-size: 12px; }article header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }article p { margin: 4px 0; font-size: 12px; }article p.error { color: #a23b34; }.tag { font-size: 10px; color: #7d6f4f; background: #f2ecdd; padding: 1px 6px; border-radius: 8px; white-space: nowrap; }.tag.warn { background: #f7e2da; color: #9b4a32; }
    .basis { display: grid; grid-template-columns: 84px 1fr; gap: 2px 8px; margin: 6px 0; font-size: 11px; background: #f8f6f0; padding: 7px 9px; }.basis dt { color: #8a7c5d; }.basis dd { margin: 0; color: #4d5754; word-break: break-all; }.row-actions { display: flex; gap: 8px; }
    .chain { display: grid; gap: 6px; max-height: 210px; overflow-y: auto; padding-right: 4px; }.revision { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 7px 10px; }.rev-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }.rev-head .v { background: #315d6e; color: white; font-size: 10px; padding: 1px 6px; border-radius: 8px; }.rev-head b { font-size: 12px; }.rev-head em { font-style: normal; color: #5a6b67; font-size: 11px; }.rev-head small { color: #93a09c; font-size: 10px; margin-left: auto; }.revision p { margin: 4px 0 0; font-size: 11px; }.effect { font-size: 11px; color: #8a5417; margin-top: 4px; display: flex; gap: 6px; }.effect span { white-space: nowrap; font-weight: 600; }.effect .invalidated { color: #a23b34; }
    .review-form, .opinion-form, .plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }.review-form .wide, .opinion-form .wide, .plan-form .wide { grid-column: 1 / -1; }.review-form button, .plan-form button { align-self: center; }.records { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 9px; margin-top: 7px; display: grid; gap: 4px; }.records.followup { border-left-color: #c99f3d; background: #fbf7ec; }.records p { margin: 0; font-size: 12px; }.records span { color: #72807d; font-size: 10px; }.records small { color: #9b7d3c; font-size: 10px; }
    .opinions article { border-bottom: 1px solid #e2e7e6; padding: 9px 0; display: grid; grid-template-columns: 1fr auto; gap: 4px; }.opinions p { grid-column: 1 / -1; margin: 0; font-size: 12px; }.opinions span { color: #8a6720; font-size: 10px; }.opinions button { grid-column: 1 / -1; justify-self: start; }
    .plan-state { background: #f6f8f8; border: 1px solid #dde5e3; padding: 8px 10px; margin-bottom: 8px; }.plan-state div { display: flex; align-items: center; gap: 10px; }.plan-state b { font-size: 11px; color: #45575c; }.plan-state .invalid { color: #a23b34; font-size: 11px; margin: 5px 0 0; }.lifecycle { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #e3eae8; color: #46606a; }.lifecycle.执行中 { background: #e4f0e9; color: #2c7a4d; }.lifecycle.已失效 { background: #fae7e5; color: #a23b34; }.lifecycle.已完成 { background: #e6e9f2; color: #44508a; }
    .approval-band { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 7px; background: #f6f0df; border-left: 3px solid #c99f3d; padding: 10px; margin-top: 12px; }.approval-band b, .approval-band span { display: block; }.approval-band span { color: #746c55; font-size: 10px; margin-top: 4px; }
  `]
})
export class AnomalyPageComponent {
  private readonly store = inject(Store)
  private readonly channel = inject(ReviewWriteChannelService)
  readonly filtered$ = this.store.select(selectFilteredAnomalies)
  readonly selected$ = this.store.select(selectSelectedAnomaly)
  readonly all$ = this.store.select(selectAnomalies)
  readonly pending$ = this.store.select(selectPendingWrites)
  readonly drafts$ = this.store.select(selectConflictDrafts)
  readonly notice$ = this.store.select(selectNotice)
  readonly columns = ['title', 'severity', 'status', 'version', 'open']
  readonly statuses: Anomaly['status'][] = ['待现场复核', '原因调查中', '待负责人审批', '应急联动', '已关闭']
  readonly disciplines: ExpertOpinion['discipline'][] = ['坝体', '水文', '岩土', '应急']
  readonly actions: DispositionPlan['action'][] = ['加密监测', '降低库水位', '疏通排水', '应急撤离准备', '工程加固']
  readonly operators = ['宋立', '周岩', '许洁', '何清']
  operator = '宋立'
  /** 旧窗口演练：勾选后提交所见版本停留在打开异常时的版本，用于复现后到保存冲突 */
  staleWindow = false
  viewedVersion = 0
  private dismissedNotice = ''
  localKeyword = ''
  localStatus: Anomaly['status'] | '全部' = '全部'
  fieldForm = { observed: '', evidence: '', reassessment: '' }
  opinionForm = { discipline: '坝体' as ExpertOpinion['discipline'], content: '' }
  planForm = { action: '加密监测' as DispositionPlan['action'], owner: '坝体安全组', conditions: '', deadline: '2026-09-29T18:00' }

  get failureDrill(): boolean { return this.channel.failureDrill }
  set failureDrill(value: boolean) { this.channel.failureDrill = value }

  count(status: Anomaly['status']): number { let value = 0; this.all$.subscribe((items) => { value = items.filter((item) => item.status === status).length }).unsubscribe(); return value }
  updateKeyword(value: string): void { this.store.dispatch(TailingsActions.updateKeyword({ keyword: value })) }
  updateStatus(value: Anomaly['status'] | '全部'): void { this.store.dispatch(TailingsActions.updateStatus({ status: value })) }

  select(id: string): void {
    this.store.dispatch(TailingsActions.selectAnomaly({ anomalyId: id }))
    this.store.select(selectTailings).pipe(take(1)).subscribe((state) => {
      this.viewedVersion = state.dataset.anomalies.find((item) => item.id === id)?.version ?? 0
      this.staleWindow = false
    })
  }

  clearNotice(): void { this.store.dispatch(TailingsActions.clearNotice()) }

  baseVersionOf(anomaly: Anomaly): number { return this.staleWindow ? this.viewedVersion : anomaly.version }
  chainOf(anomaly: Anomaly) { return [...anomaly.chain].reverse() }
  lifecycleClass(lifecycle: string | undefined): string { return lifecycle ?? '待审批' }
  canApprove(anomaly: Anomaly): boolean {
    const lifecycle = anomaly.plan.lifecycle ?? '待审批'
    return lifecycle === '待审批' && (anomaly.severity !== '重大' || anomaly.plan.emergencyLinked)
  }

  pendingFor(anomaly: Anomaly) {
    return this.pending$.pipe(map((items: PendingWrite[]) => items.filter((item) => item.anomalyId === anomaly.id)))
  }
  draftsFor(anomaly: Anomaly) {
    return this.drafts$.pipe(map((items: ConflictDraft[]) => items.filter((item) => item.anomalyId === anomaly.id)))
  }

  labelOf(kind: string): string {
    return ({ applied: '已生效', conflict: '版本冲突', duplicate: '重复重放', rejected: '未生效', info: '提示' } as Record<string, string>)[kind] ?? '提示'
  }

  private dispatch(anomaly: Anomaly, command: ReviewCommand): void {
    this.store.dispatch(TailingsActions.submitReview({
      commandId: newCommandId(),
      anomalyId: anomaly.id,
      operator: this.operator,
      baseVersion: this.baseVersionOf(anomaly),
      command,
      createdAt: new Date().toISOString()
    }))
  }

  submitReview(anomaly: Anomaly): void {
    if (!this.fieldForm.observed || !this.fieldForm.evidence || !this.fieldForm.reassessment) return
    const review: FieldReview = { id: `FR-${Date.now()}`, inspector: this.operator, arrivedAt: new Date().toISOString(), ...this.fieldForm, version: 0 }
    this.dispatch(anomaly, { type: 'submitFieldReview', review })
    this.fieldForm = { observed: '', evidence: '', reassessment: '' }
  }
  addOpinion(anomaly: Anomaly): void {
    if (!this.opinionForm.content) return
    this.dispatch(anomaly, { type: 'addExpertOpinion', opinion: { id: `OP-${Date.now()}`, specialist: this.operator, ...this.opinionForm, conclusion: '补充证据', createdAt: new Date().toISOString() } })
    this.opinionForm.content = ''
  }
  withdrawOpinion(anomaly: Anomaly, opinionId: string): void {
    const reason = window.prompt('撤回原因', '该意见依据的读数已被现场复核修正') ?? '意见撤回'
    this.dispatch(anomaly, { type: 'withdrawExpertOpinion', opinionId, reason })
  }
  savePlan(anomaly: Anomaly): void {
    if (!this.planForm.owner || !this.planForm.deadline || !this.planForm.conditions) return
    this.dispatch(anomaly, { type: 'saveDispositionPlan', plan: { id: anomaly.plan.id, ...this.planForm, emergencyLinked: anomaly.plan.emergencyLinked, approvedBy: '', approvedAt: '' } })
  }
  approve(anomaly: Anomaly): void { this.dispatch(anomaly, { type: 'approvePlan', approver: '负责人 何清', note: '同意执行，严格执行关闭条件。' }) }
  emergency(anomaly: Anomaly): void { this.dispatch(anomaly, { type: 'createEmergencyLink', note: '重大异常联动应急值班，通知下游巡查。' }) }
  close(anomaly: Anomaly): void { this.dispatch(anomaly, { type: 'closeAnomaly', note: '复测数据稳定，关闭条件已满足。' }) }

  retry(commandId: string): void { this.store.dispatch(TailingsActions.retryWrite({ commandId })) }
  retryAll(): void { this.store.dispatch(TailingsActions.retryAllWrites()) }
  discardWrite(commandId: string): void { this.store.dispatch(TailingsActions.discardWrite({ commandId })) }
  resubmit(draftId: string): void { this.store.dispatch(TailingsActions.resubmitDraft({ draftId })) }
  discardDraft(draftId: string): void { this.store.dispatch(TailingsActions.discardDraft({ draftId })) }
}
