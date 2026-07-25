import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type Event,
} from 'nostr-tools'
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
} from '../shared/contracts'
import {
  accountsMatch,
  buildProofIntentUrl,
  normalizeProofDestination,
  parseProofPostId,
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
const ACTIVE_ACCOUNT_TTL_MS = 5 * 60_000
const PROOF_SESSION_TTL_MS = 30 * 60_000
const WOT_OVERLAP_SECONDS = 60
const MAX_NIP39_EVENTS = 100
const MAX_PROFILE_HTML_BYTES = 1_500_000
const MAX_RELAYS = 20

export interface StoredBackgroundSettings {
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

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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

export class AttentionXBackend {
  readonly #repository: AttentionXRepository
  readonly #settingsStore: BackgroundSettingsStore
  readonly #relay: BackgroundRelayTransport
  readonly #fetch: typeof fetch
  readonly #queryProofPost: (postId: string) => Promise<ProofPostQueryResult>
  readonly #now: () => number
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

  private constructor(dependencies: AttentionXBackendDependencies) {
    this.#repository = dependencies.repository
    this.#settingsStore = dependencies.settingsStore
    this.#relay = dependencies.relay
    this.#fetch = dependencies.fetch ?? fetch
    this.#queryProofPost =
      dependencies.queryProofPost ??
      ((postId) => queryOEmbedProofPost(postId, this.#fetch))
    this.#now = dependencies.now ?? Date.now
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
    this.#settings = {
      secretKeyHex: legacy.secretKeyHex,
      relays: legacy.relays,
    }

    for (const candidate of legacy.cachedEvents ?? []) {
      if (!isEvent(candidate)) continue
      await this.#ingestSupportedEvent(candidate)
    }
    await this.#settingsStore.write(this.#settings)
    await this.#rebuildGraph()
    await this.#rebuildNip39Winners()
  }

  async handleRequest(request: ExtensionRequest): Promise<unknown> {
    switch (request.type) {
      case 'GET_STATE':
        return this.getPublicState()
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
        return this.#getActiveXAccount()
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
        return this.#publishTrustStatement({
          subject: request.subject,
          value: request.value,
          context: request.context,
          content: request.content,
          activationTime: request.activationTime,
          expirationTime: request.expirationTime,
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
    const secretKey = this.#settings.secretKeyHex
      ? hexToBytes(this.#settings.secretKeyHex)
      : undefined
    const pubkey = secretKey ? getPublicKey(secretKey) : undefined
    return {
      hasIdentity: Boolean(secretKey),
      npub: pubkey ? nip19.npubEncode(pubkey) : undefined,
      pubkey,
      relays: [...this.#settings.relays],
      cachedEventCount: (
        await this.#repository.getEventsByKind(32009)
      ).length,
      activeXAccount: this.#getActiveXAccount(),
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

  async runMaintenance(): Promise<WotSyncStatus> {
    if (this.#maintenance) return this.#maintenance
    this.#maintenance = (async () => {
      await this.#publisher.retryDue()
      if (
        this.#settings.secretKeyHex &&
        this.#syncStatus.state !== 'running'
      ) {
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
    this.#settings.secretKeyHex = bytesToHex(generateSecretKey())
    await this.#persistSettings()
    return this.getPublicState()
  }

  async #importIdentity(nsec: string): Promise<PublicExtensionState> {
    const decoded = nip19.decode(nsec.trim())
    if (decoded.type !== 'nsec') throw new Error('Enter a valid nsec key')
    this.#settings.secretKeyHex = bytesToHex(decoded.data)
    await this.#persistSettings()
    return this.getPublicState()
  }

  async #clearIdentity(): Promise<PublicExtensionState> {
    delete this.#settings.secretKeyHex
    this.#syncController?.abort()
    await this.#persistSettings()
    return this.getPublicState()
  }

  async #saveRelays(relays: string[]): Promise<PublicExtensionState> {
    this.#settings.relays = normalizeRelays(relays)
    await this.#persistSettings()
    return this.getPublicState()
  }

  async #persistSettings(): Promise<void> {
    await this.#settingsStore.write({
      ...(this.#settings.secretKeyHex
        ? { secretKeyHex: this.#settings.secretKeyHex }
        : {}),
      relays: [...this.#settings.relays],
    })
  }

  #secretKey(): Uint8Array {
    if (!this.#settings.secretKeyHex) {
      throw new Error(
        'Create or import a Nostr identity from the AttentionX popup first',
      )
    }
    return hexToBytes(this.#settings.secretKeyHex)
  }

  #pubkey(): string {
    return getPublicKey(this.#secretKey())
  }

  async #publishTrustStatement(input: {
    subject: TrustSubject
    value: TrustValue
    context?: string
    content?: string
    activationTime?: number
    expirationTime?: number
  }): Promise<PublishResult> {
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
    const event = finalizeEvent(template, this.#secretKey())
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
      const current = await this.#currentNip39Event(pubkey)
      result.alreadyProven = await decideAlreadyProven(
        {
          expectedPubkey: pubkey,
          expectedTwitterId: twitterId,
          currentEvent: current,
        },
        this.#proofDependencies(),
      )
    }
    return result
  }

  #reportActiveXAccount(
    account: ActiveXAccountReport | null,
  ): ActiveXAccountReport | null {
    if (account === null) {
      this.#activeXAccount = undefined
      return null
    }
    const handle = requireString(account.handle, 'X handle', 16)
      .trim()
      .replace(/^@/, '')
      .toLowerCase()
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
      throw new Error('Invalid active X handle')
    }
    const twitterId =
      account.twitterId === undefined
        ? undefined
        : requireString(account.twitterId, 'X account ID', 24)
    if (twitterId !== undefined && !isTwitterNumericId(twitterId)) {
      throw new Error('Invalid active X account ID')
    }
    const detectedAt = this.#now()
    this.#activeXAccount = {
      handle,
      detectedAt,
      ...(twitterId ? { twitterId } : {}),
    }
    return structuredClone(this.#activeXAccount)
  }

  #getActiveXAccount(): ActiveXAccountReport | undefined {
    if (!this.#activeXAccount) return undefined
    if (this.#now() - this.#activeXAccount.detectedAt > ACTIVE_ACCOUNT_TTL_MS) {
      this.#activeXAccount = undefined
      return undefined
    }
    return structuredClone(this.#activeXAccount)
  }

  async #prepareProofComposer(
    handle: string,
    twitterId: string,
  ): Promise<ProofComposerPreview> {
    const destination = normalizeProofDestination(handle, twitterId)
    const active = this.#getActiveXAccount()
    if (!accountsMatch(active, destination)) {
      throw new Error(
        'Active X account must match the destination handle and numeric ID before linking',
      )
    }
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
    const active = this.#getActiveXAccount()
    if (
      !accountsMatch(active, {
        handle: session.handle,
        twitterId: session.twitterId,
      })
    ) {
      throw new Error(
        'Active X account changed; confirm the destination account again',
      )
    }
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
  ): Promise<PublishResult> {
    const pubkey = this.#pubkey()
    try {
      const relayEvents = await this.#relay.queryEvents(
        this.#settings.relays,
        { kinds: [NIP39_EVENT_KIND], authors: [pubkey], limit: MAX_NIP39_EVENTS },
      )
      for (const relayEvent of relayEvents) {
        await this.#ingestSupportedEvent(relayEvent)
      }
    } catch (error) {
      console.info('AttentionX used the cached NIP-39 replacement event', error)
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
    const event = finalizeEvent(template, this.#secretKey())
    const verification = await verifyNip39Proof(
      event,
      this.#proofDependencies(),
    )
    if (verification.state !== 'verified') {
      throw new Error(`X proof is not verified: ${verification.reason}`)
    }

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
    eventId: string,
  ): Promise<void> {
    const now = this.#now()
    await this.#repository.removeXIdentityClaimsByPubkey(
      verification.nostrPubkey,
      now,
    )
    const existing = await this.#repository.getXIdentity(verification.twitterId)
    const claims = [
      ...(existing?.claims ?? []).filter(
        ({ pubkey }) => pubkey !== verification.nostrPubkey,
      ),
      {
        pubkey: verification.nostrPubkey,
        eventId,
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
