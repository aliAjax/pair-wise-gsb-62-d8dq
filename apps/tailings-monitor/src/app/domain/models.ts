export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭'
export type Severity = '关注' | '较高' | '重大'

export interface MonitoringPoint {
  id: string
  name: string
  zone: string
  type: MonitoringType
  longitude: number
  latitude: number
  status: PointStatus
  currentValue: number
  unit: string
  thresholdId: string
  lastInspectionAt: string
}

export interface Threshold {
  id: string
  type: MonitoringType
  warning: number
  alarm: number
  changeRate: number
  unit: string
  enabled: boolean
  version: number
}

export interface RawReading {
  id: string
  pointId: string
  value: number
  unit: string
  capturedAt: string
  deviceId: string
  quality: '有效' | '可疑' | '无效'
}

export interface ExpertOpinion {
  id: string
  specialist: string
  discipline: '坝体' | '水文' | '岩土' | '应急'
  content: string
  conclusion: '支持结论' | '提出异议' | '补充证据'
  createdAt: string
  /** 撤回时间；非空表示该意见已撤回，但仍作为版本链证据保留 */
  withdrawnAt?: string
  withdrawnBy?: string
  /** 追加意见时所依据的异常版本（记录“所见版本”） */
  baseVersion?: number
}

export interface FieldReview {
  id: string
  inspector: string
  arrivedAt: string
  observed: string
  evidence: string
  reassessment: string
  /** 该复核在异常版本链上的生效版本 */
  version: number
  /** 复核动作发生时审阅员所见的异常版本 */
  baseVersion?: number
  kind?: '现场复核' | '意见联动复核'
  /** 执行中方案被意见变更触发追加复核时，冻结的原方案依据 */
  supersededBasis?: PlanBasis
}

/** 方案在版本链上的生命周期状态 */
export type PlanLifecycle = '待审批' | '执行中' | '已失效' | '已完成'

export interface PlanBasis {
  /** 方案生效（审批通过）时的异常版本 */
  basisVersion: number
  /** 生效时所依据的现场复核（id -> 内容摘要） */
  fieldReviewId: string
  fieldReviewDigest: string
  /** 生效时所依据的有效专业意见 id 集合 */
  opinionIds: string[]
  opinionDigest: string
  approvedBy: string
  approvedAt: string
}

export interface DispositionPlan {
  id: string
  action: '加密监测' | '降低库水位' | '疏通排水' | '应急撤离准备' | '工程加固'
  owner: string
  deadline: string
  conditions: string
  emergencyLinked: boolean
  approvedBy: string
  approvedAt: string
  lifecycle?: PlanLifecycle
  /** 保存方案时所见的异常版本 */
  baseVersion?: number
  /** 方案生效时冻结的依据；执行中方案被意见变更后仍保留 */
  basis?: PlanBasis
  /** 失效原因（由专业意见补充/撤回触发重算时写入） */
  invalidReason?: string
  invalidAt?: string
}

/**
 * 统一版本链上的一个原子修订。
 * 异常、现场复核、专业意见、处置方案、审计结论共享同一条链，
 * 每个修订都记录动作发生时所见版本 baseVersion 与生效版本 version。
 */
export interface ChainRevision {
  version: number
  commandId: string
  kind: '现场复核' | '补充专业意见' | '撤回专业意见' | '提交处置方案' | '审批处置方案' | '应急联动' | '关闭异常' | '意见联动'
  operator: string
  baseVersion: number
  summary: string
  createdAt: string
  /** 该修订内联发生的处置方案联动结论（与修订同一版本，重放不重复追加） */
  effects?: PlanRecalcEffect[]
}

/** 方案被意见变更联动重算的结论记录（挂在修订上，重放幂等） */
export interface PlanRecalcEffect {
  planId: string
  result: '失效重算' | '追加复核'
  reason: string
  frozenBasis?: PlanBasis
}

export interface Anomaly {
  id: string
  pointId: string
  title: string
  severity: Severity
  status: AnomalyStatus
  openedAt: string
  owner: string
  triggerReadingId: string
  observedValue: string
  fieldReviews: FieldReview[]
  opinions: ExpertOpinion[]
  plan: DispositionPlan
  closedAt: string
  /** 异常当前生效版本（版本链头版本号） */
  version: number
  /** 统一版本链（按版本升序），未水合时为空数组 */
  chain?: ChainRevision[]
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 动作所见版本；-1 表示种子/系统记录 */
  baseVersion?: number
  /** 动作生效版本；版本冲突未生效时与 baseVersion 相同 */
  version?: number
  commandId?: string
  conflict?: boolean
}

/** 后到保存产生的冲突草稿，保留完整动作载荷与依据，供审阅者对齐重提 */
export interface ConflictDraft {
  id: string
  anomalyId: string
  commandId: string
  kind: ChainRevision['kind']
  operator: string
  payload: Record<string, unknown>
  /** 草稿所见版本 */
  baseVersion: number
  /** 冲突时链上已生效版本 */
  headVersion: number
  /** 冲突时保留的依据快照（完整审阅版本） */
  basis: ReviewBasisSnapshot
  detail: string
  createdAt: string
  status: '待处理' | '已重提' | '已放弃'
}

/** 动作发生/失败时的完整审阅依据快照，用于从失败写中恢复重试 */
export interface ReviewBasisSnapshot {
  anomalyVersion: number
  status: AnomalyStatus
  latestFieldReview?: string
  activeOpinionIds: string[]
  planId: string
  planLifecycle: PlanLifecycle
  planDigest: string
}

/** 写入通道的待办/失败写（WAL），落 localStorage，刷新后可恢复重试 */
export interface PendingWrite {
  commandId: string
  anomalyId: string
  kind: ChainRevision['kind']
  operator: string
  baseVersion: number
  payload: Record<string, unknown>
  status: '待发送' | '发送失败'
  attempts: number
  lastError: string
  createdAt: string
  updatedAt: string
  /** 发起写入时的完整审阅版本，恢复重试时展示依据 */
  snapshot: ReviewBasisSnapshot
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  audit: AuditEntry[]
}
