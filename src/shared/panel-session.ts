/**
 * Panel session contract: facts, binding/integrity classifiers, and the pure
 * route selector. The service-worker controller owns transitions; this module
 * has no Chrome or React dependencies.
 *
 * @module shared/panel-session
 */

import {
  MAX_BOUND_X_ACCOUNTS,
  boundTwitterIdsOf,
  countBoundAccounts,
  findAccountByPubkey,
  normalizeBoundTwitterId,
  type BindingAccountShape,
} from '../accounts/x-binding.ts'
import {
  DEFAULT_APP_MODE,
  parseAppMode,
  type AppMode,
} from './app-mode.ts'
import type { PanelLifecycle } from './operator-lifecycle.ts'
import {
  isSelectedSubject,
  type SelectedSubject,
} from './selected-subject.ts'

export type { PanelLifecycle } from './operator-lifecycle.ts'

export const PANEL_SESSION_SNAPSHOT_KEY = 'attentionxPanelSession'
export const PANEL_SESSION_CHANGED_MESSAGE = 'PANEL_SESSION_CHANGED' as const
export const WIZARD_SESSION_KEY = 'wizardState'
export const WIZARD_RESUME_MAX_AGE_MS = 5 * 60 * 1000
/** Set after JustWorks provision of the first account; cleared on Demo/Live confirm. */
export const JUST_WORKS_DEMO_PENDING_KEY = 'attentionxJustWorksDemoPending'
/** Set when JustWorks provision fails so the route can fall back to firstRun. */
export const JUST_WORKS_FAILED_KEY = 'attentionxJustWorksFailed'

export type PanelIntegrity =
  | 'ok'
  | 'repairing'
  | 'inconsistent'
  | 'unavailable'

export type PanelVaultState =
  | { kind: 'absent' }
  | { kind: 'starting'; neverLock: boolean; accountCount: number; activeAccountId?: string }
  | { kind: 'locked'; neverLock: boolean; accountCount: number; activeAccountId?: string }
  | { kind: 'ready'; neverLock: boolean; accountCount: number; activeAccountId?: string }

export type PanelSiteState =
  | { kind: 'unavailable' }
  | {
      kind: 'error'
      tabId?: number
      windowId?: number
      url?: string
      domain?: string
      isX: boolean
    }
  | {
      kind: 'disconnected'
      tabId: number
      windowId: number
      url: string
      domain: string
      isX: boolean
    }
  | {
      kind: 'connected'
      tabId: number
      windowId: number
      url: string
      domain: string
      isX: boolean
    }

export type PanelXState =
  | { kind: 'notApplicable' }
  | { kind: 'unknown'; tabId: number }
  | { kind: 'loggedOut'; tabId: number }
  | {
      kind: 'identified'
      tabId: number
      twitterId: string
      handle?: string
    }

export type PanelBindingState =
  | { kind: 'notApplicable' }
  | { kind: 'unbound'; twitterId: string }
  | {
      kind: 'localBound'
      twitterId: string
      accountId: string
      pubkey: string
    }
  | { kind: 'remoteOnly'; twitterId: string; pubkey: string }
  | { kind: 'inconsistent'; twitterId: string; reason: string }

export interface PanelIntent {
  notesRequested: boolean
  /** Selected Notes user/post, when known. */
  selected: SelectedSubject | null
  canBack: boolean
  canForward: boolean
  resumableFirstRunWizard: boolean
  pendingApprovalCount: number
  pendingUnlockCount: number
}

export type PanelRoute =
  | 'integrity'
  | 'unlock'
  | 'justWorks'
  | 'demoChoice'
  | 'firstRun'
  | 'afterKeyClear'
  | 'noSite'
  | 'siteDisconnected'
  | 'offXHome'
  | 'xUnknown'
  | 'xLoggedOut'
  | 'xUnbound'
  | 'xHome'

