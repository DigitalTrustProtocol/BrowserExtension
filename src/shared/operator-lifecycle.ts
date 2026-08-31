/**
 * Durable operator lifecycle (device-local). Distinguishes first-run from
 * post-delete so the panel does not re-open onboarding after keys are cleared.
 *
 * @module shared/operator-lifecycle
 */

export const OPERATOR_LIFECYCLE_KEY = 'attentionxOperatorLifecycleV1'

export type OperatorLifecycleReason =
  | 'accountPersisted'
  | 'lastKeyDelete'
  | 'logout'
  | 'destroy'

export type PanelLifecycle = 'neverUsed' | 'active' | 'keysCleared'

export interface OperatorLifecycleRecord {
  version: 1
  revision: number
  everHadAccounts: boolean
  restoreSuppressed: boolean
  changedAt: number
  reason?: OperatorLifecycleReason
}

export function emptyOperatorLifecycle(
  now: number,
): OperatorLifecycleRecord {
  return {
    version: 1,
    revision: 0,
    everHadAccounts: false,
    restoreSuppressed: false,
    changedAt: now,
  }
}

export function operatorLifecycleFromUnknown(
  value: unknown,
): OperatorLifecycleRecord | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.version !== 1) return null
  if (typeof row.revision !== 'number' || !Number.isFinite(row.revision)) {
    return null
  }
  if (typeof row.everHadAccounts !== 'boolean') return null
  if (typeof row.restoreSuppressed !== 'boolean') return null
  if (typeof row.changedAt !== 'number' || !Number.isFinite(row.changedAt)) {
    return null
  }
  const reason = row.reason
  const known: OperatorLifecycleReason[] = [
    'accountPersisted',
    'lastKeyDelete',
    'logout',
    'destroy',
  ]
  return {
    version: 1,
    revision: Math.max(0, Math.floor(row.revision)),
    everHadAccounts: row.everHadAccounts,
    restoreSuppressed: row.restoreSuppressed,
    changedAt: row.changedAt,
    ...(typeof reason === 'string' &&
    known.includes(reason as OperatorLifecycleReason)
      ? { reason: reason as OperatorLifecycleReason }
      : {}),
  }
}

export function derivePanelLifecycle(
  record: OperatorLifecycleRecord | null,
  accountCount: number,
): PanelLifecycle {
  if (accountCount > 0) return 'active'
  if (record?.restoreSuppressed) return 'keysCleared'
  if (record?.everHadAccounts) return 'keysCleared'
  return 'neverUsed'
}

export function nextLifecycleOnPersist(
  previous: OperatorLifecycleRecord | null,
  now: number,
): OperatorLifecycleRecord {
  return {
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    everHadAccounts: true,
    restoreSuppressed: false,
    changedAt: now,
    reason: 'accountPersisted',
  }
}

export function nextLifecycleOnClear(
  previous: OperatorLifecycleRecord | null,
  now: number,
  reason: Exclude<OperatorLifecycleReason, 'accountPersisted'>,
): OperatorLifecycleRecord {
  return {
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    everHadAccounts: true,
    restoreSuppressed: true,
    changedAt: now,
    reason,
  }
}
