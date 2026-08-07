/**
 * Session storage key + helpers for the signed-in X account report.
 * Shared so vault handlers can gate switchAccount in X-tab context without
 * importing the full backend.
 *
 * @module shared/active-x-session
 */

import type { ActiveXAccountReport } from './proof-composer.ts'

export const ACTIVE_X_ACCOUNT_SESSION_KEY = 'attentionxActiveXAccount'

export function activeXAccountFromUnknown(
  value: unknown,
): ActiveXAccountReport | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (typeof row.handle !== 'string' || !row.handle.trim()) return undefined
  if (typeof row.detectedAt !== 'number' || !Number.isFinite(row.detectedAt)) {
    return undefined
  }
  const twitterId =
    typeof row.twitterId === 'string' && /^[0-9]+$/.test(row.twitterId)
      ? row.twitterId
      : undefined
  return {
    handle: row.handle.trim(),
    detectedAt: row.detectedAt,
    ...(twitterId ? { twitterId } : {}),
    ...(typeof row.displayName === 'string'
      ? { displayName: row.displayName }
      : {}),
    ...(typeof row.iconPath === 'string' ? { iconPath: row.iconPath } : {}),
  }
}
