import {
  finalizeEvent,
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
  verifyNip39Proof,
  XIdentityResolver,
  type ProofPostQueryResult,
  type ProofVerificationResult,
  type XIdentityResolution,
} from '../identity'
import {
  LocalTrustGraph,
  type GraphBounds,
  type ReducedTrustStatement,
  type TrustQueryResult,
  type TrustSubject,
} from '../graph'
import {
  DEFAULT_GRAPH_SYNC_LIMITS,
  DurableOutboxPublisher,
  RelaySynchronizer,
  type GraphSyncLimits,
  type OutboxPublishResult,
  type RelayPublishClient,
  type RelayQueryClient,
  type SynchronizeResult,
} from '../relay'
import {
  AttentionXRepository,
  eventAddress,
  type XIdentityRecord,
} from '../storage'
import {
  BACKGROUND_API_VERSION,
  DEFAULT_RELAYS,
  NIP39_EVENT_KIND,
  type ActiveXAccountReport,
  type ExtensionRequest,
  type ProofComposerPreview,
  type ProofComposerSession,
  type PublicExtensionState,
  type PublishResult,
  type CockpitState,
  type CockpitChromeStorageSummary,
  type GraphSnapshot,
  type AppLogsState,
  type XIdentitiesState,
  type XIdentityListRow,
  type XIdentitySortDir,
  type XIdentitySortField,
  type XProofCheckResult,
} from '../shared/contracts'
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
import {
  MAX_OBSERVATIONS_PER_MESSAGE,
  isAllowedXOperation,
  normalizeObservedHandle,
  sanitizeObservedXIdentity,
} from '../shared/observed-x-identity'
import {
  isTwitterNumericId,
  parseCanonicalTwitterSubject,
} from '../shared/x-identity'
import {
  DurableIdentityRepository,
  RepositoryOutboxAdapter,
  RepositorySyncAdapter,
  type RelayEventQuery,
} from './adapters'

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

function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error('Invalid Nostr secret key')
  }
  return Uint8Array.from(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)))
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
    return { relays: [...DEFAULT_RELAYS] }
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

function defaultSubjectContext(subject: TrustSubject): string {
  if (subject.type !== 'i') return ''
  const parsed = parseCanonicalTwitterSubject(subject.value)
  if (!parsed) return ''
  return parsed.type === 'account' ? 'identity' : 'news:accuracy'
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
  return sortBy === 'updatedAt' ? 'desc' : 'asc'
}

function primaryHandleKey(row: XIdentityListRow): string {
  return row.handles[0]?.toLowerCase() ?? ''
}

