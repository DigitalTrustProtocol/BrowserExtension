import { boundTwitterIdsOf } from '../../../accounts/x-binding.ts'
import { truncateNpub } from '@shared/format/text.ts'
import { t } from '@lib/i18n.js'
import {
  accountIsReadOnly,
  formatKeyTitle,
} from '../../../accounts/key-title.ts'

export type BindingLabelAccount = {
  id: string
  pubkey: string
  name?: string
  readOnly?: boolean
  type?: string
  boundTwitterIds?: readonly string[] | null
  boundTwitterId?: string | null
}

export type BindingLabelRow = {
  twitterId: string
  handle?: string
  displayName?: string
  accountId?: string
}

function formatHandle(handle: string | undefined): string | undefined {
  const trimmed = handle?.trim().replace(/^@+/u, '')
  return trimmed ? `@${trimmed}` : undefined
}

export function boundHandlesForAccount(
  account: BindingLabelAccount,
  rows: readonly BindingLabelRow[],
): string[] {
  const ids = boundTwitterIdsOf(account)
  const labels: string[] = []
  for (const id of ids) {
    const row = rows.find((r) => r.twitterId === id)
    const handle = formatHandle(row?.handle)
    labels.push(handle ?? id)
  }
  return labels
}

/** Dropdown option: local key title, plus already-bound X handles when any. */
export function nostrBindingOptionLabel(
  account: BindingLabelAccount,
  rows: readonly BindingLabelRow[],
): string {
  const title = formatKeyTitle(
    account.name,
    accountIsReadOnly(account),
    t('settings.keyReadOnlySuffix'),
    truncateNpub(account.pubkey),
  )
  const handles = boundHandlesForAccount(account, rows)
  if (handles.length === 0) return title
  return `${title} · ${handles.join(', ')}`
}
