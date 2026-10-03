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
import type { Anomaly, ConflictDraft, DispositionPlan, ExpertOpinion, FieldReview, PendingWrite } from '../domain'
import type { ReviewWrite, WriteKind, WritePayloads } from '../domain/version-chain'
import { TailingsActions } from '../store/tailings.actions'
import { selectAnomalies, selectFilteredAnomalies, selectNotice, selectPendingWrites, selectSelectedAnomaly } from '../store/tailings.selectors'

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

      <ng-container *ngIf="(notice$ | async) as notice"><div class="notice" *ngIf="notice.text" [class.ok]="notice.kind === 'ok'" [class.warn]="notice.kind === 'warn'" [class.error]="notice.kind === 'error'">{{ notice.text }}</div></ng-container>

      <div class="recovery panel" *ngIf="(pending$ | async)?.length as pendingCount">
        <h3>写入失败 · 待恢复审阅版本（{{ pendingCount }}）</h3>
        <div class="recovery-item" *ngFor="let item of (pending$ | async)">
          <div><b>{{ kindText(item.kind) }}</b><span>{{ item.anomalyId }} · 所见V{{ item.baseVersion }} · {{ item.at.replace('T', ' ').slice(0, 16) }} · 已尝试{{ item.attempts }}次</span><small>{{ item.lastError }}</small></div>
          <button mat-flat-button color="primary" (click)="retry(item)">从完整版本恢复重试</button>
        </div>
      </div>

      <div class="toolbar">
        <mat-form-field appearance="outline"><mat-label>搜索异常</mat-label><input matInput [(ngModel)]="localKeyword" (ngModelChange)="updateKeyword($event)" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>状态</mat-label><mat-select [(ngModel)]="localStatus" (ngModelChange)="updateStatus($event)"><mat-option value="全部">全部</mat-option><mat-option *ngFor="let item of statuses" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field>
        <mat-checkbox [(ngModel)]="simulateFailure" class="fail-switch">模拟下一次写入失败（保留完整审阅版本）</mat-checkbox>
        <button mat-button color="warn" (click)="reset()">重置演示数据</button>
      </div>

      <div class="split">
        <table mat-table [dataSource]="filtered$ | async" class="panel">
          <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>异常</th><td mat-cell *matCellDef="let row"><b>{{ row.title }}</b><small class="sub">{{ row.id }} · {{ row.pointId }}</small></td></ng-container>
          <ng-container matColumnDef="severity"><th mat-header-cell *matHeaderCellDef>级别</th><td mat-cell *matCellDef="let row"><span class="severity" [class.major]="row.severity === '重大'">{{ row.severity }}</span></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row">{{ row.status }}<small class="sub" *ngIf="row.plan.lifecycle !== '待提交'">{{ row.plan.lifecycle }} V{{ row.plan.planVersion }}</small></td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}</td></ng-container>
          <ng-container matColumnDef="open"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button (click)="select(row.id)">审阅</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected]="row.id === (selected$ | async)?.id"></tr>
        </table>

        <div class="panel detail" *ngIf="selected$ | async as selected">
          <div class="detail-head"><div><span>{{ selected.id }} · 当前链版本 V{{ selected.version }}</span><h2>{{ selected.title }}</h2><p>{{ selected.observedValue }}</p></div><span class="severity" [class.major]="selected.severity === '重大'">{{ selected.severity }}</span></div>

          <h3>版本链（异常 / 复核 / 意见 / 方案 / 审计共用）</h3>
          <div class="chain">
            <div class="chain-item" *ngFor="let rev of selected.revisions"><b>V{{ rev.version }}</b><span>{{ rev.kind }} · {{ rev.operator }} · {{ rev.summary }}</span><small>{{ rev.writeId }} · {{ rev.at.replace('T', ' ').slice(0, 16) }}</small></div>
          </div>

          <h3>现场复核 <small class="hint">提交时记录所见版本 V{{ selected.version }}</small></h3>
          <div class="review-form"><mat-form-field appearance="outline" class="wide"><mat-label>现场观察</mat-label><textarea matInput rows="2" [(ngModel)]="fieldForm.observed"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>证据清单</mat-label><input matInput [(ngModel)]="fieldForm.evidence" /></mat-form-field><mat-form-field appearance="outline"><mat-label>重新评估</mat-label><input matInput [(ngModel)]="fieldForm.reassessment" /></mat-form-field><button mat-flat-button color="primary" (click)="submitReview(selected)">提交复核版本</button></div>
          <div class="records" *ngFor="let review of selected.fieldReviews"><b>{{ review.inspector }} · 复核V{{ review.version }} <em *ngIf="review.autoGenerated">（意见变动追加复核）</em></b><p>{{ review.observed }}</p><span>{{ review.reassessment }} · {{ review.evidence }}</span><small>所见V{{ review.baseVersion }} · 依据V{{ review.basisVersion }}</small></div>

          <h3>专业意见 <small class="hint">补充/撤回后：未执行方案失效重算，执行中保留原依据并追加复核</small></h3>
          <div class="opinion-form"><mat-form-field appearance="outline"><mat-label>专业</mat-label><mat-select [(ngModel)]="opinionForm.discipline"><mat-option *ngFor="let item of disciplines" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>意见（所见 V{{ selected.version }}）</mat-label><input matInput [(ngModel)]="opinionForm.content" /></mat-form-field><button mat-button (click)="addOpinion(selected)">补充意见</button></div>
          <div class="opinions"><article *ngFor="let opinion of selected.opinions" [class.withdrawn]="opinion.withdrawn"><b>{{ opinion.discipline }}专家 {{ opinion.specialist }}</b><span>{{ opinion.conclusion }} <i *ngIf="opinion.withdrawn">（已撤回）</i></span><p>{{ opinion.content }}</p><small>所见V{{ opinion.baseVersion }} · {{ opinion.createdAt.replace('T', ' ').slice(0, 16) }}</small><button mat-button color="warn" *ngIf="!opinion.withdrawn" (click)="withdrawOpinion(selected, opinion)">撤回意见</button></article></div>

          <h3>处置方案与会签</h3>
          <div class="plan-status">
            <span class="pill" [attr.data-lc]="selected.plan.lifecycle">{{ selected.plan.lifecycle }}<i *ngIf="selected.plan.planVersion > 0"> · 方案V{{ selected.plan.planVersion }}</i></span>
            <span *ngIf="selected.plan.approvedBy">签批：{{ selected.plan.approvedBy }} · {{ selected.plan.approvedAt.replace('T', ' ').slice(0, 16) }}</span>
            <span *ngIf="selected.plan.basis" class="basis">执行依据锁定：复核V{{ selected.plan.basis.reviewVersion }}、意见{{ selected.plan.basis.opinionIds.length }}条（意见后续变动不覆盖执行依据）</span>
          </div>
          <div class="plan-form"><mat-form-field appearance="outline"><mat-label>措施</mat-label><mat-select [(ngModel)]="planForm.action"><mat-option *ngFor="let item of actions" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline"><mat-label>责任方</mat-label><input matInput [(ngModel)]="planForm.owner" /></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>关闭条件</mat-label><textarea matInput rows="2" [(ngModel)]="planForm.conditions"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>截止</mat-label><input matInput type="datetime-local" [(ngModel)]="planForm.deadline" /></mat-form-field><button mat-flat-button color="primary" (click)="savePlan(selected, false)">提交审批（基于 V{{ selected.version }}）</button><button mat-button color="accent" (click)="savePlan(selected, true)">模拟旧窗口保存（基于过期版本）</button></div>
          <div class="history" *ngIf="selected.planHistory.length"><b>已归档/失效方案：</b><span *ngFor="let old of selected.planHistory">V{{ old.planVersion }} {{ old.action }}（{{ old.lifecycle }}）；</span></div>
          <div class="approval-band"><div><b>{{ selected.plan.approvedBy || '尚未审批' }}</b><span>{{ selected.plan.conditions || '方案待提交' }}</span></div><button mat-flat-button color="primary" [disabled]="selected.plan.lifecycle !== '待审批' || (selected.severity === '重大' && !selected.plan.emergencyLinked)" (click)="approve(selected)">负责人审批</button><button mat-button color="primary" [disabled]="selected.plan.lifecycle !== '已签批'" (click)="startPlan(selected)">开始执行</button><button mat-button color="warn" [disabled]="selected.plan.lifecycle === '执行中' || selected.plan.lifecycle === '已完成'" (click)="emergency(selected)">应急联动</button><button mat-button [disabled]="selected.plan.lifecycle !== '执行中'" (click)="close(selected)">关闭异常</button></div>

          <ng-container *ngIf="selected.conflictDrafts.length">
            <h3>冲突草稿（后到保存，含依据版本）</h3>
            <div class="conflict" *ngFor="let draft of selected.conflictDrafts" [class.resolved]="draft.resolved">
              <div><b>{{ kindText(draft.kind) }} · {{ draft.operator }}</b><span>草稿基于 V{{ draft.baseVersion }}，保存时当前已为 V{{ draft.currentVersion }} —— {{ draft.reason }}</span><small>{{ draft.writeId }} · {{ draft.createdAt.replace('T', ' ').slice(0, 16) }} <i *ngIf="draft.resolved">（已处理）</i></small></div>
              <ng-container *ngIf="!draft.resolved"><button mat-button color="primary" (click)="loadDraft(selected, draft)">载入内容</button><button mat-flat-button (click)="commitDraft(draft)">对照V{{ selected.version }}核对后生效</button><button mat-button (click)="discardDraft(draft)">放弃</button></ng-container>
            </div>
          </ng-container>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 14px; }.metrics article { padding: 16px 18px; border-right: 1px solid #e2e7e6; }.metrics article:last-child { border: 0; }.metrics span, .metrics strong, .metrics small { display: block; }.metrics span { color: #72807d; font-size: 12px; }.metrics strong { font-size: 26px; color: #245060; margin: 6px 0; }.metrics small { color: #98a4a0; font-size: 10px; }
    .notice { padding: 10px 14px; margin-bottom: 10px; border-left: 4px solid; font-size: 12px; background: white; }.notice.ok { border-color: #3a7d5c; color: #2c5f45; background: #eef7f1; }.notice.warn { border-color: #c99f3d; color: #8a6720; background: #fbf4df; }.notice.error { border-color: #b0453c; color: #93342c; background: #fceeec; }
    .recovery { padding: 12px 14px; margin-bottom: 12px; border-left: 4px solid #b0453c; }.recovery h3 { margin: 0 0 8px; font-size: 13px; color: #93342c; }.recovery-item { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px dashed #e2d9d8; }.recovery-item b, .recovery-item span, .recovery-item small { display: block; }.recovery-item span { color: #72807d; font-size: 11px; }.recovery-item small { color: #a2574f; font-size: 10px; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }.fail-switch { font-size: 12px; color: #93342c; }
    .split { display: grid; grid-template-columns: minmax(560px,1fr) 560px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; } table { width: 100%; }.selected { background: #eef5f4; }.sub { display: block; color: #7c8986; font-size: 10px; margin-top: 3px; }.severity { padding: 3px 7px; border-radius: 3px; background: #f7edd6; color: #8e681d; font-size: 11px; }.severity.major { background: #fae7e5; color: #a23b34; }
    .detail { padding: 16px; max-height: 78vh; overflow: auto; }.detail-head { display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid #e1e6e5; padding-bottom: 12px; }.detail-head span { color: #74827f; font-size: 10px; }.detail-head h2 { margin: 4px 0; font-size: 18px; }.detail-head p { margin: 0; color: #65736f; font-size: 12px; }.detail h3 { font-size: 13px; margin: 16px 0 8px; }.detail .hint { color: #98a4a0; font-weight: normal; font-size: 10px; }
    .chain { border: 1px solid #e2e7e6; max-height: 150px; overflow: auto; }.chain-item { display: grid; grid-template-columns: 42px 1fr; gap: 0 8px; padding: 6px 9px; border-bottom: 1px solid #f0f3f2; font-size: 11px; }.chain-item b { color: #315d6e; }.chain-item span { grid-column: 2; }.chain-item small { grid-column: 2; color: #9aa7a3; font-size: 9px; }
    .review-form, .opinion-form, .plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }.review-form .wide, .opinion-form .wide, .plan-form .wide { grid-column: 1 / -1; }.review-form button, .plan-form button { align-self: center; }.records { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 9px; margin-top: 7px; display: grid; gap: 4px; }.records p { margin: 0; font-size: 12px; }.records span { color: #52605c; font-size: 10px; }.records small, .opinions small { color: #98a4a0; font-size: 9px; }.records em { color: #8a6720; font-style: normal; }
    .opinions article { border-bottom: 1px solid #e2e7e6; padding: 9px 0; display: grid; grid-template-columns: 1fr auto; gap: 4px; }.opinions p { grid-column: 1 / -1; margin: 0; font-size: 12px; }.opinions span { color: #8a6720; font-size: 10px; }.opinions small { grid-column: 1 / -1; }.opinions button { grid-column: 2; grid-row: 2 / 4; }.opinions article.withdrawn { opacity: .55; }
    .plan-status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 11px; color: #52605c; margin-bottom: 8px; }.pill { padding: 3px 9px; border-radius: 10px; background: #e7eeed; color: #2c5f45; }.pill[data-lc="已签批"] { background: #e3edf8; color: #27507a; }.pill[data-lc="执行中"] { background: #dff0e6; color: #1f6b45; }.pill[data-lc="已失效"] { background: #f3e4e2; color: #93342c; }.pill[data-lc="已完成"] { background: #e8e8e8; color: #555; }.basis { color: #8a6720; }
    .history { margin-top: 6px; font-size: 10px; color: #98a4a0; }.approval-band { display: grid; grid-template-columns: 1fr auto auto auto auto; align-items: center; gap: 7px; background: #f6f0df; border-left: 3px solid #c99f3d; padding: 10px; margin-top: 12px; }.approval-band b, .approval-band span { display: block; }.approval-band span { color: #746c55; font-size: 10px; margin-top: 4px; }
    .conflict { display: flex; justify-content: space-between; align-items: center; gap: 10px; border-left: 3px solid #b0453c; background: #fdf3f2; padding: 9px; margin-top: 7px; }.conflict.resolved { opacity: .5; border-left-color: #b9c2bf; background: #f4f6f5; }.conflict b, .conflict span, .conflict small { display: block; }.conflict span { font-size: 11px; color: #6c4a47; margin: 2px 0; }.conflict small { font-size: 9px; color: #a2807c; }
  `]
})
export class AnomalyPageComponent {
  private readonly store = inject(Store)
  readonly filtered$ = this.store.select(selectFilteredAnomalies)
  readonly selected$ = this.store.select(selectSelectedAnomaly)
  readonly all$ = this.store.select(selectAnomalies)
  readonly pending$ = this.store.select(selectPendingWrites)
  readonly notice$ = this.store.select(selectNotice)
  readonly columns = ['title', 'severity', 'status', 'version', 'open']
  readonly statuses: Anomaly['status'][] = ['待现场复核', '原因调查中', '待负责人审批', '应急联动', '已关闭']
  readonly disciplines: ExpertOpinion['discipline'][] = ['坝体', '水文', '岩土', '应急']
  readonly actions: DispositionPlan['action'][] = ['加密监测', '降低库水位', '疏通排水', '应急撤离准备', '工程加固']
  localKeyword = ''
  localStatus: Anomaly['status'] | '全部' = '全部'
  simulateFailure = false
  fieldForm = { observed: '', evidence: '', reassessment: '' }
  opinionForm = { discipline: '坝体' as ExpertOpinion['discipline'], content: '' }
  planForm = { action: '加密监测' as DispositionPlan['action'], owner: '坝体安全组', conditions: '', deadline: '2026-10-05T18:00' }

  private writeSeq = 0
  private nextWriteId(): string {
    this.writeSeq += 1
    return `W-${Date.now()}-${this.writeSeq}`
  }

  private dispatch<K extends WriteKind>(anomalyId: string, kind: K, baseVersion: number, payload: WritePayloads[K], operator = '当前用户', note?: string, forceFailure = false): void {
    const write: ReviewWrite<K> = { writeId: this.nextWriteId(), anomalyId, kind, baseVersion, payload, operator, note, at: new Date().toISOString() }
    this.store.dispatch(TailingsActions.reviewWrite({ write: write as ReviewWrite<WriteKind>, simulateFailure: forceFailure || this.simulateFailure }))
  }

  kindText(kind: string): string {
    return { 'field-review': '现场复核', 'opinion-add': '补充专业意见', 'opinion-withdraw': '撤回专业意见', 'plan-save': '处置方案', 'plan-approve': '方案签批', 'plan-start': '开始执行', 'emergency-link': '应急联动', 'anomaly-close': '关闭异常' }[kind] ?? kind
  }

  count(status: Anomaly['status']): number { let value = 0; this.all$.subscribe((items) => { value = items.filter((item) => item.status === status).length }).unsubscribe(); return value }
  updateKeyword(value: string): void { this.store.dispatch(TailingsActions.updateKeyword({ keyword: value })) }
  updateStatus(value: Anomaly['status'] | '全部'): void { this.store.dispatch(TailingsActions.updateStatus({ status: value })) }
  select(id: string): void { this.store.dispatch(TailingsActions.selectAnomaly({ anomalyId: id })) }
  reset(): void { this.store.dispatch(TailingsActions.resetDemo()) }
  retry(item: PendingWrite): void { this.store.dispatch(TailingsActions.retryPendingWrite({ writeId: item.writeId })) }
  discardDraft(draft: ConflictDraft): void { this.store.dispatch(TailingsActions.resolveConflictDraft({ draftId: draft.id })) }
  commitDraft(draft: ConflictDraft): void { this.store.dispatch(TailingsActions.commitConflictDraft({ draftId: draft.id })) }

  submitReview(anomaly: Anomaly): void {
    const review = { id: `FR-${Date.now()}`, inspector: '宋立', arrivedAt: new Date().toISOString(), ...this.fieldForm }
    this.dispatch(anomaly.id, 'field-review', anomaly.version, { review }, '宋立')
    this.fieldForm = { observed: '', evidence: '', reassessment: '' }
  }

  addOpinion(anomaly: Anomaly): void {
    const opinion = { id: `OP-${Date.now()}`, specialist: '当前用户', ...this.opinionForm, conclusion: '补充证据' as const, createdAt: new Date().toISOString() }
    this.dispatch(anomaly.id, 'opinion-add', anomaly.version, { opinion })
    this.opinionForm.content = ''
  }

  withdrawOpinion(anomaly: Anomaly, opinion: ExpertOpinion): void {
    this.dispatch(anomaly.id, 'opinion-withdraw', anomaly.version, { opinionId: opinion.id, reason: '审阅人撤回，留痕保留' }, opinion.specialist)
  }

  savePlan(anomaly: Anomaly, staleWindow: boolean): void {
    const baseVersion = staleWindow ? Math.max(0, anomaly.version - 1) : anomaly.version
    const plan = { id: anomaly.plan.id, ...this.planForm, emergencyLinked: anomaly.plan.emergencyLinked }
    this.dispatch(anomaly.id, 'plan-save', baseVersion, { plan }, '当前用户', staleWindow ? '旧窗口（过期所见版本）保存' : undefined)
  }

  approve(anomaly: Anomaly): void {
    this.dispatch(anomaly.id, 'plan-approve', anomaly.version, { approver: '负责人 何清', note: '同意执行，严格执行关闭条件。' }, '负责人 何清')
  }
  startPlan(anomaly: Anomaly): void {
    this.dispatch(anomaly.id, 'plan-start', anomaly.version, { operator: '负责人 何清', note: '按签批锁定依据组织实施。' }, '负责人 何清')
  }
  emergency(anomaly: Anomaly): void {
    this.dispatch(anomaly.id, 'emergency-link', anomaly.version, { note: '重大异常联动应急值班，通知下游巡查。' }, '值班负责人')
  }
  close(anomaly: Anomaly): void {
    this.dispatch(anomaly.id, 'anomaly-close', anomaly.version, { note: '复测数据稳定，关闭条件已满足。' }, anomaly.plan.approvedBy || '负责人 何清')
  }

  loadDraft(anomaly: Anomaly, draft: ConflictDraft): void {
    if (draft.kind === 'plan-save') {
      const plan = draft.payload['plan'] as DispositionPlan
      if (plan) this.planForm = { action: plan.action, owner: plan.owner, conditions: plan.conditions, deadline: plan.deadline }
    } else if (draft.kind === 'field-review') {
      const review = draft.payload['review'] as FieldReview
      if (review) this.fieldForm = { observed: review.observed, evidence: review.evidence, reassessment: review.reassessment }
    } else if (draft.kind === 'opinion-add') {
      const opinion = draft.payload['opinion'] as ExpertOpinion
      if (opinion) this.opinionForm = { discipline: opinion.discipline, content: opinion.content }
    }
    this.select(anomaly.id)
  }
}