function primaryNpubKey(row: XIdentityListRow): string {
  return row.claims[0]?.npub.toLowerCase() ?? ''
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
      result = a.proofState.localeCompare(b.proofState)
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
  readonly #identityRepository: DurableIdentityRepository
  readonly #resolver: XIdentityResolver
  readonly #publisher: DurableOutboxPublisher
  readonly #synchronizer: RelaySynchronizer
  readonly #graph = new LocalTrustGraph()

  #settings: StoredBackgroundSettings = { relays: [...DEFAULT_RELAYS] }
  #syncStatus: WotSyncStatus = { state: 'idle' }
  #syncController?: AbortController
  #maintenance?: Promise<WotSyncStatus>
  #activeXAccount?: ActiveXAccountReport
  #proofSession?: ProofComposerSession
  /** Dedupes concurrent GraphQL proof searches per X account id. */
  readonly #proofSearchInFlight = new Set<string>()

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
    this.#identityRepository = new DurableIdentityRepository(this.#repository)
    this.#resolver = new XIdentityResolver({
      repository: this.#identityRepository,
      fetch: this.#fetch,
      queryNip39: (handle, signal) => this.#queryVerifiedNip39(handle, signal),
      now: this.#now,
    })
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
    }

    if (legacy.secretKeyHex) {
      await this.#migrateLegacySecretKey(legacy.secretKeyHex)
    }

    for (const candidate of legacy.cachedEvents ?? []) {
      if (!isEvent(candidate)) continue
      await this.#ingestSupportedEvent(candidate)
    }
    await this.#settingsStore.write(this.#settings)
    // Keep Network UI / NIP-07 in sync with the active backend list.
    const syncCsv = this.#settings.relays.join(',')
    if (syncArea.relays !== syncCsv) {
      await chrome.storage.sync.set({ relays: syncCsv })
    }
    await this.#repository.pruneOutboxRelays(this.#settings.relays, this.#now())
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

  async handleRequest(request: ExtensionRequest): Promise<unknown> {
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
          await this.#resolver.ingestObservations(
            observations as NonNullable<(typeof observations)[number]>[],
          )
          return { ingested: observations.length }
        }
      case 'RESOLVE_X_IDENTITY':
        assertVersion(request)
        return this.#resolver.resolve(
          requireString(request.handle, 'X handle', 16),
        )
      case 'GET_X_IDENTITY':
        assertVersion(request)
        return this.#getXIdentity(
          request.handle === undefined
            ? undefined
            : requireString(request.handle, 'X handle', 16),
          request.twitterId === undefined
            ? undefined
            : requireString(request.twitterId, 'X account ID', 24),
        )
      case 'CHECK_X_PROOF':
        assertVersion(request)
        return this.#checkXProof(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          {
            queryRelays: request.queryRelays !== false,
            scanPage: request.scanPage === true,
          },
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
          content: request.content,
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
          content: request.content,
        })
      case 'QUERY_TRUST':
        assertVersion(request)
        return this.#queryTrust(
          request.subject,
          request.context,
          request.rootPubkey,
          request.now,
          request.bounds,
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
    return {
      hasIdentity,
      npub: pubkey ? nip19.npubEncode(pubkey) : undefined,
      pubkey: pubkey || undefined,
      vaultLocked: await vault.exists() ? vault.isLocked() : false,
      relays: [...this.#settings.relays],
      cachedEventCount: (
        await this.#repository.getEventsByKind(32009)
      ).length,
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
    }
  }

  async #getGraphSnapshot(options: {
    maxDepth?: number
    maxNodes?: number
    context?: string
  }): Promise<GraphSnapshot> {
    if (this.#graph.graphVersion === 0 || this.#graph.listStatements().length === 0) {
      await this.#rebuildGraph()
    }
    const rootPubkey = this.#pubkey()
    const maxDepth = options.maxDepth ?? 4
    const snapshot = this.#graph.egoSnapshot(rootPubkey, {
      maxDepth,
      maxNodes: options.maxNodes ?? 400,
      context: options.context ?? 'identity',
      now: this.#now(),
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
      handles: [...identity.handles],
      proofState: identity.proofState,
      claims: identity.claims.map((claim) => ({
        pubkey: claim.pubkey,
        npub: nip19.npubEncode(claim.pubkey),
        ...(claim.eventId ? { eventId: claim.eventId } : {}),
        ...(claim.proofTweetId ? { proofTweetId: claim.proofTweetId } : {}),
        verifiedAt: claim.verifiedAt,
        ...(claim.expiresAt !== undefined ? { expiresAt: claim.expiresAt } : {}),
        state: claim.state,
      })),
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
    }
  }

  #matchesXIdentityQuery(row: XIdentityListRow, query: string): boolean {
    if (row.twitterId.toLowerCase().includes(query)) return true
    if (row.proofState.toLowerCase().includes(query)) return true
    if (row.handles.some((handle) => handle.toLowerCase().includes(query))) {
      return true
    }
    return row.claims.some(
      (claim) =>
        claim.pubkey.toLowerCase().includes(query) ||
        claim.npub.toLowerCase().includes(query) ||
        (claim.eventId?.toLowerCase().includes(query) ?? false) ||
        (claim.proofTweetId?.toLowerCase().includes(query) ?? false),
    )
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

  async #publishTrustStatement(input: {
    subject: TrustSubject
    value: TrustValue
    context?: string
    content?: string
    activationTime?: number
    expirationTime?: number
    hintHandle?: string
  }): Promise<PublishResult> {
    // One-shot proof discovery when trusting an X account that has no binding yet.
    if (input.value === '1' && input.subject.type === 'i') {
      const parsed = parseCanonicalTwitterSubject(input.subject.value)
      if (parsed?.type === 'account') {
        await this.#ensureXProofBindingOnTrust(
          parsed.twitterId,
          input.hintHandle,
        )
      }
    }

    const context = input.context ?? defaultSubjectContext(input.subject)
    const d = await buildKind32009D(input.subject, context)
    const currentId = await this.#repository.getAddressWinner(
      eventAddress(32009, this.#pubkey(), d),
    )
    const current = currentId
      ? await this.#repository.getEvent(currentId)
      : undefined
    const createdAt = Math.max(
      Math.floor(this.#now() / 1_000),
      (current?.created_at ?? -1) + 1,
    )
    const template = await buildKind32009Event({
      subject: input.subject,
      value: input.value,
      context,
      content: input.content?.trim() ?? '',
      activationTime: input.activationTime,
      expirationTime: input.expirationTime,
      createdAt,
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

    await this.#repository.storeEventAndEnqueue(
      event,
      this.#settings.relays,
      {
        now: this.#now(),
        addressWinner: {
          address: eventAddress(32009, event.pubkey, validation.statement.d),
        },
      },
    )
    await this.#rebuildGraph()
    return publishResult(await this.#publisher.flush(event.id))
  }

  #queryTrust(
    subject: TrustSubject,
    context?: string,
    rootPubkey?: string,
    now?: number,
    bounds?: Partial<GraphBounds>,
  ): TrustQueryResult {
    const root = rootPubkey ?? this.#pubkey()
    const resolvedContext = context ?? defaultSubjectContext(subject)
    if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root pubkey')
    const subjectError = getTrustSubjectValidationError(subject)
    if (subjectError) throw new Error(subjectError)
    if (!isCanonicalTrustContext(resolvedContext)) {
      throw new Error('Context is not canonical')
    }
    return this.#graph.query({
      rootPubkey: root,
      subject,
      context: resolvedContext,
      now,
      bounds,
    })
  }

  async #getXIdentity(
    handle?: string,
    twitterId?: string,
  ): Promise<
    | {
        resolution?: XIdentityResolution
        identity?: XIdentityRecord
      }
    | undefined
  > {
    if (!handle && !twitterId) {
      throw new Error('GET_X_IDENTITY requires handle or twitterId')
    }
    if (twitterId && !isTwitterNumericId(twitterId)) {
      throw new Error('Invalid X account ID')
    }
    const resolution = handle
      ? await this.#identityRepository.getResolution(handle.toLowerCase())
      : undefined
    const id = twitterId ?? (
      resolution?.state === 'resolved' ? resolution.twitterId : undefined
    )
    const identity = id
      ? await this.#repository.getXIdentity(id)
      : undefined
    if (!resolution && !identity) return undefined
    return { resolution, identity }
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
    options: { queryRelays: boolean; scanPage: boolean },
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

    // 1) xIdentity is the durable Nostr↔X binding lookup (skip search when known).
    const fromIdentity = await this.#verifiedProofFromLocalIdentity(
      pubkey,
      destination,
      npub,
    )
    if (fromIdentity) return fromIdentity

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
      await this.#recordVerifiedIdentity(decision.verification, current.id)
      return {
        status: 'verified',
        handle: decision.verification.handle,
        twitterId: decision.verification.twitterId,
        proofPostId: decision.verification.proofPostId,
        npub,
        source: 'local-event',
      }
    }

    if (options.queryRelays) {
      await this.#refreshOwnNip39FromRelays(pubkey)
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
        await this.#recordVerifiedIdentity(decision.verification, current.id)
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

    // Latest 10011 no longer claims this X id — drop stale xIdentity claims for it.
    if (current && decision.decision === 'needs_proof') {
      await this.#reconcileNip39Winner(pubkey, current)
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

    // 3) No xIdentity binding and no verified 10011 for this X id → GraphQL search.
    if (
      options.scanPage &&
      (decision.decision === 'needs_proof' ||
        decision.decision === 'conflict')
    ) {
      const pagePostId = await this.#findProofPostOnX(
        destination.handle,
        npub,
      )
      if (pagePostId) {
        // Persist binding in xIdentity only — user publishes kind 10011 explicitly.
        await this.#recordVerifiedIdentity(
          {
            state: 'verified',
            handle: destination.handle,
            twitterId: destination.twitterId,
            proofPostId: pagePostId,
            nostrPubkey: pubkey.toLowerCase(),
          },
          undefined,
        )
        return {
          status: 'needs_publish',
          handle: destination.handle,
          twitterId: destination.twitterId,
          proofPostId: pagePostId,
          npub,
          proofText,
          source: 'page-scan',
        }
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
   * xIdentity lookup: durable binding of this Nostr key to an X account via
   * a previously confirmed proof post id (no GraphQL re-search).
   */
  async #verifiedProofFromLocalIdentity(
    pubkey: string,
    destination: { handle: string; twitterId: string },
    npub: string,
  ): Promise<Extract<XProofCheckResult, { status: 'verified' }> | undefined> {
    const identity = await this.#repository.getXIdentity(destination.twitterId)
    const claim = identity?.claims.find(
      (entry) =>
        entry.pubkey.toLowerCase() === pubkey.toLowerCase() &&
        entry.state === 'verified' &&
        typeof entry.proofTweetId === 'string' &&
        isTwitterNumericId(entry.proofTweetId),
    )
    if (!claim?.proofTweetId) return undefined

    return {
      status: 'verified',
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: claim.proofTweetId,
      npub,
      source: 'local-identity',
    }
  }

  async #refreshOwnNip39FromRelays(pubkey: string): Promise<void> {
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
      identity?.claims.some(
        (claim) =>
          claim.state === 'verified' &&
          typeof claim.proofTweetId === 'string' &&
          isTwitterNumericId(claim.proofTweetId),
      ),
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
    for (const handle of identity?.handles ?? []) {
      const normalized = normalizeObservedHandle(handle)
      if (normalized) return normalized
    }

    const now = this.#now()
    const aliases =
      await this.#repository.getHandleAliasesForTwitterId(twitterId)
    for (const alias of aliases) {
      if (alias.expiresAt !== undefined && alias.expiresAt <= now) continue
      const normalized = normalizeObservedHandle(alias.handle)
      if (normalized) return normalized
    }
    return undefined
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

        const match = await this.#searchProofPostOnX(handle)
        if (!match?.fullText) return

        const npub = extractNpubFromLinkingProofText(match.fullText)
        if (!npub) return
        let pubkey: string
        try {
          const decoded = nip19.decode(npub)
          if (decoded.type !== 'npub') return
          pubkey = decoded.data
        } catch {
          return
        }

        await this.#recordVerifiedIdentity(
          {
            state: 'verified',
            handle,
            twitterId,
            proofPostId: match.postId,
            nostrPubkey: pubkey.toLowerCase(),
          },
          undefined,
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

    // 3) Numeric ID: live tab → same-handle session → handle alias.
    let twitterId =
      fromTab?.twitterId && isTwitterNumericId(fromTab.twitterId)
        ? fromTab.twitterId
        : stored?.twitterId &&
            isTwitterNumericId(stored.twitterId) &&
            stored.handle === handle
          ? stored.twitterId
          : undefined

    if (!twitterId) {
      const alias = await this.#repository.getHandleAlias(handle, this.#now())
      if (alias?.twitterId && isTwitterNumericId(alias.twitterId)) {
        twitterId = alias.twitterId
      }
    }

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

    await this.#repository.putHandleAlias({
      handle,
      twitterId,
      source: 'dom',
      observedAt: this.#now(),
      expiresAt: this.#now() + 6 * 60 * 60 * 1_000,
    })

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
    if (verification.state === 'verified') {
      const current = await this.#currentNip39Event(event.pubkey)
      if (current?.id === event.id) {
        await this.#recordVerifiedIdentity(verification, event.id)
      }
    }
    return verification
  }

  async #publishXIdentity(
    handle: string,
    twitterId: string,
    proofTweetId: string,
    options: { flush?: boolean } = {},
  ): Promise<PublishResult> {
    const flush = options.flush !== false
    const pubkey = this.#pubkey()
    if (flush) {
      try {
        await this.#refreshOwnNip39FromRelays(pubkey)
      } catch {
        /* use cached replacement */
      }
    }
    const existing = await this.#currentNip39Event(pubkey)
    const template = buildKind10011Event({
      handle,
      twitterId,
      proofPostId: proofTweetId,
      createdAt: Math.max(
        Math.floor(this.#now() / 1_000),
        (existing?.created_at ?? -1) + 1,
      ),
      existingEvent: existing,
    })
    const proofKey = this.#secretKey()
    let event: Event
    try {
      event = finalizeEvent(template, proofKey)
    } finally {
      proofKey.fill(0)
    }
    const verification = await verifyNip39Proof(
      event,
      this.#proofDependencies(),
    )
    if (verification.state !== 'verified') {
      throw new Error(`X proof is not verified: ${verification.reason}`)
    }

    if (flush) {
      await this.#repository.storeEventAndEnqueue(
        event,
        this.#settings.relays,
        {
          now: this.#now(),
          addressWinner: {
            address: eventAddress(NIP39_EVENT_KIND, event.pubkey, ''),
          },
        },
      )
      await this.#reconcileNip39Winner(event.pubkey, event)
      await this.#recordVerifiedIdentity(verification, event.id)
      return publishResult(await this.#publisher.flush(event.id))
    }

    // Stage locally only — user confirms before relay publish.
    await this.#repository.ingestEvent({
      event,
      address: eventAddress(NIP39_EVENT_KIND, event.pubkey, ''),
      observedAt: this.#now(),
    })
    await this.#repository.setAddressWinner(
      eventAddress(NIP39_EVENT_KIND, event.pubkey, ''),
      event.id,
      this.#now(),
    )
    await this.#reconcileNip39Winner(event.pubkey, event)
    await this.#recordVerifiedIdentity(verification, event.id)
    return {
      eventId: event.id,
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
    }
  }

  async #queryVerifiedNip39(
    handle: string,
    signal?: AbortSignal,
  ): Promise<
    Array<{
      status: 'verified'
      handle: string
      twitterId: string
      nostrPubkey: string
      proofPostId: string
      verifiedAt: number
    }>
  > {
    const events = await this.#relay.queryEvents(
      this.#settings.relays,
      {
        kinds: [NIP39_EVENT_KIND],
        '#i': [`twitter:${handle}`],
        limit: MAX_NIP39_EVENTS,
      },
      signal,
    )
    const candidateAuthors = new Set<string>()
    for (const event of events) {
      if (await this.#ingestSupportedEvent(event)) {
        candidateAuthors.add(event.pubkey)
      }
    }

    const candidates = new Map<string, Event>()
    for (const pubkey of candidateAuthors) {
      const replacements = await this.#relay.queryEvents(
        this.#settings.relays,
        {
          kinds: [NIP39_EVENT_KIND],
          authors: [pubkey],
          limit: MAX_NIP39_EVENTS,
        },
        signal,
      )
      for (const replacement of replacements) {
        await this.#ingestSupportedEvent(replacement)
      }
      const current = await this.#currentNip39Event(pubkey)
      if (!current) continue
      const validation = validateKind10011TwitterIdentity(current)
      if (validation.valid && validation.identity.handle === handle) {
        candidates.set(pubkey, current)
      }
    }

    const verified = []
    for (const event of candidates.values()) {
      const proof = await verifyNip39Proof(event, this.#proofDependencies())
      if (proof.state !== 'verified') continue
      await this.#recordVerifiedIdentity(proof, event.id)
      verified.push({
        status: 'verified' as const,
        handle: proof.handle,
        twitterId: proof.twitterId,
        nostrPubkey: proof.nostrPubkey,
        proofPostId: proof.proofPostId,
        verifiedAt: this.#now(),
      })
    }
    return verified
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

  async #recordVerifiedIdentity(
    verification: Extract<ProofVerificationResult, { state: 'verified' }>,
    eventId?: string,
  ): Promise<void> {
    const now = this.#now()
    await this.#repository.removeXIdentityClaimsByPubkey(
      verification.nostrPubkey,
      now,
    )
    const existing = await this.#repository.getXIdentity(verification.twitterId)
    const prior = (existing?.claims ?? []).find(
      ({ pubkey }) => pubkey === verification.nostrPubkey,
    )
    const claims = [
      ...(existing?.claims ?? []).filter(
        ({ pubkey }) => pubkey !== verification.nostrPubkey,
      ),
      {
        pubkey: verification.nostrPubkey,
        ...(eventId
          ? { eventId }
          : prior?.eventId
            ? { eventId: prior.eventId }
            : {}),
        proofTweetId: verification.proofPostId,
        verifiedAt: now,
        state: 'verified' as const,
      },
    ]
    await this.#repository.putXIdentity({
      twitterId: verification.twitterId,
      handles: [
        ...new Set([...(existing?.handles ?? []), verification.handle]),
      ],
      claims,
      proofState: 'verified',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    await this.#identityRepository.saveResolution({
      state: 'resolved',
      handle: verification.handle,
      twitterId: verification.twitterId,
      provenance: 'verified-nip39',
      resolvedAt: now,
      expiresAt: now + 6 * 60 * 60 * 1_000,
      nostrPubkeys: [verification.nostrPubkey],
    })
  }

  async #currentNip39Event(pubkey: string): Promise<Event | undefined> {
    const winnerId = await this.#repository.getAddressWinner(
      eventAddress(NIP39_EVENT_KIND, pubkey, ''),
    )
    if (winnerId) return this.#repository.getEvent(winnerId)
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
      return (await this.#syncRepository.ingestEvent(event)) !== 'rejected'
    }
    if (event.kind !== NIP39_EVENT_KIND) return false
    const validation = validateSignedKind10011Event(event)
    if (!validation.valid) return false

    const address = eventAddress(event.kind, event.pubkey, '')
    const winnerId = await this.#repository.getAddressWinner(address)
    const winner = winnerId
      ? await this.#repository.getEvent(winnerId)
      : undefined
    const replacesWinner =
      !winner ||
      event.created_at > winner.created_at ||
      (event.created_at === winner.created_at && event.id < winner.id)
    await this.#repository.ingestEvent({
      event,
      ...(replacesWinner ? { address } : {}),
      observedAt: this.#now(),
    })
    if (replacesWinner && winnerId !== event.id) {
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
      ...identities.flatMap((identity) =>
        identity.claims.map((claim) => claim.pubkey),
      ),
    ])
    for (const pubkey of authors) {
      const winner = winners.get(pubkey)
      const address = eventAddress(NIP39_EVENT_KIND, pubkey, '')
      if (winner) {
        await this.#repository.setAddressWinner(address, winner.id, this.#now())
      } else {
        await this.#repository.deleteAddress(address)
      }
      await this.#reconcileNip39Winner(pubkey, winner)
    }
  }

  async #reconcileNip39Winner(
    pubkey: string,
    winner: Event | undefined,
  ): Promise<void> {
    const identities = await this.#repository.getAllXIdentities()
    const twitter = winner
      ? validateKind10011TwitterIdentity(winner)
      : undefined
    const retained = new Map<string, XIdentityRecord['claims']>()
    let stale = false
    for (const identity of identities) {
      const claims = identity.claims.filter((claim) => claim.pubkey === pubkey)
      if (claims.length === 0) continue
      const currentClaims =
        twitter?.valid === true && twitter.identity.twitterId === identity.twitterId
          ? claims.filter((claim) => claim.eventId === winner?.id)
          : []
      if (currentClaims.length !== claims.length) stale = true
      if (currentClaims.length > 0) {
        retained.set(identity.twitterId, currentClaims)
      }
    }
    if (!stale) return

    const now = this.#now()
    await this.#repository.removeXIdentityClaimsByPubkey(pubkey, now)
    for (const [twitterId, claims] of retained) {
      const identity = await this.#repository.getXIdentity(twitterId)
      if (!identity) continue
      const merged = [...identity.claims, ...claims]
      await this.#repository.putXIdentity({
        ...identity,
        claims: merged,
        proofState: merged.some((claim) => claim.state === 'verified')
          ? 'verified'
          : identity.proofState,
        updatedAt: Math.max(identity.updatedAt, now),
      })
    }
  }

  async #rebuildGraph(): Promise<void> {
    const events = await this.#repository.getEventsByKind(32009)
    const reduced = await reduceKind32009Events(events)
    this.#graph.rebuild(reduced.statements.map(reducedStatement))
    for (const statement of reduced.statements) {
      await this.#repository.setAddressWinner(
        eventAddress(32009, statement.event.pubkey, statement.d),
        statement.event.id,
        this.#now(),
      )
    }
  }

  #startSync(
    overlapSeconds = WOT_OVERLAP_SECONDS,
    bounds?: Partial<GraphBounds>,
  ): WotSyncStatus {
    if (this.#syncStatus.state === 'running') {
      return structuredClone(this.#syncStatus)
    }
    if (!Number.isFinite(overlapSeconds) || overlapSeconds < 0) {
      throw new Error('overlapSeconds must be non-negative')
    }
    const rootPubkey = this.#pubkey()
    const limits = syncLimits(bounds)
    const controller = new AbortController()
    const startedAt = this.#now()
    this.#syncController = controller
    this.#syncStatus = { state: 'running', startedAt }

    void this.#synchronizer.synchronize({
      relayUrls: this.#settings.relays,
      rootPubkeys: [rootPubkey],
      scope: WOT_SCOPE,
      overlapSeconds,
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
    })

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