export interface PanelSessionFacts {
  integrity: PanelIntegrity
  vault: PanelVaultState
  lifecycle: PanelLifecycle
  site: PanelSiteState
  x: PanelXState
  binding: PanelBindingState
  intent: PanelIntent
  atCap: boolean
  justWorksDemoPending: boolean
  justWorksFailed: boolean
  appMode: AppMode
}

export interface PanelSessionSnapshot extends PanelSessionFacts {
  revision: number
  assembledAt: number
  route: PanelRoute
}

export interface BindingAccountInput extends BindingAccountShape {
  id: string
  pubkey: string
  readOnly?: boolean
}

export function vaultAccountCount(vault: PanelVaultState): number {
  if (vault.kind === 'absent') return 0
  return vault.accountCount
}

export function classifyVault(input: {
  vaultExists: boolean
  locked: boolean
  neverLock: boolean
  accountCount: number
  activeAccountId?: string | null
}): PanelVaultState {
  const active =
    typeof input.activeAccountId === 'string' && input.activeAccountId
      ? { activeAccountId: input.activeAccountId }
      : {}
  if (!input.vaultExists) {
    if (input.accountCount > 0) {
      return {
        kind: 'ready',
        neverLock: false,
        accountCount: input.accountCount,
        ...active,
      }
    }
    return { kind: 'absent' }
  }
  if (input.locked && input.neverLock) {
    return {
      kind: 'starting',
      neverLock: true,
      accountCount: input.accountCount,
      ...active,
    }
  }
  if (input.locked) {
    return {
      kind: 'locked',
      neverLock: false,
      accountCount: input.accountCount,
      ...active,
    }
  }
  return {
    kind: 'ready',
    neverLock: input.neverLock,
    accountCount: input.accountCount,
    ...active,
  }
}

export function classifyBinding(input: {
  twitterId: string | null
  localAccounts: ReadonlyArray<BindingAccountInput>
  syncPubkey?: string | null
}): PanelBindingState {
  const twitterId = normalizeBoundTwitterId(input.twitterId)
  if (!twitterId) return { kind: 'notApplicable' }

  const locals = input.localAccounts.filter((account) =>
    boundTwitterIdsOf(account).includes(twitterId),
  )
  if (locals.length > 1) {
    return {
      kind: 'inconsistent',
      twitterId,
      reason: 'duplicate-local-binding',
    }
  }
  const syncPubkey =
    typeof input.syncPubkey === 'string' &&
    /^[0-9a-f]{64}$/i.test(input.syncPubkey.trim())
      ? input.syncPubkey.trim().toLowerCase()
      : null

  if (locals.length === 1) {
    const local = locals[0]
    const localPub = local.pubkey.trim().toLowerCase()
    if (syncPubkey && syncPubkey !== localPub) {
      return {
        kind: 'inconsistent',
        twitterId,
        reason: 'local-sync-pubkey-mismatch',
      }
    }
    return {
      kind: 'localBound',
      twitterId,
      accountId: local.id,
      pubkey: local.pubkey,
    }
  }

  if (syncPubkey) {
    const byPub = findAccountByPubkey(
      input.localAccounts.map((account) => ({
        id: account.id,
        pubkey: account.pubkey,
        boundTwitterIds: boundTwitterIdsOf(account),
        boundTwitterId: null,
        boundUpdatedAt: null,
        readOnly: account.readOnly === true,
      })),
      syncPubkey,
    )
    if (byPub) {
      // Same pubkey locally, not yet bound to this X: wipe+reimport leftover
      // Sync, persist-before-bind lag, or 1 Nostr → N X. Not vault corruption.
      return { kind: 'unbound', twitterId }
    }
    return { kind: 'remoteOnly', twitterId, pubkey: syncPubkey }
  }
  return { kind: 'unbound', twitterId }
}

