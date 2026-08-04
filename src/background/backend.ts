import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type Event,
} from 'nostr-tools'
import * as vault from '../vault/vault.ts'
import { importNsec } from '../accounts/accounts.ts'
import {
  decideAlreadyProven,
  extractTwitterIdsFromProfileJsonLd,
  generateNip39ProofText,
  parseNip39TwitterClaim,
  verifyNip39Proof,
  type ProofPostQueryResult,
  type ProofVerificationResult,
  type XIdentityResolution,
} from '../identity'
import {
  buildXIdentityFromObservation,
  evaluateXIdentityRow,
  npubFromPubkey,
  preserveXIdentityProfileFields,
  primaryNpubFromRow,
  pubkeyFromNpub,
} from '../identity/x-identity-row'
import {
  LocalTrustGraph,
  type GraphBounds,
  type ReducedTrustStatement,
  type ResolveBounds,
  type TrustQueryResult,
  type TrustSubject,
} from '../graph'
import {
  DEFAULT_GRAPH_SYNC_LIMITS,
  DurableOutboxPublisher,
  OUTBOX_HOLD_ALARM,
  outboxHoldUntil,
  RelaySynchronizer,
  type GraphSyncLimits,
  type OutboxPublishResult,
  type RelayPublishClient,
  type RelayQueryClient,
  type SynchronizeResult,
} from '../relay'
import {
  AttentionXRepository,
  DEMO_EVENT_STATE,
  addressKeyForEvent,
  eventAddress,
  type EventRecord,
  type XIdentityBlockedBy,
  type XIdentityRecord,
} from '../storage'
import {
  BACKGROUND_API_VERSION,
  DEFAULT_RELAYS,
  NIP39_EVENT_KIND,
  STORAGE_KEY,
  type ActiveXAccountReport,
  type ExtensionRequest,
  type ProofComposerPreview,
  type ProofComposerSession,
  type PublicExtensionState,
  type PublishResult,
  type CockpitState,
  type CockpitChromeStorageSummary,
  type GraphNeighborhood,
  type GraphNeighborhoodDirection,
  type GraphNeighborhoodValueFilter,
  type GraphSnapshot,
  type AppLogsState,
  type XIdentityDisplay,
  type EventListRow,
  type EventSortDir,
  type EventSortField,
  type EventsState,
  type OutboxListRow,
  type OutboxState,
  type XIdentitiesState,
  type XIdentityListRow,
  type XIdentityPublishPreview,
  type XIdentityPublishResult,
  type XIdentitySortDir,
  type XIdentitySortField,
  type XIdentityStatusSyncResult,
  type XProofCheckResult,
  type QueryTrustBatchItem,
  type QueryTrustBatchResult,
  MAX_TRUST_BATCH_ITEMS,
  type DeleteUserDataMode,
  type DeleteUserDataResult,
  type DemoWotClearResult,
  type DemoWotSeedResult,
  type DemoWotStatus,
} from '../shared/contracts'
import * as signer from '../nip07/signer.ts'
import * as signerPermissions from '../nip07/permissions.ts'
import { config } from '../nip07/bg/state.ts'
import {
  DEMO_WOT_EXTRA_TAGS,
  TRUST_GRAPH_UPDATED_MESSAGE,
  isDemoWotEvent,
  materializeDemoSubject,
  planDemoWotNetwork,
} from '../shared/demo-wot'
import {
  APP_MODE_CHANGED_MESSAGE,
  APP_MODE_STORAGE_KEY,
  DEFAULT_APP_MODE,
  parseAppMode,
  type AppMode,
} from '../shared/app-mode'
import {
  ResolveTimingTracker,
} from '../shared/resolve-timing'
import {
  WOT_MAX_DEGREE_CHANGED_MESSAGE,
  WOT_MAX_DEGREE_DEFAULT,
  WOT_MAX_DEGREE_HARD_CAP,
  WOT_MAX_DEGREE_MIN,
  WOT_RESOLVE_AUTO_LOWER_MS,
  WOT_RESOLVE_SOFT_HINT_MS,
  clampWotMaxDegree,
  RESOLVE_TIMING_STORAGE_KEY,
} from '../shared/wot-max-degree'
import {
  accountsMatch,
  buildProofIntentUrl,
  extractNpubFromLinkingProofText,
  normalizeProofDestination,
  parseProofPostId,
  type ProofDestinationAccount,
} from '../shared/proof-composer'
import {
  buildKind10011Event,
  classifyKind10011PublishChange,
  countPreservedKind10011Tags,
  inspectExistingTwitterTags,
  validateSignedKind10011Event,
  validateKind10011TwitterIdentity,
} from '../shared/kind-10011'
import {
  buildKind32009Event,
  buildKind32009D,
  getTrustSubjectValidationError,
  isCanonicalTrustContext,
  reduceKind32009Events,
  validateKind32009Event,
  type ParsedKind32009,
  type TrustValue,
} from '../shared/kind-32009'
import { sanitizeTrustContent } from '../shared/trust-content'
import {
  MAX_OBSERVATIONS_PER_MESSAGE,
  isAllowedXOperation,
  normalizeObservedHandle,
  sanitizeObservedXIdentity,
} from '../shared/observed-x-identity'
import {
  canonicalTwitterAccountClass,
  canonicalTwitterPostClass,
  isTwitterNumericId,
  parseCanonicalTwitterSubject,
  X_TRUST_SCOPE,
} from '../shared/x-identity'
import {
  RepositoryOutboxAdapter,
  RepositorySyncAdapter,
  type RelayEventQuery,
} from './adapters'
import { logActivity } from '../nip07/bg/activity-handlers.ts'

const WOT_SCOPE = 'attentionx-wot-v1'
const ACTIVE_ACCOUNT_TTL_MS = 24 * 60 * 60_000
const ACTIVE_X_ACCOUNT_SESSION_KEY = 'attentionxActiveXAccount'
const PROOF_SESSION_TTL_MS = 30 * 60_000
const WOT_OVERLAP_SECONDS = 60
const MAX_NIP39_EVENTS = 100
/** Fail fast on silent relays so CHECK can fall through to page scan. */
const DEFAULT_NIP39_RELAY_REFRESH_MS = 1_500
const MAX_PROFILE_HTML_BYTES = 1_500_000
const MAX_RELAYS = 20

export interface StoredBackgroundSettings {
  /** @deprecated Migrated into encrypted vault; kept for one-time import only. */
  secretKeyHex?: string
  relays: string[]
  mode?: AppMode
  /** Sync and Resolve max degree (1–5). */
  wotMaxDegree?: number
}

interface LegacyStoredBackgroundSettings extends StoredBackgroundSettings {
  cachedEvents?: unknown[]
}

export interface BackgroundSettingsStore {
  read(): Promise<unknown>
  write(settings: StoredBackgroundSettings): Promise<void>
}

export interface BackgroundRelayTransport
  extends RelayQueryClient,
    RelayPublishClient,
    RelayEventQuery {}

export interface AttentionXBackendDependencies {
  repository: AttentionXRepository
  settingsStore: BackgroundSettingsStore
  relay: BackgroundRelayTransport
  fetch?: typeof fetch
  queryProofPost?: (postId: string) => Promise<ProofPostQueryResult>
  now?: () => number
  /** Override NIP-39 relay refresh budget (tests / tuning). */
  nip39RelayRefreshMs?: number
}

export type WotSyncStatus =
  | { state: 'idle' }
  | { state: 'running'; startedAt: number }
  | {
      state: 'complete'
      startedAt: number
      finishedAt: number
      result: SynchronizeResult
    }
  | { state: 'stopped'; startedAt: number; finishedAt: number }
  | {
      state: 'error'
      startedAt: number
      finishedAt: number
      error: string
    }

export function normalizeRelays(relays: readonly string[]): string[] {
  const normalized = new Set<string>()
  for (const relay of relays) {
    const url = new URL(relay.trim())
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      throw new Error(`Relay must use ws:// or wss://: ${relay}`)
    }
    normalized.add(url.toString().replace(/\/$/, ''))
  }
  if (normalized.size === 0) throw new Error('Configure at least one relay')
  return [...normalized]
}

/** Parse chrome.storage.sync relays CSV; returns undefined when unset/invalid. */
export function parseSyncRelayList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined
  const parts = value
    .split(',')
    .map((relay) => relay.trim())
    .filter(Boolean)
  if (parts.length === 0) return []
  try {
    return normalizeRelays(parts)
  } catch {
    return undefined
  }
}

function sameRelayList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((relay, index) => relay === right[index])
}

function parseSettings(value: unknown): LegacyStoredBackgroundSettings {
  if (typeof value !== 'object' || value === null) {
    return {
      relays: [...DEFAULT_RELAYS],
      mode: DEFAULT_APP_MODE,
      wotMaxDegree: WOT_MAX_DEGREE_DEFAULT,
    }
  }
  const stored = value as Partial<LegacyStoredBackgroundSettings>
  let relays: string[]
  try {
    relays =
      Array.isArray(stored.relays) && stored.relays.length > 0
        ? normalizeRelays(stored.relays.filter(
            (relay): relay is string => typeof relay === 'string',
          ))
        : [...DEFAULT_RELAYS]
  } catch {
    relays = [...DEFAULT_RELAYS]
  }
  return {
    ...(typeof stored.secretKeyHex === 'string' &&
    /^[0-9a-f]{64}$/i.test(stored.secretKeyHex)
      ? { secretKeyHex: stored.secretKeyHex.toLowerCase() }
      : {}),
    relays,
    mode: parseAppMode(stored.mode),
    wotMaxDegree: clampWotMaxDegree(stored.wotMaxDegree),
    ...(Array.isArray(stored.cachedEvents)
      ? { cachedEvents: stored.cachedEvents }
      : {}),
  }
}

function reducedStatement(statement: ParsedKind32009): ReducedTrustStatement {
  return {
    eventId: statement.event.id,
    author: statement.event.pubkey,
    subject: { ...statement.subject },
    context: statement.context,
    value: Number(statement.value) as -1 | 0 | 1,
    createdAt: statement.event.created_at,
    ...(statement.activationTime === undefined
      ? {}
      : { activeFrom: statement.activationTime }),
    ...(statement.expirationTime === undefined
      ? {}
      : { activeUntil: statement.expirationTime }),
  }
}

function publishResult(result: OutboxPublishResult): PublishResult {
  return {
    eventId: result.eventId,
    deliveredTo: result.deliveredRelays,
    attemptedRelays: result.attemptedRelays,
    deliveryStatus: result.status,
  }
}

function defaultTrustPublishTags(subject: TrustSubject): {
  scopes: string[]
  k?: string
} {
  const tags = { scopes: [X_TRUST_SCOPE] as string[] }
  if (subject.type !== 'i') {
    return tags
  }
  const parsed = parseCanonicalTwitterSubject(subject.value)
  if (!parsed) {
    return tags
  }
  return {
    ...tags,
    k:
      parsed.type === 'account'
        ? canonicalTwitterAccountClass()
        : canonicalTwitterPostClass(),
  }
}

