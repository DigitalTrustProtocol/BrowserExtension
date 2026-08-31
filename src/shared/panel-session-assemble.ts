/**
 * Pure assembly of panel-session facts from already-loaded storage blobs.
 * Chrome / vault I/O stays in the controller.
 *
 * @module shared/panel-session-assemble
 */

import { boundTwitterIdsOf } from '../accounts/x-binding.ts'
import type { FocusedProductTab } from './focused-product-tab.ts'
import type { ActiveXTabObservation } from './active-x-session.ts'
import {
  derivePanelLifecycle,
  operatorLifecycleFromUnknown,
} from './operator-lifecycle.ts'
import {
  WIZARD_RESUME_MAX_AGE_MS,
  atCapFromAccounts,
  buildPanelSnapshot,
  classifyBinding,
  classifyIntegrity,
  classifyVault,
  emptyIntent,
  type BindingAccountInput,
  type PanelBindingState,
  type PanelIntent,
  type PanelSessionFacts,
  type PanelSessionSnapshot,
  type PanelSiteState,
  type PanelXState,
} from './panel-session.ts'
import { shouldOneTimeAutoConnectXHost } from './x-host-autoconnect.ts'
import type { SelectedSubject } from './selected-subject.ts'

export function bindingAccountsFromUnknown(
  value: unknown,
): BindingAccountInput[] {
  if (!Array.isArray(value)) return []
  const out: BindingAccountInput[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    if (typeof rec.id !== 'string' || !rec.id) continue
    if (typeof rec.pubkey !== 'string' || !rec.pubkey) continue
    const ids = boundTwitterIdsOf({
      boundTwitterIds: Array.isArray(rec.boundTwitterIds)
        ? rec.boundTwitterIds.filter((id): id is string => typeof id === 'string')
        : undefined,
      boundTwitterId:
        typeof rec.boundTwitterId === 'string' ? rec.boundTwitterId : null,
    })
    out.push({
      id: rec.id,
      pubkey: rec.pubkey,
      boundTwitterIds: ids,
      boundTwitterId: ids[0] ?? null,
      readOnly: rec.readOnly === true,
    })
  }
  return out
}

export function parseWizardResumable(value: unknown, now: number): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (typeof row.step !== 'string' || !row.step) return false
  if (typeof row.ts !== 'number' || !Number.isFinite(row.ts)) return false
  return now - row.ts >= 0 && now - row.ts < WIZARD_RESUME_MAX_AGE_MS
}

export function countSignerPending(value: unknown): {
  pendingApprovalCount: number
  pendingUnlockCount: number
} {
  if (!Array.isArray(value)) {
    return { pendingApprovalCount: 0, pendingUnlockCount: 0 }
  }
  let pendingApprovalCount = 0
  let pendingUnlockCount = 0
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    if ((item as { waitingForUnlock?: unknown }).waitingForUnlock === true) {
      pendingUnlockCount += 1
    } else {
      pendingApprovalCount += 1
    }
  }
  return { pendingApprovalCount, pendingUnlockCount }
}

export function syncPubkeyForTwitterId(
  bindingsRaw: unknown,
  twitterId: string,
): string | null {
  if (!bindingsRaw || typeof bindingsRaw !== 'object') return null
  const byTwitterId = (bindingsRaw as { byTwitterId?: unknown }).byTwitterId
  if (!byTwitterId || typeof byTwitterId !== 'object') return null
  const row = (byTwitterId as Record<string, unknown>)[twitterId]
  if (!row || typeof row !== 'object') return null
  const pubkey = (row as { pubkey?: unknown }).pubkey
  if (typeof pubkey !== 'string') return null
  const trimmed = pubkey.trim().toLowerCase()
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null
}

export function classifySiteFromFocused(input: {
  focused: FocusedProductTab
  allowedDomains: readonly string[]
  autoConnectDone: boolean
}): { site: PanelSiteState; autoConnectWouldGrant: boolean } {
  if (input.focused.kind === 'none') {
    return { site: { kind: 'unavailable' }, autoConnectWouldGrant: false }
  }
  const { tabId, windowId, url, domain, isX } = input.focused
  const autoConnectWouldGrant = shouldOneTimeAutoConnectXHost(
    domain,
    input.allowedDomains,
    input.autoConnectDone,
  )
  const connected =
    input.allowedDomains.includes(domain) || autoConnectWouldGrant
  const site: PanelSiteState = connected
    ? { kind: 'connected', tabId, windowId, url, domain, isX }
    : { kind: 'disconnected', tabId, windowId, url, domain, isX }
  return { site, autoConnectWouldGrant }
}

