/**
 * Pure invariants of the config form's model cascade: which selection survives
 * a provider / model switch. A model survives a provider switch only when the
 * new provider advertises the same id; an effort survives only when the model
 * it lands on still advertises it. Sending an effort a model does not expose
 * is the one hard error this guards (the adapter would receive an id outside
 * its table), so every cascade step drops stale halves the same way.
 */
import type { ModelCatalogGroup } from './types.js'

/** The current model kept across a provider switch, or '' when unknown to it. */
export function modelForProvider(
  catalog: readonly ModelCatalogGroup[],
  nextProvider: string,
  currentModel: string,
): string {
  if (nextProvider === '') return ''
  const group = catalog.find((g) => g.id === nextProvider)
  return group?.models.some((m) => m.id === currentModel) === true ? currentModel : ''
}

/** The current effort kept across a cascade step, or '' when the model does
 * not advertise it — including a model without any efforts entry at all. */
export function effortForModel(
  catalog: readonly ModelCatalogGroup[],
  providerId: string,
  modelId: string,
  currentEffort: string,
): string {
  if (modelId === '') return ''
  const group = catalog.find((g) => g.id === providerId)
  const efforts = group?.models.find((m) => m.id === modelId)?.reasoning?.efforts
  return efforts !== undefined && efforts.some((e) => e.id === currentEffort) ? currentEffort : ''
}
