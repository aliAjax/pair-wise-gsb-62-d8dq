import type {
  Anomaly,
  AuditEntry,
  ChainRevision,
  ConflictDraft,
  DispositionPlan,
  ExpertOpinion,
  FieldReview,
  PlanBasis,
  PlanLifecycle,
  ReviewBasisSnapshot,
  TailingsDataset
} from './models'

/**
 * 异常处置统一版本链引擎（纯函数）。
 *
 * 约定：
 * - 异常、现场复核、专业意见、处置方案共享同一条单调递增的版本链；
 * - 每个写请求记录审阅人“所见版本” baseVersion，保存时做 CAS：
 *   baseVersion === 当前链头版本才生效，先到者生效，后到者转为冲突草稿并保留依据；
 * - 专业意见补充/撤回在同一修订内联动：未生效方案立即失效重算，执行中方案保留原依据并追加复核；
 * - 每个命令带 commandId，重复命令原样返回，重放绝不重复追加结论。
 */

export type ReviewCommand =
  | { type: 'submitFieldReview'; review: FieldReview }
  | { type: 'addExpertOpinion'; opinion: ExpertOpinion }
  | { type: 'withdrawExpertOpinion'; opinionId: string; reason: string }
  | { type: 'saveDispositionPlan'; plan: DispositionPlan }
  | { type: 'approvePlan'; approver: string; note: string }
  | { type: 'createEmergencyLink'; note: string }
  | { type: 'closeAnomaly'; note: string }

export interface ReviewRequest {
  commandId: string
  anomalyId: string
  operator: string
  /** 动作发生时审阅人所见的异常版本 */
  baseVersion: number
  command: ReviewCommand
  createdAt: string
}

export type ApplyOutcome = 'applied' | 'conflict' | 'duplicate' | 'rejected'

export interface ApplyResult {
  dataset: TailingsDataset
  outcome: ApplyOutcome
  /** applied / conflict / duplicate 时的链头版本（rejected 时不变） */
  headVersion: number
  conflict?: ConflictDraft
  reason?: string
}

