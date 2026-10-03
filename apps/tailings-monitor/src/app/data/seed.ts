import type { Anomaly, RevisionRef, TailingsDataset } from '../domain'

const revisions01: RevisionRef[] = [
  { version: 7, writeId: 'SEED-07', kind: 'plan-save', operator: '库区调度班', summary: '提交处置方案 V1（降低库水位）', at: '2026-09-29T11:30:00' },
  { version: 6, writeId: 'SEED-06', kind: 'opinion-add', operator: '许洁', summary: '补充专业意见（许洁）', at: '2026-09-29T10:45:00' },
  { version: 5, writeId: 'SEED-05', kind: 'opinion-add', operator: '周岩', summary: '补充专业意见（周岩）', at: '2026-09-29T10:20:00' },
  { version: 4, writeId: 'SEED-04', kind: 'field-review', operator: '宋立', summary: '现场复核 V1（宋立）', at: '2026-09-29T09:25:00' },
  { version: 3, writeId: 'SEED-03', kind: 'dispatch', operator: '值班调度', summary: '派发现场复核（宋立）', at: '2026-09-29T08:40:00' },
  { version: 2, writeId: 'SEED-02', kind: 'acknowledge', operator: '坝体安全组', summary: '认领异常并定级重大', at: '2026-09-29T08:30:00' },
  { version: 1, writeId: 'SEED-01', kind: 'create', operator: '阈值引擎', summary: '位移超报警阈值，生成异常', at: '2026-09-29T08:25:00' }
]

const revisions02: RevisionRef[] = [
  { version: 4, writeId: 'SEED-104', kind: 'opinion-add', operator: '许洁', summary: '补充专业意见（许洁）', at: '2026-09-29T09:00:00' },
  { version: 3, writeId: 'SEED-103', kind: 'dispatch', operator: '值班调度', summary: '转入原因调查', at: '2026-09-29T08:20:00' },
  { version: 2, writeId: 'SEED-102', kind: 'acknowledge', operator: '库区调度班', summary: '认领异常并定级较高', at: '2026-09-29T08:10:00' },
  { version: 1, writeId: 'SEED-101', kind: 'create', operator: '阈值引擎', summary: '水位上升速率超预警值，生成异常', at: '2026-09-29T08:00:00' }
]

