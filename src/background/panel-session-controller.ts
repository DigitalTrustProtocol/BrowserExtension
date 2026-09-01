/**
 * Tab-scoped panel session machine. Fast GET_PANEL_SESSION path — storage and
 * cheap tab APIs only. Does not open IndexedDB or wait for backend startup.
 *
 * @module background/panel-session-controller
 */

import {
  OPERATOR_LIFECYCLE_KEY,
} from '../shared/operator-lifecycle.ts'
import {
  JUST_WORKS_DEMO_PENDING_KEY,
  JUST_WORKS_FAILED_KEY,
  PANEL_SESSION_CHANGED_MESSAGE,
  PANEL_SESSION_SNAPSHOT_KEY,
  WIZARD_SESSION_KEY,
  isNewerRevision,
  isPanelMessageOnlyRoute,
  panelSessionSnapshotFromUnknown,
  type PanelSessionSnapshot,
} from '../shared/panel-session.ts'
import {
  assemblePanelSnapshot,
  bindingAccountsFromUnknown,
} from '../shared/panel-session-assemble.ts'
import {
  ACTIVE_X_TAB_REGISTRY_KEY,
  bumpTabNavigationEpoch,
  observationForTab,
} from '../shared/active-x-session.ts'
import { APP_MODE_STORAGE_KEY, parseAppMode } from '../shared/app-mode.ts'
import { X_HOST_AUTO_CONNECT_DONE_KEY } from '../shared/x-host-autoconnect.ts'
import {
  OPEN_NOTES_ON_LAUNCH_KEY,
  SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
  SELECTED_SUBJECT_STORAGE_KEY,
  isSelectedSubject,
  isSelectedSubjectHistory,
  selectedSubjectHistoryFlags,
  type SelectedSubject,
} from '../shared/selected-subject.ts'
import { X_NOSTR_BINDINGS_KEY } from '../vault/x-nostr-bindings-sync.ts'
import { maybeOneTimeAutoConnectXHost } from '../nip07/bg/domain-handlers.ts'
import { setVaultLockListener } from '../vault/vault.ts'
import {
  clearCachedFocusedProductTab,
  hydrateFocusedProductTab,
} from './focused-tab-cache.ts'
import {
  loadActiveXTabRegistry,
  resetActiveXTabRegistryMemory,
  saveActiveXTabRegistry,
} from './active-x-tab-store.ts'
import type { FocusedProductTab } from '../shared/focused-product-tab.ts'

const KEY_VAULT = 'keyVault'
const ACCOUNTS = 'accounts'
const ACTIVE_ID = 'activeAccountId'
const AUTO_LOCK_MS = 'autoLockMs'
const ALLOWED_DOMAINS = 'allowedDomains'
const SIGNER_PENDING = 'signerPending'

const LOCAL_WATCH = new Set([
  ACCOUNTS,
  ACTIVE_ID,
  KEY_VAULT,
  AUTO_LOCK_MS,
  OPERATOR_LIFECYCLE_KEY,
  ALLOWED_DOMAINS,
  X_HOST_AUTO_CONNECT_DONE_KEY,
  APP_MODE_STORAGE_KEY,
])
const SESSION_WATCH = new Set([
  ACTIVE_X_TAB_REGISTRY_KEY,
  WIZARD_SESSION_KEY,
  SIGNER_PENDING,
  OPEN_NOTES_ON_LAUNCH_KEY,
  SELECTED_SUBJECT_STORAGE_KEY,
  SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
  JUST_WORKS_DEMO_PENDING_KEY,
  JUST_WORKS_FAILED_KEY,
])
const SYNC_WATCH = new Set([X_NOSTR_BINDINGS_KEY])

type VaultLockKnown = 'unknown' | boolean

let started = false
let vaultLocked: VaultLockKnown = 'unknown'
let snapshot: PanelSessionSnapshot | null = null
let revision = 0
let queue: Promise<void> = Promise.resolve()
let autoConnectInFlight: string | null = null
let ensureUnknownListener: (() => void | Promise<unknown>) | null = null
let ensureUnknownInFlight = false
let ensureUnknownAttemptedKey: string | null = null
let justWorksListener:
  | (() => Promise<{ ok: boolean; demoPending?: boolean; reason?: string }>)
  | null = null
let justWorksInFlight = false
let justWorksAttemptedKey: string | null = null
let runId = 0

