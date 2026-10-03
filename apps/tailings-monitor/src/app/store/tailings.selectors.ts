import { createFeatureSelector, createSelector } from '@ngrx/store'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectSelectedAnomaly = createSelector(selectTailings, (state) => state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0])
export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))
export const selectPendingWrites = createSelector(selectTailings, (state) => state.pendingWrites)
export const selectConflictDrafts = createSelector(selectTailings, (state) => state.conflictDrafts)
export const selectNotice = createSelector(selectTailings, (state) => state.notice)
export const selectOpenConflictDrafts = createSelector(selectConflictDrafts, (drafts) => drafts.filter((draft) => draft.status === '待处理'))