export const seedDataset: TailingsDataset = {
  points: [
    { id: 'P-D01', name: '主坝顶部位移点 D01', zone: '主坝', type: '位移', longitude: 112.832, latitude: 40.116, status: '异常', currentValue: 18.7, unit: 'mm', thresholdId: 'T-D', lastInspectionAt: '2026-09-29T08:20:00' },
    { id: 'P-D02', name: '主坝下游位移点 D02', zone: '主坝', type: '位移', longitude: 112.837, latitude: 40.111, status: '预警', currentValue: 12.4, unit: 'mm', thresholdId: 'T-D', lastInspectionAt: '2026-09-29T08:10:00' },
    { id: 'P-W01', name: '库内水位计 W01', zone: '库区', type: '水位', longitude: 112.846, latitude: 40.121, status: '预警', currentValue: 873.4, unit: 'm', thresholdId: 'T-W', lastInspectionAt: '2026-09-29T07:55:00' },
    { id: 'P-S01', name: '主坝渗流计 S01', zone: '主坝', type: '渗流', longitude: 112.827, latitude: 40.106, status: '正常', currentValue: 1.8, unit: 'L/s', thresholdId: 'T-S', lastInspectionAt: '2026-09-29T07:40:00' },
    { id: 'P-R01', name: '库区雨量站 R01', zone: '库区', type: '降雨', longitude: 112.861, latitude: 40.132, status: '正常', currentValue: 24.6, unit: 'mm/h', thresholdId: 'T-R', lastInspectionAt: '2026-09-29T08:00:00' }
  ],
  thresholds: [
    { id: 'T-D', type: '位移', warning: 10, alarm: 16, changeRate: 3, unit: 'mm/d', enabled: true, version: 4 },
    { id: 'T-W', type: '水位', warning: 871, alarm: 873, changeRate: 0.5, unit: 'm/h', enabled: true, version: 3 },
    { id: 'T-S', type: '渗流', warning: 2.2, alarm: 3, changeRate: 0.4, unit: 'L/s', enabled: true, version: 5 },
    { id: 'T-R', type: '降雨', warning: 30, alarm: 50, changeRate: 10, unit: 'mm/h', enabled: true, version: 2 }
  ],
  readings: [
    { id: 'RD-1', pointId: 'P-D01', value: 18.7, unit: 'mm', capturedAt: '2026-09-29T08:20:00', deviceId: 'GNSS-D01', quality: '有效' },
    { id: 'RD-2', pointId: 'P-D01', value: 16.2, unit: 'mm', capturedAt: '2026-09-29T07:20:00', deviceId: 'GNSS-D01', quality: '有效' },
    { id: 'RD-3', pointId: 'P-D01', value: 13.8, unit: 'mm', capturedAt: '2026-09-29T06:20:00', deviceId: 'GNSS-D01', quality: '有效' },
    { id: 'RD-4', pointId: 'P-W01', value: 873.4, unit: 'm', capturedAt: '2026-09-29T07:55:00', deviceId: 'WL-W01', quality: '有效' }
  ],
  anomalies: [
    {
      id: 'AN-260929-01', pointId: 'P-D01', title: '主坝D01累计位移超过报警阈值', severity: '重大', status: '待负责人审批', openedAt: '2026-09-29T08:25:00', owner: '坝体安全组', triggerReadingId: 'RD-1', observedValue: '18.7 mm，昨日变化4.2 mm/d', version: 7, closedAt: '',
      fieldReviews: [{ id: 'FR-1', inspector: '宋立', arrivedAt: '2026-09-29T09:10:00', observed: '坝顶排水沟未见明显开裂，D01附近无新增裂缝，基准点稳定。', evidence: 'D01近景照片、基准点复核记录、GNSS原始观测文件', reassessment: '读数有效，位移趋势仍上升，建议立即降低库水位并加密监测。', version: 1, baseVersion: 3, basisVersion: -1 }],
      opinions: [
        { id: 'OP-1', specialist: '周岩', discipline: '岩土', content: '近三日位移速率持续高于阈值，需结合孔隙水压力分析潜在滑面。', conclusion: '支持结论', createdAt: '2026-09-29T10:20:00', baseVersion: 4, withdrawn: false },
        { id: 'OP-2', specialist: '许洁', discipline: '水文', content: '库水位仍接近警戒线，建议优先降低库水位并核对上游来水。', conclusion: '补充证据', createdAt: '2026-09-29T10:45:00', baseVersion: 5, withdrawn: false }
      ],
      plan: { id: 'PL-1', action: '降低库水位', owner: '库区调度班', deadline: '2026-09-29T18:00', conditions: '每2小时复测D01、D02和W01；位移速率恢复至3mm/d以下并稳定12小时后，负责人可关闭异常。', emergencyLinked: true, approvedBy: '', approvedAt: '', planVersion: 1, lifecycle: '待审批', baseVersion: 6, basis: null },
      planHistory: [],
      revisions: revisions01,
      conflictDrafts: []
    } satisfies Anomaly,
    {
      id: 'AN-260929-02', pointId: 'P-W01', title: '库水位短时上升速率超预警值', severity: '较高', status: '原因调查中', openedAt: '2026-09-29T08:00:00', owner: '库区调度班', triggerReadingId: 'RD-4', observedValue: '873.4 m，1小时上升0.6 m', version: 4, closedAt: '',
      fieldReviews: [],
      opinions: [{ id: 'OP-3', specialist: '许洁', discipline: '水文', content: '上游降雨汇流导致入湖量增加，需核实泄洪闸状态。', conclusion: '支持结论', createdAt: '2026-09-29T09:00:00', baseVersion: 3, withdrawn: false }],
      plan: { id: 'PL-2', action: '加密监测', owner: '', deadline: '', conditions: '', emergencyLinked: false, approvedBy: '', approvedAt: '', planVersion: 0, lifecycle: '待提交', baseVersion: 0, basis: null },
      planHistory: [],
      revisions: revisions02,
      conflictDrafts: []
    } satisfies Anomaly
  ],
  audit: [
    { id: 'A-SEED-07', entityId: 'AN-260929-01', action: '提交处置方案', operator: '库区调度班', detail: '所见V6 → V7｜提交方案V1：降低库水位，责任方库区调度班', createdAt: '2026-09-29T11:30:00', version: 7, writeId: 'SEED-07' },
    { id: 'A-SEED-06', entityId: 'AN-260929-01', action: '补充专业意见', operator: '许洁', detail: '所见V5 → V6｜水文专家许洁｜补充证据：库水位仍接近警戒线，建议优先降低库水位并核对上游来水。', createdAt: '2026-09-29T10:45:00', version: 6, writeId: 'SEED-06' },
    { id: 'A-SEED-05', entityId: 'AN-260929-01', action: '补充专业意见', operator: '周岩', detail: '所见V4 → V5｜岩土专家周岩｜支持结论：近三日位移速率持续高于阈值，需结合孔隙水压力分析潜在滑面。', createdAt: '2026-09-29T10:20:00', version: 5, writeId: 'SEED-05' },
    { id: 'A-SEED-04', entityId: 'AN-260929-01', action: '提交现场复核', operator: '宋立', detail: '所见V3 → V4｜现场复核V1：原始读数有效，位移趋势仍上升', createdAt: '2026-09-29T09:25:00', version: 4, writeId: 'SEED-04' },
    { id: 'A-SEED-01', entityId: 'P-D01', action: '生成异常', operator: '阈值引擎', detail: '累计位移18.7mm超过报警阈值16mm', createdAt: '2026-09-29T08:25:00', version: 1, writeId: 'SEED-01' }
  ],
  pendingWrites: []
}
