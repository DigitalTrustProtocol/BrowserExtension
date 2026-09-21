/**
 * Operator binding completeness: Bio and kind 10011 are independent.
 * Bio is a public npub hint; 10011 is the signed claim that this key
 * controls the X account. Overall `complete` still wants both plus backup.
 * Derived from xIdentities + local 10011 — not kind 0 or vault stamps.
 */

export type Kind0CompareResult = 'missing' | 'mismatch' | 'match'

export type BindingMissingIssue = 'unbound' | 'bio' | 'nip39' | 'backup'

export interface Kind0MetadataLike {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  nip05?: string
  lud16?: string
  website?: string
  banner?: string
}

export interface OperatorBindingCompleteness {
  bound: boolean
  bioOk: boolean
  bioMismatch: boolean
  nip39Ok: boolean
  backupOk: boolean
  complete: boolean
}

function trim(value: string | undefined): string {
  return value?.trim() ?? ''
}

export function normalizeBindingNpub(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim().toLowerCase()
  return trimmed?.startsWith('npub1') ? trimmed : undefined
}

export function npubsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeBindingNpub(a)
  const right = normalizeBindingNpub(b)
  return Boolean(left && right && left === right)
}

/**
 * Kind 0 vs this X user's chrome. Missing kind 0 is not a match.
 */
export function compareKind0ToX(
  kind0: Kind0MetadataLike | null | undefined,
  x: { name?: string; picture?: string; banner?: string },
): Kind0CompareResult {
  const hasKind0 = Boolean(
    kind0 &&
      (trim(kind0.name) ||
        trim(kind0.display_name) ||
        trim(kind0.picture) ||
        trim(kind0.banner) ||
        trim(kind0.about) ||
        trim(kind0.nip05) ||
        trim(kind0.lud16) ||
        trim(kind0.website)),
  )
  if (!hasKind0) return 'missing'
  const name = trim(kind0?.name) || trim(kind0?.display_name)
  const xName = trim(x.name)
  if (xName && name !== xName) return 'mismatch'
  const xPicture = trim(x.picture)
  if (xPicture && trim(kind0?.picture) !== xPicture) return 'mismatch'
  const xBanner = trim(x.banner)
  if (xBanner && trim(kind0?.banner) !== xBanner) return 'mismatch'
  return 'match'
}

export function resolveOperatorBindingCompleteness(input: {
  bound: boolean
  boundNpub?: string | null
  xNpub?: string | null
  nip39Npub?: string | null
  current10011ClaimsTwitterId?: boolean
  backupOk?: boolean
}): OperatorBindingCompleteness {
  const boundNpub = normalizeBindingNpub(input.boundNpub)
  const xNpub = normalizeBindingNpub(input.xNpub)
  const nip39Npub = normalizeBindingNpub(input.nip39Npub)
  const bioOk = Boolean(input.bound && boundNpub && npubsEqual(xNpub, boundNpub))
  const bioMismatch = Boolean(
    input.bound && xNpub && boundNpub && xNpub !== boundNpub,
  )
  const nip39Ok = Boolean(
    input.bound &&
      boundNpub &&
      (npubsEqual(nip39Npub, boundNpub) ||
        input.current10011ClaimsTwitterId === true),
  )
  const backupOk = input.backupOk === true
  return {
    bound: input.bound,
    bioOk,
    bioMismatch,
    nip39Ok,
    backupOk,
    complete: Boolean(input.bound && bioOk && nip39Ok && backupOk),
  }
}

export function liveSetupIssues(
  status: OperatorBindingCompleteness,
): BindingMissingIssue[] {
  if (!status.bound) return ['unbound']
  const missing: BindingMissingIssue[] = []
  if (!status.backupOk) missing.push('backup')
  if (!status.bioOk) missing.push('bio')
  if (!status.nip39Ok) missing.push('nip39')
  return missing
}

export const UNBOUND_COMPLETENESS: OperatorBindingCompleteness = {
  bound: false,
  bioOk: false,
  bioMismatch: false,
  nip39Ok: false,
  backupOk: false,
  complete: false,
}

export const MASTER_BACKUP_DONE_KEY = 'attentionxMasterBackupDone' as const