/** Register before `startPanelSessionController()`. Never awaited on GET. */
export function setEnsureActiveXAccountListener(
  listener: (() => void | Promise<unknown>) | null,
): void {
  ensureUnknownListener = listener
}

/** Register JustWorks provision. Fire-and-forget after assemble; never on GET. */
export function setJustWorksProvisionListener(
  listener:
    | (() => Promise<{ ok: boolean; demoPending?: boolean; reason?: string }>)
    | null,
): void {
  justWorksListener = listener
}

function ensureUnknownKey(
  tabId: number,
  observation: { navigationEpoch: number } | undefined,
): string {
  return `${tabId}:${observation?.navigationEpoch ?? 0}`
}

function maybeKickEnsureUnknown(
  next: PanelSessionSnapshot,
  observation: { navigationEpoch: number } | undefined,
): void {
  const site = next.site
  const onX =
    (site.kind === 'connected' || site.kind === 'disconnected') && site.isX
  if (!onX || next.x.kind !== 'unknown') return
  const listener = ensureUnknownListener
  if (!listener) return
  const key = ensureUnknownKey(next.x.tabId, observation)
  if (ensureUnknownAttemptedKey === key) return
  if (ensureUnknownInFlight) return
  ensureUnknownAttemptedKey = key
  ensureUnknownInFlight = true
  let pending: unknown
  try {
    pending = listener()
  } catch {
    ensureUnknownInFlight = false
    return
  }
  void Promise.resolve(pending)
    .catch(() => undefined)
    .finally(() => {
      ensureUnknownInFlight = false
    })
}

function justWorksKickKey(next: PanelSessionSnapshot): string {
  const twitterId = next.x.kind === 'identified' ? next.x.twitterId : 'none'
  return `${twitterId}:${next.lifecycle}:${next.vault.kind}:${vaultAccountCountSafe(next)}`
}

function vaultAccountCountSafe(next: PanelSessionSnapshot): number {
  return next.vault.kind === 'absent' ? 0 : next.vault.accountCount
}

function maybeKickJustWorks(next: PanelSessionSnapshot): void {
  if (next.route !== 'justWorks') return
  if (next.vault.kind === 'locked') return
  const listener = justWorksListener
  if (!listener) return
  const key = justWorksKickKey(next)
  if (justWorksAttemptedKey === key) return
  if (justWorksInFlight) return
  justWorksAttemptedKey = key
  justWorksInFlight = true
  let pending: Promise<{ ok: boolean; demoPending?: boolean; reason?: string }>
  try {
    pending = listener()
  } catch {
    justWorksInFlight = false
    justWorksAttemptedKey = null
    return
  }
  void pending
    .then(async (result) => {
      if (!result.ok && result.reason === 'locked') {
        justWorksAttemptedKey = null
        return
      }
      try {
        if (result.ok && result.demoPending) {
          await chrome.storage.session.set({
            [JUST_WORKS_DEMO_PENDING_KEY]: true,
          })
          await chrome.storage.session.remove(JUST_WORKS_FAILED_KEY)
          return
        }
        if (!result.ok) {
          await chrome.storage.session.set({ [JUST_WORKS_FAILED_KEY]: true })
        }
      } catch {
        /* session unavailable */
      }
    })
    .catch(() => {
      justWorksAttemptedKey = null
      void chrome.storage.session
        .set({ [JUST_WORKS_FAILED_KEY]: true })
        .catch(() => undefined)
    })
    .finally(() => {
      justWorksInFlight = false
      requestPanelSessionRecompute()
    })
}

/** Forget a finished JustWorks kick so a later first-run wipe can mint again. */
export function resetJustWorksProvisionKick(): void {
  justWorksAttemptedKey = null
}

async function clearJustWorksSessionFlags(): Promise<void> {
  try {
    await chrome.storage.session.remove([
      JUST_WORKS_DEMO_PENDING_KEY,
      JUST_WORKS_FAILED_KEY,
    ])
  } catch {
    /* session unavailable */
  }
}