export function classifyIntegrity(input: {
  vaultExists: boolean
  vaultLocked: boolean
  accounts: ReadonlyArray<BindingAccountInput>
  activeAccountId?: string | null
  binding: PanelBindingState
  storageFailed?: boolean
}): PanelIntegrity {
  if (input.storageFailed) return 'unavailable'
  if (input.binding.kind === 'inconsistent') return 'inconsistent'

  const writableWithoutVault = !input.vaultExists &&
    input.accounts.some((account) => account.readOnly !== true)
  if (writableWithoutVault) return 'inconsistent'

  const activeId = input.activeAccountId
  if (
    typeof activeId === 'string' &&
    activeId.length > 0 &&
    input.accounts.length > 0 &&
    !input.accounts.some((account) => account.id === activeId)
  ) {
    return 'repairing'
  }

  if (
    input.vaultExists &&
    !input.vaultLocked &&
    input.accounts.length === 0
  ) {
    return 'repairing'
  }
  return 'ok'
}

export function atCapFromAccounts(
  accounts: ReadonlyArray<BindingAccountShape>,
): boolean {
  return countBoundAccounts(accounts) >= MAX_BOUND_X_ACCOUNTS
}

export function isNewerRevision(
  incoming: number,
  current: number,
): boolean {
  return incoming > current
}

/**
 * First match wins. Priority: integrity → timed unlock → afterKeyClear →
 * justWorks → firstRun fallback → demoChoice → site → X session/binding.
 */
export function resolvePanelRoute(facts: PanelSessionFacts): PanelRoute {
  if (facts.integrity !== 'ok') return 'integrity'

  if (facts.vault.kind === 'locked' && !facts.vault.neverLock) {
    return 'unlock'
  }

  const accounts = vaultAccountCount(facts.vault)
  if (accounts === 0) {
    if (facts.lifecycle === 'keysCleared') return 'afterKeyClear'
    if (facts.justWorksFailed) return 'firstRun'
    return 'justWorks'
  }

  if (facts.justWorksDemoPending) return 'demoChoice'

  switch (facts.site.kind) {
    case 'unavailable':
    case 'error':
      return 'noSite'
    case 'disconnected':
      return 'siteDisconnected'
    case 'connected':
      if (!facts.site.isX) return 'offXHome'
      break
    default: {
      const _exhaustive: never = facts.site
      return _exhaustive
    }
  }

  switch (facts.x.kind) {
    case 'notApplicable':
      return 'offXHome'
    case 'unknown':
      return 'xUnknown'
    case 'loggedOut':
      return 'xLoggedOut'
    case 'identified':
      break
    default: {
      const _exhaustive: never = facts.x
      return _exhaustive
    }
  }

  switch (facts.binding.kind) {
    case 'localBound':
      return 'xHome'
    case 'unbound':
      if (facts.lifecycle !== 'keysCleared') return 'justWorks'
      return 'xUnbound'
    case 'remoteOnly':
      return 'xUnbound'
    case 'inconsistent':
      return 'integrity'
    case 'notApplicable':
      return 'offXHome'
    default: {
      const _exhaustive: never = facts.binding
      return _exhaustive
    }
  }
}

/** Routes that may show Notes once session gates (unlock / first-run / bind) clear. */
export function isPanelNotesReadyRoute(route: PanelRoute): boolean {
  switch (route) {
    case 'xHome':
    case 'offXHome':
    case 'noSite':
    case 'siteDisconnected':
      return true
    case 'integrity':
    case 'unlock':
    case 'justWorks':
    case 'demoChoice':
    case 'firstRun':
    case 'afterKeyClear':
    case 'xUnknown':
    case 'xLoggedOut':
    case 'xUnbound':
      return false
    default: {
      const _exhaustive: never = route
      return _exhaustive
    }
  }
}

/** Notes body after gates: requested, and either a selected subject or URL fallback. */
export function panelNotesBodyVisible(snapshot: {
  route: PanelRoute
  intent: PanelIntent
}): boolean {
  return snapshot.intent.notesRequested && isPanelNotesReadyRoute(snapshot.route)
}