export function classifyXFromFocused(input: {
  focused: FocusedProductTab
  observation: ActiveXTabObservation | undefined
}): PanelXState {
  if (input.focused.kind !== 'ok' || !input.focused.isX) {
    return { kind: 'notApplicable' }
  }
  const tabId = input.focused.tabId
  const observation = input.observation
  if (!observation || observation.status === 'unknown') {
    return { kind: 'unknown', tabId }
  }
  if (observation.status === 'loggedOut') {
    return { kind: 'loggedOut', tabId }
  }
  const twitterId = observation.account?.twitterId
  if (!twitterId) return { kind: 'unknown', tabId }
  return {
    kind: 'identified',
    tabId,
    twitterId,
    ...(observation.account?.handle
      ? { handle: observation.account.handle }
      : {}),
  }
}

export interface AssemblePanelSessionInput {
  storageFailed?: boolean
  vaultExists: boolean
  vaultLocked: boolean
  neverLock: boolean
  accounts: ReadonlyArray<BindingAccountInput>
  activeAccountId?: string | null
  lifecycleRaw: unknown
  focused: FocusedProductTab
  allowedDomains: readonly string[]
  autoConnectDone: boolean
  xObservation: ActiveXTabObservation | undefined
  syncBindingsRaw: unknown
  notesRequested: boolean
  selected: SelectedSubject | null
  canBack: boolean
  canForward: boolean
  wizardState: unknown
  signerPending: unknown
  now: number
}

export function assemblePanelSessionFacts(
  input: AssemblePanelSessionInput,
): PanelSessionFacts {
  const accounts = [...input.accounts]
  const vault = classifyVault({
    vaultExists: input.vaultExists,
    locked: input.vaultLocked,
    neverLock: input.neverLock,
    accountCount: accounts.length,
    activeAccountId: input.activeAccountId,
  })
  const lifecycle = derivePanelLifecycle(
    operatorLifecycleFromUnknown(input.lifecycleRaw),
    accounts.length,
  )
  const { site } = classifySiteFromFocused({
    focused: input.focused,
    allowedDomains: input.allowedDomains,
    autoConnectDone: input.autoConnectDone,
  })
  const x = classifyXFromFocused({
    focused: input.focused,
    observation: input.xObservation,
  })
  const twitterId = x.kind === 'identified' ? x.twitterId : null
  const binding: PanelBindingState = classifyBinding({
    twitterId,
    localAccounts: accounts,
    syncPubkey: twitterId
      ? syncPubkeyForTwitterId(input.syncBindingsRaw, twitterId)
      : null,
  })
  const integrity = classifyIntegrity({
    vaultExists: input.vaultExists,
    vaultLocked: input.vaultLocked,
    accounts,
    activeAccountId: input.activeAccountId,
    binding,
    storageFailed: input.storageFailed === true,
  })
  const pending = countSignerPending(input.signerPending)
  const intent: PanelIntent = {
    ...emptyIntent(),
    notesRequested: input.notesRequested,
    selected: input.selected,
    canBack: input.canBack === true,
    canForward: input.canForward === true,
    resumableFirstRunWizard:
      lifecycle === 'neverUsed' &&
      parseWizardResumable(input.wizardState, input.now),
    pendingApprovalCount: pending.pendingApprovalCount,
    pendingUnlockCount: pending.pendingUnlockCount,
  }
  return {
    integrity,
    vault,
    lifecycle,
    site,
    x,
    binding,
    intent,
    atCap: atCapFromAccounts(accounts),
  }
}

export function assemblePanelSnapshot(
  input: AssemblePanelSessionInput,
  revision: number,
): PanelSessionSnapshot {
  return buildPanelSnapshot(assemblePanelSessionFacts(input), revision, input.now)
}