let idSeed = 0
export function uniqueId(prefix: string): string {
  idSeed += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`
}

export function newCommandId(): string {
  return uniqueId('CMD')
}

export function newDraftId(): string {
  return uniqueId('CD')
}

const COMMIT_KIND: Record<ReviewCommand['type'], ChainRevision['kind']> = {
  submitFieldReview: '现场复核',
  addExpertOpinion: '补充专业意见',
  withdrawExpertOpinion: '撤回专业意见',
  saveDispositionPlan: '提交处置方案',
  approvePlan: '审批处置方案',
  createEmergencyLink: '应急联动',
  closeAnomaly: '关闭异常'
}

export function reviewDigest(plan: DispositionPlan): string {
  return `${plan.action}|${plan.owner}|${plan.deadline}|${plan.conditions}|应急:${plan.emergencyLinked ? 1 : 0}`
}

export function reviewDigestOf(anomaly: Anomaly): string {
  return reviewDigest(anomaly.plan)
}

/** 拍摄动作发起时的完整审阅依据快照（写失败恢复/冲突保留均依赖它） */
export function captureBasis(anomaly: Anomaly): ReviewBasisSnapshot {
  const latest = anomaly.fieldReviews[0]
  return {
    anomalyVersion: anomaly.version,
    status: anomaly.status,
    latestFieldReview: latest ? `${latest.inspector}@V${latest.version}:${latest.reassessment}` : undefined,
    activeOpinionIds: anomaly.opinions.filter((opinion) => !opinion.withdrawnAt).map((opinion) => opinion.id),
    planId: anomaly.plan.id,
    planLifecycle: anomaly.plan.lifecycle ?? '待审批',
    planDigest: reviewDigest(anomaly.plan)
  }
}

function buildPlanBasis(anomaly: Anomaly, approvedBy: string, approvedAt: string): PlanBasis {
  const latest = anomaly.fieldReviews.find((review) => (review.kind ?? '现场复核') === '现场复核') ?? anomaly.fieldReviews[0]
  const active = anomaly.opinions.filter((opinion) => !opinion.withdrawnAt)
  return {
    basisVersion: anomaly.version + 1,
    fieldReviewId: latest?.id ?? '',
    fieldReviewDigest: latest ? `${latest.inspector}@V${latest.version}:${latest.reassessment}` : '',
    opinionIds: active.map((opinion) => opinion.id),
    opinionDigest: active.map((opinion) => `${opinion.id}:${opinion.conclusion}`).join('||'),
    approvedBy,
    approvedAt
  }
}

function makeAudit(entry: Omit<AuditEntry, 'id'>): AuditEntry {
  return { id: uniqueId('AUD'), ...entry }
}

function auditSummary(command: ReviewCommand): string {
  switch (command.type) {
    case 'submitFieldReview':
      return `现场复核：${command.review.reassessment}`
    case 'addExpertOpinion':
      return `补充专业意见：${command.opinion.conclusion}，${command.opinion.content}`
    case 'withdrawExpertOpinion':
      return `撤回专业意见：${command.reason}`
    case 'saveDispositionPlan':
      return `提交处置方案：${command.plan.action}，责任方${command.plan.owner}`
    case 'approvePlan':
      return `审批处置方案：${command.note || '同意执行'}`
    case 'createEmergencyLink':
      return `启动应急联动：${command.note}`
    case 'closeAnomaly':
      return `关闭异常：${command.note}`
  }
}

/**
 * 在数据集上应用一个审阅写请求。
 * 不修改入参（内部 structuredClone）。
 */
export function applyReview(dataset: TailingsDataset, req: ReviewRequest): ApplyResult {
  const next: TailingsDataset = structuredClone(dataset)
  const anomaly = next.anomalies.find((item) => item.id === req.anomalyId)
  if (!anomaly) {
    return { dataset, outcome: 'rejected', headVersion: 0, reason: '异常不存在' }
  }
  anomaly.chain ??= []

  // 幂等：同一 commandId 已在版本链上生效，重放直接返回，不重复追加任何结论
  if (anomaly.chain.some((revision) => revision.commandId === req.commandId)) {
    return { dataset, outcome: 'duplicate', headVersion: anomaly.version, reason: '命令已生效' }
  }

  // 乐观并发：后到保存（所见版本落后于链头）不覆盖已生效签批/审计，转冲突草稿
  if (req.baseVersion !== anomaly.version) {
    const draft: ConflictDraft = {
      id: newDraftId(),
      anomalyId: anomaly.id,
      commandId: req.commandId,
      kind: COMMIT_KIND[req.command.type],
      operator: req.operator,
      payload: commandPayload(req.command),
      baseVersion: req.baseVersion,
      headVersion: anomaly.version,
      basis: captureBasis(anomaly),
      detail: auditSummary(req.command),
      createdAt: req.createdAt,
      status: '待处理'
    }
    return {
      dataset,
      outcome: 'conflict',
      headVersion: anomaly.version,
      conflict: draft,
      reason: `版本冲突：所见V${req.baseVersion}，当前已到V${anomaly.version}`
    }
  }

  const result = mutate(anomaly, req)
  if (!result.ok) {
    return { dataset, outcome: 'rejected', headVersion: anomaly.version, reason: result.reason }
  }

  // 提交一个原子修订：现场复核/意见/方案/审计结论同版本生效
  const revision: ChainRevision = {
    version: anomaly.version,
    commandId: req.commandId,
    kind: COMMIT_KIND[req.command.type],
    operator: req.operator,
    baseVersion: req.baseVersion,
    summary: auditSummary(req.command),
    createdAt: req.createdAt,
    effects: result.effects?.length ? result.effects : undefined
  }
  anomaly.chain.push(revision)

  next.audit.unshift(makeAudit({
    entityId: anomaly.id,
    action: COMMIT_KIND[req.command.type],
    operator: req.operator,
    detail: result.auditDetail ?? auditSummary(req.command),
    createdAt: req.createdAt,
    baseVersion: req.baseVersion,
    version: anomaly.version,
    commandId: req.commandId,
    conflict: false
  }))
  result.extraAudit?.forEach((entry) => next.audit.unshift(makeAudit({
    ...entry,
    entityId: anomaly.id,
    createdAt: entry.createdAt ?? req.createdAt,
    baseVersion: req.baseVersion,
    version: anomaly.version,
    commandId: req.commandId
  })))

  return { dataset: next, outcome: 'applied', headVersion: anomaly.version }
}

interface MutateResult {
  ok: boolean
  reason?: string
  auditDetail?: string
  extraAudit?: Array<Omit<AuditEntry, 'id' | 'entityId' | 'baseVersion' | 'version' | 'commandId'>>
  effects?: ChainRevision['effects']
}

function mutate(anomaly: Anomaly, req: ReviewRequest): MutateResult {
  const { command, operator } = req
  const at = req.createdAt
  const plan = anomaly.plan
  const lifecycle = plan.lifecycle ?? '待审批'

  switch (command.type) {
    case 'submitFieldReview': {
      const review = command.review
      if (!review.observed || !review.evidence || !review.reassessment) return { ok: false, reason: '复核内容不完整' }
      const committed: FieldReview = {
        ...review,
        version: anomaly.version + 1,
        baseVersion: req.baseVersion,
        kind: '现场复核'
      }
      anomaly.fieldReviews.unshift(committed)
      if (anomaly.status === '待现场复核') anomaly.status = '原因调查中'
      bump(anomaly)
      return { ok: true }
    }

    case 'addExpertOpinion': {
      const opinion = command.opinion
      if (!opinion.content) return { ok: false, reason: '意见内容为空' }
      const committed: ExpertOpinion = { ...opinion, baseVersion: req.baseVersion }
      anomaly.opinions.unshift(committed)
      bump(anomaly)
      return recalcByOpinion(anomaly, req, `新增${opinion.discipline}专业意见（${opinion.conclusion}）`)
    }

    case 'withdrawExpertOpinion': {
      const opinion = anomaly.opinions.find((item) => item.id === command.opinionId)
      if (!opinion) return { ok: false, reason: '意见不存在' }
      if (opinion.withdrawnAt) return { ok: false, reason: '意见已撤回' }
      opinion.withdrawnAt = at
      opinion.withdrawnBy = operator
      bump(anomaly)
      return recalcByOpinion(anomaly, req, `撤回${opinion.discipline}专业意见：${command.reason}`)
    }

    case 'saveDispositionPlan': {
      const candidate = command.plan
      if (!candidate.owner || !candidate.deadline || !candidate.conditions) return { ok: false, reason: '方案要素不完整' }
      const preservedBasis = lifecycle === '执行中' ? plan.basis : undefined
      anomaly.plan = {
        ...candidate,
        approvedBy: '',
        approvedAt: '',
        lifecycle: '待审批',
        basis: undefined,
        invalidReason: undefined,
        invalidAt: undefined,
        baseVersion: req.baseVersion,
        // 极端情况下对执行中方案的改稿，保留其已冻结依据以便追溯
        ...(preservedBasis ? { basis: preservedBasis } : {})
      }
      anomaly.status = '待负责人审批'
      bump(anomaly)
      return { ok: true }
    }

    case 'approvePlan': {
      if (lifecycle === '执行中') return { ok: false, reason: '方案已在执行，不得重复签批' }
      if (lifecycle === '已失效') return { ok: false, reason: '方案已失效，须重新提交后再审批' }
      if (lifecycle === '已完成') return { ok: false, reason: '方案已完成' }
      if (anomaly.severity === '重大' && !plan.emergencyLinked) return { ok: false, reason: '重大异常须先启动应急联动' }
      const approvedAt = at
      plan.approvedBy = command.approver
      plan.approvedAt = approvedAt
      plan.lifecycle = '执行中'
      plan.basis = buildPlanBasis(anomaly, command.approver, approvedAt)
      anomaly.status = plan.emergencyLinked ? '应急联动' : '原因调查中'
      bump(anomaly)
      return { ok: true, auditDetail: `审批处置方案：${command.note || '同意执行'}；依据V${plan.basis.basisVersion}（${plan.basis.opinionIds.length}条意见、复核${plan.basis.fieldReviewId || '无'}）` }
    }

    case 'createEmergencyLink': {
      if (anomaly.status === '已关闭') return { ok: false, reason: '异常已关闭' }
      plan.emergencyLinked = true
      if (lifecycle === '待审批' || lifecycle === '已失效') plan.lifecycle = lifecycle === '已失效' ? '已失效' : '待审批'
      anomaly.status = '应急联动'
      bump(anomaly)
      return { ok: true }
    }

    case 'closeAnomaly': {
      if (!command.note.trim()) return { ok: false, reason: '关闭说明为空' }
      if (!anomaly.fieldReviews.some((review) => (review.kind ?? '现场复核') === '现场复核')) return { ok: false, reason: '缺少现场复核，不得关闭' }
      if (lifecycle !== '执行中') return { ok: false, reason: '仅执行中方案可关闭' }
      plan.lifecycle = '已完成'
      anomaly.status = '已关闭'
      anomaly.closedAt = at
      bump(anomaly)
      return { ok: true }
    }
  }
}

function bump(anomaly: Anomaly): void {
  anomaly.version += 1
}

/**
 * 专业意见补充/撤回后的方案联动（与触发修订同一版本提交，天然幂等）：
 * - 未生效（待审批/已失效）方案：立即失效、退回重算；
 * - 执行中方案：冻结并保留原依据，追加一条意见联动复核。
 */
function recalcByOpinion(
  anomaly: Anomaly,
  req: ReviewRequest,
  trigger: string
): MutateResult {
  const plan = anomaly.plan
  const lifecycle = plan.lifecycle ?? '待审批'

  if (lifecycle === '待审批') {
    plan.lifecycle = '已失效'
    plan.invalidReason = trigger
    plan.invalidAt = req.createdAt
    if (anomaly.status === '待负责人审批') anomaly.status = '原因调查中'
    return {
      ok: true,
      auditDetail: `${auditSummary(req.command)}；原待审批方案【${plan.action}】立即失效，退回重算`,
      effects: [{ planId: plan.id, result: '失效重算', reason: plan.invalidReason }]
    }
  }

  if (lifecycle === '执行中') {
    const frozen = plan.basis
    const followUp: FieldReview = {
      id: uniqueId('FR'),
      inspector: req.operator,
      arrivedAt: req.createdAt,
      observed: `专业意见变更（${trigger}）后对执行中方案的追加复核`,
      evidence: frozen ? `原依据V${frozen.basisVersion}；原意见${frozen.opinionIds.join('、') || '无'}` : '原方案未冻结依据',
      reassessment: `继续执行原方案【${plan.action}】，保留原签批依据并按新意见补充复核`,
      version: anomaly.version,
      baseVersion: req.baseVersion,
      kind: '意见联动复核',
      supersededBasis: frozen ? structuredClone(frozen) : undefined
    }
    anomaly.fieldReviews.unshift(followUp)
    return {
      ok: true,
      auditDetail: `${auditSummary(req.command)}；执行中方案【${plan.action}】保留V${frozen?.basisVersion ?? '?'}原依据，追加复核${followUp.id}`,
      effects: [{ planId: plan.id, result: '追加复核', reason: trigger, frozenBasis: frozen ? structuredClone(frozen) : undefined }]
    }
  }

  // 已失效/已完成：无需联动
  return { ok: true }
}

function commandPayload(command: ReviewCommand): Record<string, unknown> {
  const { type, ...rest } = command
  return { type, ...rest } as Record<string, unknown>
}

/** 从冲突草稿重提（对齐到当前链头版本，使用新 commandId 以保证可再次 CAS） */
export function rebaseDraftRequest(draft: ConflictDraft, command: ReviewCommand, now: string): ReviewRequest {
  return {
    commandId: newCommandId(),
    anomalyId: draft.anomalyId,
    operator: draft.operator,
    baseVersion: draft.headVersion,
    command,
    createdAt: now
  }
}

/** 把冲突草稿载荷还原成命令（恢复重试时复用） */
export function commandFromDraft(draft: ConflictDraft): ReviewCommand {
  return draft.payload as unknown as ReviewCommand
}

/**
 * 放弃冲突草稿：仅留审计，不推进版本链（不改变任何已生效签批）。
 */
export function discardDraft(dataset: TailingsDataset, draft: ConflictDraft, now: string): TailingsDataset {
  const next = structuredClone(dataset)
  next.audit.unshift(makeAudit({
    entityId: draft.anomalyId,
    action: '放弃冲突草稿',
    operator: draft.operator,
    detail: `放弃V${draft.baseVersion}草稿《${draft.detail}》（链头已到V${draft.headVersion}）`,
    createdAt: now,
    baseVersion: draft.headVersion,
    version: draft.headVersion,
    conflict: true
  }))
  return next
}

/** 种子数据水合：把既有现场复核/意见按时间重建到统一版本链，保证演示一致 */
export function hydrateDataset(dataset: TailingsDataset): TailingsDataset {
  const next = structuredClone(dataset)
  const seedAuditCount = next.audit.length

  for (const anomaly of next.anomalies) {
    anomaly.chain = []

    const reviewEvents = anomaly.fieldReviews
      .map((review) => ({ kind: '现场复核' as const, at: review.arrivedAt, id: review.id, review }))
    const opinionEvents = anomaly.opinions
      .filter((opinion) => !opinion.withdrawnAt)
      .map((opinion) => ({ kind: '补充专业意见' as const, at: opinion.createdAt, id: opinion.id, opinion }))
    const events = [...reviewEvents, ...opinionEvents].sort((a, b) => a.at.localeCompare(b.at))

    let version = 0
    for (const event of events) {
      version += 1
      if (event.kind === '现场复核') {
        event.review.version = version
        event.review.baseVersion = version - 1
        event.review.kind = '现场复核'
      } else {
        event.opinion.baseVersion = version - 1
      }
      anomaly.chain.push({
        version,
        commandId: `SEED-${anomaly.id}-${event.id}`,
        kind: event.kind,
        operator: event.kind === '现场复核' ? event.review.inspector : event.opinion.specialist,
        baseVersion: version - 1,
        summary: event.kind === '现场复核'
          ? `现场复核：${event.review.reassessment}`
          : `补充专业意见：${event.opinion.conclusion}，${event.opinion.content}`,
        createdAt: event.at
      })
    }

    const approved = !!anomaly.plan.approvedBy
    anomaly.plan.lifecycle = anomaly.status === '已关闭' ? '已完成' : approved ? '执行中' : '待审批'
    anomaly.plan.baseVersion = anomaly.plan.baseVersion ?? version
    if (approved) {
      anomaly.plan.basis = {
        basisVersion: version,
        fieldReviewId: anomaly.fieldReviews[0]?.id ?? '',
        fieldReviewDigest: anomaly.fieldReviews[0] ? `${anomaly.fieldReviews[0].inspector}@V${anomaly.fieldReviews[0].version}:${anomaly.fieldReviews[0].reassessment}` : '',
        opinionIds: anomaly.opinions.map((opinion) => opinion.id),
        opinionDigest: anomaly.opinions.map((opinion) => `${opinion.id}:${opinion.conclusion}`).join('||'),
        approvedBy: anomaly.plan.approvedBy,
        approvedAt: anomaly.plan.approvedAt
      }
    }
    anomaly.version = version
  }

  // 给既有审计补上版本字段（系统记录记 -1）
  for (const audit of next.audit.slice(0, seedAuditCount)) {
    const anomaly = next.anomalies.find((item) => item.id === audit.entityId)
    audit.baseVersion = anomaly ? 0 : -1
    audit.version = anomaly ? 0 : undefined
    audit.conflict = false
  }
  return next
}