export function buildPanelSnapshot(
  facts: PanelSessionFacts,
  revision: number,
  assembledAt: number,
): PanelSessionSnapshot {
  return {
    ...facts,
    revision,
    assembledAt,
    route: resolvePanelRoute(facts),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function parseIntent(value: unknown): PanelIntent | null {
  if (!isRecord(value)) return null
  if (typeof value.notesRequested !== 'boolean') return null
  if (typeof value.resumableFirstRunWizard !== 'boolean') return null
  if (
    typeof value.pendingApprovalCount !== 'number' ||
    !Number.isFinite(value.pendingApprovalCount)
  ) {
    return null
  }
  if (
    typeof value.pendingUnlockCount !== 'number' ||
    !Number.isFinite(value.pendingUnlockCount)
  ) {
    return null
  }
  return {
    notesRequested: value.notesRequested,
    selected: isSelectedSubject(value.selected) ? value.selected : null,
    canBack: value.canBack === true,
    canForward: value.canForward === true,
    resumableFirstRunWizard: value.resumableFirstRunWizard,
    pendingApprovalCount: Math.max(0, Math.floor(value.pendingApprovalCount)),
    pendingUnlockCount: Math.max(0, Math.floor(value.pendingUnlockCount)),
  }
}

const ROUTES: ReadonlySet<PanelRoute> = new Set([
  'integrity',
  'unlock',
  'justWorks',
  'demoChoice',
  'firstRun',
  'afterKeyClear',
  'noSite',
  'siteDisconnected',
  'offXHome',
  'xUnknown',
  'xLoggedOut',
  'xUnbound',
  'xHome',
])

export function panelSessionSnapshotFromUnknown(
  value: unknown,
): PanelSessionSnapshot | null {
  if (!isRecord(value)) return null
  if (typeof value.revision !== 'number' || !Number.isFinite(value.revision)) {
    return null
  }
  if (
    typeof value.assembledAt !== 'number' ||
    !Number.isFinite(value.assembledAt)
  ) {
    return null
  }
  if (typeof value.route !== 'string' || !ROUTES.has(value.route as PanelRoute)) {
    return null
  }
  const integrity = value.integrity
  if (
    integrity !== 'ok' &&
    integrity !== 'repairing' &&
    integrity !== 'inconsistent' &&
    integrity !== 'unavailable'
  ) {
    return null
  }
  const lifecycle = value.lifecycle
  if (
    lifecycle !== 'neverUsed' &&
    lifecycle !== 'active' &&
    lifecycle !== 'keysCleared'
  ) {
    return null
  }
  const vault = parseVault(value.vault)
  const site = parseSite(value.site)
  const x = parseX(value.x)
  const binding = parseBinding(value.binding)
  const intent = parseIntent(value.intent)
  if (!vault || !site || !x || !binding || !intent) return null
  if (typeof value.atCap !== 'boolean') return null
  return {
    integrity,
    vault,
    lifecycle,
    site,
    x,
    binding,
    intent,
    atCap: value.atCap,
    justWorksDemoPending: value.justWorksDemoPending === true,
    justWorksFailed: value.justWorksFailed === true,
    appMode: parseAppMode(value.appMode),
    revision: Math.max(0, Math.floor(value.revision)),
    assembledAt: value.assembledAt,
    route: value.route as PanelRoute,
  }
}

function parseVault(value: unknown): PanelVaultState | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'absent') return { kind: 'absent' }
  if (
    value.kind !== 'starting' &&
    value.kind !== 'locked' &&
    value.kind !== 'ready'
  ) {
    return null
  }
  if (typeof value.neverLock !== 'boolean') return null
  if (typeof value.accountCount !== 'number' || !Number.isFinite(value.accountCount)) {
    return null
  }
  const active =
    typeof value.activeAccountId === 'string'
      ? { activeAccountId: value.activeAccountId }
      : {}
  return {
    kind: value.kind,
    neverLock: value.neverLock,
    accountCount: Math.max(0, Math.floor(value.accountCount)),
    ...active,
  }
}

