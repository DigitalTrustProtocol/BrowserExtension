/**
 * Cheap Browser Sync Easy-blob presence. Boolean only — never reads ncryptsec.
 *
 * @module shared/easy-restore-available
 */

export const EASY_ACCOUNT_BLOB_KEY = 'easyAccountBlob'
export const EASY_ACCOUNT_BLOBS_KEY = 'easyAccountBlobs'

const HEX_64 = /^[0-9a-f]{64}$/i

function hasPubkeyHint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const hint = (value as { pubkeyHint?: unknown }).pubkeyHint
  return typeof hint === 'string' && HEX_64.test(hint.trim())
}

function v1Restorable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as { version?: unknown; deleted?: unknown }
  if (row.version !== 1) return false
  if (row.deleted === true) return false
  return hasPubkeyHint(value)
}

function v2Restorable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as { version?: unknown; byTwitterId?: unknown }
  if (row.version !== 2) return false
  if (!row.byTwitterId || typeof row.byTwitterId !== 'object') return false
  for (const entry of Object.values(
    row.byTwitterId as Record<string, unknown>,
  )) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as { deleted?: unknown }
    if (rec.deleted === true) continue
    if (hasPubkeyHint(entry)) return true
  }
  return false
}

/** True when Sync holds a live Easy blob that JustWorks can restore. */
export function easyRestoreAvailableFromSyncValues(
  v1: unknown,
  v2: unknown,
): boolean {
  return v2Restorable(v2) || v1Restorable(v1)
}
