import {
  EASY_ACCOUNT_BLOB_KEY,
  EASY_ACCOUNT_BLOBS_KEY,
} from './easy-restore-available'
import { RESOLVE_TIMING_STORAGE_KEY } from './wot-max-degree'

/**
 * Not user settings. Logs belong in the Logs download. A leftover
 * attentionxResolveTimingV1 in local storage is ignored; live samples are in
 * chrome.storage.session.
 */
const OMIT_STORAGE_KEYS = new Set([
  'keyVault',
  EASY_ACCOUNT_BLOB_KEY,
  EASY_ACCOUNT_BLOBS_KEY,
  'activityLog',
  RESOLVE_TIMING_STORAGE_KEY,
])

/** Fields that carry an nsec, seed, or encrypted key, at any depth. */
const OMIT_FIELDS = new Set([
  'secretKeyHex',
  'privkey',
  'mnemonic',
  'mnemonicBytes',
  'ncryptsec',
  'nsec',
  'localPrivkey',
])

export interface ChromeStorageExport {
  exportedAt: number
  local: Record<string, unknown>
  sync: Record<string, unknown>
  /** Top-level keys left out: secrets, logs, or telemetry measurements. */
  omittedKeys: string[]
}

export function exportChromeStorageAreas(
  local: Record<string, unknown>,
  sync: Record<string, unknown>,
  exportedAt: number,
): ChromeStorageExport {
  const omittedKeys: string[] = []
  return {
    exportedAt,
    local: redactArea(local, omittedKeys, 'local'),
    sync: redactArea(sync, omittedKeys, 'sync'),
    omittedKeys,
  }
}

function redactArea(
  area: Record<string, unknown>,
  omittedKeys: string[],
  areaName: 'local' | 'sync',
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(area)) {
    if (OMIT_STORAGE_KEYS.has(key)) {
      omittedKeys.push(`${areaName}.${key}`)
      continue
    }
    const next = redactValue(value)
    if (next !== undefined) out[key] = next
  }
  return out
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (isSecretString(value)) return undefined
    return value
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const next = redactValue(item)
      return next === undefined ? [] : [next]
    })
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (OMIT_FIELDS.has(key)) continue
      const next = redactValue(child)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return value
}

function isSecretString(value: string): boolean {
  return value.startsWith('nsec1') || value.startsWith('ncryptsec1')
}