function parseSite(value: unknown): PanelSiteState | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'unavailable') return { kind: 'unavailable' }
  if (value.kind === 'error') {
    return {
      kind: 'error',
      isX: value.isX === true,
      ...(typeof value.tabId === 'number' ? { tabId: value.tabId } : {}),
      ...(typeof value.windowId === 'number' ? { windowId: value.windowId } : {}),
      ...(typeof value.url === 'string' ? { url: value.url } : {}),
      ...(typeof value.domain === 'string' ? { domain: value.domain } : {}),
    }
  }
  if (value.kind !== 'disconnected' && value.kind !== 'connected') return null
  if (typeof value.tabId !== 'number' || !Number.isFinite(value.tabId)) {
    return null
  }
  if (typeof value.windowId !== 'number' || !Number.isFinite(value.windowId)) {
    return null
  }
  if (typeof value.url !== 'string' || typeof value.domain !== 'string') {
    return null
  }
  return {
    kind: value.kind,
    tabId: value.tabId,
    windowId: value.windowId,
    url: value.url,
    domain: value.domain,
    isX: value.isX === true,
  }
}

function parseX(value: unknown): PanelXState | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'notApplicable') return { kind: 'notApplicable' }
  if (value.kind === 'unknown' || value.kind === 'loggedOut') {
    if (typeof value.tabId !== 'number' || !Number.isFinite(value.tabId)) {
      return null
    }
    return { kind: value.kind, tabId: value.tabId }
  }
  if (value.kind !== 'identified') return null
  if (typeof value.tabId !== 'number' || !Number.isFinite(value.tabId)) {
    return null
  }
  const twitterId = normalizeBoundTwitterId(
    typeof value.twitterId === 'string' ? value.twitterId : null,
  )
  if (!twitterId) return null
  return {
    kind: 'identified',
    tabId: value.tabId,
    twitterId,
    ...(typeof value.handle === 'string' ? { handle: value.handle } : {}),
  }
}

function parseBinding(value: unknown): PanelBindingState | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'notApplicable') return { kind: 'notApplicable' }
  const twitterId = normalizeBoundTwitterId(
    typeof value.twitterId === 'string' ? value.twitterId : null,
  )
  if (!twitterId) return null
  if (value.kind === 'unbound') return { kind: 'unbound', twitterId }
  if (value.kind === 'remoteOnly') {
    if (typeof value.pubkey !== 'string') return null
    return { kind: 'remoteOnly', twitterId, pubkey: value.pubkey }
  }
  if (value.kind === 'inconsistent') {
    if (typeof value.reason !== 'string') return null
    return { kind: 'inconsistent', twitterId, reason: value.reason }
  }
  if (value.kind !== 'localBound') return null
  if (typeof value.accountId !== 'string' || typeof value.pubkey !== 'string') {
    return null
  }
  return {
    kind: 'localBound',
    twitterId,
    accountId: value.accountId,
    pubkey: value.pubkey,
  }
}

export function emptyIntent(): PanelIntent {
  return {
    notesRequested: false,
    selected: null,
    canBack: false,
    canForward: false,
    resumableFirstRunWizard: false,
    pendingApprovalCount: 0,
    pendingUnlockCount: 0,
  }
}

/** Client fallback when GET_PANEL_SESSION fails — hide splash, show integrity. */
export function unavailablePanelSnapshot(
  revision = 0,
  assembledAt = Date.now(),
): PanelSessionSnapshot {
  return buildPanelSnapshot(
    {
      integrity: 'unavailable',
      vault: { kind: 'absent' },
      lifecycle: 'neverUsed',
      site: { kind: 'unavailable' },
      x: { kind: 'notApplicable' },
      binding: { kind: 'notApplicable' },
      intent: emptyIntent(),
      atCap: false,
      justWorksDemoPending: false,
      justWorksFailed: false,
      appMode: DEFAULT_APP_MODE,
    },
    revision,
    assembledAt,
  )
}
