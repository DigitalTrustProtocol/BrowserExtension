/**
 * Canonical Nostr-key list order: first generated first.
 *
 * @module accounts/account-order
 */

import { defaultKeyTitleNumber } from './key-title.ts'

export type GenerationOrderAccount = {
  id: string
  name?: string | null
  createdAt?: number | null
  derivationIndex?: number | null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function compareOptionalAsc(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left == null || right == null) return undefined
  if (left === right) return 0
  return left - right
}

export function compareAccountsByGeneration(
  left: GenerationOrderAccount,
  right: GenerationOrderAccount,
): number {
  const named = compareOptionalAsc(
    defaultKeyTitleNumber(left.name),
    defaultKeyTitleNumber(right.name),
  )
  if (named) return named

  const created = compareOptionalAsc(
    finiteNumber(left.createdAt),
    finiteNumber(right.createdAt),
  )
  if (created) return created

  const derived = compareOptionalAsc(
    finiteNumber(left.derivationIndex),
    finiteNumber(right.derivationIndex),
  )
  if (derived) return derived

  return 0
}

/** Earliest-created first; stable when generation fields are missing. */
export function sortAccountsByGeneration<T extends GenerationOrderAccount>(
  accounts: readonly T[],
): T[] {
  return accounts
    .map((account, index) => ({ account, index }))
    .sort((left, right) => {
      const cmp = compareAccountsByGeneration(left.account, right.account)
      return cmp !== 0 ? cmp : left.index - right.index
    })
    .map((row) => row.account)
}
