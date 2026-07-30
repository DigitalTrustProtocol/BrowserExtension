import {
  DEFAULT_TRUST_FILTERS,
  normalizeTrustFilters,
  type TrustFilters,
} from './x-augmentation'

/** Sync config channel for XHR rewrites (postMessage is racy for first paint). */
export const TRUST_FILTERS_DATASET_KEY = 'attentionxTrustFilters'

export function writeTrustFiltersDataset(
  doc: Document,
  filters: TrustFilters,
): void {
  doc.documentElement.dataset[TRUST_FILTERS_DATASET_KEY] =
    JSON.stringify(filters)
}

export function readTrustFiltersDataset(
  doc: Document,
): TrustFilters | undefined {
  const raw = doc.documentElement.dataset[TRUST_FILTERS_DATASET_KEY]
  if (!raw) return undefined
  try {
    return normalizeTrustFilters({ trustFilters: JSON.parse(raw) as unknown })
  } catch {
    return { ...DEFAULT_TRUST_FILTERS }
  }
}