function syncLimits(bounds?: Partial<GraphBounds>): GraphSyncLimits {
  const limits = { ...DEFAULT_GRAPH_SYNC_LIMITS, ...bounds }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`)
    }
  }
  if (
    limits.maxAuthorsPerLevel < 1 ||
    limits.maxTotalAuthors < 1 ||
    limits.maxEvents < 1
  ) {
    throw new Error('WoT synchronization bounds must be positive')
  }
  return limits
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected AttentionX error'
}

function assertVersion(request: { version?: unknown }): void {
  if (request.version !== BACKGROUND_API_VERSION) {
    throw new Error(`Unsupported background API version: ${String(request.version)}`)
  }
}

function requireString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function isEvent(value: unknown): value is Event {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'sig' in value
  )
}

const X_IDENTITY_SORT_FIELDS = [
  'username',
  'twitterId',
  'proofState',
  'npub',
  'updatedAt',
  'lastSeen',
] as const satisfies readonly XIdentitySortField[]

function parseXIdentitySortField(value: unknown): XIdentitySortField {
  return X_IDENTITY_SORT_FIELDS.includes(value as XIdentitySortField)
    ? (value as XIdentitySortField)
    : 'username'
}

function parseXIdentitySortDir(
  value: unknown,
  sortBy: XIdentitySortField,
): XIdentitySortDir {
  if (value === 'asc' || value === 'desc') return value
  return sortBy === 'updatedAt' || sortBy === 'lastSeen' ? 'desc' : 'asc'
}

const EVENT_SORT_FIELDS = [
  'kind',
  'id',
  'pubkey',
  'created_at',
  'firstSeenAt',
  'addressKey',
  'state',
] as const satisfies readonly EventSortField[]

function parseEventSortField(value: unknown): EventSortField {
  return EVENT_SORT_FIELDS.includes(value as EventSortField)
    ? (value as EventSortField)
    : 'created_at'
}

function parseEventSortDir(
  value: unknown,
  sortBy: EventSortField,
): EventSortDir {
  if (value === 'asc' || value === 'desc') return value
  return sortBy === 'created_at' || sortBy === 'firstSeenAt' ? 'desc' : 'asc'
}

function compareEventRows(
  a: EventListRow,
  b: EventListRow,
  sortBy: EventSortField,
  sortDir: EventSortDir,
): number {
  let result = 0
  switch (sortBy) {
    case 'kind':
      result = a.kind - b.kind
      break
    case 'id':
      result = a.id.localeCompare(b.id)
      break
    case 'pubkey':
      result = a.npub.localeCompare(b.npub) || a.pubkey.localeCompare(b.pubkey)
      break
    case 'created_at':
      result = a.created_at - b.created_at
      break
    case 'firstSeenAt':
      result = a.firstSeenAt - b.firstSeenAt
      break
    case 'addressKey':
      result = a.addressKey.localeCompare(b.addressKey)
      break
    case 'state':
      result = (a.state ?? '').localeCompare(b.state ?? '')
      break
    default: {
      const _exhaustive: never = sortBy
      void _exhaustive
      break
    }
  }
  if (result === 0) {
    result = a.id.localeCompare(b.id)
  }
  return sortDir === 'desc' ? -result : result
}

function primaryHandleKey(row: XIdentityListRow): string {
  return row.handle.toLowerCase()
}

function primaryNpubKey(row: XIdentityListRow): string {
  return primaryNpubFromRow(row) ?? ''
}

function compareXIdentityRows(
  a: XIdentityListRow,
  b: XIdentityListRow,
  sortBy: XIdentitySortField,
  sortDir: XIdentitySortDir,
): number {
  let result = 0
  switch (sortBy) {
    case 'username': {
      const handleA = primaryHandleKey(a)
      const handleB = primaryHandleKey(b)
      if (handleA && handleB) result = handleA.localeCompare(handleB)
      else if (handleA !== handleB) result = handleA ? -1 : 1
      break
    }
    case 'twitterId':
      result = a.twitterId.localeCompare(b.twitterId)
      break
    case 'proofState':
      result = a.state.localeCompare(b.state)
      break
    case 'npub': {
      const npubA = primaryNpubKey(a)
      const npubB = primaryNpubKey(b)
      if (npubA && npubB) result = npubA.localeCompare(npubB)
      else if (npubA !== npubB) result = npubA ? -1 : 1
      break
    }
    case 'updatedAt':
      result = a.updatedAt - b.updatedAt
      break
    case 'lastSeen':
      result = a.lastSeen - b.lastSeen
      break
    default: {
      const _exhaustive: never = sortBy
      void _exhaustive
      break
    }
  }
  if (result === 0) {
    result = a.twitterId.localeCompare(b.twitterId)
  }
  return sortDir === 'desc' ? -result : result
}

export class AttentionXBackend {
  readonly #repository: AttentionXRepository
  readonly #settingsStore: BackgroundSettingsStore
  readonly #relay: BackgroundRelayTransport
  readonly #fetch: typeof fetch
  readonly #queryProofPost: (postId: string) => Promise<ProofPostQueryResult>
  readonly #now: () => number
  readonly #nip39RelayRefreshMs: number
  readonly #syncRepository: RepositorySyncAdapter
  readonly #publisher: DurableOutboxPublisher
  readonly #synchronizer: RelaySynchronizer
  readonly #graph = new LocalTrustGraph()

  #settings: StoredBackgroundSettings = {
    relays: [...DEFAULT_RELAYS],
    mode: DEFAULT_APP_MODE,
    wotMaxDegree: WOT_MAX_DEGREE_DEFAULT,
  }
  #syncStatus: WotSyncStatus = { state: 'idle' }
  #syncController?: AbortController
  #maintenance?: Promise<WotSyncStatus>
  #activeXAccount?: ActiveXAccountReport
  #proofSession?: ProofComposerSession
  /** Dedupes concurrent GraphQL proof searches per X account id. */
  readonly #proofSearchInFlight = new Set<string>()
  /** When true, trust queries rebuild the in-memory graph before reading. */
  #graphDirty = true
  /** Per-subject trust query memo, invalidated when graphVersion advances. */
  readonly #trustMemo = new Map<string, TrustQueryResult>()
  #trustMemoVersion = 0
  /** Graph tab id → opener tab id for Close focus restoration. */
  readonly #graphPageOpeners = new Map<number, number>()
  readonly #resolveTiming = new ResolveTimingTracker()
  /** Coalesce concurrent auto-lower / SET_WOT_MAX_DEGREE writes. */
  #wotMaxDegreeWrite?: Promise<number>

  private constructor(dependencies: AttentionXBackendDependencies) {
    this.#repository = dependencies.repository
    this.#settingsStore = dependencies.settingsStore
    this.#relay = dependencies.relay
    this.#fetch = dependencies.fetch ?? fetch
    this.#queryProofPost =
      dependencies.queryProofPost ??
      ((postId) => queryOEmbedProofPost(postId, this.#fetch))
    this.#now = dependencies.now ?? Date.now
    this.#nip39RelayRefreshMs =
      dependencies.nip39RelayRefreshMs ?? DEFAULT_NIP39_RELAY_REFRESH_MS
    this.#syncRepository = new RepositorySyncAdapter(this.#repository)
    this.#publisher = new DurableOutboxPublisher({
      repository: new RepositoryOutboxAdapter(this.#repository),
      client: this.#relay,
    })
    this.#synchronizer = new RelaySynchronizer({
      client: this.#relay,
      cursors: this.#syncRepository,
      events: this.#syncRepository,
      onProvenance: async (observation) => {
        if (observation.ingestResult === 'rejected') return
        const event = await this.#repository.getEvent(observation.eventId)
        if (event) {
          await this.#repository.ingestEvent({
            event,
            relayUrl: observation.relayUrl,
            observedAt: observation.observedAt,
          })
        }
      },
    })
  }

  static async create(
    dependencies: AttentionXBackendDependencies,
  ): Promise<AttentionXBackend> {
    const backend = new AttentionXBackend(dependencies)
    await backend.#initialize()
    chrome.tabs.onRemoved.addListener((tabId) => {
      backend.#graphPageOpeners.delete(tabId)
      for (const [graphTabId, openerTabId] of backend.#graphPageOpeners) {
        if (openerTabId === tabId) backend.#graphPageOpeners.delete(graphTabId)
      }
    })
    return backend
  }

  async #initialize(): Promise<void> {
    const legacy = parseSettings(await this.#settingsStore.read())
    const syncArea = await chrome.storage.sync.get('relays')
    const syncRelays = parseSyncRelayList(syncArea.relays)
    // Network settings (sync.relays) are the user-facing source of truth.
    this.#settings = {
      relays:
        syncRelays && syncRelays.length > 0 ? syncRelays : legacy.relays,
      mode: legacy.mode ?? DEFAULT_APP_MODE,
      wotMaxDegree: clampWotMaxDegree(legacy.wotMaxDegree),
    }

    if (legacy.secretKeyHex) {
      await this.#migrateLegacySecretKey(legacy.secretKeyHex)
    }

    for (const candidate of legacy.cachedEvents ?? []) {
      if (!isEvent(candidate)) continue
      await this.#ingestSupportedEvent(candidate)
    }
    await this.#settingsStore.write(this.#settings)
    await this.#mirrorAppMode(this.#settings.mode ?? DEFAULT_APP_MODE)
    await this.#applyModeActionChrome(this.#settings.mode ?? DEFAULT_APP_MODE)
    // Keep Network UI / NIP-07 in sync with the active backend list.
    const syncCsv = this.#settings.relays.join(',')
    if (syncArea.relays !== syncCsv) {
      await chrome.storage.sync.set({ relays: syncCsv })
    }
    await this.#repository.pruneOutboxRelays(this.#settings.relays, this.#now())
    await this.#repository.ensureDemoAddressKeysNamespaced()
    await this.#resolveTiming.load()
    await this.#rebuildGraph()
    await this.#rebuildNip39Winners()
  }

  async #migrateLegacySecretKey(secretKeyHex: string): Promise<void> {
    if (await vault.exists()) {
      delete this.#settings.secretKeyHex
      return
    }
    const account = await importNsec(secretKeyHex, 'Migrated')
    // Empty password = "never lock" path used by nostr-wot; user can set a
    // real password from Security settings.
    await vault.create('', {
      accounts: [account],
      activeAccountId: account.id,
    })
    await chrome.storage.local.set({
      accounts: [
        {
          id: account.id,
          name: account.name,
          pubkey: account.pubkey,
          type: account.type,
          readOnly: account.readOnly,
        },
      ],
      activeAccountId: account.id,
      autoLockMs: 0,
    })
    await chrome.storage.sync.set({ myPubkey: account.pubkey })
    delete this.#settings.secretKeyHex
  }

  async handleRequest(
    request: ExtensionRequest,
    context: { senderTabId?: number } = {},
  ): Promise<unknown> {
    switch (request.type) {
      case 'GET_STATE':
        return this.getPublicState()
      case 'GET_COCKPIT_STATE':
        return this.getCockpitState()
      case 'GET_GRAPH_SNAPSHOT':
        assertVersion(request)
        return this.#getGraphSnapshot({
          maxDepth:
            typeof request.maxDepth === 'number' ? request.maxDepth : undefined,
          maxNodes:
            typeof request.maxNodes === 'number' ? request.maxNodes : undefined,
          context:
            typeof request.context === 'string' ? request.context : undefined,
        })
      case 'GET_GRAPH_NEIGHBORHOOD':
        assertVersion(request)
        return this.#getGraphNeighborhood({
          centerId: requireString(request.centerId, 'centerId', 1_100),
          direction:
            request.direction === 'out' ||
            request.direction === 'in' ||
            request.direction === 'both'
              ? request.direction
              : undefined,
          valueFilter:
            request.valueFilter === 'trust' ||
            request.valueFilter === 'distrust' ||
            request.valueFilter === 'both'
              ? request.valueFilter
              : undefined,
          context:
            typeof request.context === 'string'
              ? requireString(request.context, 'context', 128)
              : undefined,
          limit: typeof request.limit === 'number' ? request.limit : undefined,
        })
      case 'OPEN_GRAPH_PAGE':
        assertVersion(request)
        return this.#openGraphPage(
          requireString(request.url, 'url', 4_096),
          context.senderTabId,
        )
      case 'CLOSE_GRAPH_PAGE':
        assertVersion(request)
        return this.#closeGraphPage(context.senderTabId)
      case 'OPEN_OUTBOX_PAGE':
        assertVersion(request)
        return this.#openOutboxPage(context.senderTabId)
      case 'GET_OUTBOX':
        assertVersion(request)
        return this.#getOutbox()
      case 'DELETE_OUTBOX_EVENT':
        assertVersion(request)
        return this.#deleteOutboxEvent(
          requireString(request.eventId, 'eventId', 128),
        )
      case 'PUBLISH_OUTBOX_NOW':
        assertVersion(request)
        return this.#publishOutboxNow(
          requireString(request.eventId, 'eventId', 128),
        )
      case 'PUBLISH_OUTBOX_ALL_NOW':
        assertVersion(request)
        return this.#publishOutboxAllNow()
      case 'GET_APP_LOGS':
        assertVersion(request)
        return this.#getAppLogs({
          errorLimit:
            typeof request.errorLimit === 'number'
              ? request.errorLimit
              : undefined,
          activityLimit:
            typeof request.activityLimit === 'number'
              ? request.activityLimit
              : undefined,
        })
      case 'GET_X_IDENTITIES':
        assertVersion(request)
        return this.#getXIdentities({
          query:
            typeof request.query === 'string' ? request.query : undefined,
          offset:
            typeof request.offset === 'number' ? request.offset : undefined,
          limit:
            typeof request.limit === 'number' ? request.limit : undefined,
          sortBy: request.sortBy,
          sortDir: request.sortDir,
        })
      case 'GET_EVENTS':
        assertVersion(request)
        return this.#getEvents({
          query:
            typeof request.query === 'string' ? request.query : undefined,
          offset:
            typeof request.offset === 'number' ? request.offset : undefined,
          limit:
            typeof request.limit === 'number' ? request.limit : undefined,
          sortBy: request.sortBy,
          sortDir: request.sortDir,
        })
      case 'GENERATE_IDENTITY':
        return this.#generateIdentity()
      case 'IMPORT_IDENTITY':
        return this.#importIdentity(requireString(request.nsec, 'nsec', 200))
      case 'CLEAR_IDENTITY':
        return this.#clearIdentity()
      case 'SAVE_RELAYS':
        if (
          !Array.isArray(request.relays) ||
          request.relays.length === 0 ||
          request.relays.length > MAX_RELAYS ||
          request.relays.some(
            (relay) => typeof relay !== 'string' || relay.length > 2_048,
          )
        ) {
          throw new Error('Invalid relay list')
        }
        return this.#saveRelays(request.relays)
      case 'INGEST_X_IDENTITIES':
        assertVersion(request)
        if (
          !Array.isArray(request.observations) ||
          request.observations.length === 0 ||
          request.observations.length > MAX_OBSERVATIONS_PER_MESSAGE
        ) {
          throw new Error('Invalid X identity observation batch')
        }
        {
          const receivedAt = this.#now()
          const observations = request.observations.map((value) => {
            const observation = sanitizeObservedXIdentity({
              ...value,
              observedAt: receivedAt,
            })
            if (
              !observation ||
              !isAllowedXOperation(observation.sourceOperation)
            ) {
              return undefined
            }
            return { ...observation, observedAt: receivedAt }
          })
          if (observations.some((observation) => !observation)) {
            throw new Error('Invalid X identity observation')
          }
          const validObservations =
            observations as NonNullable<(typeof observations)[number]>[]
          for (const observation of validObservations) {
            const existing = await this.#repository.getXIdentity(
              observation.twitterId,
            )
            const { record, dataChanged } = buildXIdentityFromObservation(
              existing,
              observation,
            )
            await this.#repository.putXIdentity(record)
            if (dataChanged) {
              await this.#syncXIdentityStatus(observation.twitterId)
            }
          }
          return { ingested: observations.length }
        }
      case 'GET_X_IDENTITY':
        assertVersion(request)
        return this.#getXIdentity(
          requireString(request.twitterId, 'X account ID', 24),
        )
      case 'GET_X_IDENTITY_DISPLAYS':
        assertVersion(request)
        if (
          !Array.isArray(request.twitterIds) ||
          request.twitterIds.length === 0 ||
          request.twitterIds.length > 50
        ) {
          throw new Error('Invalid X identity display batch')
        }
        return this.#getXIdentityDisplays(request.twitterIds)
      case 'SYNC_X_IDENTITY_STATUS':
        assertVersion(request)
        return this.#syncXIdentityStatusForUi(
          requireString(request.twitterId, 'X account ID', 24),
        )
      case 'CHECK_X_PROOF':
        assertVersion(request)
        return this.#checkXProof(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          {
            queryRelays: request.queryRelays !== false,
            scanPage: request.scanPage === true,
            forceRescan: request.forceRescan === true,
          },
        )
      case 'SEARCH_X_PROOF':
        assertVersion(request)
        return this.#searchXProof(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          { forceRescan: request.forceRescan !== false },
        )
      case 'GENERATE_X_PROOF':
        assertVersion(request)
        return this.#generateXProof(
          request.handle === undefined
            ? undefined
            : requireString(request.handle, 'X handle', 16),
          request.twitterId === undefined
            ? undefined
            : requireString(request.twitterId, 'X account ID', 24),
        )
      case 'VERIFY_X_PROOF':
        assertVersion(request)
        if (!isEvent(request.event)) throw new Error('Invalid Nostr event')
        return this.#verifyXProof(request.event)
      case 'REPORT_ACTIVE_X_ACCOUNT':
        assertVersion(request)
        return this.#reportActiveXAccount(request.account)
      case 'GET_ACTIVE_X_ACCOUNT':
        assertVersion(request)
        return this.#loadActiveXAccount()
      case 'ENSURE_ACTIVE_X_ACCOUNT':
        assertVersion(request)
        return this.#ensureActiveXAccount()
      case 'PREPARE_X_PROOF_COMPOSER':
        assertVersion(request)
        return this.#prepareProofComposer(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
        )
      case 'CONFIRM_X_PROOF_COMPOSER':
        assertVersion(request)
        return this.#confirmProofComposer(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
        )
      case 'GET_PROOF_COMPOSER_SESSION':
        assertVersion(request)
        return this.#getProofSession()
      case 'CAPTURE_X_PROOF_POST':
        assertVersion(request)
        return this.#captureProofPost(
          requireString(request.proofTweetId, 'proof post ID', 512),
        )
      case 'PUBLISH_STAGED_X_PROOF':
        assertVersion(request)
        return this.#publishXIdentity(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          requireString(request.proofTweetId, 'proof post ID', 24),
          { flush: true },
        )
      case 'PREPARE_X_IDENTITY_PUBLISH':
        assertVersion(request)
        return this.#prepareXIdentityPublish(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          requireString(request.proofTweetId, 'proof post ID', 24),
        )
      case 'CONFIRM_X_IDENTITY_PUBLISH':
        assertVersion(request)
        return this.#confirmXIdentityPublish({
          handle: requireString(request.handle, 'X handle', 16),
          twitterId: requireString(request.twitterId, 'X account ID', 24),
          proofTweetId: requireString(
            request.proofTweetId,
            'proof post ID',
            24,
          ),
          existingEventId:
            request.existingEventId === null
              ? null
              : requireString(
                  request.existingEventId ?? '',
                  'existingEventId',
                  128,
                ),
          confirmReplacement: request.confirmReplacement === true,
        })
      case 'CANCEL_PROOF_COMPOSER':
        assertVersion(request)
        this.#proofSession = undefined
        return { cancelled: true }
      case 'PUBLISH_X_IDENTITY':
        if (request.version !== undefined) assertVersion(request)
        return this.#publishXIdentity(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          requireString(request.proofTweetId, 'proof post ID', 24),
        )
      case 'PUBLISH_TRUST_STATEMENT':
        assertVersion(request)
        if (
          request.content !== undefined &&
          (typeof request.content !== 'string' ||
            request.content.length > 10_000)
        ) {
          throw new Error('Invalid trust statement content')
        }
        if (
          request.context !== undefined &&
          (typeof request.context !== 'string' || request.context.length > 256)
        ) {
          throw new Error('Invalid trust statement context')
        }
        if (
          request.hintHandle !== undefined &&
          (typeof request.hintHandle !== 'string' ||
            request.hintHandle.length > 32)
        ) {
          throw new Error('Invalid hint handle')
        }
        return this.#publishTrustStatement({
          subject: request.subject,
          value: request.value,
          context: request.context,
          content:
            request.content === undefined
              ? undefined
              : sanitizeTrustContent(request.content),
          activationTime: request.activationTime,
          expirationTime: request.expirationTime,
          hintHandle: request.hintHandle,
        })
      case 'CANCEL_TRUST_STATEMENT':
        assertVersion(request)
        if (
          request.content !== undefined &&
          (typeof request.content !== 'string' ||
            request.content.length > 10_000)
        ) {
          throw new Error('Invalid trust statement content')
        }
        return this.#publishTrustStatement({
          subject: request.subject,
          value: '0',
          context: request.context,
          content:
            request.content === undefined
              ? undefined
              : sanitizeTrustContent(request.content),
        })
      case 'QUERY_TRUST':
        assertVersion(request)
        return this.#queryTrust(
          request.subject,
          request.context,
          request.rootPubkey,
          request.now,
          request.bounds,
          request.format,
        )
      case 'QUERY_TRUST_BATCH':
        assertVersion(request)
        if (
          !Array.isArray(request.items) ||
          request.items.length === 0 ||
          request.items.length > MAX_TRUST_BATCH_ITEMS
        ) {
          throw new Error('Invalid trust batch')
        }
        return this.#queryTrustBatch(
          request.items,
          request.rootPubkey,
          request.now,
          request.bounds,
          request.format,
        )
      case 'START_WOT_SYNC':
        assertVersion(request)
        return this.#startSync(request.overlapSeconds, request.limits)
      case 'GET_WOT_SYNC_STATUS':
        assertVersion(request)
        return structuredClone(this.#syncStatus)
      case 'STOP_WOT_SYNC':
        assertVersion(request)
        return this.#stopSync()
      case 'SEED_DEMO_WOT':
        assertVersion(request)
        return this.#seedDemoWot()
      case 'CLEAR_DEMO_WOT':
        assertVersion(request)
        return this.#clearDemoWot()
      case 'GET_DEMO_WOT_STATUS':
        assertVersion(request)
        return this.#getDemoWotStatus()
      case 'GET_APP_MODE':
        assertVersion(request)
        return { mode: this.#appMode() }
      case 'SET_APP_MODE':
        assertVersion(request)
        return this.#setAppMode(request.mode)
      case 'GET_WOT_MAX_DEGREE':
        assertVersion(request)
        return { degree: this.#wotMaxDegree() }
      case 'SET_WOT_MAX_DEGREE':
        assertVersion(request)
        return this.#setWotMaxDegree(request.degree).then((degree) => ({
          degree,
        }))
      case 'DELETE_USER_DATA':
        assertVersion(request)
        return this.#deleteUserData(request.mode)
      default:
        throw new Error(
          `Unknown AttentionX background request type: ${String(
            (request as { type?: unknown }).type,
          )}`,
        )
    }
  }

  async getPublicState(): Promise<PublicExtensionState> {
    const active = vault.getActiveAccount()
    const pubkey =
      active?.pubkey ||
      (vault.isLocked() ? undefined : vault.getActivePubkey() || undefined)
    const accounts = (await chrome.storage.local.get('accounts')) as {
      accounts?: unknown[]
    }
    const hasIdentity = Boolean(pubkey || accounts.accounts?.length)
    const heaviest = this.#resolveTiming.heaviestDegreeAvgMs()
    return {
      hasIdentity,
      npub: pubkey ? nip19.npubEncode(pubkey) : undefined,
      pubkey: pubkey || undefined,
      vaultLocked: await vault.exists() ? vault.isLocked() : false,
      relays: [...this.#settings.relays],
      cachedEventCount: (
        await this.#repository.getEventsByKind(32009)
      ).length,
      wotMaxDegree: this.#wotMaxDegree(),
      ...(heaviest && heaviest.avgMs >= WOT_RESOLVE_SOFT_HINT_MS
        ? {
            resolveTimingHint: {
              heaviestDegree: heaviest.degree,
              avgMs: heaviest.avgMs,
              samples: heaviest.samples,
            },
          }
        : {}),
      activeXAccount: await this.#loadActiveXAccount(),
      proofSession: this.#getProofSession(),
      syncStatus: (() => {
        const status = this.#syncStatus
        return {
          state: status.state,
          ...('startedAt' in status ? { startedAt: status.startedAt } : {}),
          ...('finishedAt' in status ? { finishedAt: status.finishedAt } : {}),
          ...('error' in status ? { error: status.error } : {}),
        }
      })(),
    }
  }

  async getCockpitState(): Promise<CockpitState> {
    const extension = await this.getPublicState()
    const storage = await this.#repository.getStorageStats()
    const chromeStorage = await this.#readChromeStorageSummary()
    return {
      generatedAt: this.#now(),
      extension,
      storage,
      chromeStorage,
      syncStatus: extension.syncStatus,
      resolveTiming: this.#resolveTiming.snapshot(),
    }
  }

  async #getGraphSnapshot(options: {
    maxDepth?: number
    maxNodes?: number
    context?: string
  }): Promise<GraphSnapshot> {
    await this.#ensureGraphReady()
    const rootPubkey = this.#pubkey()
    const maxDepth = options.maxDepth ?? 4
    const snapshot = this.#graph.egoSnapshot(rootPubkey, {
      maxDepth,
      maxNodes: options.maxNodes ?? 400,
      context: options.context ?? '',
      now: Math.floor(this.#now() / 1_000),
    })
    return {
      generatedAt: this.#now(),
      graphVersion: snapshot.graphVersion,
      rootPubkey: snapshot.rootPubkey,
      rootNpub: nip19.npubEncode(snapshot.rootPubkey),
      statementCount: this.#graph.listStatements().length,
      nodeCount: snapshot.nodeCount,
      edgeCount: snapshot.edgeCount,
      truncated: snapshot.truncated,
      maxDepth,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
    }
  }

  async #getGraphNeighborhood(options: {
    centerId: string
    direction?: GraphNeighborhoodDirection
    valueFilter?: GraphNeighborhoodValueFilter
    context?: string
    limit?: number
  }): Promise<GraphNeighborhood> {
    await this.#ensureGraphReady()
    const centerId =
      typeof options.centerId === 'string' ? options.centerId.trim() : ''
    if (!centerId) {
      throw new Error('centerId is required')
    }
    const result = this.#graph.neighborhood(centerId, {
      direction: options.direction ?? 'both',
      valueFilter: options.valueFilter ?? 'both',
      context: options.context,
      now: Math.floor(this.#now() / 1_000),
      limit: options.limit ?? 200,
    })
    return {
      generatedAt: this.#now(),
      graphVersion: result.graphVersion,
      centerId: result.centerId,
      truncated: result.truncated,
      nodes: result.nodes,
      edges: result.edges,
    }
  }

  async #resolveOpenerTabId(
    explicit?: number,
  ): Promise<number | undefined> {
    if (explicit !== undefined) return explicit
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    const id = tabs[0]?.id
    return typeof id === 'number' ? id : undefined
  }

  async #openGraphPage(
    url: string,
    openerTabId?: number,
  ): Promise<{ opened: true }> {
    const raw = typeof url === 'string' ? url.trim() : ''
    if (!raw) throw new Error('url is required')
    const base = chrome.runtime.getURL('src/cockpit/index.html')
    const target =
      raw.startsWith('?') || !raw.includes('://')
        ? new URL(raw.startsWith('?') ? raw : `?${raw}`, base)
        : new URL(raw)
    const expected = new URL(base)
    if (
      target.origin !== expected.origin ||
      target.pathname !== expected.pathname ||
      target.hash
    ) {
      throw new Error('Graph page URL must be the Application page')
    }
    const opener = await this.#resolveOpenerTabId(openerTabId)
    const tab = await chrome.tabs.create({ url: target.href })
    if (tab.id !== undefined && opener !== undefined) {
      this.#graphPageOpeners.set(tab.id, opener)
    }
    return { opened: true }
  }

  async #closeGraphPage(graphTabId?: number): Promise<{ closed: true }> {
    if (graphTabId === undefined) {
      throw new Error('Graph page tab is unknown')
    }
    const openerTabId = this.#graphPageOpeners.get(graphTabId)
    this.#graphPageOpeners.delete(graphTabId)
    let focused = false
    if (openerTabId !== undefined) {
      try {
        await chrome.tabs.update(openerTabId, { active: true })
        focused = true
      } catch {
        // Opener may have been closed.
      }
    }
    if (!focused) {
      const xTab = await this.#findLatestXProductTab()
      if (xTab?.id !== undefined) {
        try {
          await chrome.tabs.update(xTab.id, { active: true })
        } catch {
          // X tab may have been closed.
        }
      }
    }
    try {
      await chrome.tabs.remove(graphTabId)
    } catch {
      // Tab may already be gone.
    }
    return { closed: true }
  }

  async #findLatestXProductTab(): Promise<chrome.tabs.Tab | undefined> {
    const all = await chrome.tabs.query({
      url: [
        'https://x.com/*',
        'https://www.x.com/*',
        'https://twitter.com/*',
        'https://www.twitter.com/*',
      ],
    })
    if (all.length === 0) return undefined
    return [...all].sort(
      (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
    )[0]
  }

  async #openOutboxPage(openerTabId?: number): Promise<{ opened: true }> {
    return this.#openGraphPage('?page=outbox', openerTabId)
  }

  async #scheduleOutboxHoldRelease(heldUntil: number): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.alarms?.create) return
    try {
      const existing = await chrome.alarms.get(OUTBOX_HOLD_ALARM)
      if (
        existing?.scheduledTime !== undefined &&
        existing.scheduledTime <= heldUntil
      ) {
        return
      }
      await chrome.alarms.create(OUTBOX_HOLD_ALARM, { when: heldUntil })
    } catch {
      // Alarms unavailable in some test environments.
    }
  }

  async #getOutbox(): Promise<OutboxState> {
    const records = await this.#repository.listOutbox()
    const items: OutboxListRow[] = []
    for (const record of records) {
      const event = await this.#repository.getEvent(record.eventId)
      const holdTimes = Object.values(record.relays)
        .filter(
          (relay) =>
            (relay.status === 'pending' || relay.status === 'failed') &&
            typeof relay.nextAttemptAt === 'number',
        )
        .map((relay) => relay.nextAttemptAt!)
      const heldUntil =
        holdTimes.length === 0 ? undefined : Math.min(...holdTimes)
      let subjectSummary: string | undefined
      let trustValue: string | undefined
      if (event?.kind === 32009) {
        try {
          const parsed = await validateKind32009Event(event)
          if (parsed.valid) {
            const subject = parsed.statement.subject
            subjectSummary = `${subject.type}:${subject.value}`
            trustValue = parsed.statement.value
          }
        } catch {
          // Preview best-effort.
        }
      }
      const relays = Object.entries(record.relays).map(([relayUrl, state]) => ({
        relayUrl,
        status: state.status,
        attempts: state.attempts,
        ...(state.nextAttemptAt !== undefined
          ? { nextAttemptAt: state.nextAttemptAt }
          : {}),
        ...(state.lastAttemptAt !== undefined
          ? { lastAttemptAt: state.lastAttemptAt }
          : {}),
        ...(state.publishedAt !== undefined
          ? { publishedAt: state.publishedAt }
          : {}),
        ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
      }))
      items.push({
        eventId: record.eventId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(heldUntil !== undefined ? { heldUntil } : {}),
        ...(event
          ? {
              kind: event.kind,
              pubkey: event.pubkey,
              created_at: event.created_at,
              content: event.content,
            }
          : {}),
        ...(subjectSummary !== undefined ? { subjectSummary } : {}),
        ...(trustValue !== undefined ? { trustValue } : {}),
        relays,
        anyPublished: Object.values(record.relays).some(
          (relay) => relay.status === 'published',
        ),
      })
    }
    items.sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        left.eventId.localeCompare(right.eventId),
    )
    return { generatedAt: this.#now(), items }
  }

  async #deleteOutboxEvent(
    eventId: string,
  ): Promise<{ deleted: boolean }> {
    const deleted = await this.#repository.deleteEvent(eventId)
    if (deleted) {
      await this.#rebuildGraph()
      this.#broadcastTrustGraphUpdated()
    }
    return { deleted }
  }

  async #publishOutboxNow(eventId: string): Promise<PublishResult> {
    const cleared = await this.#repository.clearOutboxHold(
      eventId,
      this.#now(),
    )
    if (!cleared) throw new Error(`Outbox event not found: ${eventId}`)
    const delivery = publishResult(await this.#publisher.flush(eventId))
    const event = await this.#repository.getEvent(eventId)
    if (event) this.#logPublishedEvent(event, delivery)
    return delivery
  }

  async #publishOutboxAllNow(): Promise<{
    published: number
    results: PublishResult[]
  }> {
    const records = await this.#repository.listOutbox()
    const results: PublishResult[] = []
    for (const record of records) {
      const needsPublish = Object.values(record.relays).some(
        (relay) =>
          relay.status === 'pending' ||
          relay.status === 'failed' ||
          relay.status === 'exhausted',
      )
      if (!needsPublish) continue
      await this.#repository.clearOutboxHold(record.eventId, this.#now())
      try {
        const delivery = publishResult(
          await this.#publisher.flush(record.eventId),
        )
        results.push(delivery)
      } catch (error) {
        results.push({
          eventId: record.eventId,
          deliveredTo: 0,
          attemptedRelays: 0,
          deliveryStatus: 'failed',
        })
        void error
      }
    }
    return { published: results.length, results }
  }

  async #getAppLogs(options: {
    errorLimit?: number
    activityLimit?: number
  }): Promise<AppLogsState> {
    const errorLimit = Math.min(200, Math.max(1, options.errorLimit ?? 80))
    const activityLimit = Math.min(200, Math.max(1, options.activityLimit ?? 50))
    const [relayHealth, relayErrors, activityRaw] = await Promise.all([
      this.#repository.listRelayHealth(),
      this.#repository.listRelayErrorLog(errorLimit),
      chrome.storage.local.get('activityLog'),
    ])
    const activityLog = Array.isArray(
      (activityRaw as { activityLog?: unknown }).activityLog,
    )
      ? ((activityRaw as { activityLog: Array<Record<string, unknown>> })
          .activityLog)
          .slice()
          .reverse()
          .slice(0, activityLimit)
      : []
    return {
      generatedAt: this.#now(),
      relayHealth: relayHealth.map((row) => ({
        relayUrl: row.relayUrl,
        status: row.status,
        ...(row.lastError ? { lastError: row.lastError } : {}),
        lastCheckedAt: row.lastCheckedAt,
        ...(row.lastSuccessAt !== undefined
          ? { lastSuccessAt: row.lastSuccessAt }
          : {}),
        consecutiveFailures: row.consecutiveFailures,
      })),
      relayErrors: relayErrors.map((row) => ({
        id: row.id,
        relayUrl: row.relayUrl,
        at: row.at,
        kind: row.kind,
        message: row.message,
      })),
      activityLog,
    }
  }

  async #getXIdentities(options: {
    query?: string
    offset?: number
    limit?: number
    sortBy?: XIdentitySortField
    sortDir?: XIdentitySortDir
  }): Promise<XIdentitiesState> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const query = (options.query ?? '').trim().toLowerCase()
    const sortBy = parseXIdentitySortField(options.sortBy)
    const sortDir = parseXIdentitySortDir(options.sortDir, sortBy)
    const rows = (await this.#repository.getAllXIdentities()).map((identity) =>
      this.#toXIdentityListRow(identity),
    )
    const filtered = query
      ? rows.filter((row) => this.#matchesXIdentityQuery(row, query))
      : rows
    filtered.sort((a, b) => compareXIdentityRows(a, b, sortBy, sortDir))
    return {
      generatedAt: this.#now(),
      total: filtered.length,
      offset,
      limit,
      query: options.query?.trim() ?? '',
      sortBy,
      sortDir,
      identities: filtered.slice(offset, offset + limit),
    }
  }

  #toXIdentityListRow(identity: XIdentityRecord): XIdentityListRow {
    return {
      twitterId: identity.twitterId,
      handle: identity.handle,
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
      ...(identity.iconPath ? { iconPath: identity.iconPath } : {}),
      ...(identity.xProofNpub ? { xProofNpub: identity.xProofNpub } : {}),
      ...(identity.xProofPostId ? { xProofPostId: identity.xProofPostId } : {}),
      ...(identity.xProofHandle ? { xProofHandle: identity.xProofHandle } : {}),
      ...(identity.xProofObservedAt !== undefined
        ? { xProofObservedAt: identity.xProofObservedAt }
        : {}),
      ...(identity.nip39Npub ? { nip39Npub: identity.nip39Npub } : {}),
      ...(identity.nip39XId ? { nip39XId: identity.nip39XId } : {}),
      ...(identity.nip39Handle ? { nip39Handle: identity.nip39Handle } : {}),
      ...(identity.nip39PostId ? { nip39PostId: identity.nip39PostId } : {}),
      ...(identity.nip39EventId ? { nip39EventId: identity.nip39EventId } : {}),
      ...(identity.nip39ObservedAt !== undefined
        ? { nip39ObservedAt: identity.nip39ObservedAt }
        : {}),
      state: identity.state,
      ...(identity.blockedBy ? { blockedBy: identity.blockedBy } : {}),
      ...(identity.verifiedAt !== undefined
        ? { verifiedAt: identity.verifiedAt }
        : {}),
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
      lastSeen: identity.lastSeen,
    }
  }

  #matchesXIdentityQuery(row: XIdentityListRow, query: string): boolean {
    if (row.twitterId.toLowerCase().includes(query)) return true
    if (row.state.toLowerCase().includes(query)) return true
    if (row.blockedBy?.toLowerCase().includes(query)) return true
    if (row.handle.toLowerCase().includes(query)) return true
    const npubs = [row.xProofNpub, row.nip39Npub].filter(Boolean) as string[]
    if (npubs.some((npub) => npub.toLowerCase().includes(query))) return true
    if (row.nip39EventId?.toLowerCase().includes(query)) return true
    if (row.xProofPostId?.toLowerCase().includes(query)) return true
    if (row.nip39PostId?.toLowerCase().includes(query)) return true
    return false
  }

  async #getEvents(options: {
    query?: string
    offset?: number
    limit?: number
    sortBy?: EventSortField
    sortDir?: EventSortDir
  }): Promise<EventsState> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const query = (options.query ?? '').trim().toLowerCase()
    const sortBy = parseEventSortField(options.sortBy)
    const sortDir = parseEventSortDir(options.sortDir, sortBy)
    const rows = (await this.#repository.getAllEvents()).map((event) =>
      this.#toEventListRow(event),
    )
    const filtered = query
      ? rows.filter((row) => this.#matchesEventQuery(row, query))
      : rows
    filtered.sort((a, b) => compareEventRows(a, b, sortBy, sortDir))
    return {
      generatedAt: this.#now(),
      total: filtered.length,
      offset,
      limit,
      query: options.query?.trim() ?? '',
      sortBy,
      sortDir,
      events: filtered.slice(offset, offset + limit),
    }
  }

  #toEventListRow(event: EventRecord): EventListRow {
    let npub = event.pubkey
    try {
      npub = nip19.npubEncode(event.pubkey)
    } catch {
      // Keep hex pubkey when encoding fails.
    }
    return {
      id: event.id,
      pubkey: event.pubkey,
      npub,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags.map((tag) => [...tag]),
      content: event.content,
      sig: event.sig,
      firstSeenAt: event.firstSeenAt,
      addressKey: event.addressKey,
      ...(event.state !== undefined ? { state: event.state } : {}),
    }
  }

  #matchesEventQuery(row: EventListRow, query: string): boolean {
    if (row.id.toLowerCase().includes(query)) return true
    if (row.pubkey.toLowerCase().includes(query)) return true
    if (row.npub.toLowerCase().includes(query)) return true
    if (String(row.kind).includes(query)) return true
    if (row.content.toLowerCase().includes(query)) return true
    if (row.sig.toLowerCase().includes(query)) return true
    if (row.addressKey.toLowerCase().includes(query)) return true
    if (row.state?.toLowerCase().includes(query)) return true
    if (
      row.tags.some((tag) =>
        tag.some((part) => part.toLowerCase().includes(query)),
      )
    ) {
      return true
    }
    return false
  }

  async #readChromeStorageSummary(): Promise<CockpitChromeStorageSummary> {
    const [local, syncArea] = await Promise.all([
      chrome.storage.local.get(null),
      chrome.storage.sync.get(null),
    ])
    const localRecord = local as Record<string, unknown>
    const syncRecord = syncArea as Record<string, unknown>
    const estimateBytes = (value: unknown): number => {
      try {
        return new TextEncoder().encode(JSON.stringify(value)).length
      } catch {
        return 0
      }
    }
    const activityLog = localRecord.activityLog
    const activityLogCount = Array.isArray(activityLog)
      ? activityLog.length
      : typeof activityLog === 'object' && activityLog
        ? Object.values(activityLog as Record<string, unknown[]>).reduce(
            (sum, entries) =>
              sum + (Array.isArray(entries) ? entries.length : 0),
            0,
          )
        : 0
    const accounts = Array.isArray(localRecord.accounts)
      ? localRecord.accounts
      : []
    const allowedDomains = Array.isArray(localRecord.allowedDomains)
      ? localRecord.allowedDomains
      : []
    return {
      localKeys: Object.keys(localRecord).sort(),
      syncKeys: Object.keys(syncRecord).sort(),
      localBytesEstimate: estimateBytes(localRecord),
      syncBytesEstimate: estimateBytes(syncRecord),
      accountCount: accounts.length,
      allowedDomainCount: allowedDomains.length,
      activityLogCount,
      vaultExists: await vault.exists(),
      autoLockMs:
        typeof localRecord.autoLockMs === 'number'
          ? localRecord.autoLockMs
          : null,
    }
  }

  async runMaintenance(): Promise<WotSyncStatus> {
    if (this.#maintenance) return this.#maintenance
    this.#maintenance = (async () => {
      await this.#publisher.retryDue()
      await this.#retryPendingIdentityProofs()
      // Demo mode: never pull kind 32009 from relays (local fixtures only).
      // NIP-39 refresh still runs via identity/proof paths.
      if (this.#appMode() === 'demo') {
        return structuredClone(this.#syncStatus)
      }
      const hasSigner =
        !vault.isLocked() && Boolean(vault.getActivePubkey())
      if (hasSigner && this.#syncStatus.state !== 'running') {
        return this.#startSync()
      }
      return structuredClone(this.#syncStatus)
    })()
    try {
      return await this.#maintenance
    } finally {
      this.#maintenance = undefined
    }
  }

  async #generateIdentity(): Promise<PublicExtensionState> {
    throw new Error(
      'Use the AttentionX onboarding wizard to create or import an identity',
    )
  }

  async #importIdentity(_nsec: string): Promise<PublicExtensionState> {
    throw new Error(
      'Use the AttentionX onboarding wizard to create or import an identity',
    )
  }

  async #clearIdentity(): Promise<PublicExtensionState> {
    throw new Error(
      'Remove accounts from the AttentionX account menu or Security settings',
    )
  }

  async #saveRelays(relays: string[]): Promise<PublicExtensionState> {
    const next = normalizeRelays(relays)
    if (sameRelayList(next, this.#settings.relays)) {
      return this.getPublicState()
    }
    this.#settings.relays = next
    await this.#persistSettings()
    // Keep NIP-07 getRelays() / Network settings in sync with AttentionX.
    const syncCsv = this.#settings.relays.join(',')
    const syncArea = await chrome.storage.sync.get('relays')
    if (syncArea.relays !== syncCsv) {
      await chrome.storage.sync.set({ relays: syncCsv })
    }
    await this.#repository.pruneOutboxRelays(this.#settings.relays, this.#now())
    return this.getPublicState()
  }

  async #persistSettings(): Promise<void> {
    await this.#settingsStore.write({
      relays: [...this.#settings.relays],
      mode: this.#appMode(),
      wotMaxDegree: this.#wotMaxDegree(),
    })
  }

  #secretKey(): Uint8Array {
    if (vault.isLocked()) {
      throw new Error('Unlock the AttentionX vault to sign')
    }
    const key = vault.getPrivkey()
    if (!key) {
      throw new Error(
        'Create or import a signing identity from the AttentionX popup first',
      )
    }
    return key
  }

  #pubkey(): string {
    const active = vault.getActiveAccount()
    if (active?.pubkey) return active.pubkey
    const key = this.#secretKey()
    try {
      return getPublicKey(key)
    } finally {
      key.fill(0)
    }
  }

  /** Active operator pubkey when available without unlocking/signing. */
  #operatorPubkey(): string | undefined {
    const active = vault.getActiveAccount()
    if (active?.pubkey) return active.pubkey.toLowerCase()
    if (vault.isLocked()) return undefined
    const pubkey = vault.getActivePubkey()
    return pubkey ? pubkey.toLowerCase() : undefined
  }

  async #publishTrustStatement(input: {
    subject: TrustSubject
    value: TrustValue
    context?: string
    content?: string
    activationTime?: number
    expirationTime?: number
    hintHandle?: string
  }): Promise<PublishResult> {
    const demoMode = this.#appMode() === 'demo'

    // One-shot proof discovery when trusting an X account that has no binding yet.
    // Skip in demo — local-only trusts should not trigger GraphQL proof search.
    if (!demoMode && input.value === '1' && input.subject.type === 'i') {
      const parsed = parseCanonicalTwitterSubject(input.subject.value)
      if (parsed?.type === 'account') {
        await this.#ensureXProofBindingOnTrust(
          parsed.twitterId,
          input.hintHandle,
        )
      }
    }

    const context = input.context ?? ''
    const publishTags = defaultTrustPublishTags(input.subject)
    const d = await buildKind32009D(
      input.subject,
      publishTags.scopes,
      context,
    )
    const addressKey = addressKeyForEvent(
      {
        id: '',
        pubkey: this.#pubkey(),
        created_at: 0,
        kind: 32009,
        tags: [['d', d]],
        content: '',
        sig: '',
      },
      demoMode ? { state: DEMO_EVENT_STATE } : {},
    )
    const current = await this.#repository.getEventByAddressKey(addressKey)
    const createdAt = Math.max(
      Math.floor(this.#now() / 1_000),
      (current?.created_at ?? -1) + 1,
    )
    const template = await buildKind32009Event({
      subject: input.subject,
      value: input.value,
      context,
      scopes: publishTags.scopes,
      k: publishTags.k,
      content: sanitizeTrustContent(input.content ?? ''),
      activationTime: input.activationTime,
      expirationTime: input.expirationTime,
      createdAt,
      ...(demoMode
        ? { extraTags: DEMO_WOT_EXTRA_TAGS.map((tag) => [...tag]) }
        : {}),
    })
    const trustKey = this.#secretKey()
    let event: Event
    try {
      event = finalizeEvent(template, trustKey)
    } finally {
      trustKey.fill(0)
    }
    const validation = await validateKind32009Event(event)
    if (!validation.valid) throw new Error(validation.errors.join('; '))

    if (demoMode) {
      await this.#repository.ingestEvent({
        event,
        state: DEMO_EVENT_STATE,
      })
      await this.#rebuildGraph()
      this.#broadcastTrustGraphUpdated()
      return {
        eventId: event.id,
        deliveredTo: 0,
        attemptedRelays: 0,
        deliveryStatus: 'complete',
        localOnly: true,
      }
    }

    const now = this.#now()
    const heldUntil = outboxHoldUntil(now)
    await this.#repository.storeEventAndEnqueue(
      event,
      this.#settings.relays,
      { now },
    )
    await this.#rebuildGraph()
    this.#broadcastTrustGraphUpdated()
    await this.#scheduleOutboxHoldRelease(heldUntil)
    this.#logPublishedEvent(event, {
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
      queued: true,
    })
    return {
      eventId: event.id,
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
      heldUntil,
    }
  }

  #queryTrust(
    subject: TrustSubject,
    context?: string,
    rootPubkey?: string,
    now?: number,
    bounds?: Partial<ResolveBounds>,
    format?: 'default' | 'path',
  ): Promise<TrustQueryResult> {
    return this.#ensureGraphReady().then(() => {
      const root = rootPubkey ?? this.#pubkey()
      const resolvedContext = context ?? ''
      if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root pubkey')
      const subjectError = getTrustSubjectValidationError(subject)
      if (subjectError) throw new Error(subjectError)
      if (!isCanonicalTrustContext(resolvedContext)) {
        throw new Error('Context is not canonical')
      }
      return this.#memoizedTrustQuery({
        rootPubkey: root,
        subject,
        context: resolvedContext,
        now,
        bounds,
        format,
      })
    })
  }

  /**
   * Resolves many subjects against one warm graph read. Per-item failures are
   * reported in `errors` so a single bad subject cannot fail a whole timeline.
   */
  #queryTrustBatch(
    items: QueryTrustBatchItem[],
    rootPubkey?: string,
    now?: number,
    bounds?: Partial<ResolveBounds>,
    format?: 'default' | 'path',
  ): Promise<QueryTrustBatchResult> {
    return this.#ensureGraphReady().then(() => {
      const root = rootPubkey ?? this.#pubkey()
      if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root pubkey')

      const results: Record<string, TrustQueryResult> = {}
      const errors: Record<string, string> = {}
      const seen = new Set<string>()

      for (const item of items) {
        const key = item?.key
        if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
          throw new Error('Invalid trust batch item key')
        }
        if (seen.has(key)) throw new Error(`Duplicate trust batch key: ${key}`)
        seen.add(key)

        try {
          const subjectError = getTrustSubjectValidationError(item.subject)
          if (subjectError) throw new Error(subjectError)
          const resolvedContext = item.context ?? ''
          if (!isCanonicalTrustContext(resolvedContext)) {
            throw new Error('Context is not canonical')
          }
          results[key] = this.#memoizedTrustQuery({
            rootPubkey: root,
            subject: item.subject,
            context: resolvedContext,
            now,
            bounds,
            format,
          })
        } catch (error) {
          errors[key] = error instanceof Error ? error.message : String(error)
        }
      }

      return {
        graphVersion: this.#graph.graphVersion,
        results,
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      }
    })
  }

  #memoizedTrustQuery(query: {
    rootPubkey: string
    subject: TrustSubject
    context: string
    now?: number
    bounds?: Partial<ResolveBounds>
    format?: 'default' | 'path'
  }): TrustQueryResult {
    if (this.#trustMemoVersion !== this.#graph.graphVersion) {
      this.#trustMemo.clear()
      this.#trustMemoVersion = this.#graph.graphVersion
    }

    const settingsMaxDepth = this.#wotMaxDegree()
    const maxDepth =
      query.bounds?.maxDepth !== undefined
        ? Math.min(
            Math.max(WOT_MAX_DEGREE_MIN, query.bounds.maxDepth),
            WOT_MAX_DEGREE_HARD_CAP,
          )
        : settingsMaxDepth
    const resolvedQuery = {
      ...query,
      bounds: { ...query.bounds, maxDepth },
    }

    // Only default-bounded "now" queries are memoized; callers that pass custom
    // bounds, format:path, or a pinned timestamp always get a fresh resolve.
    const canMemo =
      query.bounds === undefined &&
      query.now === undefined &&
      query.format !== 'path'
    if (canMemo) {
      const memoKey = `${query.rootPubkey}|${query.subject.type}:${query.subject.value}|${query.context}|${maxDepth}|${query.format ?? 'default'}`
      const cached = this.#trustMemo.get(memoKey)
      if (cached) return cached
      const result = this.#timedTrustQuery(resolvedQuery)
      this.#trustMemo.set(memoKey, result)
      return result
    }
    return this.#timedTrustQuery(resolvedQuery)
  }

  #timedTrustQuery(query: {
    rootPubkey: string
    subject: TrustSubject
    context: string
    now?: number
    bounds?: Partial<ResolveBounds>
    format?: 'default' | 'path'
  }): TrustQueryResult {
    const started =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    const result = this.#graph.query(query)
    const elapsedMs =
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - started
    this.#resolveTiming.record(elapsedMs, result)
    if (
      elapsedMs > WOT_RESOLVE_AUTO_LOWER_MS &&
      this.#wotMaxDegree() > WOT_MAX_DEGREE_MIN
    ) {
      void this.#setWotMaxDegree(this.#wotMaxDegree() - 1)
    }
    return result
  }

  async #getXIdentityDisplays(
    twitterIds: readonly string[],
  ): Promise<Record<string, XIdentityDisplay>> {
    const unique = [
      ...new Set(
        twitterIds.filter(
          (id): id is string =>
            typeof id === 'string' && isTwitterNumericId(id),
        ),
      ),
    ].slice(0, 50)
    const displays: Record<string, XIdentityDisplay> = {}
    for (const twitterId of unique) {
      const row = await this.#repository.getXIdentity(twitterId)
      if (!row) continue
      const handle = row.xProofHandle ?? (row.handle || undefined)
      displays[twitterId] = {
        ...(row.displayName ? { displayName: row.displayName } : {}),
        ...(handle ? { handle } : {}),
        ...(row.iconPath ? { iconPath: row.iconPath } : {}),
      }
    }
    return displays
  }

  async #getXIdentity(
    twitterId: string,
  ): Promise<{ identity: XIdentityRecord } | undefined> {
    if (!isTwitterNumericId(twitterId)) {
      throw new Error('Invalid X account ID')
    }
    const identity = await this.#repository.getXIdentity(twitterId)
    if (!identity) return undefined
    return { identity }
  }

  async #generateXProof(
    handle?: string,
    twitterId?: string,
  ): Promise<{
    npub: string
    proofText: string
    alreadyProven?: Awaited<ReturnType<typeof decideAlreadyProven>>
  }> {
    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)
    const result: {
      npub: string
      proofText: string
      alreadyProven?: Awaited<ReturnType<typeof decideAlreadyProven>>
    } = { npub, proofText: generateNip39ProofText(npub) }

    if (handle && twitterId) {
      if (!isTwitterNumericId(twitterId)) throw new Error('Invalid X account ID')
      // Local-only: prepare/confirm must not wait on relays. CHECK_X_PROOF owns
      // the fast relay budget + page-scan fallback.
      const current = await this.#currentNip39Event(pubkey)
      result.alreadyProven = await decideAlreadyProven(
        {
          expectedPubkey: pubkey,
          expectedTwitterId: twitterId,
          currentEvent: current,
        },
        this.#proofDependencies(),
      )
      if (
        result.alreadyProven.decision === 'already_proven' &&
        result.alreadyProven.verification.state === 'verified'
      ) {
        await this.#recordVerifiedIdentity(
          result.alreadyProven.verification,
          current!.id,
        )
      }
    }
    return result
  }

  async #checkXProof(
    handle: string,
    twitterId: string,
    options: {
      queryRelays: boolean
      scanPage: boolean
      forceRescan?: boolean
    },
  ): Promise<XProofCheckResult> {
    const destination = normalizeProofDestination(handle, twitterId)
    let pubkey: string
    let npub: string
    try {
      pubkey = this.#pubkey()
      npub = nip19.npubEncode(pubkey)
    } catch (error) {
      return {
        status: 'missing_account',
        reason:
          error instanceof Error ? error.message : 'Nostr identity unavailable',
      }
    }
    const proofText = generateNip39ProofText(npub)

    // Always refresh derived status from current columns before reading.
    await this.#syncXIdentityStatus(destination.twitterId)

    // 1) xIdentity is the durable Nostr↔X binding lookup (skip search when known).
    const fromIdentity = await this.#verifiedProofFromLocalIdentity(
      pubkey,
      destination,
      npub,
    )
    if (fromIdentity && !options.forceRescan) return fromIdentity

    // 2) Latest kind 10011 for this Nostr key (local, then optional relay refresh)
    //    narrows which X account is currently claimed — it is not the binding store.
    let current = await this.#currentNip39Event(pubkey)
    let decision = await decideAlreadyProven(
      {
        expectedPubkey: pubkey,
        expectedTwitterId: destination.twitterId,
        currentEvent: current,
      },
      this.#proofDependencies(),
    )
    if (
      decision.decision === 'already_proven' &&
      decision.verification.state === 'verified' &&
      current
    ) {
      if (await this.#recordVerifiedIdentity(decision.verification, current.id)) {
        return {
          status: 'verified',
          handle: decision.verification.handle,
          twitterId: decision.verification.twitterId,
          proofPostId: decision.verification.proofPostId,
          npub,
          source: 'local-event',
        }
      }
    }

    if (options.queryRelays) {
      await this.#refreshNip39FromRelays(pubkey)
      current = await this.#currentNip39Event(pubkey)
      decision = await decideAlreadyProven(
        {
          expectedPubkey: pubkey,
          expectedTwitterId: destination.twitterId,
          currentEvent: current,
        },
        this.#proofDependencies(),
      )
      if (
        decision.decision === 'already_proven' &&
        decision.verification.state === 'verified' &&
        current
      ) {
        if (
          await this.#recordVerifiedIdentity(decision.verification, current.id)
        ) {
          return {
            status: 'verified',
            handle: decision.verification.handle,
            twitterId: decision.verification.twitterId,
            proofPostId: decision.verification.proofPostId,
            npub,
            source: 'relay',
          }
        }
      }
    }

    // Latest 10011 no longer claims this X id — drop stale nip39 columns for it.
    if (current && decision.decision === 'needs_proof') {
      await this.#reconcileNip39Winner(pubkey, current)
    }

    const existing = await this.#repository.getXIdentity(destination.twitterId)
    const missingXProof =
      !existing?.xProofPostId ||
      !existing.xProofNpub ||
      existing.blockedBy === 'missing-x-proof'

    if (
      decision.decision === 'pending' &&
      !options.forceRescan &&
      !missingXProof
    ) {
      return {
        status: 'pending',
        handle: destination.handle,
        twitterId: destination.twitterId,
        npub,
        proofText,
        reason:
          decision.verification.state === 'pending'
            ? decision.verification.reason
            : 'pending',
      }
    }

    // 3) Durable local X-proof side — do not require GraphQL rescan.
    if (
      !options.forceRescan &&
      existing?.xProofPostId &&
      existing.xProofNpub?.toLowerCase() === npub.toLowerCase() &&
      isTwitterNumericId(existing.xProofPostId)
    ) {
      // Both sides already present: never report needs_publish — status sync
      // already derived pending / mismatch / verified from current columns.
      if (existing.nip39Npub && existing.nip39PostId) {
        if (existing.state === 'verified') {
          return {
            status: 'verified',
            handle: destination.handle,
            twitterId: destination.twitterId,
            proofPostId: existing.xProofPostId,
            npub,
            source: 'local-identity',
          }
        }
        return {
          status: 'pending',
          handle: destination.handle,
          twitterId: destination.twitterId,
          npub,
          proofText,
          reason: existing.blockedBy ?? 'pending',
        }
      }
      return {
        status: 'needs_publish',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: existing.xProofPostId,
        npub,
        proofText,
        source: 'local-identity',
      }
    }

    // 4) No local X-proof (or forced / incomplete row) → optional GraphQL search.
    //    Only a found X proof may write xProof* fields — never copy from nip39.
    const shouldScan =
      options.scanPage &&
      (options.forceRescan ||
        missingXProof ||
        decision.decision === 'needs_proof' ||
        decision.decision === 'conflict' ||
        decision.decision === 'pending')
    if (shouldScan) {
      const pagePostId = await this.#findProofPostOnX(
        destination.handle,
        npub,
      )
      if (pagePostId) {
        await this.#recordXProofSide({
          handle: destination.handle,
          twitterId: destination.twitterId,
          postId: pagePostId,
          npub,
        })
        this.#logExtensionActivity({
          method: 'xProofFound',
          decision: 'found',
          domain: 'x.com',
        })
        const afterScan = await this.#verifiedProofFromLocalIdentity(
          pubkey,
          destination,
          npub,
        )
        if (afterScan) {
          return {
            ...afterScan,
            source: options.forceRescan ? 'explicit-search' : 'page-scan',
          }
        }
        return {
          status: 'needs_publish',
          handle: destination.handle,
          twitterId: destination.twitterId,
          proofPostId: pagePostId,
          npub,
          proofText,
          source: options.forceRescan ? 'explicit-search' : 'page-scan',
        }
      }
    }

    // Rescan found nothing — fall back to any durable local X-proof.
    if (
      existing?.xProofPostId &&
      existing.xProofNpub?.toLowerCase() === npub.toLowerCase() &&
      isTwitterNumericId(existing.xProofPostId)
    ) {
      return {
        status: 'needs_publish',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: existing.xProofPostId,
        npub,
        proofText,
        source: 'local-identity',
      }
    }

    if (decision.decision === 'pending') {
      return {
        status: 'pending',
        handle: destination.handle,
        twitterId: destination.twitterId,
        npub,
        proofText,
        reason:
          decision.verification.state === 'pending'
            ? decision.verification.reason
            : 'pending',
      }
    }

    return {
      status: 'not_found',
      handle: destination.handle,
      twitterId: destination.twitterId,
      npub,
      proofText,
    }
  }

  /**
   * Explicit proof discovery for the signed-in X account (self) or any other
   * X user. Updates incomplete xIdentities rows. Content UI may call this later.
   */
  async #searchXProof(
    handle: string,
    twitterId: string,
    options: { forceRescan: boolean },
  ): Promise<XProofCheckResult> {
    const destination = normalizeProofDestination(handle, twitterId)
    const active = await this.#loadActiveXAccount()
    const isSelf =
      Boolean(active?.twitterId) &&
      active!.twitterId === destination.twitterId

    if (isSelf) {
      return this.#checkXProof(destination.handle, destination.twitterId, {
        queryRelays: true,
        scanPage: true,
        forceRescan: options.forceRescan,
      })
    }

    return this.#searchOtherUserXProof(destination, options)
  }

  /**
   * Discover / refresh an X proof post for a non-active (other) X account.
   * Does not publish kind 10011 — only updates xIdentities.
   */
  async #searchOtherUserXProof(
    destination: { handle: string; twitterId: string },
    options: { forceRescan: boolean },
  ): Promise<XProofCheckResult> {
    if (
      !options.forceRescan &&
      (await this.#hasVerifiedXIdentityProof(destination.twitterId))
    ) {
      const identity = await this.#repository.getXIdentity(destination.twitterId)
      const npub =
        identity?.xProofNpub ?? identity?.nip39Npub ?? ''
      return {
        status: 'verified',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: identity!.xProofPostId!,
        npub,
        source: 'local-identity',
      }
    }

    const existing = await this.#repository.getXIdentity(destination.twitterId)
    if (
      !options.forceRescan &&
      existing?.xProofPostId &&
      existing.xProofNpub &&
      isTwitterNumericId(existing.xProofPostId)
    ) {
      const promoted = await this.#tryPromoteOtherUserNip39(
        destination,
        existing.xProofNpub,
        existing.xProofPostId,
      )
      if (promoted) return promoted
      return {
        status: 'needs_publish',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: existing.xProofPostId,
        npub: existing.xProofNpub,
        proofText: generateNip39ProofText(existing.xProofNpub),
        source: 'local-identity',
      }
    }

    const match = await this.#searchProofPostOnX(destination.handle)
    if (!match?.fullText) {
      if (
        existing?.xProofPostId &&
        existing.xProofNpub &&
        isTwitterNumericId(existing.xProofPostId)
      ) {
        return {
          status: 'needs_publish',
          handle: destination.handle,
          twitterId: destination.twitterId,
          proofPostId: existing.xProofPostId,
          npub: existing.xProofNpub,
          proofText: generateNip39ProofText(existing.xProofNpub),
          source: 'local-identity',
        }
      }
      return {
        status: 'not_found',
        handle: destination.handle,
        twitterId: destination.twitterId,
        npub: '',
        proofText: '',
      }
    }

    const npub = extractNpubFromLinkingProofText(match.fullText)
    if (!npub) {
      return {
        status: 'not_found',
        handle: destination.handle,
        twitterId: destination.twitterId,
        npub: '',
        proofText: '',
      }
    }

    await this.#recordXProofSide({
      handle: destination.handle,
      twitterId: destination.twitterId,
      postId: match.postId,
      npub,
    })
    this.#logExtensionActivity({
      method: 'xProofFound',
      decision: 'found',
      domain: 'x.com',
    })

    const promoted = await this.#tryPromoteOtherUserNip39(
      destination,
      npub,
      match.postId,
    )
    if (promoted) return { ...promoted, source: 'explicit-search' }

    return {
      status: 'needs_publish',
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: match.postId,
      npub,
      proofText: generateNip39ProofText(npub),
      source: 'explicit-search',
    }
  }

  async #tryPromoteOtherUserNip39(
    destination: { handle: string; twitterId: string },
    npub: string,
    proofPostId: string,
  ): Promise<Extract<XProofCheckResult, { status: 'verified' }> | undefined> {
    const pubkey = pubkeyFromNpub(npub)
    if (!pubkey) return undefined
    await this.#refreshNip39FromRelays(pubkey)
    const event = await this.#currentNip39Event(pubkey)
    if (!event) return undefined
    const verification = await verifyNip39Proof(
      event,
      this.#proofDependencies(),
    )
    if (
      verification.state === 'verified' &&
      verification.twitterId === destination.twitterId
    ) {
      await this.#recordVerifiedIdentity(verification, event.id)
      return {
        status: 'verified',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: verification.proofPostId || proofPostId,
        npub,
        source: 'relay',
      }
    }
    await this.#recordNip39Side(event, {
      ...(verification.state === 'pending' &&
      verification.reason === 'proof-post-unavailable'
        ? { proofUnavailable: true }
        : {}),
    })
    return undefined
  }

  /**
   * xIdentity lookup: durable binding of this Nostr key to an X account via
   * a previously confirmed proof post id (no GraphQL re-search).
   */
  async #verifiedProofFromLocalIdentity(
    pubkey: string,
    destination: { handle: string; twitterId: string },
    npub: string,
  ): Promise<Extract<XProofCheckResult, { status: 'verified' }> | undefined> {
    const identity = await this.#repository.getXIdentity(destination.twitterId)
    if (
      identity?.state !== 'verified' ||
      typeof identity.xProofPostId !== 'string' ||
      !isTwitterNumericId(identity.xProofPostId)
    ) {
      return undefined
    }
    const boundPubkey =
      pubkeyFromNpub(identity.xProofNpub) ??
      pubkeyFromNpub(identity.nip39Npub)
    if (!boundPubkey || boundPubkey !== pubkey.toLowerCase()) {
      return undefined
    }

    return {
      status: 'verified',
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: identity.xProofPostId,
      npub,
      source: 'local-identity',
    }
  }

  async #refreshNip39FromRelays(pubkey: string): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      this.#nip39RelayRefreshMs,
    )
    try {
      const relayEvents = await this.#relay.queryEvents(
        this.#settings.relays,
        {
          kinds: [NIP39_EVENT_KIND],
          authors: [pubkey],
          limit: MAX_NIP39_EVENTS,
        },
        controller.signal,
      )
      for (const relayEvent of relayEvents) {
        await this.#ingestSupportedEvent(relayEvent)
      }
    } catch {
      // SimplePoolAdapter already records socket/query failures in IndexedDB.
    } finally {
      clearTimeout(timer)
    }
  }

  async #findProofPostOnX(
    handle: string,
    npub: string,
  ): Promise<string | undefined> {
    const match = await this.#searchProofPostOnX(handle, { npub })
    return match?.postId
  }

  /**
   * Silent SearchTimeline GraphQL via an existing signed-in x.com tab.
   * No navigation and no DOM scrape. Call only from gated paths:
   * CHECK_X_PROOF(scanPage) for the active user, or trust-click ensure.
   *
   * With `npub`: search `from:handle "npub"` and require that linking proof.
   * Without: search `from:handle "Linking my account to Nostr:"` and pick latest.
   */
  async #searchProofPostOnX(
    handle: string,
    options: { npub?: string } = {},
  ): Promise<{ postId: string; fullText: string } | undefined> {
    const tab = await this.#findXProductTab()
    if (!tab?.id) return undefined
    const tabId = tab.id

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = (await chrome.tabs.sendMessage(tabId, {
          type: 'SEARCH_PROOF_POST',
          handle,
          ...(options.npub ? { npub: options.npub } : {}),
          timeoutMs: 12_000,
        })) as
          | { postId?: string; fullText?: string }
          | undefined
        if (
          typeof response?.postId === 'string' &&
          isTwitterNumericId(response.postId)
        ) {
          return {
            postId: response.postId,
            fullText:
              typeof response.fullText === 'string' ? response.fullText : '',
          }
        }
        // Empty result is decisive once the content script answered.
        if (response && typeof response === 'object') return undefined
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 400))
          continue
        }
      }
      break
    }
    return undefined
  }

  async #hasVerifiedXIdentityProof(twitterId: string): Promise<boolean> {
    if (!isTwitterNumericId(twitterId)) return false
    const identity = await this.#repository.getXIdentity(twitterId)
    return Boolean(
      identity?.state === 'verified' &&
        typeof identity.xProofPostId === 'string' &&
        isTwitterNumericId(identity.xProofPostId),
    )
  }

  async #resolveHandleForTwitterId(
    twitterId: string,
    hintHandle?: string,
  ): Promise<string | undefined> {
    const fromHint = hintHandle
      ? normalizeObservedHandle(hintHandle)
      : undefined
    if (fromHint) return fromHint

    const identity = await this.#repository.getXIdentity(twitterId)
    return identity?.handle
      ? normalizeObservedHandle(identity.handle)
      : undefined
  }

  /**
   * On trust-author: if xIdentities has no verified proof for this X id,
   * run one GraphQL search and persist any linking proof found.
   * Best-effort — never blocks or fails the trust publish.
   */
  async #ensureXProofBindingOnTrust(
    twitterId: string,
    hintHandle?: string,
  ): Promise<void> {
    try {
      if (await this.#hasVerifiedXIdentityProof(twitterId)) return
      if (this.#proofSearchInFlight.has(twitterId)) return
      this.#proofSearchInFlight.add(twitterId)
      try {
        const handle = await this.#resolveHandleForTwitterId(
          twitterId,
          hintHandle,
        )
        if (!handle) return
        await this.#searchOtherUserXProof(
          { handle, twitterId },
          { forceRescan: false },
        )
      } finally {
        this.#proofSearchInFlight.delete(twitterId)
      }
    } catch {
      // Trust publish must proceed even when proof discovery fails.
    }
  }

  async #ensureActiveXAccount(): Promise<
    | { status: 'ready'; account: ActiveXAccountReport }
    | { status: 'missing'; reason: string; handle?: string }
  > {
    // 1) Live tab (any x.com tab — not only the focused one; the popup can
    //    steal "active" focus depending on Chrome).
    const fromTab = await this.#refreshActiveXAccountFromTab()
    // 2) Session / memory (must survive transient content misses).
    const stored = await this.#loadActiveXAccount()

    const handle = fromTab?.handle ?? stored?.handle
    if (!handle) {
      return {
        status: 'missing',
        reason: 'Open x.com while signed in so AttentionX can detect your account',
      }
    }

    // 3) Numeric ID: live tab → same-handle session.
    let twitterId =
      fromTab?.twitterId && isTwitterNumericId(fromTab.twitterId)
        ? fromTab.twitterId
        : stored?.twitterId &&
            isTwitterNumericId(stored.twitterId) &&
            stored.handle === handle
          ? stored.twitterId
          : undefined

    // 4) One more tab read if we still lack an ID (twid may arrive slightly later).
    if (!twitterId) {
      const again = await this.#refreshActiveXAccountFromTab()
      if (
        again?.handle === handle &&
        again.twitterId &&
        isTwitterNumericId(again.twitterId)
      ) {
        twitterId = again.twitterId
      }
    }

    if (!twitterId) {
      return {
        status: 'missing',
        reason: 'Waiting for X numeric account ID',
        handle,
      }
    }

    const reported = this.#reportActiveXAccount({
      handle,
      twitterId,
      detectedAt: this.#now(),
    })
    if (!reported?.twitterId) {
      return {
        status: 'missing',
        reason: 'Waiting for X numeric account ID',
        handle,
      }
    }

    const existing = await this.#repository.getXIdentity(twitterId)
    const { record } = buildXIdentityFromObservation(existing, {
      twitterId,
      handle,
      observedAt: this.#now(),
      sourceOperation: 'active-account',
    })
    await this.#repository.putXIdentity(record)

    return { status: 'ready', account: reported }
  }

  #isXProductTabUrl(url: string | undefined): boolean {
    if (!url) return false
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
      return host === 'x.com' || host === 'twitter.com'
    } catch {
      return false
    }
  }

  async #findXProductTab(): Promise<chrome.tabs.Tab | undefined> {
    const active = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (active[0] && this.#isXProductTabUrl(active[0].url)) return active[0]

    const inWindow = await chrome.tabs.query({ currentWindow: true })
    const local = inWindow.find((tab) => this.#isXProductTabUrl(tab.url))
    if (local) return local

    const all = await chrome.tabs.query({
      url: [
        'https://x.com/*',
        'https://www.x.com/*',
        'https://twitter.com/*',
        'https://www.twitter.com/*',
      ],
    })
    return all.find((tab) => tab.active) ?? all[0]
  }

  #reportActiveXAccount(
    account: ActiveXAccountReport | null,
  ): ActiveXAccountReport | null {
    if (account === null) {
      this.#activeXAccount = undefined
      void chrome.storage.session
        .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
        .catch(() => undefined)
      return null
    }
    const handle = requireString(account.handle, 'X handle', 16)
      .trim()
      .replace(/^@/, '')
      .toLowerCase()
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
      throw new Error('Invalid active X handle')
    }
    const incomingId =
      account.twitterId === undefined
        ? undefined
        : requireString(account.twitterId, 'X account ID', 24)
    if (incomingId !== undefined && !isTwitterNumericId(incomingId)) {
      throw new Error('Invalid active X account ID')
    }
    const previous = this.#activeXAccount
    // Same handle without an ID must not wipe a previously resolved numeric ID.
    const twitterId =
      incomingId ??
      (previous?.handle === handle &&
      previous.twitterId &&
      isTwitterNumericId(previous.twitterId)
        ? previous.twitterId
        : undefined)
    const detectedAt = this.#now()
    this.#activeXAccount = {
      handle,
      detectedAt,
      ...(twitterId ? { twitterId } : {}),
    }
    void chrome.storage.session
      .set({ [ACTIVE_X_ACCOUNT_SESSION_KEY]: this.#activeXAccount })
      .catch(() => undefined)
    return structuredClone(this.#activeXAccount)
  }

  async #loadActiveXAccount(): Promise<ActiveXAccountReport | undefined> {
    const fromMemory = this.#activeXAccountFromCandidate(this.#activeXAccount)
    if (fromMemory) return structuredClone(fromMemory)

    try {
      const stored = await chrome.storage.session.get(
        ACTIVE_X_ACCOUNT_SESSION_KEY,
      )
      const candidate = stored[ACTIVE_X_ACCOUNT_SESSION_KEY]
      const restored = this.#activeXAccountFromCandidate(candidate)
      if (restored) {
        this.#activeXAccount = restored
        return structuredClone(restored)
      }
    } catch {
      /* session storage unavailable */
    }
    return undefined
  }

  #activeXAccountFromCandidate(
    value: unknown,
  ): ActiveXAccountReport | undefined {
    if (!value || typeof value !== 'object') return undefined
    const record = value as Partial<ActiveXAccountReport>
    if (typeof record.handle !== 'string' || typeof record.detectedAt !== 'number') {
      return undefined
    }
    if (this.#now() - record.detectedAt > ACTIVE_ACCOUNT_TTL_MS) {
      this.#activeXAccount = undefined
      void chrome.storage.session
        .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
        .catch(() => undefined)
      return undefined
    }
    const handle = normalizeObservedHandle(record.handle)
    if (!handle) return undefined
    const twitterId =
      typeof record.twitterId === 'string' && isTwitterNumericId(record.twitterId)
        ? record.twitterId
        : undefined
    return {
      handle,
      detectedAt: record.detectedAt,
      ...(twitterId ? { twitterId } : {}),
    }
  }

  async #refreshActiveXAccountFromTab(): Promise<ActiveXAccountReport | undefined> {
    try {
      const tab = await this.#findXProductTab()
      if (!tab?.id) return undefined
      const response = (await chrome.tabs.sendMessage(tab.id, {
        type: 'GET_ACTIVE_X_ACCOUNT',
      })) as { account?: ActiveXAccountReport | null } | undefined
      // Missing/empty account must not clear session state — only an explicit
      // REPORT_ACTIVE_X_ACCOUNT null (logout) clears it.
      if (!response?.account?.handle) return undefined
      return this.#reportActiveXAccount(response.account) ?? undefined
    } catch {
      return undefined
    }
  }

  async #requireMatchingActiveAccount(
    destination: ProofDestinationAccount,
  ): Promise<void> {
    let active = await this.#loadActiveXAccount()
    if (accountsMatch(active, destination)) return

    active = await this.#refreshActiveXAccountFromTab()
    if (accountsMatch(active, destination)) return

    throw new Error(
      'Active X account must match the destination handle and numeric ID before linking',
    )
  }

  async #prepareProofComposer(
    handle: string,
    twitterId: string,
  ): Promise<ProofComposerPreview> {
    const destination = normalizeProofDestination(handle, twitterId)
    await this.#requireMatchingActiveAccount(destination)
    const generated = await this.#generateXProof(
      destination.handle,
      destination.twitterId,
    )
    const alreadyProven = generated.alreadyProven
    const verifiedExisting =
      alreadyProven?.decision === 'already_proven' &&
      alreadyProven.verification.state === 'verified'
        ? alreadyProven.verification
        : undefined
    return {
      npub: generated.npub,
      proofText: generated.proofText,
      handle: destination.handle,
      twitterId: destination.twitterId,
      alreadyProven: Boolean(verifiedExisting) || alreadyProven?.decision === 'already_proven',
      ...(verifiedExisting
        ? { existingProofPostId: verifiedExisting.proofPostId }
        : {}),
    }
  }

  async #confirmProofComposer(
    handle: string,
    twitterId: string,
  ): Promise<
    | { decision: 'already_proven'; result: PublishResult }
    | {
        decision: 'needs_proof'
        session: ProofComposerSession
        intentUrl: string
      }
  > {
    const preview = await this.#prepareProofComposer(handle, twitterId)
    if (preview.alreadyProven && preview.existingProofPostId) {
      const result = await this.#publishXIdentity(
        preview.handle,
        preview.twitterId,
        preview.existingProofPostId,
      )
      this.#proofSession = undefined
      return { decision: 'already_proven', result }
    }

    const confirmedAt = this.#now()
    const session: ProofComposerSession = {
      handle: preview.handle,
      twitterId: preview.twitterId,
      npub: preview.npub,
      proofText: preview.proofText,
      confirmedAt,
      intentOpenedAt: confirmedAt,
    }
    this.#proofSession = session
    return {
      decision: 'needs_proof',
      session: structuredClone(session),
      intentUrl: buildProofIntentUrl(preview.proofText),
    }
  }

  #getProofSession(): ProofComposerSession | undefined {
    if (!this.#proofSession) return undefined
    if (this.#now() - this.#proofSession.confirmedAt > PROOF_SESSION_TTL_MS) {
      this.#proofSession = undefined
      return undefined
    }
    return structuredClone(this.#proofSession)
  }

  async #captureProofPost(proofTweetId: string): Promise<PublishResult> {
    const session = this.#getProofSession()
    if (!session) {
      throw new Error('No confirmed proof-composer session is active')
    }
    const postId = parseProofPostId(proofTweetId)
    if (!postId) throw new Error('Invalid proof post ID or URL')
    await this.#requireMatchingActiveAccount({
      handle: session.handle,
      twitterId: session.twitterId,
    })
    this.#proofSession = {
      ...session,
      capturedPostId: postId,
    }
    this.#logExtensionActivity({
      method: 'xProofFound',
      decision: 'found',
      domain: 'x.com',
    })
    // Capture is an explicit found-proof observation — write xProof* only here.
    await this.#recordXProofSide({
      handle: session.handle,
      twitterId: session.twitterId,
      postId,
      npub: session.npub,
    })
    const result = await this.#publishXIdentity(
      session.handle,
      session.twitterId,
      postId,
    )
    this.#proofSession = undefined
    return result
  }

  async #verifyXProof(event: Event): Promise<ProofVerificationResult> {
    const validation = validateKind10011TwitterIdentity(event)
    if (!validation.valid) {
      return { state: 'invalid', reason: validation.errors.join('; ') }
    }
    await this.#ingestSupportedEvent(event)
    const verification = await verifyNip39Proof(
      event,
      this.#proofDependencies(),
    )
    const current = await this.#currentNip39Event(event.pubkey)
    if (current?.id !== event.id) return verification

    if (verification.state === 'verified') {
      await this.#recordVerifiedIdentity(verification, event.id)
    } else {
      await this.#recordNip39Side(event, {
        ...(verification.state === 'pending' &&
        verification.reason === 'proof-post-unavailable'
          ? { proofUnavailable: true }
          : {}),
      })
    }
    return verification
  }

  async #prepareXIdentityPublish(
    handle: string,
    twitterId: string,
    proofTweetId: string,
  ): Promise<XIdentityPublishPreview> {
    const destination = normalizeProofDestination(handle, twitterId)
    const postId = parseProofPostId(proofTweetId)
    if (!postId) throw new Error('Invalid proof post ID or URL')
    await this.#requireMatchingActiveAccount(destination)

    const identity = await this.#repository.getXIdentity(destination.twitterId)
    if (
      !identity?.xProofPostId ||
      identity.xProofPostId !== postId
    ) {
      // Allow publish when the proof post matches the local X-proof side, or
      // when the caller supplies a freshly verified post id (composer capture).
      if (identity?.xProofPostId && identity.xProofPostId !== postId) {
        throw new Error(
          'Proof post ID does not match the local X proof for this account',
        )
      }
    }

    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)
    try {
      await this.#refreshNip39FromRelays(pubkey)
    } catch {
      /* use cached replacement */
    }
    return this.#buildXIdentityPublishPreview({
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: postId,
      npub,
      existing: await this.#currentNip39Event(pubkey),
    })
  }

  #buildXIdentityPublishPreview(input: {
    handle: string
    twitterId: string
    proofPostId: string
    npub: string
    existing: Event | undefined
  }): XIdentityPublishPreview {
    const inspected = input.existing
      ? inspectExistingTwitterTags(input.existing.tags)
      : { rawTwitterTags: [], hasTwitterTags: false }
    const target = {
      handle: input.handle,
      twitterId: input.twitterId,
      proofPostId: input.proofPostId,
    }
    const change = classifyKind10011PublishChange(inspected, target)
    const createdAt = Math.max(
      Math.floor(this.#now() / 1_000),
      (input.existing?.created_at ?? -1) + 1,
    )
    const template = buildKind10011Event({
      ...target,
      createdAt,
      existingEvent: input.existing,
    })
    const preservedTagCount = countPreservedKind10011Tags(
      input.existing?.tags ?? [],
    )
    return {
      handle: input.handle,
      twitterId: input.twitterId,
      proofPostId: input.proofPostId,
      npub: input.npub,
      existingEventId: input.existing?.id ?? null,
      change,
      ...(inspected.claim
        ? {
            existingTwitter: {
              handle: inspected.claim.handle,
              twitterId: inspected.claim.twitterId,
              proofPostId: inspected.claim.proofPostId,
            },
          }
        : {}),
      ...(inspected.hasTwitterTags && !inspected.claim
        ? { existingTwitterTags: inspected.rawTwitterTags }
        : {}),
      preservedTagCount,
      preservesContent: Boolean(input.existing?.content),
      eventPreview: {
        kind: 10011,
        created_at: template.created_at,
        content: template.content,
        tags: template.tags.map((tag) => [...tag]),
      },
    }
  }

  async #confirmXIdentityPublish(input: {
    handle: string
    twitterId: string
    proofTweetId: string
    existingEventId: string | null
    confirmReplacement: boolean
  }): Promise<XIdentityPublishResult> {
    const destination = normalizeProofDestination(input.handle, input.twitterId)
    const postId = parseProofPostId(input.proofTweetId)
    if (!postId) throw new Error('Invalid proof post ID or URL')
    await this.#requireMatchingActiveAccount(destination)

    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)
    try {
      await this.#refreshNip39FromRelays(pubkey)
    } catch {
      /* use cached replacement */
    }
    const existing = await this.#currentNip39Event(pubkey)
    const currentId = existing?.id ?? null
    if (currentId !== input.existingEventId) {
      const preview = this.#buildXIdentityPublishPreview({
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: postId,
        npub,
        existing,
      })
      return {
        status: 'stale-preview',
        reason:
          'Your kind 10011 changed since the preview. Review the updated event before publishing.',
        preview,
      }
    }

    const preview = this.#buildXIdentityPublishPreview({
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: postId,
      npub,
      existing,
    })
    if (preview.change === 'replace' && !input.confirmReplacement) {
      return {
        status: 'replacement-required',
        reason:
          'Publishing will replace the existing X identity on your kind 10011. Confirm replacement to continue.',
        preview,
      }
    }

    return this.#signPersistAndPublishXIdentity({
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: postId,
      existing,
      flush: true,
      npub,
    })
  }

  async #publishXIdentity(
    handle: string,
    twitterId: string,
    proofTweetId: string,
    options: { flush?: boolean } = {},
  ): Promise<PublishResult> {
    const flush = options.flush !== false
    const destination = normalizeProofDestination(handle, twitterId)
    const postId = parseProofPostId(proofTweetId)
    if (!postId) throw new Error('Invalid proof post ID or URL')
    await this.#requireMatchingActiveAccount(destination)

    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)
    if (flush) {
      try {
        await this.#refreshNip39FromRelays(pubkey)
      } catch {
        /* use cached replacement */
      }
    }
    const existing = await this.#currentNip39Event(pubkey)
    const published = await this.#signPersistAndPublishXIdentity({
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: postId,
      existing,
      flush,
      npub,
    })
    return {
      eventId: published.eventId,
      deliveredTo: published.deliveredTo,
      attemptedRelays: published.attemptedRelays,
      deliveryStatus: published.deliveryStatus,
      ...(published.heldUntil !== undefined
        ? { heldUntil: published.heldUntil }
        : {}),
    }
  }

  async #signPersistAndPublishXIdentity(input: {
    handle: string
    twitterId: string
    proofPostId: string
    existing: Event | undefined
    flush: boolean
    npub: string
  }): Promise<Extract<XIdentityPublishResult, { status: 'published' }>> {
    const template = buildKind10011Event({
      handle: input.handle,
      twitterId: input.twitterId,
      proofPostId: input.proofPostId,
      createdAt: Math.max(
        Math.floor(this.#now() / 1_000),
        (input.existing?.created_at ?? -1) + 1,
      ),
      existingEvent: input.existing,
    })
    const proofKey = this.#secretKey()
    let event: Event
    try {
      event = finalizeEvent(template, proofKey)
    } finally {
      proofKey.fill(0)
    }

    const signed = validateSignedKind10011Event(event)
    if (!signed.valid) {
      throw new Error(signed.errors.join('; '))
    }

    // Persist locally first so xIdentities updates before relay delivery.
    if (input.flush) {
      await this.#repository.storeEventAndEnqueue(event, this.#settings.relays, {
        now: this.#now(),
      })
    } else {
      await this.#repository.ingestEvent({
        event,
        observedAt: this.#now(),
      })
    }
    await this.#reconcileNip39Winner(event.pubkey, event)

    const verification = await verifyNip39Proof(
      event,
      this.#proofDependencies(),
    )
    let identityState: 'verified' | 'pending' | 'unverified' = 'unverified'
    let blockedBy: XIdentityBlockedBy | undefined
    if (
      verification.state === 'verified' &&
      verification.twitterId === input.twitterId
    ) {
      // May stay unverified if X-proof side was never discovered independently.
      await this.#recordVerifiedIdentity(verification, event.id)
    } else {
      await this.#recordNip39Side(event, {
        ...(verification.state === 'pending' &&
        verification.reason === 'proof-post-unavailable'
          ? { proofUnavailable: true }
          : {}),
      })
    }
    const row = await this.#repository.getXIdentity(input.twitterId)
    identityState =
      row?.state === 'pending'
        ? 'pending'
        : row?.state === 'verified'
          ? 'verified'
          : 'unverified'
    blockedBy = row?.blockedBy

    let delivery: PublishResult = {
      eventId: event.id,
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
    }
    if (input.flush) {
      const heldUntil = outboxHoldUntil(this.#now())
      delivery = {
        eventId: event.id,
        deliveredTo: 0,
        attemptedRelays: 0,
        deliveryStatus: 'pending',
        heldUntil,
      }
      await this.#scheduleOutboxHoldRelease(heldUntil)
    }
    this.#logPublishedEvent(event, {
      ...delivery,
      ...(input.flush ? {} : { queued: true }),
    })

    return {
      status: 'published',
      eventId: delivery.eventId,
      deliveredTo: delivery.deliveredTo,
      attemptedRelays: delivery.attemptedRelays,
      deliveryStatus: delivery.deliveryStatus,
      ...(delivery.heldUntil !== undefined
        ? { heldUntil: delivery.heldUntil }
        : {}),
      identityState,
      ...(blockedBy ? { blockedBy } : {}),
      handle: input.handle,
      twitterId: input.twitterId,
      proofPostId: input.proofPostId,
      npub: input.npub,
    }
  }

  #logExtensionActivity(entry: {
    method: string
    decision: string
    kind?: number
    domain?: string
    eventId?: string
    reason?: string
    pubkey?: string
  }): void {
    void logActivity({
      domain: entry.domain ?? 'attentionx',
      method: entry.method,
      decision: entry.decision,
      ...(entry.kind !== undefined ? { kind: entry.kind } : {}),
      ...(entry.eventId ? { eventId: entry.eventId } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.pubkey ? { pubkey: entry.pubkey } : {}),
    })
  }

  #logPublishedEvent(
    event: Event,
    delivery: Pick<
      PublishResult,
      'deliveryStatus' | 'deliveredTo' | 'attemptedRelays'
    > & { queued?: boolean },
  ): void {
    const decision = delivery.queued
      ? 'pending'
      : delivery.deliveryStatus === 'complete' ||
          delivery.deliveryStatus === 'partial'
        ? 'approved'
        : delivery.deliveryStatus === 'failed'
          ? 'rejected'
          : 'pending'
    this.#logExtensionActivity({
      method: 'signEvent',
      decision,
      kind: event.kind,
      pubkey: event.pubkey,
      eventId: event.id,
      ...(decision === 'rejected'
        ? { reason: delivery.deliveryStatus || 'publish_failed' }
        : {}),
    })
  }

  #proofDependencies() {
    return {
      verifyEvent: (event: Event) => verifyEvent(event),
      toNpub: (pubkey: string) => nip19.npubEncode(pubkey),
      queryProofPost: this.#queryProofPost,
      resolveProfile: (handle: string) => this.#resolvePublicProfile(handle),
    }
  }

  async #resolvePublicProfile(handle: string): Promise<XIdentityResolution> {
    const now = this.#now()
    try {
      const response = await this.#fetch(`https://x.com/${handle}`, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'follow',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      })
      if (!response.ok) throw new Error(`profile-http-${response.status}`)
      const contentType = response.headers.get('content-type') ?? ''
      if (!/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
        throw new Error('profile-invalid-content')
      }
      const declaredLength = Number(response.headers.get('content-length'))
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_PROFILE_HTML_BYTES
      ) {
        throw new Error('profile-too-large')
      }
      const html = await response.text()
      if (new TextEncoder().encode(html).byteLength > MAX_PROFILE_HTML_BYTES) {
        throw new Error('profile-too-large')
      }
      const ids = extractTwitterIdsFromProfileJsonLd(html)
      if (ids.length === 1) {
        return {
          state: 'resolved',
          handle: handle.toLowerCase(),
          twitterId: ids[0]!,
          provenance: 'profile-jsonld',
          resolvedAt: now,
          expiresAt: now + 6 * 60 * 60 * 1_000,
        }
      }
      if (ids.length > 1) {
        return {
          state: 'conflict',
          handle: handle.toLowerCase(),
          resolvedAt: now,
          expiresAt: now + 15 * 60 * 1_000,
          candidates: ids.map((twitterId) => ({
            twitterId,
            provenance: 'profile-jsonld',
            observedAt: now,
          })),
        }
      }
    } catch {
      // The verifier reports a pending public-profile resolution below.
    }
    return {
      state: 'pending',
      handle: handle.toLowerCase(),
      resolvedAt: now,
      expiresAt: now + 60_000,
      retryAt: now + 60_000,
      reasons: ['profile-unavailable'],
    }
  }

  /**
   * Recompute `state` / `blockedBy` from the current xIdentities columns only.
   * Does not load kind 10011 events or run live oEmbed. Broadcasts when
   * derived status changes.
   */
  async #syncXIdentityStatus(
    twitterId: string,
    options: { proofUnavailable?: boolean } = {},
  ): Promise<XIdentityRecord | undefined> {
    if (!isTwitterNumericId(twitterId)) return undefined
    const row = await this.#repository.getXIdentity(twitterId)
    if (!row) return undefined

    const previousState = row.state
    const previousBlockedBy = row.blockedBy
    const now = this.#now()
    const evaluation = evaluateXIdentityRow(row, options)

    // Log only out-of-sync / mismatch cases — not missing-side gaps.
    if (evaluation.blockedBy === 'mismatch') {
      this.#logExtensionActivity({
        method: 'xIdentityStatus',
        decision: 'out_of_sync',
        reason: 'columns-mismatch',
      })
    }

    if (evaluation.columnsAligned) {
      const npub = (row.xProofNpub ?? row.nip39Npub)!.toLowerCase()
      const rawHandle = row.xProofHandle ?? row.nip39Handle ?? row.handle
      const handle = rawHandle
        ? (normalizeObservedHandle(rawHandle) ?? rawHandle.toLowerCase())
        : undefined
      const boundBeforeClear =
        await this.#repository.getXIdentitiesByNip39Npub(npub)
      await this.#repository.clearNip39BindingByNpub(npub, now)
      for (const sibling of boundBeforeClear) {
        if (sibling.twitterId === twitterId) continue
        await this.#syncXIdentityStatus(sibling.twitterId)
      }
      const afterClear = await this.#repository.getXIdentity(twitterId)
      const xProofHandle =
        afterClear?.xProofHandle ?? row.xProofHandle ?? handle
      const nip39EventId = row.nip39EventId ?? afterClear?.nip39EventId
      const next: XIdentityRecord = {
        twitterId,
        handle: handle ?? afterClear?.handle ?? row.handle,
        ...preserveXIdentityProfileFields(afterClear ?? row),
        xProofNpub: afterClear?.xProofNpub ?? row.xProofNpub!,
        xProofPostId: afterClear?.xProofPostId ?? row.xProofPostId!,
        ...(xProofHandle ? { xProofHandle } : {}),
        ...(afterClear?.xProofObservedAt !== undefined ||
        row.xProofObservedAt !== undefined
          ? {
              xProofObservedAt:
                afterClear?.xProofObservedAt ?? row.xProofObservedAt!,
            }
          : { xProofObservedAt: now }),
        nip39Npub: npub,
        nip39XId: twitterId,
        ...(handle ? { nip39Handle: handle } : {}),
        nip39PostId: row.nip39PostId!,
        ...(nip39EventId ? { nip39EventId } : {}),
        nip39ObservedAt: row.nip39ObservedAt ?? afterClear?.nip39ObservedAt ?? now,
        state: 'verified',
        verifiedAt: row.verifiedAt ?? now,
        createdAt: afterClear?.createdAt ?? row.createdAt,
        updatedAt: now,
        lastSeen: afterClear?.lastSeen ?? row.lastSeen,
      }
      await this.#repository.putXIdentity(next)
      this.#markGraphDirtyOnVerifiedChange(previousState, 'verified')
      this.#graphDirty = true
      if (previousState !== 'verified' || previousBlockedBy !== undefined) {
        this.#broadcastXIdentityUpdated(next)
      }
      return next
    }

    const next: XIdentityRecord = {
      twitterId: row.twitterId,
      handle: row.handle,
      ...(row.displayName ? { displayName: row.displayName } : {}),
      ...(row.iconPath ? { iconPath: row.iconPath } : {}),
      ...(row.xProofNpub ? { xProofNpub: row.xProofNpub } : {}),
      ...(row.xProofPostId ? { xProofPostId: row.xProofPostId } : {}),
      ...(row.xProofHandle ? { xProofHandle: row.xProofHandle } : {}),
      ...(row.xProofObservedAt !== undefined
        ? { xProofObservedAt: row.xProofObservedAt }
        : {}),
      ...(row.nip39Npub ? { nip39Npub: row.nip39Npub } : {}),
      ...(row.nip39XId ? { nip39XId: row.nip39XId } : {}),
      ...(row.nip39Handle ? { nip39Handle: row.nip39Handle } : {}),
      ...(row.nip39PostId ? { nip39PostId: row.nip39PostId } : {}),
      ...(row.nip39EventId ? { nip39EventId: row.nip39EventId } : {}),
      ...(row.nip39ObservedAt !== undefined
        ? { nip39ObservedAt: row.nip39ObservedAt }
        : {}),
      state: evaluation.state,
      createdAt: row.createdAt,
      updatedAt: now,
      lastSeen: row.lastSeen,
      ...(evaluation.blockedBy ? { blockedBy: evaluation.blockedBy } : {}),
      ...(row.verifiedAt !== undefined && evaluation.state === 'verified'
        ? { verifiedAt: row.verifiedAt }
        : {}),
    }

    const statusChanged =
      next.state !== previousState || next.blockedBy !== previousBlockedBy
    await this.#repository.putXIdentity(next)
    if (statusChanged) {
      this.#markGraphDirtyOnVerifiedChange(previousState, next.state)
      this.#broadcastXIdentityUpdated(next)
    }
    return next
  }

  async #syncXIdentityStatusForUi(
    twitterId: string,
  ): Promise<XIdentityStatusSyncResult> {
    if (!isTwitterNumericId(twitterId)) {
      throw new Error('Invalid X account ID')
    }
    const before = await this.#repository.getXIdentity(twitterId)
    if (!before) {
      throw new Error('No xIdentities record for this X account')
    }
    const previousState = before.state
    const previousBlockedBy = before.blockedBy
    const synced = await this.#syncXIdentityStatus(twitterId)
    const identity = synced ?? before
    const changed =
      identity.state !== previousState ||
      identity.blockedBy !== previousBlockedBy
    return {
      twitterId,
      previousState,
      ...(previousBlockedBy ? { previousBlockedBy } : {}),
      state: identity.state,
      ...(identity.blockedBy ? { blockedBy: identity.blockedBy } : {}),
      changed,
      identity: this.#toXIdentityListRow(identity),
    }
  }

  #broadcastXIdentityUpdated(record: XIdentityRecord): void {
    const message = {
      type: 'X_IDENTITY_UPDATED' as const,
      twitterId: record.twitterId,
      state: record.state,
      handle: record.handle,
      ...(record.blockedBy ? { blockedBy: record.blockedBy } : {}),
    }
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined)
    } catch {
      /* no extension page listening */
    }
    void chrome.tabs
      .query({
        url: [
          'https://x.com/*',
          'https://www.x.com/*',
          'https://twitter.com/*',
          'https://www.twitter.com/*',
        ],
      })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue
          void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  }

  /**
   * Promote when sync finds aligned columns + successful verify.
   * Prefer `#syncXIdentityStatus` after field writes.
   */
  async #recordVerifiedIdentity(
    verification: Extract<ProofVerificationResult, { state: 'verified' }>,
    eventId?: string,
  ): Promise<boolean> {
    const npub = npubFromPubkey(verification.nostrPubkey)
    if (!npub) return false
    const existing = await this.#repository.getXIdentity(verification.twitterId)
    const now = this.#now()
    const handle =
      normalizeObservedHandle(verification.handle) ?? verification.handle

    // Ensure nip39 columns reflect this event without touching xProof*.
    await this.#repository.putXIdentity({
      twitterId: verification.twitterId,
      handle,
      ...preserveXIdentityProfileFields(existing),
      ...(existing?.xProofNpub ? { xProofNpub: existing.xProofNpub } : {}),
      ...(existing?.xProofPostId
        ? { xProofPostId: existing.xProofPostId }
        : {}),
      ...(existing?.xProofHandle
        ? { xProofHandle: existing.xProofHandle }
        : {}),
      ...(existing?.xProofObservedAt !== undefined
        ? { xProofObservedAt: existing.xProofObservedAt }
        : {}),
      nip39Npub: npub,
      nip39XId: verification.twitterId,
      nip39Handle: handle,
      nip39PostId: verification.proofPostId,
      ...(eventId
        ? { nip39EventId: eventId }
        : existing?.nip39EventId
          ? { nip39EventId: existing.nip39EventId }
          : {}),
      nip39ObservedAt: now,
      state: existing?.state ?? 'unverified',
      ...(existing?.blockedBy ? { blockedBy: existing.blockedBy } : {}),
      ...(existing?.verifiedAt !== undefined
        ? { verifiedAt: existing.verifiedAt }
        : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    const synced = await this.#syncXIdentityStatus(verification.twitterId)
    return synced?.state === 'verified'
  }

  /**
   * Record the X-proof side from a found proof post (GraphQL / page scan).
   * Authoritative for xProof* columns. Never written from kind 10011 alone.
   * Clears nip39 columns when they contradict the discovered xProofNpub.
   * Always re-runs status sync afterward.
   */
  async #recordXProofSide(input: {
    handle: string
    twitterId: string
    postId: string
    npub: string
  }): Promise<void> {
    const now = this.#now()
    const npub = input.npub.trim().toLowerCase()
    if (!npub.startsWith('npub1')) return
    const handle =
      normalizeObservedHandle(input.handle) ?? input.handle.toLowerCase()

    const existing = await this.#repository.getXIdentity(input.twitterId)
    const nip39Contradicts =
      Boolean(existing?.nip39Npub) &&
      existing!.nip39Npub!.toLowerCase() !== npub

    await this.#repository.putXIdentity({
      twitterId: input.twitterId,
      handle,
      ...preserveXIdentityProfileFields(existing),
      xProofNpub: npub,
      xProofPostId: input.postId,
      xProofHandle: handle,
      xProofObservedAt: now,
      ...(nip39Contradicts
        ? {}
        : {
            ...(existing?.nip39Npub ? { nip39Npub: existing.nip39Npub } : {}),
            ...(existing?.nip39XId ? { nip39XId: existing.nip39XId } : {}),
            ...(existing?.nip39Handle
              ? { nip39Handle: existing.nip39Handle }
              : {}),
            ...(existing?.nip39PostId
              ? { nip39PostId: existing.nip39PostId }
              : {}),
            ...(existing?.nip39EventId
              ? { nip39EventId: existing.nip39EventId }
              : {}),
            ...(existing?.nip39ObservedAt !== undefined
              ? { nip39ObservedAt: existing.nip39ObservedAt }
              : {}),
          }),
      state: existing?.state ?? 'unverified',
      ...(existing?.blockedBy ? { blockedBy: existing.blockedBy } : {}),
      ...(existing?.verifiedAt !== undefined
        ? { verifiedAt: existing.verifiedAt }
        : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    await this.#syncXIdentityStatus(input.twitterId)
  }

  /**
   * Record the kind-10011 side of an identity row. Writes nip39* only —
   * never invents or overrides xProof* fields. Ignored when it would
   * contradict an authoritative X-proof npub already stored on the row.
   * Always re-runs status sync afterward.
   */
  async #recordNip39Side(
    event: Event,
    options: { proofUnavailable?: boolean } = {},
  ): Promise<void> {
    const parsed = parseNip39TwitterClaim(event)
    if (parsed.state !== 'valid') return

    const npub = npubFromPubkey(event.pubkey)
    if (!npub) return

    const claim = parsed.claim
    const existing = await this.#repository.getXIdentity(claim.twitterId)

    if (
      existing?.xProofNpub &&
      existing.xProofNpub.toLowerCase() !== npub
    ) {
      return
    }

    const now = this.#now()
    const handle = claim.handle
    await this.#repository.putXIdentity({
      twitterId: claim.twitterId,
      handle,
      ...preserveXIdentityProfileFields(existing),
      ...(existing?.xProofNpub ? { xProofNpub: existing.xProofNpub } : {}),
      ...(existing?.xProofPostId
        ? { xProofPostId: existing.xProofPostId }
        : {}),
      ...(existing?.xProofHandle
        ? { xProofHandle: existing.xProofHandle }
        : {}),
      ...(existing?.xProofObservedAt !== undefined
        ? { xProofObservedAt: existing.xProofObservedAt }
        : {}),
      nip39Npub: npub,
      nip39XId: claim.twitterId,
      nip39Handle: handle,
      nip39PostId: claim.proofPostId,
      nip39EventId: event.id,
      nip39ObservedAt: now,
      state: existing?.state ?? 'unverified',
      ...(existing?.blockedBy ? { blockedBy: existing.blockedBy } : {}),
      ...(existing?.verifiedAt !== undefined
        ? { verifiedAt: existing.verifiedAt }
        : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    await this.#syncXIdentityStatus(claim.twitterId, options)
  }

  async #retryPendingIdentityProofs(): Promise<void> {
    const identities = await this.#repository.getAllXIdentities()
    const candidates = identities
      .filter(
        (row) =>
          row.state === 'pending' ||
          row.blockedBy === 'proof-unavailable' ||
          (row.state === 'unverified' &&
            Boolean(row.nip39Npub && row.nip39PostId)),
      )
      .slice(0, 10)

    for (const row of candidates) {
      await this.#syncXIdentityStatus(row.twitterId)
    }
  }

  #markGraphDirtyOnVerifiedChange(
    previous: XIdentityRecord['state'] | undefined,
    next: XIdentityRecord['state'],
  ): void {
    const wasVerified = previous === 'verified'
    const isVerified = next === 'verified'
    if (wasVerified !== isVerified) {
      this.#graphDirty = true
    }
  }

  async #ensureGraphReady(): Promise<void> {
    if (
      this.#graphDirty ||
      this.#graph.graphVersion === 0 ||
      this.#graph.listStatements().length === 0
    ) {
      await this.#rebuildGraph()
    }
  }

  async #currentNip39Event(pubkey: string): Promise<Event | undefined> {
    const winner = await this.#repository.getEventByAddressKey(
      eventAddress(NIP39_EVENT_KIND, pubkey, ''),
    )
    if (winner) return winner
    return (await this.#repository.getEventsByPubkey(pubkey))
      .filter((event) => validateSignedKind10011Event(event).valid)
      .sort(
        (left, right) =>
          right.created_at - left.created_at ||
          left.id.localeCompare(right.id),
      )[0]
  }

  async #ingestSupportedEvent(event: Event): Promise<boolean> {
    if (event.kind === 32009) {
      // Demo mode never stores live kind 32009 from relays / legacy import paths.
      if (this.#appMode() === 'demo') return false
      return (await this.#syncRepository.ingestEvent(event)) !== 'rejected'
    }
    if (event.kind !== NIP39_EVENT_KIND) return false
    const validation = validateSignedKind10011Event(event)
    if (!validation.valid) return false

    const stored = await this.#repository.ingestEvent({
      event,
      observedAt: this.#now(),
    })
    if (stored.id === event.id) {
      await this.#reconcileNip39Winner(event.pubkey, event)
    }
    return true
  }

  async #rebuildNip39Winners(): Promise<void> {
    const events = (await this.#repository.getEventsByKind(NIP39_EVENT_KIND))
      .filter((event) => validateSignedKind10011Event(event).valid)
    const winners = new Map<string, Event>()
    for (const event of events) {
      const current = winners.get(event.pubkey)
      if (
        !current ||
        event.created_at > current.created_at ||
        (event.created_at === current.created_at && event.id < current.id)
      ) {
        winners.set(event.pubkey, event)
      }
    }

    const identities = await this.#repository.getAllXIdentities()
    const authors = new Set([
      ...winners.keys(),
      ...identities.flatMap((identity) => {
        const keys: string[] = []
        const fromX = pubkeyFromNpub(identity.xProofNpub)
        const fromNip39 = pubkeyFromNpub(identity.nip39Npub)
        if (fromX) keys.push(fromX)
        if (fromNip39) keys.push(fromNip39)
        return keys
      }),
    ])
    for (const pubkey of authors) {
      await this.#reconcileNip39Winner(pubkey, winners.get(pubkey))
    }
  }

  async #reconcileNip39Winner(
    pubkey: string,
    winner: Event | undefined,
  ): Promise<void> {
    const npub = npubFromPubkey(pubkey)
    if (!npub) return

    const twitter = winner
      ? validateKind10011TwitterIdentity(winner)
      : undefined
    const claimedTwitterId =
      twitter?.valid === true ? twitter.identity.twitterId : undefined

    const bound = await this.#repository.getXIdentitiesByNip39Npub(npub)

    if (!claimedTwitterId || !winner) {
      if (bound.length === 0) return
      await this.#repository.clearNip39BindingByNpub(npub, this.#now())
      for (const row of bound) {
        await this.#syncXIdentityStatus(row.twitterId)
      }
      return
    }

    const verification = await verifyNip39Proof(
      winner,
      this.#proofDependencies(),
    )
    if (
      verification.state === 'verified' &&
      verification.twitterId === claimedTwitterId
    ) {
      await this.#recordVerifiedIdentity(verification, winner.id)
      return
    }

    // Clear stale bindings on other rows, then record nip39 for the claim.
    if (bound.some((row) => row.twitterId !== claimedTwitterId)) {
      const stale = bound.filter((row) => row.twitterId !== claimedTwitterId)
      await this.#repository.clearNip39BindingByNpub(npub, this.#now())
      for (const row of stale) {
        await this.#syncXIdentityStatus(row.twitterId)
      }
    }

    await this.#recordNip39Side(winner, {
      ...(verification.state === 'pending' &&
      verification.reason === 'proof-post-unavailable'
        ? { proofUnavailable: true }
        : {}),
    })
  }

  /**
   * Rebuild the in-memory graph from IndexedDB winners.
   * - Demo: only demo-tagged/state kind 32009 events.
   * - Production: only kind 32009 authored by the operator or verified X identities.
   */
  async #rebuildGraph(): Promise<void> {
    const mode = this.#appMode()
    const identities = await this.#repository.getAllXIdentities()
    const twitterIdToPubkey = new Map<string, string>()
    const verifiedPubkeys = new Set<string>()
    for (const identity of identities) {
      if (identity.state !== 'verified') continue
      const pubkey =
        pubkeyFromNpub(identity.xProofNpub) ??
        pubkeyFromNpub(identity.nip39Npub)
      if (!pubkey) continue
      const normalized = pubkey.toLowerCase()
      verifiedPubkeys.add(normalized)
      twitterIdToPubkey.set(identity.twitterId, normalized)
    }

    const scoped = await this.#loadGraphSourceEvents(mode, verifiedPubkeys)
    const reduced = await reduceKind32009Events(scoped)
    const real = reduced.statements.map(reducedStatement)

    const derived: ReducedTrustStatement[] = []
    for (const statement of real) {
      if (statement.subject.type !== 'i' || statement.value !== 1) continue
      const parsed = parseCanonicalTwitterSubject(statement.subject.value)
      if (!parsed || parsed.type !== 'account') continue
      const pubkey = twitterIdToPubkey.get(parsed.twitterId)
      if (!pubkey) continue
      derived.push({
        eventId: statement.eventId,
        author: statement.author,
        subject: { type: 'p', value: pubkey },
        context: statement.context,
        value: statement.value,
        createdAt: statement.createdAt,
        ...(statement.activeFrom !== undefined
          ? { activeFrom: statement.activeFrom }
          : {}),
        ...(statement.activeUntil !== undefined
          ? { activeUntil: statement.activeUntil }
          : {}),
        derivedFrom: {
          subject: { ...statement.subject },
          twitterId: parsed.twitterId,
        },
      })
    }

    // Real statements first, then derived — derived must not replace non-derived.
    this.#graph.rebuild([...real, ...derived])
    this.#graphDirty = false
    this.#trustMemo.clear()
    this.#trustMemoVersion = this.#graph.graphVersion
  }

  async #loadGraphSourceEvents(
    mode: AppMode,
    verifiedPubkeys: ReadonlySet<string>,
  ): Promise<EventRecord[]> {
    if (mode === 'demo') {
      const events = await this.#repository.getEventsByKind(32009)
      return events.filter((event) => isDemoWotEvent(event))
    }

    const authors = new Set(verifiedPubkeys)
    const operator = this.#operatorPubkey()
    if (operator) authors.add(operator)
    if (authors.size === 0) return []

    const byId = new Map<string, EventRecord>()
    for (const pubkey of authors) {
      for (const event of await this.#repository.getEventsByPubkey(pubkey)) {
        if (event.kind !== 32009) continue
        if (isDemoWotEvent(event)) continue
        byId.set(event.id, event)
      }
    }
    return [...byId.values()]
  }

  #startSync(
    overlapSeconds = WOT_OVERLAP_SECONDS,
    bounds?: Partial<GraphBounds>,
  ): WotSyncStatus {
    // Demo trust evidence is local-only — do not download kind 32009 from relays.
    // NIP-39 (kind 10011) continues via #refreshNip39FromRelays on proof/identity paths.
    if (this.#appMode() === 'demo') {
      return { state: 'idle' }
    }
    if (this.#syncStatus.state === 'running') {
      return structuredClone(this.#syncStatus)
    }
    if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0) {
      throw new Error('overlapSeconds must be non-negative')
    }
    const rootPubkey = this.#pubkey()
    const limits = syncLimits({
      maxDepth: this.#wotMaxDegree(),
      ...bounds,
    })
    const controller = new AbortController()
    const startedAt = this.#now()
    this.#syncController = controller
    this.#syncStatus = { state: 'running', startedAt }

    void this.#repository.getAllXIdentities().then((identities) =>
      this.#synchronizer.synchronize({
        relayUrls: this.#settings.relays,
        rootPubkeys: [rootPubkey],
        scope: WOT_SCOPE,
        overlapSeconds,
        xUserIds: identities.map((identity) => identity.twitterId),
        limits,
        signal: controller.signal,
      }).then(async (result) => {
      await this.#rebuildGraph()
      if (this.#syncController !== controller) return
      if (controller.signal.aborted) {
        this.#syncStatus = {
          state: 'stopped',
          startedAt,
          finishedAt: this.#now(),
        }
      } else {
        this.#syncStatus = {
          state: 'complete',
          startedAt,
          finishedAt: this.#now(),
          result,
        }
      }
    }).catch((error: unknown) => {
      if (this.#syncController !== controller) return
      this.#syncStatus = controller.signal.aborted
        ? { state: 'stopped', startedAt, finishedAt: this.#now() }
        : {
            state: 'error',
            startedAt,
            finishedAt: this.#now(),
            error: errorMessage(error),
          }
    }).finally(() => {
      if (this.#syncController === controller) this.#syncController = undefined
    }))

    return structuredClone(this.#syncStatus)
  }

  #stopSync(): WotSyncStatus {
    this.#syncController?.abort()
    if (this.#syncStatus.state === 'running') {
      this.#syncStatus = {
        state: 'stopped',
        startedAt: this.#syncStatus.startedAt,
        finishedAt: this.#now(),
      }
    }
    return structuredClone(this.#syncStatus)
  }

  async #getDemoWotStatus(): Promise<DemoWotStatus> {
    const ids = await this.#repository.getEventIdsByState(DEMO_EVENT_STATE)
    return { eventCount: ids.length }
  }

  #appMode(): AppMode {
    return this.#settings.mode ?? DEFAULT_APP_MODE
  }

  #wotMaxDegree(): number {
    return clampWotMaxDegree(this.#settings.wotMaxDegree)
  }

  async #setWotMaxDegree(degree: unknown): Promise<number> {
    const next = clampWotMaxDegree(degree)
    const run = async (): Promise<number> => {
      const previous = this.#wotMaxDegree()
      if (next === previous) return next
      this.#settings.wotMaxDegree = next
      await this.#persistSettings()
      this.#trustMemo.clear()
      this.#trustMemoVersion = 0
      this.#broadcastWotMaxDegreeChanged(next)
      this.#broadcastTrustGraphUpdated()
      return next
    }
    const pending = this.#wotMaxDegreeWrite
      ? this.#wotMaxDegreeWrite.then(run, run)
      : run()
    this.#wotMaxDegreeWrite = pending
    try {
      return await pending
    } finally {
      if (this.#wotMaxDegreeWrite === pending) {
        this.#wotMaxDegreeWrite = undefined
      }
    }
  }

  #broadcastWotMaxDegreeChanged(degree: number): void {
    const message = { type: WOT_MAX_DEGREE_CHANGED_MESSAGE, degree }
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined)
    } catch {
      /* no extension page listening */
    }
    void chrome.tabs
      .query({
        url: [
          'https://x.com/*',
          'https://www.x.com/*',
          'https://twitter.com/*',
          'https://www.twitter.com/*',
        ],
      })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue
          void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  }

  async #setAppMode(mode: unknown): Promise<{ mode: AppMode; seeded: boolean }> {
    const next = parseAppMode(mode)
    const previous = this.#appMode()
    let seeded = false

    if (next === 'demo') {
      this.#settings.mode = 'demo'
      await this.#persistSettings()
      await this.#mirrorAppMode('demo')
      const existing = await this.#repository.getEventIdsByState(DEMO_EVENT_STATE)
      if (existing.length === 0) {
        await this.#seedDemoWot()
        seeded = true
      }
      await this.#flushModeCaches()
      await this.#applyModeActionChrome('demo')
      if (previous !== 'demo') {
        this.#broadcastAppModeChanged('demo')
      }
      this.#broadcastTrustGraphUpdated()
      return { mode: 'demo', seeded }
    }

    // Enter production: wipe all demo data; production rows stay.
    await this.#clearDemoWot()
    this.#settings.mode = 'production'
    await this.#persistSettings()
    await this.#mirrorAppMode('production')
    await this.#flushModeCaches()
    await this.#applyModeActionChrome('production')
    if (previous !== 'production') {
      this.#broadcastAppModeChanged('production')
    }
    this.#broadcastTrustGraphUpdated()
    return { mode: 'production', seeded: false }
  }

  /** Drop in-memory trust caches and rebuild the graph for the active mode. */
  async #flushModeCaches(): Promise<void> {
    this.#trustMemo.clear()
    this.#trustMemoVersion = 0
    this.#graphDirty = true
    await this.#rebuildGraph()
  }

  async #mirrorAppMode(mode: AppMode): Promise<void> {
    await chrome.storage.local.set({ [APP_MODE_STORAGE_KEY]: mode })
  }

  async #applyModeActionChrome(mode: AppMode): Promise<void> {
    try {
      if (mode === 'demo') {
        await chrome.action.setBadgeText({ text: 'DEMO' })
        await chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' })
        await chrome.action.setTitle({ title: 'AttentionX (Demo)' })
      } else {
        const current = await chrome.action.getBadgeText({})
        if (current === 'DEMO') {
          await chrome.action.setBadgeText({ text: '' })
        }
        await chrome.action.setTitle({ title: 'AttentionX' })
      }
    } catch {
      /* action APIs unavailable in some test harnesses */
    }
  }

  #broadcastAppModeChanged(mode: AppMode): void {
    const message = { type: APP_MODE_CHANGED_MESSAGE, mode }
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined)
    } catch {
      /* no extension page listening */
    }
    void chrome.tabs
      .query({
        url: [
          'https://x.com/*',
          'https://www.x.com/*',
          'https://twitter.com/*',
          'https://www.twitter.com/*',
        ],
      })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue
          void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  }

  async #clearDemoWot(): Promise<DemoWotClearResult> {
    const ids = await this.#repository.getEventIdsByState(DEMO_EVENT_STATE)
    let deleted = 0
    for (const eventId of ids) {
      if (await this.#repository.deleteEvent(eventId)) deleted += 1
    }
    await this.#rebuildGraph()
    this.#broadcastTrustGraphUpdated()
    return { deleted, eventCount: 0 }
  }

  async #seedDemoWot(): Promise<DemoWotSeedResult> {
    // Require an unlocked signing identity so root→degree-1 edges can be local.
    this.#pubkey()
    const cleared = await this.#clearDemoWot()

    const identities = await this.#repository.getAllXIdentities()
    const plan = planDemoWotNetwork({
      users: identities.map((row) => ({
        twitterId: row.twitterId,
        lastSeen: row.lastSeen,
      })),
    })

    const fakeKeys: Uint8Array[] = []
    const fakePubkeys: string[] = []
    let created = 0
    try {
      for (let i = 0; i < plan.fakeAuthorCount; i += 1) {
        const secret = generateSecretKey()
        fakeKeys.push(secret)
        fakePubkeys.push(getPublicKey(secret))
      }

      const rootKey = this.#secretKey()
      const baseCreatedAt = Math.floor(this.#now() / 1_000)

      try {
        for (let i = 0; i < plan.statements.length; i += 1) {
          // Yield so the popup spinner can paint during large seeds.
          if (i > 0 && i % 32 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
          const row = plan.statements[i]!
          const subject = materializeDemoSubject(row.subject, fakePubkeys)
          const authorKey =
            row.authorIndex === -1 ? rootKey : fakeKeys[row.authorIndex]
          if (!authorKey) {
            throw new Error(`Missing demo author key at ${row.authorIndex}`)
          }

          const publishTags = defaultTrustPublishTags(subject)
          const template = await buildKind32009Event({
            subject,
            value: row.value,
            context: row.context,
            scopes: publishTags.scopes,
            k: publishTags.k,
            content: '',
            createdAt: baseCreatedAt + i,
            extraTags: DEMO_WOT_EXTRA_TAGS.map((tag) => [...tag]),
          })
          const event = finalizeEvent(template, authorKey)
          // Demo fixtures are built locally — validate the first event only
          // so large seeds (1–2k) stay fast for the UI spinner path.
          if (i === 0) {
            const validation = await validateKind32009Event(event)
            if (!validation.valid) {
              throw new Error(validation.errors.join('; '))
            }
          }

          await this.#repository.ingestEvent({
            event,
            state: DEMO_EVENT_STATE,
          })
          created += 1
        }
      } finally {
        rootKey.fill(0)
      }
    } finally {
      for (const key of fakeKeys) key.fill(0)
    }

    await this.#rebuildGraph()
    this.#broadcastTrustGraphUpdated()

    // Guardrail: demo ids must never sit in the outbox.
    const demoIds = await this.#repository.getEventIdsByState(DEMO_EVENT_STATE)
    for (const eventId of demoIds) {
      const outbox = await this.#repository.getOutbox(eventId)
      if (outbox) {
        await this.#repository.deleteOutbox(eventId)
        throw new Error('Demo WoT event was incorrectly enqueued for publish')
      }
    }

    return {
      eventCount: created,
      fakeAuthors: plan.fakeAuthorCount,
      maxDepth: plan.maxDepth,
      statements: created,
      identitySubjects: plan.userSubjects,
      postSubjects: plan.postSubjects,
      clearedBeforeSeed: cleared.deleted,
    }
  }

  async #deleteUserData(mode: unknown): Promise<DeleteUserDataResult> {
    if (mode !== 'all' && mode !== 'keys' && mode !== 'cache') {
      throw new Error('Invalid delete mode')
    }
    const deleteMode = mode as DeleteUserDataMode

    if (deleteMode === 'cache' || deleteMode === 'all') {
      await this.#clearCachedData()
    }
    if (deleteMode === 'keys' || deleteMode === 'all') {
      await this.#destroyKeysAndLogout()
    }
    if (deleteMode === 'all') {
      await this.#clearExtensionLocalState()
    }

    return { mode: deleteMode }
  }

  async #clearCachedData(): Promise<void> {
    this.#syncController?.abort()
    this.#syncController = undefined
    this.#syncStatus = { state: 'idle' }
    this.#proofSession = undefined
    this.#proofSearchInFlight.clear()
    this.#activeXAccount = undefined
    this.#trustMemo.clear()
    this.#trustMemoVersion = 0
    await this.#repository.clearAllStores()
    this.#graph.rebuild([])
    this.#graphDirty = false
    void chrome.storage.session
      .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
      .catch(() => undefined)
    this.#broadcastTrustGraphUpdated()
  }

  async #destroyKeysAndLogout(): Promise<void> {
    await signer.cancelAllUnlockWaiters()
    await vault.destroy()
    await chrome.storage.local.remove([
      'accounts',
      'activeAccountId',
      'autoLockMs',
      'vaultUnlockGuard',
    ])
    await chrome.storage.sync.remove('myPubkey')
    config.myPubkey = ''
    await signerPermissions.clear()
  }

  async #clearExtensionLocalState(): Promise<void> {
    this.#settings = {
      relays: [...DEFAULT_RELAYS],
      mode: DEFAULT_APP_MODE,
      wotMaxDegree: WOT_MAX_DEGREE_DEFAULT,
    }
    await chrome.storage.local.remove([
      STORAGE_KEY,
      APP_MODE_STORAGE_KEY,
      RESOLVE_TIMING_STORAGE_KEY,
      'activityLog',
      'allowedDomains',
      'dismissedDomains',
      'weblnAllowedDomains',
      'identityDisabledSites',
      'relayFlags',
    ])
    await this.#settingsStore.write({
      relays: [...DEFAULT_RELAYS],
      mode: DEFAULT_APP_MODE,
      wotMaxDegree: WOT_MAX_DEGREE_DEFAULT,
    })
    await this.#applyModeActionChrome(DEFAULT_APP_MODE)
    const local = (await chrome.storage.local.get(null)) as Record<
      string,
      unknown
    >
    const profileKeys = Object.keys(local).filter((key) =>
      key.startsWith('profile_'),
    )
    if (profileKeys.length > 0) {
      await chrome.storage.local.remove(profileKeys)
    }
  }

  #broadcastTrustGraphUpdated(): void {
    const message = { type: TRUST_GRAPH_UPDATED_MESSAGE }
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined)
    } catch {
      /* no extension page listening */
    }
    void chrome.tabs
      .query({
        url: [
          'https://x.com/*',
          'https://www.x.com/*',
          'https://twitter.com/*',
          'https://www.twitter.com/*',
        ],
      })
      .then((tabs) => {
        for (const tab of tabs) {
          if (tab.id === undefined) continue
          void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  }
}

export async function queryOEmbedProofPost(
  postId: string,
  fetchImplementation: typeof fetch,
): Promise<ProofPostQueryResult> {
  if (!isTwitterNumericId(postId)) {
    return { status: 'not-found' }
  }
  try {
    const endpoint = new URL('https://publish.twitter.com/oembed')
    endpoint.searchParams.set(
      'url',
      `https://twitter.com/i/web/status/${postId}`,
    )
    endpoint.searchParams.set('omit_script', 'true')
    endpoint.searchParams.set('dnt', 'true')
    const response = await fetchImplementation(endpoint, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
    if (response.status === 404) return { status: 'not-found' }
    if (!response.ok) return { status: 'unavailable' }
    const value = await response.json() as unknown
    if (typeof value !== 'object' || value === null) {
      return { status: 'unavailable' }
    }
    const record = value as Record<string, unknown>
    if (typeof record.html !== 'string' || record.html.length > 20_000) {
      return { status: 'unavailable' }
    }
    const authorUrl =
      typeof record.author_url === 'string' ? record.author_url : ''
    const authorHandle = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/.exec(
      authorUrl,
    )?.[1]
    if (!authorHandle) return { status: 'unavailable' }
    return {
      status: 'found',
      post: {
        postId,
        text: htmlToText(record.html),
        authorHandle,
      },
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
