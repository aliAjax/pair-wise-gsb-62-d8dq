import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import { selectDataset } from '../store/tailings.selectors'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head"><div><h2>审计与版本追溯</h2><p>异常创建、现场复核、专业意见、处置方案、审批与关闭在同一版本链上原子生效；每条记录含所见版本与生效版本，冲突、失败重试与幂等重放均留痕。</p></div><button mat-flat-button color="primary" (click)="exportPackage()">导出审阅包</button></div>
      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索实体、动作、操作人</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field><span>共{{ (filtered$ | async)?.length }}条事件</span></div>
      <table mat-table [dataSource]="filtered$ | async" class="panel">
        <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let row">{{ row.createdAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>实体</th><td mat-cell *matCellDef="let row">{{ row.entityId }}</td></ng-container>
        <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>所见→生效</th><td mat-cell *matCellDef="let row"><span class="ver" [class.conflict]="row.conflict">{{ row.baseVersion === -1 ? '系统' : 'V' + row.baseVersion }} → {{ row.version === undefined || row.version === null ? '—' : 'V' + row.version }}</span><small class="cmd" *ngIf="row.commandId">{{ row.commandId }}</small></td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>动作</th><td mat-cell *matCellDef="let row">{{ row.action }}<span class="conflict-tag" *ngIf="row.conflict">未进链/冲突</span></td></ng-container>
        <ng-container matColumnDef="operator"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let row">{{ row.operator }}</td></ng-container>
        <ng-container matColumnDef="detail"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row">{{ row.detail }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.dim]="row.conflict"></tr>
      </table>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.head h2 { margin: 0 0 5px; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; max-width: 760px; }.toolbar { display: flex; align-items: center; gap: 12px; }.toolbar span { color: #72807d; font-size: 11px; }.panel { width: 100%; background: white; border: 1px solid #d9e1df; }
    .ver { font-size: 11px; color: #315d6e; font-weight: 600; }.ver.conflict { color: #a23b34; }.cmd { display: block; color: #9aa7a3; font-size: 9px; }.conflict-tag { margin-left: 6px; background: #f7e2da; color: #9b4a32; font-size: 10px; padding: 1px 6px; border-radius: 8px; }tr.dim { background: #faf7f4; color: #8b9490; }
  `]
})
export class AuditPageComponent {
  private readonly store = inject(Store)
  private readonly api = inject(TailingsApiService)
  keyword = ''
  readonly columns = ['time', 'entity', 'version', 'action', 'operator', 'detail']
  readonly filtered$ = this.store.select(selectDataset).pipe(map((dataset) => dataset.audit.filter((item) => !this.keyword || `${item.entityId} ${item.action} ${item.operator} ${item.detail}`.includes(this.keyword))))
  exportPackage(): void {
    this.store.select(selectDataset).subscribe((dataset) => {
      this.api.exportPackage(dataset).subscribe((blob) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = '尾矿库监测审阅包.json'; anchor.click(); URL.revokeObjectURL(url)
      })
    }).unsubscribe()
  }
}
