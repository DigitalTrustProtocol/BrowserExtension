/**
 * Public Admin key-scenario fixture constants and handle gate.
 * Apply logic stays in the worker (`vault/admin-key-scenarios.ts`) so cockpit
 * can import this module without bundling vault secrets handling.
 *
 * @module shared/admin-key-scenarios
 */

import { normalizeObservedHandle } from './observed-x-identity.ts'
import type { PanelLifecycle } from './operator-lifecycle.ts'

/** Signed-in X handle that may see / call Admin key scenarios. */
export const ADMIN_KEY_SCENARIO_HANDLE = 'trustprotocol'

/** Public test seed — not a real operator key. */
export const ADMIN_TEST_MNEMONIC =
  'put negative polar talent lazy fantasy describe perfect scrap situate earth inform'

/** Password for the locked-vault fixture. */
export const ADMIN_TEST_VAULT_PASSWORD = 'password12'

/** Fixed twitter id used for the after-delete Sync tombstone. */
export const ADMIN_DELETED_TOMBSTONE_TWITTER_ID = '22551796'

export const KEY_SCENARIO_IDS = [
  'firstRun',
  'afterDelete',
  'oneKeyBound',
  'oneKeyUnbound',
  'lockedVault',
  'twoKeys',
] as const

export type KeyScenarioId = (typeof KEY_SCENARIO_IDS)[number]

export interface KeyScenarioStatus {
  lifecycle: PanelLifecycle
  accountCount: number
  vaultExists: boolean
  vaultLocked: boolean
  neverLock: boolean
  boundTwitterIds: string[]
  activeAccountId: string | null
}

export function isKeyScenarioId(value: unknown): value is KeyScenarioId {
  return (
    typeof value === 'string' &&
    (KEY_SCENARIO_IDS as readonly string[]).includes(value)
  )
}

export function isAdminKeyScenarioOperator(
  handle: string | undefined | null,
): boolean {
  if (!handle) return false
  return normalizeObservedHandle(handle) === ADMIN_KEY_SCENARIO_HANDLE
}

export function assertAdminKeyScenarioOperator(
  handle: string | undefined | null,
): void {
  if (!isAdminKeyScenarioOperator(handle)) {
    throw new Error(
      'Admin key scenarios are only available for @TrustProtocol',
    )
  }
}