function enqueue(work: () => Promise<void>): Promise<void> {
  const run = queue.then(work, work)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

async function readLocalBundle(): Promise<{
  storageFailed: boolean
  vaultExists: boolean
  neverLock: boolean
  accountsRaw: unknown
  activeAccountId: string | null
  lifecycleRaw: unknown
  allowedDomains: string[]
  autoConnectDone: boolean
  appModeRaw: unknown
}> {
  try {
    const local = (await chrome.storage.local.get([
      KEY_VAULT,
      ACCOUNTS,
      ACTIVE_ID,
      AUTO_LOCK_MS,
      OPERATOR_LIFECYCLE_KEY,
      ALLOWED_DOMAINS,
      X_HOST_AUTO_CONNECT_DONE_KEY,
      APP_MODE_STORAGE_KEY,
    ])) as Record<string, unknown>
    const autoLockMs =
      typeof local[AUTO_LOCK_MS] === 'number' &&
      Number.isFinite(local[AUTO_LOCK_MS] as number)
        ? (local[AUTO_LOCK_MS] as number)
        : 900_000
    return {
      storageFailed: false,
      vaultExists: Boolean(local[KEY_VAULT]),
      neverLock: autoLockMs === 0,
      accountsRaw: local[ACCOUNTS],
      activeAccountId:
        typeof local[ACTIVE_ID] === 'string' ? (local[ACTIVE_ID] as string) : null,
      lifecycleRaw: local[OPERATOR_LIFECYCLE_KEY],
      allowedDomains: parseStringList(local[ALLOWED_DOMAINS]),
      autoConnectDone: local[X_HOST_AUTO_CONNECT_DONE_KEY] === true,
      appModeRaw: local[APP_MODE_STORAGE_KEY],
    }
  } catch {
    return {
      storageFailed: true,
      vaultExists: false,
      neverLock: false,
      accountsRaw: [],
      activeAccountId: null,
      lifecycleRaw: null,
      allowedDomains: [],
      autoConnectDone: false,
      appModeRaw: null,
    }
  }
}

async function readSessionBundle(): Promise<{
  notesRequested: boolean
  selected: SelectedSubject | null
  canBack: boolean
  canForward: boolean
  wizardState: unknown
  signerPending: unknown
  justWorksDemoPending: boolean
  justWorksFailed: boolean
}> {
  try {
    const session = (await chrome.storage.session.get([
      OPEN_NOTES_ON_LAUNCH_KEY,
      SELECTED_SUBJECT_STORAGE_KEY,
      SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
      WIZARD_SESSION_KEY,
      SIGNER_PENDING,
      JUST_WORKS_DEMO_PENDING_KEY,
      JUST_WORKS_FAILED_KEY,
    ])) as Record<string, unknown>
    const selected = isSelectedSubject(session[SELECTED_SUBJECT_STORAGE_KEY])
      ? session[SELECTED_SUBJECT_STORAGE_KEY]
      : null
    const flags = isSelectedSubjectHistory(
      session[SELECTED_SUBJECT_HISTORY_STORAGE_KEY],
    )
      ? selectedSubjectHistoryFlags(
          session[SELECTED_SUBJECT_HISTORY_STORAGE_KEY],
        )
      : { canBack: false, canForward: false }
    return {
      notesRequested: session[OPEN_NOTES_ON_LAUNCH_KEY] === true,
      selected,
      canBack: flags.canBack,
      canForward: flags.canForward,
      wizardState: session[WIZARD_SESSION_KEY],
      signerPending: session[SIGNER_PENDING],
      justWorksDemoPending: session[JUST_WORKS_DEMO_PENDING_KEY] === true,
      justWorksFailed: session[JUST_WORKS_FAILED_KEY] === true,
    }
  } catch {
    return {
      notesRequested: false,
      selected: null,
      canBack: false,
      canForward: false,
      wizardState: null,
      signerPending: [],
      justWorksDemoPending: false,
      justWorksFailed: false,
    }
  }
}

async function readSyncBindings(): Promise<unknown> {
  try {
    const sync = (await chrome.storage.sync.get(X_NOSTR_BINDINGS_KEY)) as Record<
      string,
      unknown
    >
    return sync[X_NOSTR_BINDINGS_KEY]
  } catch {
    return null
  }
}

function resolvedVaultLocked(vaultExists: boolean): boolean {
  if (vaultLocked !== 'unknown') return vaultLocked
  return vaultExists
}

/**
 * A newly opened X tab is `xUnknown` until ENSURE identifies it. Do not
 * unmount an already-mounted full panel for that gap — keep the last
 * broadcast snapshot. Cold start (nothing mounted, or the last broadcast
 * was itself a message-only route) still shows `xUnknown`.
 */
function shouldHoldUnknownSnapshot(next: PanelSessionSnapshot): boolean {
  if (next.route !== 'xUnknown') return false
  if (!snapshot) return false
  return !isPanelMessageOnlyRoute(snapshot.route)
}

async function persistAndBroadcast(next: PanelSessionSnapshot): Promise<void> {
  snapshot = next
  revision = next.revision
  try {
    await chrome.storage.session.set({ [PANEL_SESSION_SNAPSHOT_KEY]: next })
  } catch {
    /* session unavailable */
  }
  try {
    await chrome.runtime.sendMessage({
      type: PANEL_SESSION_CHANGED_MESSAGE,
      snapshot: next,
    })
  } catch {
    /* no popup / cockpit listener yet */
  }
}

async function recomputeNow(): Promise<PanelSessionSnapshot> {
  const myRun = runId
  const now = Date.now()
  const local = await readLocalBundle()
  const sessionBits = await readSessionBundle()
  const syncBindingsRaw = await readSyncBindings()
  const focused = await hydrateFocusedProductTab()
  const registry = await loadActiveXTabRegistry(now)
  const observation =
    focused.kind === 'ok' ? observationForTab(registry, focused.tabId) : undefined
  const accounts = bindingAccountsFromUnknown(local.accountsRaw)
  const nextRevision = revision + 1
  const next = assemblePanelSnapshot(
    {
      storageFailed: local.storageFailed,
      vaultExists: local.vaultExists,
      vaultLocked: resolvedVaultLocked(local.vaultExists),
      neverLock: local.neverLock,
      accounts,
      activeAccountId: local.activeAccountId,
      lifecycleRaw: local.lifecycleRaw,
      focused,
      allowedDomains: local.allowedDomains,
      autoConnectDone: local.autoConnectDone,
      xObservation: observation,
      syncBindingsRaw,
      notesRequested: sessionBits.notesRequested,
      selected: sessionBits.selected,
      canBack: sessionBits.canBack,
      canForward: sessionBits.canForward,
      wizardState: sessionBits.wizardState,
      signerPending: sessionBits.signerPending,
      justWorksDemoPending: sessionBits.justWorksDemoPending,
      justWorksFailed: sessionBits.justWorksFailed,
      appMode: parseAppMode(local.appModeRaw),
      now,
    },
    nextRevision,
  )
  if (myRun !== runId) {
    return snapshot ?? next
  }
  if (!shouldHoldUnknownSnapshot(next)) {
    await persistAndBroadcast(next)
  }
  maybeKickEnsureUnknown(next, observation)
  maybeKickJustWorks(next)
  if (
    next.site.kind === 'connected' &&
    next.site.isX &&
    !local.autoConnectDone &&
    !local.allowedDomains.includes(next.site.domain)
  ) {
    const domain = next.site.domain
    if (autoConnectInFlight !== domain) {
      autoConnectInFlight = domain
      void maybeOneTimeAutoConnectXHost(domain)
        .catch(() => false)
        .finally(() => {
          if (autoConnectInFlight === domain) autoConnectInFlight = null
        })
    }
  }
  return next
}

async function restorePersistedSnapshot(): Promise<PanelSessionSnapshot | null> {
  if (snapshot) return snapshot
  try {
    const stored = await chrome.storage.session.get(PANEL_SESSION_SNAPSHOT_KEY)
    const parsed = panelSessionSnapshotFromUnknown(
      stored[PANEL_SESSION_SNAPSHOT_KEY],
    )
    if (parsed) {
      snapshot = parsed
      revision = parsed.revision
      return parsed
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function getPanelSessionSnapshot(): Promise<PanelSessionSnapshot> {
  const cached = await restorePersistedSnapshot()
  if (cached) {
    void enqueue(async () => {
      await hydrateFocusedProductTab()
      await recomputeNow()
    })
    return cached
  }
  let result: PanelSessionSnapshot | null = null
  await enqueue(async () => {
    await hydrateFocusedProductTab()
    result = await recomputeNow()
  })
  if (result) return result
  return (
    snapshot ??
    (await recomputeNow())
  )
}

export function notifyPanelVaultLockChanged(locked: boolean): void {
  vaultLocked = locked
  void enqueue(async () => {
    await recomputeNow()
  })
}

export function requestPanelSessionRecompute(): void {
  void enqueue(async () => {
    await recomputeNow()
  })
}

/** Close Notes: clear the director flag; selected subject stays for history. */
export async function closePanelNotes(): Promise<{ closed: true }> {
  try {
    await chrome.storage.session.remove(OPEN_NOTES_ON_LAUNCH_KEY)
  } catch {
    /* session unavailable */
  }
  await enqueue(async () => {
    await recomputeNow()
  })
  return { closed: true }
}

async function onTabRemoved(tabId: number): Promise<void> {
  const now = Date.now()
  const registry = await loadActiveXTabRegistry(now)
  if (!(String(tabId) in registry.byTabId)) {
    await recomputeNow()
    return
  }
  const next = {
    version: 1 as const,
    byTabId: { ...registry.byTabId },
  }
  delete next.byTabId[String(tabId)]
  await saveActiveXTabRegistry(next)
  await recomputeNow()
}

async function onTabNavigated(tabId: number, windowId: number): Promise<void> {
  const now = Date.now()
  const registry = await loadActiveXTabRegistry(now)
  await saveActiveXTabRegistry(
    bumpTabNavigationEpoch(registry, tabId, windowId, now),
  )
  await hydrateFocusedProductTab()
  await recomputeNow()
}

function onStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): void {
  const keys = Object.keys(changes)
  if (
    area === 'local' &&
    OPERATOR_LIFECYCLE_KEY in changes &&
    changes[OPERATOR_LIFECYCLE_KEY]?.newValue === undefined
  ) {
    resetJustWorksProvisionKick()
    void clearJustWorksSessionFlags()
  }
  if (area === 'local' && keys.some((key) => LOCAL_WATCH.has(key))) {
    requestPanelSessionRecompute()
    return
  }
  if (area === 'session' && keys.some((key) => SESSION_WATCH.has(key))) {
    requestPanelSessionRecompute()
    return
  }
  if (area === 'sync' && keys.some((key) => SYNC_WATCH.has(key))) {
    requestPanelSessionRecompute()
  }
}

function onActivated(): void {
  void enqueue(async () => {
    await hydrateFocusedProductTab()
    await recomputeNow()
  })
}

function onUpdated(
  tabId: number,
  changeInfo: { url?: string; status?: string },
  tab: chrome.tabs.Tab,
): void {
  if (!changeInfo.url && changeInfo.status !== 'complete') return
  void enqueue(async () => {
    if (changeInfo.url && typeof tab.windowId === 'number') {
      await onTabNavigated(tabId, tab.windowId)
      return
    }
    await hydrateFocusedProductTab()
    await recomputeNow()
  })
}

function onFocusChanged(windowId: number): void {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  void enqueue(async () => {
    await hydrateFocusedProductTab()
    await recomputeNow()
  })
}

function onRemoved(tabId: number): void {
  void enqueue(async () => {
    await onTabRemoved(tabId)
  })
}

export function startPanelSessionController(): void {
  if (started) return
  started = true
  setVaultLockListener((locked) => {
    vaultLocked = locked
    requestPanelSessionRecompute()
  })
  chrome.storage.onChanged.addListener(onStorageChanged)
  chrome.tabs.onActivated.addListener(onActivated)
  chrome.tabs.onUpdated.addListener(onUpdated)
  chrome.tabs.onRemoved.addListener(onRemoved)
  chrome.windows.onFocusChanged.addListener(onFocusChanged)
}

export async function resetPanelSessionControllerForTests(): Promise<void> {
  runId += 1
  await queue
  started = false
  vaultLocked = 'unknown'
  snapshot = null
  revision = 0
  queue = Promise.resolve()
  autoConnectInFlight = null
  ensureUnknownListener = null
  ensureUnknownInFlight = false
  ensureUnknownAttemptedKey = null
  justWorksListener = null
  justWorksInFlight = false
  justWorksAttemptedKey = null
  setVaultLockListener(null)
  clearCachedFocusedProductTab()
  resetActiveXTabRegistryMemory()
}

export function currentPanelSessionRevisionForTests(): number {
  return revision
}

export function isNewerPanelSession(
  incoming: PanelSessionSnapshot,
  current: PanelSessionSnapshot | null,
): boolean {
  if (!current) return true
  return isNewerRevision(incoming.revision, current.revision)
}

export type { FocusedProductTab }
