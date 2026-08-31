import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
  type Event,
} from 'nostr-tools'
import * as vault from '../vault/vault.ts'
import { npubDecode } from '../vault/crypto/bech32.ts'
import { importNsec } from '../accounts/accounts.ts'
import {
  accountIsBoundTo,
  boundTwitterIdsOf,
  collectOperatorKnownTwitterIds,
  findAccountByBoundTwitterId,
  normalizeBoundTwitterId,
  preferredBoundTwitterId,
  toBoundAccountView,
} from '../accounts/x-binding.ts'
import {
  clearLocalAccounts,
  listLocalBoundAccountViews,
  readLocalAccounts,
  removeOperatorLifecycle,
  toLocalAccountEntry,
  writeLocalAccounts,
} from '../accounts/local-account-mirror.ts'
import {
  closePanelNotes,
  getPanelSessionSnapshot,
} from './panel-session-controller.ts'
import {
  patchXNostrBindingSetup,
  readXNostrBindings,
} from '../vault/x-nostr-bindings-sync.ts'
import { readEasyBlobsMap } from '../vault/easy-roaming.ts'
import { broadcastAccountChanged } from '../nip07/bg/domain-handlers.ts'
import {
  decideAlreadyProven,
  extractTwitterIdsFromProfileJsonLd,
  generateNip39ProofText,
  parseNip39TwitterClaim,
  verifyNip39Proof,
  verifyProofPostResponse,
  type ProofPostQueryResult,
  type ProofVerificationResult,
  type XIdentityResolution,
} from '../identity'
import {
  fillXIdentityDisplayGaps,
  overlayLiveXChromeOnIdentity,
  xIdentityDisplayFromLiveChrome,
  xIdentityDisplayFromRow,
  xIdentityDisplayHasChrome,
} from '../identity/x-identity-display'
import {
  buildXIdentityFromObservation,
  collectXIdentityPubkeyHexes,
  evaluateXIdentityRow,
  isNewerSourceDate,
  npubFromPubkey,
  preserveXIdentityProofFields,
  primaryNpubFromRow,
  pubkeyFromNpub,
} from '../identity/x-identity-row'
import { parseWireCenterId } from '../graph/adapter'
import {
  LocalTrustGraph,
  incomingSubjectKeys,
  selectIncomingUserStatements,
  selectOutgoingUserStatements,
  type GraphBounds,
  type RatingQueryResult,
  type ReducedRatingClaim,
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
  type XIdentityProofSource,
  type XIdentityRecord,
  type XPostRecord,
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
  type OperatorXBindingRow,
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
  type XIdentityClearPreview,
  type XIdentityClearResult,
  type XBindingPublishResult,
  type XIdentitySuggestFlags,
  type XIdentitySortDir,
  type XIdentitySortField,
  type XIdentityStatusSyncResult,
  type XPostListRow,
  type XPostDisplay,
  type XPostsState,
  type XPostSortDir,
  type XPostSortField,
  type XProofCheckResult,
  type QueryTrustBatchItem,
  type QueryTrustBatchResult,
  type QueryOutgoingTrustResult,
  type QueryRatingBatchItem,
  type QueryRatingBatchResult,
  MAX_TRUST_BATCH_ITEMS,
  MAX_RATING_BATCH_ITEMS,
  type DeleteUserDataMode,
  type DeleteUserDataResult,
  type DemoWotClearResult,
  type DemoWotSeedResult,
  type DemoWotStatus,
  type XBioEditPreview,
} from '../shared/contracts'
import {
  MAX_X_POST_CHROME_PER_MESSAGE,
  sanitizeXPostChromeInput,
} from '../shared/x-post-chrome'
import * as signer from '../nip07/signer.ts'
import * as signerPermissions from '../nip07/permissions.ts'
import { config } from '../nip07/bg/state.ts'
import {
  forgetProfileMetadata,
  fetchProfileMetadata,
  putProfileMetadata,
} from '../nip07/bg/profile-handlers.ts'
import {
  DEMO_WOT_EXTRA_TAGS,
  TRUST_GRAPH_UPDATED_MESSAGE,
  demoWotAuthorProfile,
  demoWotMissingChainMembers,
  isDemoWotEvent,
  materializeDemoSubject,
  planDemoWotNetwork,
} from '../shared/demo-wot'
import {
  graphViewMessageFromDeepLink,
  isGraphChromeTabUrl,
  isGraphDeepLink,
  parseGraphPageUrl,
  type GraphDeepLink,
} from '../shared/graph-deeplink'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
  SELECTED_SUBJECT_STORAGE_KEY,
  OPEN_NOTES_ON_LAUNCH_KEY,
  emptySelectedSubjectHistory,
  isSelectedSubject,
  isSelectedSubjectHistory,
  moveSelectedSubjectHistory,
  pushSelectedSubjectHistory,
  selectedSubjectHistoryFlags,
  selectedSubjectIdentity,
  type SelectedSubject,
  type SelectedSubjectHistory,
  type SelectedSubjectHistoryDirection,
  type SelectedSubjectSnapshot,
} from '../shared/selected-subject'
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
  MAINTENANCE_ALARM,
  WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
  WOT_SYNC_INTERVAL_PAUSED_MINUTES,
  normalizeSyncIntervalMinutes,
} from '../shared/wot-sync-interval'
import {
  accountsMatch,
  buildProofIntentUrl,
  extractNpubFromProofPostText,
  LINKING_PROOF_PREFIX,
  normalizeProofDestination,
  parseProofPostId,
  type ProofDestinationAccount,
} from '../shared/proof-composer'
import {
  MAX_X_PROOF_CANDIDATES_PER_MESSAGE,
  sanitizeObservedXProofCandidate,
} from '../shared/observed-x-proof'
import {
  MAX_X_BIO_CANDIDATES_PER_MESSAGE,
  sanitizeObservedXBioCandidate,
  type ObservedXBioCandidate,
} from '../shared/observed-x-bio'
import {
  buildSuggestedXBio,
  X_EDIT_PROFILE_URL,
} from '../shared/x-bio-edit'
import {
  buildKind10011ClearEvent,
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
  canonicalizeNpubHint,
  getTrustSubjectValidationError,
  isCanonicalTrustContext,
  isTrustStatementActive,
  reduceKind32009Events,
  subjectNpubFromHints,
  validateKind32009Event,
  cloneLabelHints,
  type ParsedKind32009,
  type SubjectHint,
  type TrustValue,
} from '../shared/kind-32009'
import {
  RATING_STATEMENT_KIND,
  buildKind32014Event,
  canonicalizeRatingScore,
  canonicalRatingLabels,
  isCanonicalRatingLabel,
  isRatingStatementActive,
  reduceKind32014Events,
  validateKind32014Event,
  type ParsedKind32014,
} from '../shared/kind-32014'
import { sanitizeTrustContent } from '../shared/trust-content'
import {
  MAX_OBSERVATIONS_PER_MESSAGE,
  isAllowedXOperation,
  normalizeObservedHandle,
  sanitizeObservedXIdentity,
} from '../shared/observed-x-identity'
import {
  buildXProfileBannerUrl,
  buildXProfileIconUrl,
  isXProfileBannerPath,
  isXProfileIconPath,
  normalizeXDisplayName,
  normalizeXProfileIconPath,
} from '../shared/x-profile-display'
import { pickXVerifiedChrome } from '../shared/x-verified'
import {
  compareKind0ToX,
  resolveOperatorBindingCompleteness,
  UNBOUND_COMPLETENESS,
  type Kind0MetadataLike,
  type OperatorBindingCompleteness,
} from '../shared/operator-binding-status.ts'
import {
  canonicalTwitterAccountClass,
  canonicalTwitterPostClass,
  isEligibleXRatingScope,
  isEligibleXTrustScope,
  isTwitterNumericId,
  parseCanonicalTwitterSubject,
  scopesFromEventTags,
  xTrustScopeRank,
  X_TRUST_SCOPE,
} from '../shared/x-identity'
import {
  IDENTITY_TRUST_CONTEXT,
  ratingPublishContextForSubject,
  ratingQueryContextForSubject,
  trustPublishContextForSubject,
  trustQueryContextForSubject,
} from '../shared/trust-context'
import {
  normalizeNpubOrHex,
  winningNpubLookupKeys,
} from '../shared/npub-lookup'
import {
  RepositoryOutboxAdapter,
  RepositorySyncAdapter,
  type RelayEventQuery,
} from './adapters'
import { logActivity } from '../nip07/bg/activity-handlers.ts'
import {
  ACTIVE_X_ACCOUNT_SESSION_KEY,
  observationForTab,
  removeActiveXTabObservation,
  upsertActiveXTabObservation,
  type ActiveXTabObservation,
} from '../shared/active-x-session'
import { twitterIdFromTwidCookie } from '../shared/x-twid'
import {
  getCachedFocusedProductTab,
  hydrateFocusedProductTab,
} from './focused-tab-cache.ts'
import {
  loadActiveXTabRegistry,
  saveActiveXTabRegistry,
} from './active-x-tab-store.ts'

const WOT_SCOPE = 'attentionx-wot-v1'
const ACTIVE_ACCOUNT_TTL_MS = 24 * 60 * 60_000
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
  /** Periodic network refresh interval in minutes; 0 = paused (manual). */
  syncIntervalMinutes?: number
  /** Auto-lower max degree when a cold resolve is slow. Default true. */
  wotAutoLower?: boolean
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
      syncIntervalMinutes: WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
      wotAutoLower: true,
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
    syncIntervalMinutes: normalizeSyncIntervalMinutes(
      stored.syncIntervalMinutes,
    ),
    wotAutoLower: stored.wotAutoLower !== false,
    ...(Array.isArray(stored.cachedEvents)
      ? { cachedEvents: stored.cachedEvents }
      : {}),
  }
}

function reducedStatement(
  statement: ParsedKind32009,
): ReducedTrustStatement | undefined {
  if (
    statement.value !== '1' &&
    statement.value !== '0' &&
    statement.value !== '-1'
  ) {
    return undefined
  }
  const labelHints = cloneLabelHints(statement.labelHints)
  return {
    eventId: statement.event.id,
    author: statement.event.pubkey,
    subject: { ...statement.subject },
    context: statement.context,
    value: Number(statement.value) as -1 | 0 | 1,
    createdAt: statement.event.created_at,
    ...(statement.content !== '' ? { content: statement.content } : {}),
    ...(statement.labels.length > 0 ? { labels: [...statement.labels] } : {}),
    ...(labelHints !== undefined ? { labelHints } : {}),
    ...(statement.activationTime === undefined
      ? {}
      : { activeFrom: statement.activationTime }),
    ...(statement.expirationTime === undefined
      ? {}
      : { activeUntil: statement.expirationTime }),
  }
}

function reducedRatingClaim(
  statement: ParsedKind32014,
): ReducedRatingClaim | undefined {
  if (statement.scoreValue === undefined) return undefined
  const labelHints = cloneLabelHints(statement.labelHints)
  return {
    eventId: statement.event.id,
    author: statement.event.pubkey,
    subject: { ...statement.subject },
    context: statement.context,
    score: statement.scoreValue,
    labels: [...statement.labels],
    ...(labelHints !== undefined ? { labelHints } : {}),
    content: statement.content,
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
  // AttentionX scope policy: `x.com` for X account and post subjects. See
  // docs/architecture.md § Scope policy.
  if (subject.type === 'p' || subject.type === 'e') {
    return { scopes: [] }
  }
  if (subject.type !== 'i') {
    return { scopes: [] }
  }
  const parsed = parseCanonicalTwitterSubject(subject.value)
  if (!parsed) {
    return { scopes: [] }
  }
  if (parsed.type === 'account') {
    return {
      scopes: [X_TRUST_SCOPE],
      k: canonicalTwitterAccountClass(),
    }
  }
  return {
    scopes: [X_TRUST_SCOPE],
    k: canonicalTwitterPostClass(),
  }
}

/**
 * Keep X-eligible scopes only; when both empty and `x.com` exist for the same
 * author/subject/context, keep the `x.com` statement(s).
 */
function selectXEligibleRatingEvents(
  events: readonly EventRecord[],
): EventRecord[] {
  return events.filter((event) =>
    isEligibleXRatingScope(scopesFromEventTags(event.tags)),
  )
}

function selectXEligibleTrustEvents(
  events: readonly EventRecord[],
): EventRecord[] {
  const eligible = events.filter((event) =>
    isEligibleXTrustScope(scopesFromEventTags(event.tags)),
  )
  const bestRank = new Map<string, number>()
  for (const event of eligible) {
    const key = xTrustGraphGroupKey(event)
    if (!key) continue
    const rank = xTrustScopeRank(scopesFromEventTags(event.tags))
    bestRank.set(key, Math.max(bestRank.get(key) ?? 0, rank))
  }
  return eligible.filter((event) => {
    const key = xTrustGraphGroupKey(event)
    if (!key) return false
    return (
      xTrustScopeRank(scopesFromEventTags(event.tags)) === bestRank.get(key)
    )
  })
}

function xTrustGraphGroupKey(event: EventRecord): string | undefined {
  let subjectType: string | undefined
  let subjectValue: string | undefined
  let context = ''
  for (const tag of event.tags) {
    if (
      (tag[0] === 'i' || tag[0] === 'p' || tag[0] === 'e') &&
      typeof tag[1] === 'string' &&
      subjectType === undefined
    ) {
      subjectType = tag[0]
      subjectValue = tag[1]
      continue
    }
    if (tag[0] === 'c' && typeof tag[1] === 'string') {
      context = tag[1]
    }
  }
  if (!subjectType || !subjectValue) return undefined
  return `${event.pubkey.toLowerCase()}|${subjectType}:${subjectValue.toLowerCase()}|${context}`
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
      limits.maxEvents < 1 ||
      (limits.maxRatingEvents !== undefined && limits.maxRatingEvents < 1)
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

const XPOST_SORT_FIELDS = [
  'postId',
  'lastSeen',
  'updatedAt',
  'authorHandle',
] as const satisfies readonly XPostSortField[]

function parseXPostSortField(value: unknown): XPostSortField {
  return XPOST_SORT_FIELDS.includes(value as XPostSortField)
    ? (value as XPostSortField)
    : 'lastSeen'
}

function parseXPostSortDir(
  value: unknown,
  sortBy: XPostSortField,
): XPostSortDir {
  if (value === 'asc' || value === 'desc') return value
  return sortBy === 'postId' || sortBy === 'authorHandle' ? 'asc' : 'desc'
}

function compareXPostRows(
  a: XPostListRow,
  b: XPostListRow,
  sortBy: XPostSortField,
  sortDir: XPostSortDir,
): number {
  let result = 0
  switch (sortBy) {
    case 'postId':
      result = a.postId.localeCompare(b.postId)
      break
    case 'lastSeen':
      result = a.lastSeen - b.lastSeen
      break
    case 'updatedAt':
      result = a.updatedAt - b.updatedAt
      break
    case 'authorHandle':
      result = (a.authorHandle ?? '').localeCompare(b.authorHandle ?? '')
      break
    default: {
      const _exhaustive: never = sortBy
      void _exhaustive
      result = 0
    }
  }
  if (result === 0) result = a.postId.localeCompare(b.postId)
  return sortDir === 'asc' ? result : -result
}

function enrichEventSubject(
  event: EventRecord,
  identityByTwitterId?: Map<string, XIdentityRecord>,
  postById?: Map<string, XPostRecord>,
): Partial<EventListRow> {
  if (event.kind !== 32009 && event.kind !== RATING_STATEMENT_KIND) return {}
  let trustValue: string | undefined
  let ratingScore: string | undefined
  const ratingLabels: string[] = []
  let subjectType: 'p' | 'e' | 'i' | undefined
  let subjectValue: string | undefined
  for (const tag of event.tags) {
    if (event.kind === 32009 && tag[0] === 'v' && typeof tag[1] === 'string') {
      trustValue = tag[1]
    }
    if (
      event.kind === RATING_STATEMENT_KIND &&
      tag[0] === 'score' &&
      typeof tag[1] === 'string'
    ) {
      ratingScore = tag[1]
    }
    if (
      event.kind === RATING_STATEMENT_KIND &&
      tag[0] === 'l' &&
      typeof tag[1] === 'string' &&
      tag[1].length > 0
    ) {
      ratingLabels.push(tag[1])
    }
    if (
      (tag[0] === 'p' || tag[0] === 'e' || tag[0] === 'i') &&
      typeof tag[1] === 'string' &&
      !subjectType
    ) {
      subjectType = tag[0]
      subjectValue = tag[1]
    }
  }
  const extras: Partial<EventListRow> = {
    ...(trustValue !== undefined ? { trustValue } : {}),
    ...(ratingScore !== undefined ? { ratingScore } : {}),
    ...(ratingLabels.length > 0 ? { ratingLabels } : {}),
  }
  if (!subjectType || !subjectValue) {
    return extras
  }
  const subjectId = `${subjectType}:${subjectValue}`
  const base: Partial<EventListRow> = {
    ...extras,
    subjectId,
    subjectSummary: subjectValue,
  }
  if (subjectType === 'p') {
    return { ...base, subjectKind: 'pubkey', subjectLabel: subjectValue.slice(0, 12) + '…' }
  }
  if (subjectType === 'i' && subjectValue.startsWith('user:id:')) {
    const twitterId = subjectValue.slice('user:id:'.length)
    const identity = identityByTwitterId?.get(twitterId)
    return {
      ...base,
      subjectKind: 'twitter_id',
      subjectLabel:
        identity?.displayName?.trim() ||
        (identity?.handle ? `@${identity.handle}` : undefined) ||
        subjectValue,
      ...(identity?.handle ? { subjectHandle: identity.handle } : {}),
      ...(identity?.iconPath ? { subjectPicturePath: identity.iconPath } : {}),
    }
  }
  if (subjectType === 'i' && subjectValue.startsWith('post:id:')) {
    const postId = subjectValue.slice('post:id:'.length)
    const post = postById?.get(postId)
    return {
      ...base,
      subjectKind: 'post',
      subjectLabel: post?.headline || subjectValue,
      ...(post?.headline ? { subjectHeadline: post.headline } : {}),
      ...(post?.authorHandle ? { subjectHandle: post.authorHandle } : {}),
      ...(post?.role ? { subjectRole: post.role } : {}),
    }
  }
  if (subjectType === 'e') {
    return { ...base, subjectKind: 'post', subjectLabel: `Event · ${subjectValue.slice(0, 12)}…` }
  }
  return { ...base, subjectKind: 'other' }
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
    syncIntervalMinutes: WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
    wotAutoLower: true,
  }
  #syncStatus: WotSyncStatus = { state: 'idle' }
  #syncController?: AbortController
  #maintenance?: Promise<WotSyncStatus>
  #activeXAccount?: ActiveXAccountReport
  #proofSession?: ProofComposerSession
  /** Dedupes concurrent GraphQL proof searches per X account id. */
  readonly #proofSearchInFlight = new Set<string>()
  /** Cap passive proof-candidate oEmbed calls per rolling minute. */
  #proofCandidateOembedWindowStartedAt = 0
  #proofCandidateOembedCount = 0
  /** When true, trust queries rebuild the in-memory graph before reading. */
  #graphDirty = true
  /** Per-subject trust query memo, invalidated when graphVersion advances. */
  readonly #trustMemo = new Map<string, TrustQueryResult>()
  #trustMemoVersion = 0
  readonly #npubToTwitterId = new Map<string, string>()
  /** Graph tab id → opener tab id for Close focus restoration. */
  readonly #graphPageOpeners = new Map<number, number>()
  /** Tab ids opened as fullscreen Graph chrome (`?mode=graph|path`). */
  readonly #graphChromeTabIds = new Set<number>()
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
      void backend.#onGraphRelatedTabRemoved(tabId)
      void backend.#onActiveXTabRemoved(tabId)
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
      syncIntervalMinutes: normalizeSyncIntervalMinutes(
        legacy.syncIntervalMinutes,
      ),
      wotAutoLower: legacy.wotAutoLower !== false,
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
    await this.reconcileMaintenanceAlarm()
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
    await writeLocalAccounts({
      accounts: [toLocalAccountEntry(account)],
      activeAccountId: account.id,
      markPersisted: true,
    })
    await chrome.storage.local.set({
      autoLockMs: 0,
    })
    await chrome.storage.sync.set({ myPubkey: account.pubkey })
    delete this.#settings.secretKeyHex
  }

  async handleRequest(
    request: ExtensionRequest,
    context: {
      senderTabId?: number
      senderWindowId?: number
      senderUrl?: string
    } = {},
  ): Promise<unknown> {
    switch (request.type) {
      case 'GET_STATE':
        return this.getPublicState()
      case 'GET_PANEL_SESSION':
        return getPanelSessionSnapshot()
      case 'CLOSE_PANEL_NOTES':
        return closePanelNotes()
      case 'GET_COCKPIT_STATE':
        return this.getCockpitState()
      case 'GET_GRAPH_SNAPSHOT':
        assertVersion(request)
        return this.#getGraphSnapshot({
          maxDepth:
            typeof request.maxDepth === 'number' ? request.maxDepth : undefined,
          maxNodes:
            typeof request.maxNodes === 'number' ? request.maxNodes : undefined,
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
          limit: typeof request.limit === 'number' ? request.limit : undefined,
        })
      case 'OPEN_GRAPH_PAGE':
        assertVersion(request)
        return this.#openGraphPage(
          requireString(request.url, 'url', 4_096),
          context.senderTabId,
          context.senderUrl,
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
          twitterId:
            typeof request.twitterId === 'string'
              ? request.twitterId
              : undefined,
        })
      case 'GET_X_POSTS':
        assertVersion(request)
        return this.#getXPosts({
          query:
            typeof request.query === 'string' ? request.query : undefined,
          offset:
            typeof request.offset === 'number' ? request.offset : undefined,
          limit:
            typeof request.limit === 'number' ? request.limit : undefined,
          sortBy: request.sortBy,
          sortDir: request.sortDir,
        })
      case 'GET_X_POST_DISPLAYS':
        assertVersion(request)
        if (
          !Array.isArray(request.postIds) ||
          request.postIds.length === 0 ||
          request.postIds.length > 50
        ) {
          throw new Error('Invalid xPosts display batch')
        }
        return this.#getXPostDisplays(request.postIds)
      case 'UPSERT_X_POST_CHROME':
        assertVersion(request)
        if (
          !Array.isArray(request.posts) ||
          request.posts.length === 0 ||
          request.posts.length > MAX_X_POST_CHROME_PER_MESSAGE
        ) {
          throw new Error('Invalid xPosts chrome batch')
        }
        return this.#upsertXPostChrome(request.posts)
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
              const latest =
                (await this.#repository.getXIdentity(observation.twitterId)) ??
                record
              this.#broadcastXIdentityUpdated(latest, { statusChanged: false })
            }
          }
          return { ingested: observations.length }
        }
      case 'REPORT_X_PROOF_CANDIDATES':
        assertVersion(request)
        if (
          !Array.isArray(request.candidates) ||
          request.candidates.length === 0 ||
          request.candidates.length > MAX_X_PROOF_CANDIDATES_PER_MESSAGE
        ) {
          throw new Error('Invalid X proof candidate batch')
        }
        return this.#ingestXProofCandidates(request.candidates)
      case 'REPORT_X_BIO_CANDIDATES':
        assertVersion(request)
        if (
          !Array.isArray(request.candidates) ||
          request.candidates.length === 0 ||
          request.candidates.length > MAX_X_BIO_CANDIDATES_PER_MESSAGE
        ) {
          throw new Error('Invalid X bio candidate batch')
        }
        return this.#ingestXBioCandidates(request.candidates)
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
      case 'GET_X_IDENTITY_DISPLAYS_FOR_PUBKEYS':
        assertVersion(request)
        if (
          !Array.isArray(request.pubkeys) ||
          request.pubkeys.length === 0 ||
          request.pubkeys.length > 50
        ) {
          throw new Error('Invalid X identity pubkey display batch')
        }
        return this.#getXIdentityDisplaysForPubkeys(request.pubkeys)
      case 'GET_OPERATOR_X_BINDINGS':
        assertVersion(request)
        return this.#getOperatorXBindings()
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
        return this.#reportActiveXAccount(request.account, {
          tabId: context.senderTabId,
          windowId: context.senderWindowId,
        })
      case 'GET_ACTIVE_X_ACCOUNT':
        assertVersion(request)
        return this.#loadActiveXAccount()
      case 'ENSURE_ACTIVE_X_ACCOUNT':
        assertVersion(request)
        return this.#ensureActiveXAccount()
      case 'PREPARE_X_BIO_EDIT':
        assertVersion(request)
        return this.#prepareXBioEdit(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
          request.confirmReplace === true,
          request.removeNpub === true,
        )
      case 'GET_X_IDENTITY_SUGGEST_FLAGS':
        assertVersion(request)
        return this.#getXIdentitySuggestFlags(
          typeof request.handle === 'string' ? request.handle : undefined,
          requireString(request.twitterId, 'X account ID', 24),
        )
      case 'PUBLISH_X_BINDING':
        assertVersion(request)
        return this.#publishXBinding(
          typeof request.handle === 'string' ? request.handle : undefined,
          requireString(request.twitterId, 'X account ID', 24),
          request.force === true,
        )
      case 'MARK_X_BINDING_SETUP': {
        assertVersion(request)
        const destination = normalizeProofDestination(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
        )
        await this.#requireMatchingActiveAccount(destination)
        const pubkey = this.#pubkey()
        await this.#markXBindingSetup({
          twitterId: destination.twitterId,
          pubkey,
          bioUpdated: request.bioUpdated === true,
          publishedBinding: request.publishedBinding === true,
        })
        return { ok: true }
      }
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
      case 'PREPARE_X_IDENTITY_CLEAR':
        assertVersion(request)
        return this.#prepareXIdentityClear(
          requireString(request.handle, 'X handle', 16),
          requireString(request.twitterId, 'X account ID', 24),
        )
      case 'CONFIRM_X_IDENTITY_CLEAR':
        assertVersion(request)
        return this.#confirmXIdentityClear({
          handle: requireString(request.handle, 'X handle', 16),
          twitterId: requireString(request.twitterId, 'X account ID', 24),
          existingEventId:
            request.existingEventId === null
              ? null
              : requireString(
                  request.existingEventId ?? '',
                  'existingEventId',
                  128,
                ),
        })
      case 'CLEAR_X_IDENTITY_SIDES':
        assertVersion(request)
        return this.#clearXIdentitySides(
          requireString(request.twitterId, 'X account ID', 24),
          {
            bio: request.bio === true,
            post: request.post === true,
            nip39: request.nip39 === true,
          },
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
        if (
          request.value !== '1' &&
          request.value !== '0' &&
          request.value !== '-1'
        ) {
          throw new Error('Invalid trust statement value')
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
          value: '',
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
      case 'QUERY_OUTGOING_TRUST':
        assertVersion(request)
        return this.#queryOutgoingTrust(request.subject)
      case 'PUBLISH_RATING_STATEMENT':
        assertVersion(request)
        if (
          request.content !== undefined &&
          (typeof request.content !== 'string' ||
            request.content.length > 10_000)
        ) {
          throw new Error('Invalid rating statement content')
        }
        if (
          request.context !== undefined &&
          (typeof request.context !== 'string' || request.context.length > 256)
        ) {
          throw new Error('Invalid rating statement context')
        }
        if (typeof request.score !== 'string') {
          throw new Error('Invalid rating score')
        }
        if (request.labels !== undefined && !Array.isArray(request.labels)) {
          throw new Error('Invalid rating labels')
        }
        return this.#publishRatingStatement({
          subject: request.subject,
          score: request.score,
          labels: request.labels,
          context: request.context,
          content:
            request.content === undefined
              ? undefined
              : sanitizeTrustContent(request.content),
          activationTime: request.activationTime,
          expirationTime: request.expirationTime,
        })
      case 'CANCEL_RATING_STATEMENT':
        assertVersion(request)
        if (
          request.content !== undefined &&
          (typeof request.content !== 'string' ||
            request.content.length > 10_000)
        ) {
          throw new Error('Invalid rating statement content')
        }
        return this.#publishRatingStatement({
          subject: request.subject,
          score: '',
          context: request.context,
          content:
            request.content === undefined
              ? undefined
              : sanitizeTrustContent(request.content),
        })
      case 'QUERY_RATING':
        assertVersion(request)
        return this.#queryRating(
          request.subject,
          request.labels,
          request.rootPubkey,
          request.now,
          request.bounds,
          request.format,
        )
      case 'QUERY_RATING_BATCH':
        assertVersion(request)
        if (
          !Array.isArray(request.items) ||
          request.items.length === 0 ||
          request.items.length > MAX_RATING_BATCH_ITEMS
        ) {
          throw new Error('Invalid rating batch')
        }
        return this.#queryRatingBatch(
          request.items,
          request.rootPubkey,
          request.now,
          request.bounds,
        )
      case 'OPEN_SIDE_PANEL':
        assertVersion(request)
        return this.#openSidePanel(
          request.subject,
          request.context,
          context.senderTabId,
        )
      case 'SELECT_SUBJECT':
        assertVersion(request)
        return this.#selectSubject(request.subject, request.context)
      case 'GET_SELECTED_SUBJECT':
        assertVersion(request)
        return this.#getSelectedSubjectSnapshot()
      case 'SELECT_SUBJECT_HISTORY':
        assertVersion(request)
        if (request.direction !== 'back' && request.direction !== 'forward') {
          throw new Error('Invalid history direction')
        }
        return this.#moveSelectedSubjectHistory(request.direction)
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
      case 'GET_WOT_SYNC_INTERVAL':
        assertVersion(request)
        return { intervalMinutes: this.#syncIntervalMinutes() }
      case 'SET_WOT_SYNC_INTERVAL':
        assertVersion(request)
        return this.#setSyncIntervalMinutes(request.intervalMinutes).then(
          (intervalMinutes) => ({ intervalMinutes }),
        )
      case 'GET_WOT_AUTO_LOWER':
        assertVersion(request)
        return { enabled: this.#wotAutoLowerEnabled() }
      case 'SET_WOT_AUTO_LOWER':
        assertVersion(request)
        return this.#setWotAutoLower(request.enabled).then((enabled) => ({
          enabled,
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
    const activeXAccount = await this.#loadActiveXAccount()
    const twitterId = normalizeBoundTwitterId(activeXAccount?.twitterId)
    let needsNostrForX: string | undefined
    let xBoundAccountId: string | undefined
    if (twitterId) {
      const { accounts: localAccounts } = await readLocalAccounts()
      const bound = findAccountByBoundTwitterId(
        listLocalBoundAccountViews(localAccounts),
        twitterId,
      )
      if (bound) xBoundAccountId = bound.id
      else needsNostrForX = twitterId
    }
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
      activeXAccount,
      ...(needsNostrForX ? { needsNostrForX } : {}),
      ...(xBoundAccountId ? { xBoundAccountId } : {}),
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
  }): Promise<GraphSnapshot> {
    await this.#ensureGraphReady()
    const rootPubkey = this.#pubkey()
    const maxDepth = options.maxDepth ?? 4
    const snapshot = this.#graph.egoSnapshot(rootPubkey, {
      maxDepth,
      maxNodes: options.maxNodes ?? 400,
      context: IDENTITY_TRUST_CONTEXT,
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
    limit?: number
  }): Promise<GraphNeighborhood> {
    await this.#ensureGraphReady()
    const centerId =
      typeof options.centerId === 'string' ? options.centerId.trim() : ''
    if (!centerId) {
      throw new Error('centerId is required')
    }
    const parsedCenter = parseWireCenterId(centerId)
    const outboundPubkeys: string[] = []
    if (parsedCenter?.subject?.type === 'i') {
      const twitter = parseCanonicalTwitterSubject(parsedCenter.subject.value)
      if (twitter?.type === 'account') {
        const identity = await this.#repository.getXIdentity(twitter.twitterId)
        if (identity) {
          outboundPubkeys.push(...collectXIdentityPubkeyHexes(identity))
        }
      }
    }
    const result = this.#graph.neighborhood(centerId, {
      direction: options.direction ?? 'both',
      valueFilter: options.valueFilter ?? 'both',
      context: IDENTITY_TRUST_CONTEXT,
      ratingContext: '',
      now: Math.floor(this.#now() / 1_000),
      limit: options.limit ?? 200,
      ...(outboundPubkeys.length > 0 ? { outboundPubkeys } : {}),
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
    senderUrl?: string,
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
    const requested = parseGraphPageUrl(target.search)
    if (isGraphDeepLink(requested)) {
      const reuseId = await this.#graphTabToReuse(
        expected,
        openerTabId,
        senderUrl,
      )
      if (reuseId !== undefined) {
        await chrome.tabs.update(reuseId, { active: true })
        this.#rememberGraphChromeTab(reuseId, opener)
        this.#notifyGraphView(reuseId, requested)
        return { opened: true }
      }
    }
    const tab = await chrome.tabs.create({ url: target.href })
    if (tab.id !== undefined) {
      if (isGraphDeepLink(requested)) {
        this.#rememberGraphChromeTab(tab.id, opener)
      } else if (opener !== undefined) {
        this.#graphPageOpeners.set(tab.id, opener)
      }
    }
    return { opened: true }
  }

  #notifyGraphView(tabId: number, link: GraphDeepLink): void {
    const message = graphViewMessageFromDeepLink(tabId, link)
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined)
    } catch {
      /* no extension page listening */
    }
  }

  #rememberGraphChromeTab(tabId: number, opener?: number): void {
    this.#graphChromeTabIds.add(tabId)
    if (opener !== undefined && !this.#graphPageOpeners.has(tabId)) {
      this.#graphPageOpeners.set(tabId, opener)
    }
  }

  #isKnownGraphChromeTab(
    expected: URL,
    tabId: number,
    url?: string,
  ): boolean {
    if (typeof url === 'string' && url.length > 0) {
      return isGraphChromeTabUrl(url, {
        origin: expected.origin,
        pathname: expected.pathname,
      })
    }
    return this.#graphChromeTabIds.has(tabId)
  }

  async #graphTabToReuse(
    expected: URL,
    senderTabId?: number,
    senderUrl?: string,
  ): Promise<number | undefined> {
    if (
      senderTabId !== undefined &&
      this.#isKnownGraphChromeTab(expected, senderTabId, senderUrl)
    ) {
      return senderTabId
    }
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    const tab = tabs[0]
    if (tab?.id === undefined) return undefined
    if (this.#isKnownGraphChromeTab(expected, tab.id, tab.url)) {
      return tab.id
    }
    return undefined
  }

  async #onGraphRelatedTabRemoved(tabId: number): Promise<void> {
    this.#graphChromeTabIds.delete(tabId)
    const openerTabId = this.#graphPageOpeners.get(tabId)
    if (openerTabId !== undefined) {
      // Browser closed the Application tab — restore focus like Close.
      this.#graphPageOpeners.delete(tabId)
      await this.#restoreFocusAfterGraphPageClose(openerTabId)
      return
    }
    for (const [graphTabId, opener] of this.#graphPageOpeners) {
      if (opener === tabId) this.#graphPageOpeners.delete(graphTabId)
    }
  }

  async #restoreFocusAfterGraphPageClose(
    openerTabId?: number,
  ): Promise<void> {
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
  }

  async #closeGraphPage(graphTabId?: number): Promise<{ closed: true }> {
    if (graphTabId === undefined) {
      throw new Error('Graph page tab is unknown')
    }
    const openerTabId = this.#graphPageOpeners.get(graphTabId)
    this.#graphPageOpeners.delete(graphTabId)
    this.#graphChromeTabIds.delete(graphTabId)
    await this.#restoreFocusAfterGraphPageClose(openerTabId)
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
      let ratingScore: string | undefined
      let ratingLabels: string[] | undefined
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
      } else if (event?.kind === RATING_STATEMENT_KIND) {
        try {
          const parsed = await validateKind32014Event(event)
          if (parsed.valid) {
            const subject = parsed.statement.subject
            subjectSummary = `${subject.type}:${subject.value}`
            ratingScore = parsed.statement.score
            if (parsed.statement.labels.length > 0) {
              ratingLabels = [...parsed.statement.labels]
            }
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
        ...(ratingScore !== undefined ? { ratingScore } : {}),
        ...(ratingLabels !== undefined ? { ratingLabels } : {}),
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
    // Keep the signed-in X account visible at the top of the current page set.
    const activeId = (await this.#loadActiveXAccount())?.twitterId
    if (activeId) {
      const activeIndex = filtered.findIndex((row) => row.twitterId === activeId)
      if (activeIndex > 0) {
        const [activeRow] = filtered.splice(activeIndex, 1)
        filtered.unshift(activeRow)
      }
    }
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
      ...(identity.bannerPath ? { bannerPath: identity.bannerPath } : {}),
      ...pickXVerifiedChrome(identity),
      ...(identity.xNpub ? { xNpub: identity.xNpub } : {}),
      ...(identity.xDate !== undefined ? { xDate: identity.xDate } : {}),
      ...(identity.xObservedAt !== undefined
        ? { xObservedAt: identity.xObservedAt }
        : {}),
      ...(identity.postNpub ? { postNpub: identity.postNpub } : {}),
      ...(identity.postId ? { postId: identity.postId } : {}),
      ...(identity.postHandle ? { postHandle: identity.postHandle } : {}),
      ...(identity.postDate !== undefined
        ? { postDate: identity.postDate }
        : {}),
      ...(identity.postObservedAt !== undefined
        ? { postObservedAt: identity.postObservedAt }
        : {}),
      ...(identity.nip39Npub ? { nip39Npub: identity.nip39Npub } : {}),
      ...(identity.nip39XId ? { nip39XId: identity.nip39XId } : {}),
      ...(identity.nip39Handle ? { nip39Handle: identity.nip39Handle } : {}),
      ...(identity.nip39PostId ? { nip39PostId: identity.nip39PostId } : {}),
      ...(identity.nip39Date !== undefined
        ? { nip39Date: identity.nip39Date }
        : {}),
      ...(identity.eventNpub ? { eventNpub: identity.eventNpub } : {}),
      ...(identity.eventDate !== undefined
        ? { eventDate: identity.eventDate }
        : {}),
      ...(identity.eventId ? { eventId: identity.eventId } : {}),
      ...(identity.eventIssuer ? { eventIssuer: identity.eventIssuer } : {}),
      state: identity.state,
      ...(identity.proofSource ? { proofSource: identity.proofSource } : {}),
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
    if (row.proofSource?.toLowerCase().includes(query)) return true
    if (row.handle.toLowerCase().includes(query)) return true
    if (row.displayName?.toLowerCase().includes(query)) return true
    const npubs = [row.xNpub, row.postNpub, row.nip39Npub, row.eventNpub].filter(
      Boolean,
    ) as string[]
    if (npubs.some((npub) => npub.toLowerCase().includes(query))) return true
    if (row.eventId?.toLowerCase().includes(query)) return true
    if (row.postId?.toLowerCase().includes(query)) return true
    if (row.nip39PostId?.toLowerCase().includes(query)) return true
    return false
  }

  async #getEvents(options: {
    query?: string
    offset?: number
    limit?: number
    sortBy?: EventSortField
    sortDir?: EventSortDir
    twitterId?: string
  }): Promise<EventsState> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const query = (options.query ?? '').trim().toLowerCase()
    const sortBy = parseEventSortField(options.sortBy)
    const sortDir = parseEventSortDir(options.sortDir, sortBy)

    let filterPubkeys: string[] | undefined
    const twitterId = options.twitterId?.trim()
    if (twitterId) {
      if (!/^\d{1,24}$/.test(twitterId)) {
        throw new Error('Invalid twitterId')
      }
      const identity = await this.#repository.getXIdentity(twitterId)
      const pubkeys = new Set<string>()
      for (const npub of [
        identity?.xNpub,
        identity?.postNpub,
        identity?.nip39Npub,
        identity?.eventNpub,
      ]) {
        const pk = npub ? pubkeyFromNpub(npub) : undefined
        if (pk) pubkeys.add(pk)
      }
      filterPubkeys = [...pubkeys]
      if (filterPubkeys.length === 0) {
        return {
          generatedAt: this.#now(),
          total: 0,
          offset,
          limit,
          query: options.query?.trim() ?? '',
          sortBy,
          sortDir,
          events: [],
          filterTwitterId: twitterId,
          filterPubkeys: [],
        }
      }
    }

    const identities = await this.#repository.getAllXIdentities()
    const identityByTwitterId = new Map(
      identities.map((row) => [row.twitterId, row] as const),
    )
    const posts = await this.#repository.getAllXPosts()
    const postById = new Map(posts.map((row) => [row.postId, row] as const))

    let rows = (await this.#repository.getAllEvents()).map((event) =>
      this.#toEventListRow(event, identityByTwitterId, postById),
    )
    if (filterPubkeys) {
      const allowed = new Set(filterPubkeys)
      rows = rows.filter((row) => allowed.has(row.pubkey))
    }
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
      ...(twitterId ? { filterTwitterId: twitterId } : {}),
      ...(filterPubkeys ? { filterPubkeys } : {}),
    }
  }

  #toEventListRow(
    event: EventRecord,
    identityByTwitterId?: Map<string, XIdentityRecord>,
    postById?: Map<string, XPostRecord>,
  ): EventListRow {
    let npub = event.pubkey
    try {
      npub = nip19.npubEncode(event.pubkey)
    } catch {
      // Keep hex pubkey when encoding fails.
    }
    const enrichment = enrichEventSubject(
      event,
      identityByTwitterId,
      postById,
    )
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
      ...enrichment,
    }
  }

  async #getXPosts(options: {
    query?: string
    offset?: number
    limit?: number
    sortBy?: XPostSortField
    sortDir?: XPostSortDir
  }): Promise<XPostsState> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const offset = Math.max(0, Math.floor(options.offset ?? 0))
    const query = (options.query ?? '').trim().toLowerCase()
    const sortBy = parseXPostSortField(options.sortBy)
    const sortDir = parseXPostSortDir(options.sortDir, sortBy)
    const rows: XPostListRow[] = (await this.#repository.getAllXPosts()).map(
      (post) => ({
        postId: post.postId,
        ...(post.authorTwitterId
          ? { authorTwitterId: post.authorTwitterId }
          : {}),
        ...(post.authorHandle ? { authorHandle: post.authorHandle } : {}),
        ...(post.headline ? { headline: post.headline } : {}),
        ...(post.role ? { role: post.role } : {}),
        ...(post.parentPostId ? { parentPostId: post.parentPostId } : {}),
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        lastSeen: post.lastSeen,
      }),
    )
    const filtered = query
      ? rows.filter((row) => {
          if (row.postId.includes(query)) return true
          if (row.authorTwitterId?.includes(query)) return true
          if (row.authorHandle?.toLowerCase().includes(query)) return true
          if (row.headline?.toLowerCase().includes(query)) return true
          if (row.role?.includes(query)) return true
          return false
        })
      : rows
    filtered.sort((a, b) => compareXPostRows(a, b, sortBy, sortDir))
    return {
      generatedAt: this.#now(),
      total: filtered.length,
      offset,
      limit,
      query: options.query?.trim() ?? '',
      sortBy,
      sortDir,
      posts: filtered.slice(offset, offset + limit),
    }
  }

  async #upsertXPostChrome(
    rawPosts: unknown[],
  ): Promise<{ upserted: number }> {
    await this.#ensureGraphReady()
    const root = (this.#operatorPubkey() ?? this.#pubkey()).toLowerCase()
    let upserted = 0
    for (const raw of rawPosts) {
      const chrome = sanitizeXPostChromeInput(raw)
      if (!chrome) continue
      const subject = {
        type: 'i' as const,
        value: `post:id:${chrome.postId}`,
      }
      const result = this.#memoizedTrustQuery({
        rootPubkey: root,
        subject,
        context: trustQueryContextForSubject(subject),
      })
      const rating = this.#graph.queryRating({
        rootPubkey: root,
        subject,
        context: '',
      })
      const hasEvidence =
        result.resolution !== 'none' ||
        result.direct?.value === 1 ||
        result.direct?.value === -1 ||
        rating.claimCount > 0
      if (!hasEvidence) continue
      await this.#repository.upsertXPostChrome(
        {
          postId: chrome.postId,
          ...(chrome.authorTwitterId
            ? { authorTwitterId: chrome.authorTwitterId }
            : {}),
          ...(chrome.authorHandle ? { authorHandle: chrome.authorHandle } : {}),
          ...(chrome.headline ? { headline: chrome.headline } : {}),
          ...(chrome.role ? { role: chrome.role } : {}),
          ...(chrome.parentPostId
            ? { parentPostId: chrome.parentPostId }
            : {}),
        },
        chrome.observedAt ?? this.#now(),
      )
      upserted += 1
    }
    return { upserted }
  }

  /**
   * After publishing/cancelling post trust: ensure a row exists for active
   * statements; prune orphans when cancelled or evidence is gone.
   */
  async #syncXPostRowAfterTrustPublish(
    subject: TrustSubject,
    value: TrustValue,
  ): Promise<void> {
    if (subject.type !== 'i') return
    const parsed = parseCanonicalTwitterSubject(subject.value)
    if (parsed?.type !== 'post') return
    if (value === '1' || value === '0' || value === '-1') {
      await this.#repository.upsertXPostChrome(
        { postId: parsed.postId },
        this.#now(),
      )
    }
    await this.#pruneOrphanXPosts()
  }

  /** After publishing/cancelling a post rating, keep or prune xPosts chrome. */
  async #syncXPostRowAfterRatingPublish(
    subject: TrustSubject,
    score: string,
  ): Promise<void> {
    if (subject.type !== 'i') return
    const parsed = parseCanonicalTwitterSubject(subject.value)
    if (parsed?.type !== 'post') return
    const selected = await this.#readSelectedSubject()
    const selectedThisPost =
      selected?.subject.type === 'i' && selected.subject.value === subject.value
    // Keep Notes chrome after Delete so the still-selected post can be rated again.
    if (score !== '' || selectedThisPost) {
      await this.#repository.upsertXPostChrome(
        { postId: parsed.postId },
        this.#now(),
      )
    }
    await this.#pruneOrphanXPosts()
  }

  /** Drop xPosts rows that no longer have local trust evidence. */
  async #pruneOrphanXPosts(): Promise<number> {
    await this.#ensureGraphReady()
    const root = this.#operatorPubkey()
    if (!root) return 0
    const proofPostIds = new Set(
      (await this.#repository.getAllXIdentities())
        .map((identity) => identity.postId)
        .filter(
          (postId): postId is string =>
            typeof postId === 'string' && isTwitterNumericId(postId),
        ),
    )
    const keep = new Set<string>()
    const selected = await this.#readSelectedSubject()
    const selectedParsed =
      selected?.subject.type === 'i'
        ? parseCanonicalTwitterSubject(selected.subject.value)
        : undefined
    if (selectedParsed?.type === 'post') {
      keep.add(selectedParsed.postId)
    }
    for (const post of await this.#repository.getAllXPosts()) {
      if (proofPostIds.has(post.postId)) {
        keep.add(post.postId)
        continue
      }
      const result = this.#memoizedTrustQuery({
        rootPubkey: root,
        subject: { type: 'i', value: `post:id:${post.postId}` },
        context: trustQueryContextForSubject({
          type: 'i',
          value: `post:id:${post.postId}`,
        }),
      })
      const rating = this.#graph.queryRating({
        rootPubkey: root,
        subject: { type: 'i', value: `post:id:${post.postId}` },
        context: '',
      })
      if (
        result.resolution !== 'none' ||
        result.direct?.value === 1 ||
        result.direct?.value === -1 ||
        rating.claimCount > 0
      ) {
        keep.add(post.postId)
      }
    }
    return this.#repository.deleteXPostsNotIn(keep)
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
    if (row.subjectSummary?.toLowerCase().includes(query)) return true
    if (row.subjectLabel?.toLowerCase().includes(query)) return true
    if (row.subjectHeadline?.toLowerCase().includes(query)) return true
    if (row.trustValue?.includes(query)) return true
    if (row.ratingScore?.includes(query)) return true
    if (row.ratingLabels?.some((label) => label.toLowerCase().includes(query))) {
      return true
    }
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
      const syncEnabled =
        this.#syncIntervalMinutes() > WOT_SYNC_INTERVAL_PAUSED_MINUTES
      if (hasSigner && syncEnabled && this.#syncStatus.state !== 'running') {
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
      syncIntervalMinutes: this.#syncIntervalMinutes(),
      wotAutoLower: this.#wotAutoLowerEnabled(),
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

  async #subjectHintsForTrust(
    subject: TrustSubject,
    value: TrustValue,
  ): Promise<SubjectHint[]> {
    if (value !== '1' || subject.type !== 'i') return []
    const parsed = parseCanonicalTwitterSubject(subject.value)
    if (parsed?.type !== 'account') return []
    const identity = await this.#repository.getXIdentity(parsed.twitterId)
    if (!identity) return []
    const npub = primaryNpubFromRow(identity)
    if (!npub) return []
    return [{ kind: 'npub', npub }]
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
    if (!demoMode) {
      this.#assertActiveNostrBoundToX()
    }

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

    const isCancel = input.value === ''
    const context = isCancel
      ? (input.context ?? '')
      : trustPublishContextForSubject(input.subject)
    const publishTags = defaultTrustPublishTags(input.subject)
    const subjectHints = await this.#subjectHintsForTrust(
      input.subject,
      input.value,
    )
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
      ...(subjectHints.length > 0 ? { subjectHints } : {}),
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
      await this.#syncXPostRowAfterTrustPublish(input.subject, input.value)
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
    await this.#syncXPostRowAfterTrustPublish(input.subject, input.value)
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
    rootPubkey?: string,
    now?: number,
    bounds?: Partial<ResolveBounds>,
    format?: 'default' | 'path',
  ): Promise<TrustQueryResult> {
    return this.#ensureGraphReady().then(async () => {
      const root = rootPubkey ?? this.#pubkey()
      const resolvedContext = trustQueryContextForSubject(subject)
      if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root pubkey')
      const subjectError = getTrustSubjectValidationError(subject)
      if (subjectError) throw new Error(subjectError)
      if (!isCanonicalTrustContext(resolvedContext)) {
        throw new Error('Context is not canonical')
      }
      const resolved = this.#memoizedTrustQuery({
        rootPubkey: root,
        subject,
        context: resolvedContext,
        now,
        bounds,
        format,
      })
      return this.#attachConnectionKeysToTrustResult(
        await this.#withIncomingStatementFallback(resolved),
      )
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
          const resolvedContext = trustQueryContextForSubject(item.subject)
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

  /**
   * Notes "Trusted by" uses QUERY_TRUST.statements. Graph 1-hop inbound is
   * unfiltered; WoT resolve only lists last-degree authors. When resolve is
   * empty, fill from the same inbound edges the Graph already draws.
   */
  async #withIncomingStatementFallback(
    result: TrustQueryResult,
  ): Promise<TrustQueryResult> {
    if (result.statements.length > 0) return result
    const keys = incomingSubjectKeys(result.subject)
    if (keys.twitterId) {
      try {
        const identity = await this.#repository.getXIdentity(keys.twitterId)
        for (const hex of identity ? collectXIdentityPubkeyHexes(identity) : []) {
          keys.pubkeyHexes.add(hex)
        }
      } catch {
        /* identity row optional */
      }
    }
    if (!keys.twitterId && keys.pubkeyHexes.size === 0) return result
    const selected = selectIncomingUserStatements(
      this.#graph.listStatements(),
      keys,
    )
    if (selected.statements.length === 0) return result
    return {
      ...result,
      statements: selected.statements,
      sourceEventIds: [
        ...new Set(selected.statements.map((row) => row.eventId)),
      ].sort(),
      truncated: result.truncated || selected.truncated,
    }
  }

  async #queryOutgoingTrust(
    subject: TrustSubject,
  ): Promise<QueryOutgoingTrustResult> {
    const subjectError = getTrustSubjectValidationError(subject)
    if (subjectError) throw new Error(subjectError)
    const parsed =
      subject.type === 'i'
        ? parseCanonicalTwitterSubject(subject.value)
        : undefined
    const authors = new Set<string>()
    if (subject.type === 'p') {
      const hex = subject.value.trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Invalid pubkey')
      authors.add(hex)
    } else if (parsed?.type === 'account') {
      const identity = await this.#repository.getXIdentity(parsed.twitterId)
      for (const hex of identity ? collectXIdentityPubkeyHexes(identity) : []) {
        authors.add(hex)
      }
    } else {
      return { subject: { ...subject }, statements: [], truncated: false }
    }
    if (authors.size === 0 && parsed?.type === 'account') {
      return {
        subject: { ...subject },
        statements: [],
        truncated: false,
        unavailable: true,
      }
    }
    await this.#ensureGraphReady()
    const selected = selectOutgoingUserStatements(
      this.#graph.listStatements(),
      authors,
    )
    return {
      subject: { ...subject },
      statements: await this.#attachConnectionKeys(selected.statements),
      truncated: selected.truncated,
    }
  }

  async #publishRatingStatement(input: {
    subject: TrustSubject
    score: string
    labels?: string[]
    context?: string
    content?: string
    activationTime?: number
    expirationTime?: number
  }): Promise<PublishResult> {
    const demoMode = this.#appMode() === 'demo'
    if (!demoMode) {
      this.#assertActiveNostrBoundToX()
    }

    const subjectError = getTrustSubjectValidationError(input.subject)
    if (subjectError) throw new Error(subjectError)

    const isCancel = input.score === ''
    const context = isCancel
      ? (input.context ?? '')
      : ratingPublishContextForSubject(input.subject)
    if (!isCanonicalTrustContext(context)) {
      throw new Error('Context is not canonical')
    }

    const score = canonicalizeRatingScore(input.score)
    if (score === undefined) throw new Error('Invalid rating score')

    const labels = canonicalRatingLabels(input.labels ?? [])
    for (const label of labels) {
      if (!isCanonicalRatingLabel(label)) {
        throw new Error('Invalid rating label')
      }
    }

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
        kind: RATING_STATEMENT_KIND,
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
    const template = await buildKind32014Event({
      subject: input.subject,
      score,
      context,
      scopes: publishTags.scopes,
      k: publishTags.k,
      labels,
      content: sanitizeTrustContent(input.content ?? ''),
      activationTime: input.activationTime,
      expirationTime: input.expirationTime,
      createdAt,
      ...(demoMode
        ? { extraTags: DEMO_WOT_EXTRA_TAGS.map((tag) => [...tag]) }
        : {}),
    })
    const ratingKey = this.#secretKey()
    let event: Event
    try {
      event = finalizeEvent(template, ratingKey)
    } finally {
      ratingKey.fill(0)
    }
    const validation = await validateKind32014Event(event)
    if (!validation.valid) throw new Error(validation.errors.join('; '))

    if (demoMode) {
      await this.#repository.ingestEvent({
        event,
        state: DEMO_EVENT_STATE,
      })
      await this.#rebuildGraph()
      await this.#syncXPostRowAfterRatingPublish(input.subject, score)
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
    await this.#syncXPostRowAfterRatingPublish(input.subject, score)
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

  #queryRating(
    subject: TrustSubject,
    labels?: string[],
    rootPubkey?: string,
    now?: number,
    bounds?: Partial<ResolveBounds>,
    format?: 'default' | 'path',
  ): Promise<RatingQueryResult> {
    return this.#ensureGraphReady().then(() => {
      const root = rootPubkey ?? this.#pubkey()
      const resolvedContext = ratingQueryContextForSubject(subject)
      if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root pubkey')
      const subjectError = getTrustSubjectValidationError(subject)
      if (subjectError) throw new Error(subjectError)
      if (!isCanonicalTrustContext(resolvedContext)) {
        throw new Error('Context is not canonical')
      }
      if (labels !== undefined) {
        if (!Array.isArray(labels)) throw new Error('Invalid rating labels')
        for (const label of labels) {
          if (typeof label !== 'string' || !isCanonicalRatingLabel(label)) {
            throw new Error('Invalid rating label')
          }
        }
      }
      return this.#graph.queryRating({
        rootPubkey: root,
        subject,
        context: resolvedContext,
        ...(labels !== undefined ? { labels } : {}),
        now,
        bounds,
        ...(format ? { format } : {}),
      })
    })
  }

  #queryRatingBatch(
    items: QueryRatingBatchItem[],
    rootPubkey?: string,
    now?: number,
    bounds?: Partial<ResolveBounds>,
  ): Promise<QueryRatingBatchResult> {
    return this.#ensureGraphReady().then(() => {
      const root = rootPubkey ?? this.#pubkey()
      if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid root pubkey')

      const results: Record<string, RatingQueryResult> = {}
      const errors: Record<string, string> = {}
      const seen = new Set<string>()

      for (const item of items) {
        const key = item?.key
        if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
          throw new Error('Invalid rating batch item key')
        }
        if (seen.has(key)) throw new Error(`Duplicate rating batch key: ${key}`)
        seen.add(key)

        try {
          const subjectError = getTrustSubjectValidationError(item.subject)
          if (subjectError) throw new Error(subjectError)
          const resolvedContext = ratingQueryContextForSubject(item.subject)
          if (!isCanonicalTrustContext(resolvedContext)) {
            throw new Error('Context is not canonical')
          }
          if (item.labels !== undefined) {
            if (!Array.isArray(item.labels)) {
              throw new Error('Invalid rating labels')
            }
            for (const label of item.labels) {
              if (typeof label !== 'string' || !isCanonicalRatingLabel(label)) {
                throw new Error('Invalid rating label')
              }
            }
          }
          results[key] = this.#graph.queryRating({
            rootPubkey: root,
            subject: item.subject,
            context: resolvedContext,
            ...(item.labels !== undefined ? { labels: item.labels } : {}),
            now,
            bounds,
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
      this.#wotAutoLowerEnabled() &&
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
    const active = await this.#loadActiveXAccount()
    const signedIn = normalizeBoundTwitterId(active?.twitterId)
    const live =
      signedIn && active
        ? xIdentityDisplayFromLiveChrome({
            twitterId: signedIn,
            ...(active.displayName ? { displayName: active.displayName } : {}),
            ...(active.handle ? { handle: active.handle } : {}),
            ...(active.iconPath ? { iconPath: active.iconPath } : {}),
          })
        : undefined
    const displays: Record<string, XIdentityDisplay> = {}
    for (const twitterId of unique) {
      const row = await this.#repository.getXIdentity(twitterId)
      const fromRow = row ? xIdentityDisplayFromRow(row) : undefined
      const merged =
        signedIn === twitterId
          ? fillXIdentityDisplayGaps(live, fromRow)
          : fromRow
      if (merged) displays[twitterId] = merged
    }
    return displays
  }

  async #getXIdentityDisplaysForPubkeys(
    pubkeys: readonly string[],
  ): Promise<Record<string, XIdentityDisplay>> {
    const wanted = new Set<string>()
    for (const raw of pubkeys) {
      if (typeof raw !== 'string') continue
      const hex = raw.trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(hex)) wanted.add(hex)
    }
    const displays: Record<string, XIdentityDisplay> = {}
    if (wanted.size === 0) return displays
    const rows = await this.#repository.getAllXIdentities()
    for (const row of rows) {
      const display = xIdentityDisplayFromRow(row)
      for (const hex of collectXIdentityPubkeyHexes(row)) {
        if (!wanted.has(hex) || displays[hex]) continue
        displays[hex] = display
      }
    }
    const needed = [...wanted].filter(
      (hex) => !xIdentityDisplayHasChrome(displays[hex]),
    )
    if (needed.length > 0 && !vault.isLocked()) {
      const active = await this.#loadActiveXAccount()
      const signedIn = normalizeBoundTwitterId(active?.twitterId)
      for (const acct of vault.listAccounts()) {
        const hex = acct.pubkey.trim().toLowerCase()
        if (!wanted.has(hex) || xIdentityDisplayHasChrome(displays[hex])) {
          continue
        }
        const twitterId = preferredBoundTwitterId(acct, signedIn)
        if (!twitterId) continue
        const bound = await this.#getXIdentityDisplays([twitterId])
        const display = bound[twitterId]
        if (!display) continue
        displays[hex] =
          fillXIdentityDisplayGaps(displays[hex], display) ?? display
      }
    }
    return this.#fillSignedInXDisplayChrome(displays)
  }

  async #fillSignedInXDisplayChrome(
    displays: Record<string, XIdentityDisplay>,
  ): Promise<Record<string, XIdentityDisplay>> {
    const active = await this.#loadActiveXAccount()
    const signedIn = normalizeBoundTwitterId(active?.twitterId)
    if (!signedIn || !active) return displays
    const live = xIdentityDisplayFromLiveChrome({
      twitterId: signedIn,
      ...(active.displayName ? { displayName: active.displayName } : {}),
      ...(active.handle ? { handle: active.handle } : {}),
      ...(active.iconPath ? { iconPath: active.iconPath } : {}),
    })
    if (!live) return displays
    for (const hex of Object.keys(displays)) {
      if (displays[hex]?.twitterId !== signedIn) continue
      const merged = fillXIdentityDisplayGaps(live, displays[hex])
      if (merged) displays[hex] = merged
    }
    return displays
  }

  async #getOperatorXBindings(): Promise<OperatorXBindingRow[]> {
    const vaultIds: string[] = []
    const byTwitterAccount = new Map<
      string,
      { accountId: string; pubkey: string }
    >()
    if (!vault.isLocked()) {
      for (const acct of vault.listAccounts()) {
        for (const tid of boundTwitterIdsOf(acct)) {
          vaultIds.push(tid)
          byTwitterAccount.set(tid, { accountId: acct.id, pubkey: acct.pubkey })
        }
      }
    }
    let syncIds: string[] = []
    const syncPubkeys = new Map<string, string>()
    try {
      const sync = await readXNostrBindings()
      syncIds = Object.keys(sync.byTwitterId)
      for (const [tid, row] of Object.entries(sync.byTwitterId)) {
        if (row.pubkey) syncPubkeys.set(tid, row.pubkey)
      }
    } catch {
      /* ignore */
    }
    let blobIds: string[] = []
    try {
      const blobs = await readEasyBlobsMap()
      blobIds = Object.entries(blobs.byTwitterId)
        .filter(([, blob]) => !blob.deleted)
        .map(([tid]) => tid)
    } catch {
      /* ignore */
    }
    const active = await this.#loadActiveXAccount()
    const signedIn = normalizeBoundTwitterId(active?.twitterId)
    const twitterIds = collectOperatorKnownTwitterIds({
      vaultTwitterIds: vaultIds,
      syncTwitterIds: syncIds,
      blobTwitterIds: blobIds,
      signedInTwitterId: signedIn,
    })
    const displays =
      twitterIds.length > 0
        ? await this.#getXIdentityDisplays(twitterIds)
        : {}
    const rows: OperatorXBindingRow[] = []
    for (const twitterId of twitterIds) {
      const display = displays[twitterId]
      const bound = byTwitterAccount.get(twitterId)
      const pubkey = bound?.pubkey || syncPubkeys.get(twitterId)
      const handle =
        display?.handle ||
        (signedIn === twitterId ? active?.handle : undefined)
      const displayName =
        display?.displayName ||
        (signedIn === twitterId ? active?.displayName : undefined)
      const iconPath =
        display?.iconPath ||
        (signedIn === twitterId ? active?.iconPath : undefined)
      const identity = await this.#repository.getXIdentity(twitterId)
      const completeness = await this.#operatorBindingCompleteness(
        twitterId,
        pubkey,
      )
      rows.push({
        twitterId,
        ...(handle ? { handle } : {}),
        ...(displayName ? { displayName } : {}),
        ...(iconPath ? { iconPath } : {}),
        ...(identity?.bannerPath ? { bannerPath: identity.bannerPath } : {}),
        ...pickXVerifiedChrome(identity ?? display),
        ...(bound
          ? { accountId: bound.accountId, pubkey: bound.pubkey }
          : pubkey
            ? { pubkey }
            : {}),
        ...(signedIn === twitterId ? { signedIn: true } : {}),
        completeness,
      })
    }
    return rows
  }

  async #operatorBindingCompleteness(
    twitterId: string,
    pubkey: string | undefined,
  ): Promise<OperatorBindingCompleteness> {
    if (!pubkey) return UNBOUND_COMPLETENESS
    const boundNpub = npubFromPubkey(pubkey)
    const identity = await this.#repository.getXIdentity(twitterId)
    const xPicture =
      identity?.iconPath && isXProfileIconPath(identity.iconPath)
        ? buildXProfileIconUrl(identity.iconPath)
        : undefined
    const xBanner =
      identity?.bannerPath && isXProfileBannerPath(identity.bannerPath)
        ? buildXProfileBannerUrl(identity.bannerPath)
        : undefined
    let kind0: Kind0MetadataLike | null = null
    try {
      const metadata = await fetchProfileMetadata(pubkey)
      if (metadata && typeof metadata === 'object') {
        kind0 = metadata as Kind0MetadataLike
      }
    } catch {
      /* cache miss / locked */
    }
    const kind0Compare = compareKind0ToX(kind0, {
      ...(identity?.displayName ? { name: identity.displayName } : {}),
      ...(xPicture ? { picture: xPicture } : {}),
      ...(xBanner ? { banner: xBanner } : {}),
    })
    let current10011ClaimsTwitterId = false
    try {
      const current = await this.#currentNip39Event(pubkey)
      const claim = current
        ? inspectExistingTwitterTags(current.tags).claim
        : undefined
      current10011ClaimsTwitterId = claim?.twitterId === twitterId
    } catch {
      /* no 10011 slot */
    }
    return resolveOperatorBindingCompleteness({
      bound: true,
      boundNpub,
      xNpub: identity?.xNpub,
      nip39Npub: identity?.nip39Npub,
      kind0Compare,
      current10011ClaimsTwitterId,
    })
  }

  async #getXPostDisplays(
    postIds: readonly string[],
  ): Promise<Record<string, XPostDisplay>> {
    const unique = [
      ...new Set(
        postIds.filter(
          (id): id is string =>
            typeof id === 'string' && isTwitterNumericId(id),
        ),
      ),
    ].slice(0, 50)
    const displays: Record<string, XPostDisplay> = {}
    for (const postId of unique) {
      const row = await this.#repository.getXPost(postId)
      if (!row) continue
      displays[postId] = {
        ...(row.headline ? { headline: row.headline } : {}),
        ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
        ...(row.authorTwitterId
          ? { authorTwitterId: row.authorTwitterId }
          : {}),
        ...(row.role ? { role: row.role } : {}),
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
    const active = await this.#loadActiveXAccount()
    return {
      identity: overlayLiveXChromeOnIdentity(identity, {
        twitterId: active?.twitterId,
        ...(active?.displayName ? { displayName: active.displayName } : {}),
        ...(active?.handle ? { handle: active.handle } : {}),
        ...(active?.iconPath ? { iconPath: active.iconPath } : {}),
      }),
    }
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
        await this.#recordVerifiedIdentity(result.alreadyProven.verification)
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
      if (await this.#recordVerifiedIdentity(decision.verification)) {
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
          await this.#recordVerifiedIdentity(decision.verification)
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
    const missingPostProof = !existing?.postId || !existing.postNpub

    if (
      decision.decision === 'pending' &&
      !options.forceRescan &&
      !missingPostProof
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

    // 3) Durable local X-proof side is self-sufficient — do not require
    //    GraphQL rescan or a matching kind 10011.
    if (
      !options.forceRescan &&
      existing?.postId &&
      existing.postNpub?.toLowerCase() === npub.toLowerCase() &&
      isTwitterNumericId(existing.postId)
    ) {
      return {
        status: 'verified',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: existing.postId,
        npub,
        source: 'local-identity',
      }
    }

    // 4) No local X-proof (or forced / incomplete row) → optional GraphQL search.
    //    Only a found X proof may write post* fields — never copy from nip39.
    const shouldScan =
      options.scanPage &&
      (options.forceRescan ||
        missingPostProof ||
        decision.decision === 'needs_proof' ||
        decision.decision === 'conflict' ||
        decision.decision === 'pending')
    if (shouldScan) {
      const pagePostId = await this.#findProofPostOnX(
        destination.handle,
        npub,
      )
      if (pagePostId) {
        await this.#recordPostSide({
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
      existing?.postId &&
      existing.postNpub?.toLowerCase() === npub.toLowerCase() &&
      isTwitterNumericId(existing.postId)
    ) {
      return {
        status: 'verified',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: existing.postId,
        npub,
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
  /**
   * A found post-proof is self-sufficient (the X account itself asserts the
   * npub) — no separate kind 10011 is required to reach `verified`.
   */
  async #searchOtherUserXProof(
    destination: { handle: string; twitterId: string },
    options: { forceRescan: boolean },
  ): Promise<XProofCheckResult> {
    const existing = await this.#repository.getXIdentity(destination.twitterId)
    if (
      !options.forceRescan &&
      existing?.state === 'verified' &&
      existing.postId &&
      existing.postNpub &&
      isTwitterNumericId(existing.postId)
    ) {
      return {
        status: 'verified',
        handle: destination.handle,
        twitterId: destination.twitterId,
        proofPostId: existing.postId,
        npub: existing.postNpub,
        source: 'local-identity',
      }
    }

    const match = await this.#searchProofPostOnX(destination.handle)
    if (!match?.fullText) {
      if (
        existing?.postId &&
        existing.postNpub &&
        isTwitterNumericId(existing.postId)
      ) {
        return {
          status: 'verified',
          handle: destination.handle,
          twitterId: destination.twitterId,
          proofPostId: existing.postId,
          npub: existing.postNpub,
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

    const npub = extractNpubFromProofPostText(match.fullText)
    if (!npub) {
      return {
        status: 'not_found',
        handle: destination.handle,
        twitterId: destination.twitterId,
        npub: '',
        proofText: '',
      }
    }

    await this.#recordPostSide({
      handle: destination.handle,
      twitterId: destination.twitterId,
      postId: match.postId,
      npub,
      ...(match.postedAt !== undefined ? { postedAt: match.postedAt } : {}),
    })
    this.#logExtensionActivity({
      method: 'xProofFound',
      decision: 'found',
      domain: 'x.com',
    })

    return {
      status: 'verified',
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: match.postId,
      npub,
      source: 'explicit-search',
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
    if (
      identity?.state !== 'verified' ||
      typeof identity.postId !== 'string' ||
      !isTwitterNumericId(identity.postId)
    ) {
      return undefined
    }
    const boundPubkey =
      pubkeyFromNpub(identity.postNpub) ??
      pubkeyFromNpub(identity.nip39Npub)
    if (!boundPubkey || boundPubkey !== pubkey.toLowerCase()) {
      return undefined
    }

    return {
      status: 'verified',
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId: identity.postId,
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
   *
   * Page results are never trusted alone — oEmbed must confirm the post id,
   * author handle, and proof text before the value is returned for persistence.
   */
  async #searchProofPostOnX(
    handle: string,
    options: { npub?: string } = {},
  ): Promise<
    { postId: string; fullText: string; postedAt?: number } | undefined
  > {
    const tab = await this.#findXProductTab()
    if (!tab?.id) return undefined
    const tabId = tab.id
    const expectedHandle = normalizeObservedHandle(handle)
    if (!expectedHandle) return undefined

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = (await chrome.tabs.sendMessage(tabId, {
          type: 'SEARCH_PROOF_POST',
          handle: expectedHandle,
          ...(options.npub ? { npub: options.npub } : {}),
          timeoutMs: 12_000,
        })) as
          | { postId?: string; fullText?: string; postedAt?: number }
          | undefined
        if (
          typeof response?.postId === 'string' &&
          isTwitterNumericId(response.postId)
        ) {
          const pagePostedAt =
            typeof response.postedAt === 'number' &&
            Number.isSafeInteger(response.postedAt) &&
            response.postedAt > 0
              ? response.postedAt
              : undefined
          const verified = await this.#revalidatePageProofPost({
            postId: response.postId,
            handle: expectedHandle,
            npub: options.npub,
          })
          if (!verified) return undefined
          return {
            ...verified,
            ...(pagePostedAt !== undefined ? { postedAt: pagePostedAt } : {}),
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

  /**
   * Independently confirm a page-reported proof post via public oEmbed before
   * any `post*` identity write or composer capture publish.
   */
  async #revalidatePageProofPost(input: {
    postId: string
    handle: string
    npub?: string
  }): Promise<{ postId: string; fullText: string } | undefined> {
    const queried = await this.#queryProofPost(input.postId)
    if (queried.status !== 'found') return undefined
    const verified = verifyProofPostResponse(queried.post, {
      postId: input.postId,
      handle: input.handle,
      ...(input.npub
        ? { npub: input.npub }
        : { proofText: LINKING_PROOF_PREFIX }),
    })
    if (!verified.valid) return undefined
    return {
      postId: verified.post.postId,
      fullText: verified.post.text,
    }
  }

  async #hasVerifiedXIdentityProof(twitterId: string): Promise<boolean> {
    if (!isTwitterNumericId(twitterId)) return false
    const identity = await this.#repository.getXIdentity(twitterId)
    return Boolean(
      identity?.state === 'verified' &&
        typeof identity.postId === 'string' &&
        isTwitterNumericId(identity.postId),
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

  async #readTwidTwitterIdFromCookies(): Promise<string | undefined> {
    try {
      const cookie = await chrome.cookies.get({
        url: 'https://x.com/',
        name: 'twid',
      })
      const fromX = cookie?.value
        ? twitterIdFromTwidCookie(cookie.value)
        : undefined
      if (fromX) return fromX
      const twitter = await chrome.cookies.get({
        url: 'https://twitter.com/',
        name: 'twid',
      })
      return twitter?.value
        ? twitterIdFromTwidCookie(twitter.value)
        : undefined
    } catch {
      return undefined
    }
  }

  async #ensureActiveXAccount(): Promise<
    | { status: 'ready'; account: ActiveXAccountReport }
    | { status: 'missing'; reason: string; handle?: string }
  > {
    const focused = await hydrateFocusedProductTab()
    if (focused.kind !== 'ok' || !focused.isX) {
      return {
        status: 'missing',
        reason: 'Open x.com while signed in so AttentionX can detect your account',
      }
    }
    const now = this.#now()
    const registry = await loadActiveXTabRegistry(now)
    const captured = observationForTab(registry, focused.tabId)
    const capturedEpoch = captured?.navigationEpoch ?? 0
    const capturedTabId = focused.tabId

    const fromTab = await this.#refreshActiveXAccountFromTab(focused.tabId)
    const live = await loadActiveXTabRegistry(this.#now())
    const liveEpoch = observationForTab(live, capturedTabId)?.navigationEpoch
    if (
      liveEpoch !== undefined &&
      liveEpoch !== capturedEpoch
    ) {
      const current = observationForTab(live, capturedTabId)
      if (current?.status === 'identified' && current.account?.twitterId) {
        return { status: 'ready', account: structuredClone(current.account) }
      }
      // SPA / complete bumps the epoch without identifying — keep resolving
      // from the tab, twid cookie, and xIdentities instead of aborting.
    }

    const stored = await this.#loadActiveXAccount()
    const fromCookie = await this.#readTwidTwitterIdFromCookies()

    let handle = fromTab?.handle ?? stored?.handle
    let twitterId =
      fromTab?.twitterId && isTwitterNumericId(fromTab.twitterId)
        ? fromTab.twitterId
        : fromCookie && isTwitterNumericId(fromCookie)
          ? fromCookie
          : stored?.twitterId &&
              isTwitterNumericId(stored.twitterId) &&
              (!handle || stored.handle === handle)
            ? stored.twitterId
            : undefined

    if (!twitterId) {
      const again = await this.#refreshActiveXAccountFromTab(capturedTabId)
      if (again?.twitterId && isTwitterNumericId(again.twitterId)) {
        twitterId = again.twitterId
        if (!handle && again.handle) handle = again.handle
      }
    }
    if (!twitterId) {
      const cookieAgain = await this.#readTwidTwitterIdFromCookies()
      if (cookieAgain && isTwitterNumericId(cookieAgain)) {
        twitterId = cookieAgain
      }
    }

    if (!handle && twitterId) {
      try {
        const row = await this.#repository.getXIdentity(twitterId)
        if (typeof row?.handle === 'string' && row.handle.trim()) {
          handle = row.handle.trim().replace(/^@/, '').toLowerCase()
        }
      } catch {
        /* identity row optional */
      }
    }

    if (!twitterId && !handle) {
      return {
        status: 'missing',
        reason: 'Open x.com while signed in so AttentionX can detect your account',
      }
    }

    if (!twitterId) {
      return {
        status: 'missing',
        reason: 'Waiting for X numeric account ID',
        handle,
      }
    }

    const reported = await this.#reportActiveXAccount(
      {
        handle: handle ?? '',
        twitterId,
        detectedAt: this.#now(),
        ...(fromTab?.displayName ? { displayName: fromTab.displayName } : {}),
        ...(fromTab?.iconPath ? { iconPath: fromTab.iconPath } : {}),
      },
      { tabId: capturedTabId, windowId: focused.windowId },
    )
    const after = await loadActiveXTabRegistry(this.#now())
    if (
      (observationForTab(after, capturedTabId)?.navigationEpoch ?? capturedEpoch) !==
      capturedEpoch
    ) {
      const current = observationForTab(after, capturedTabId)
      if (current?.status === 'identified' && current.account?.twitterId) {
        return { status: 'ready', account: structuredClone(current.account) }
      }
    }
    if (!reported?.twitterId) {
      return {
        status: 'missing',
        reason: 'Waiting for X numeric account ID',
        handle,
      }
    }

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
    // Prefer lastFocusedWindow: when the popup is open, currentWindow can be the
    // popup itself and miss the user's X tab.
    const focusedActive = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    })
    if (focusedActive[0] && this.#isXProductTabUrl(focusedActive[0].url)) {
      return focusedActive[0]
    }

    const currentActive = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    if (currentActive[0] && this.#isXProductTabUrl(currentActive[0].url)) {
      return currentActive[0]
    }

    const inFocused = await chrome.tabs.query({ lastFocusedWindow: true })
    const focusedLocal = inFocused.find((tab) =>
      this.#isXProductTabUrl(tab.url),
    )
    if (focusedLocal) return focusedLocal

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

  /**
   * Resolve handle + twitterId for proof / suggest RPCs. Prefer the caller
   * handle; otherwise use `xIdentities.handle` for this twitterId.
   */
  async #resolveProofDestination(
    handle: string | undefined,
    twitterId: string,
  ): Promise<{ handle: string; twitterId: string }> {
    const tid = requireString(twitterId, 'X account ID', 24)
    if (!isTwitterNumericId(tid)) throw new Error('Invalid X account ID')
    const fromCaller =
      typeof handle === 'string' ? normalizeObservedHandle(handle) : undefined
    if (fromCaller) {
      return normalizeProofDestination(fromCaller, tid)
    }
    const identity = await this.#repository.getXIdentity(tid)
    const fromRow =
      typeof identity?.handle === 'string'
        ? normalizeObservedHandle(identity.handle)
        : undefined
    if (fromRow) {
      return normalizeProofDestination(fromRow, tid)
    }
    const active = this.#activeXAccount
    if (
      active?.twitterId === tid &&
      typeof active.handle === 'string'
    ) {
      const fromActive = normalizeObservedHandle(active.handle)
      if (fromActive) return normalizeProofDestination(fromActive, tid)
    }
    throw new Error(
      'X handle unknown for this account. Open that X profile once, then try again.',
    )
  }

  async #prepareXBioEdit(
    handle: string,
    twitterId: string,
    confirmReplace: boolean,
    removeNpub = false,
  ): Promise<XBioEditPreview> {
    const destination = normalizeProofDestination(handle, twitterId)
    let pubkey: string | undefined
    if (!vault.isLocked()) {
      const accounts = vault.listAccounts()
      const acct = accounts.find((a) =>
        accountIsBoundTo(a, destination.twitterId),
      )
      if (acct) pubkey = acct.pubkey
    }
    if (!pubkey) {
      try {
        pubkey = this.#pubkey()
      } catch {
        throw new Error('Unlock the vault to prepare an X bio suggestion')
      }
    }
    const npub = nip19.npubEncode(pubkey)
    const identity = await this.#repository.getXIdentity(destination.twitterId)
    const storedBioNpub =
      typeof identity?.xNpub === 'string' ? identity.xNpub : undefined

    let tabMatch = false
    try {
      let active = await this.#loadActiveXAccount()
      if (!accountsMatch(active, destination)) {
        active = await this.#refreshActiveXAccountFromTab()
      }
      tabMatch = accountsMatch(active, destination)
    } catch {
      tabMatch = false
    }

    let liveBio: string | undefined
    let bioRead = false
    if (tabMatch) {
      const tab = await this.#findXProductTab()
      if (tab?.id) {
        try {
          const res = (await chrome.tabs.sendMessage(tab.id, {
            type: 'READ_ACTIVE_X_BIO',
          })) as { found?: boolean; bio?: string } | undefined
          if (res?.found === true && typeof res.bio === 'string') {
            liveBio = res.bio
            bioRead = true
          }
        } catch {
          /* content script may not be ready */
        }
      }
    }

    let mismatchNpub: string | undefined
    if (!vault.isLocked()) {
      const accounts = vault.listAccounts()
      const acct = accounts.find((a) =>
        accountIsBoundTo(a, destination.twitterId),
      )
      const full = acct ? vault.getAccountById(acct.id) : null
      if (
        typeof full?.bioMismatchNpub === 'string' &&
        full.bioMismatchNpub.startsWith('npub1')
      ) {
        mismatchNpub = full.bioMismatchNpub
      }
    }
    const conflictNpub =
      mismatchNpub ??
      (storedBioNpub && storedBioNpub.toLowerCase() !== npub.toLowerCase()
        ? storedBioNpub
        : undefined)
    const currentBio =
      liveBio !== undefined
        ? liveBio
        : conflictNpub && !removeNpub
          ? conflictNpub
          : ''
    const suggested = buildSuggestedXBio({
      currentBio,
      activeNpub: npub,
      ...(storedBioNpub ? { storedBioNpub } : {}),
      confirmReplace,
      removeNpub,
    })
    return {
      ...suggested,
      handle: destination.handle,
      twitterId: destination.twitterId,
      bioRead,
      tabMatch,
      editProfileUrl: X_EDIT_PROFILE_URL,
    }
  }

  /**
   * Persist Bio-updated / Published Binding flags on vault (local) + Sync.
   * Suggest strip reads these instead of probing X or relays.
   */
  async #markXBindingSetup(input: {
    twitterId: string
    pubkey: string
    bioUpdated?: boolean
    publishedBinding?: boolean
    clearBioUpdated?: boolean
    clearPublishedBinding?: boolean
    bioMismatchNpub?: string | null
    clearBioMismatch?: boolean
  }): Promise<void> {
    const tid = normalizeBoundTwitterId(input.twitterId)
    if (!tid) return
    const pubkey = input.pubkey.toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return
    const now = this.#now()
    const mismatchValue = input.clearBioMismatch
      ? null
      : input.bioMismatchNpub !== undefined
        ? input.bioMismatchNpub
        : undefined
    if (!vault.isLocked()) {
      const accounts = vault.listAccounts()
      const acct = accounts.find(
        (a) =>
          a.pubkey.toLowerCase() === pubkey &&
          accountIsBoundTo(a, tid),
      )
      if (acct) {
        try {
          const patch: {
            twitterId?: string
            bioUpdatedAt?: number | null
            publishedBindingAt?: number | null
            bioMismatchNpub?: string | null
          } = { twitterId: tid }
          if (input.clearBioUpdated) patch.bioUpdatedAt = null
          else if (input.bioUpdated) {
            patch.bioUpdatedAt = now
            patch.bioMismatchNpub = null
          }
          if (input.clearPublishedBinding) patch.publishedBindingAt = null
          else if (input.publishedBinding) patch.publishedBindingAt = now
          if (mismatchValue !== undefined) {
            patch.bioMismatchNpub = mismatchValue
          }
          if (Object.keys(patch).length > 0) {
            await vault.setAccountBindingSetup(acct.id, patch)
          }
        } catch {
          /* locked race */
        }
      }
    }
    try {
      await patchXNostrBindingSetup({
        twitterId: tid,
        pubkey,
        ...(input.clearBioUpdated
          ? { bioUpdatedAt: null }
          : input.bioUpdated
            ? { bioUpdatedAt: now }
            : {}),
        ...(input.clearPublishedBinding
          ? { publishedBindingAt: null }
          : input.publishedBinding
            ? { publishedBindingAt: now }
            : {}),
        ...(mismatchValue !== undefined
          ? { bioMismatchNpub: mismatchValue }
          : input.bioUpdated
            ? { bioMismatchNpub: null }
            : {}),
      })
    } catch {
      /* Sync optional */
    }
  }

  async #getXIdentitySuggestFlags(
    handle: string | undefined,
    twitterId: string,
  ): Promise<XIdentitySuggestFlags> {
    const tid = requireString(twitterId, 'X account ID', 24)
    if (!isTwitterNumericId(tid)) throw new Error('Invalid X account ID')

    let resolvedHandle: string | undefined
    try {
      const destination = await this.#resolveProofDestination(handle, twitterId)
      resolvedHandle = destination.handle
    } catch {
      /* Handle may be unknown until the profile is observed once. */
    }

    let pubkey: string | undefined

    // Prefer the vault account bound to this twitterId.
    if (!vault.isLocked()) {
      const accounts = vault.listAccounts()
      const acct = accounts.find((a) => accountIsBoundTo(a, tid))
      if (acct) pubkey = acct.pubkey
    }

    if (!pubkey) {
      try {
        const activePubkey = this.#pubkey()
        if (!vault.isLocked()) {
          const accounts = vault.listAccounts()
          const activeBound = accounts.find(
            (a) =>
              a.pubkey.toLowerCase() === activePubkey.toLowerCase() &&
              accountIsBoundTo(a, tid),
          )
          if (activeBound) pubkey = activePubkey
        } else {
          pubkey = activePubkey
        }
      } catch {
        /* Vault locked / no active signer */
      }
    }

    try {
      const sync = await readXNostrBindings()
      const row = sync.byTwitterId[tid]
      if (row && !pubkey) pubkey = row.pubkey
    } catch {
      /* Sync optional */
    }

    if (!pubkey) {
      return {
        hasBioNpubForActive: false,
        hasMatching10011ForActive: false,
        bioNpubMismatch: false,
        ...(resolvedHandle ? { resolvedHandle } : {}),
      }
    }

    const completeness = await this.#operatorBindingCompleteness(tid, pubkey)
    const identity = await this.#repository.getXIdentity(tid)
    const otherBioNpub =
      completeness.bioMismatch && identity?.xNpub
        ? identity.xNpub
        : undefined
    if (completeness.nip39Ok) {
      void this.#markXBindingSetup({
        twitterId: tid,
        pubkey,
        publishedBinding: true,
      })
    }
    return {
      hasBioNpubForActive: completeness.bioOk,
      hasMatching10011ForActive: completeness.nip39Ok,
      bioNpubMismatch: completeness.bioMismatch,
      ...(otherBioNpub ? { otherBioNpub } : {}),
      ...(resolvedHandle ? { resolvedHandle } : {}),
    }
  }

  /**
   * One-shot Publish Binding from the popup suggest strip: resolve a proof
   * post if needed, then sign + enqueue kind 10011 without a separate preview.
   */
  async #publishXBinding(
    handle: string | undefined,
    twitterId: string,
    force = false,
  ): Promise<XBindingPublishResult> {
    const destination = await this.#resolveProofDestination(handle, twitterId)
    await this.#requireMatchingActiveAccount(destination)
    this.#assertActiveNostrBoundToX()

    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)

    // Local 10011 slot only — do not relay-first for Published Binding state.
    const current = await this.#currentNip39Event(pubkey)
    const existingClaim = current
      ? inspectExistingTwitterTags(current.tags).claim
      : undefined
    if (
      !force &&
      existingClaim?.twitterId === destination.twitterId
    ) {
      await this.#markXBindingSetup({
        twitterId: destination.twitterId,
        pubkey,
        publishedBinding: true,
      })
      return {
        status: 'already_published',
        ...(existingClaim.proofPostId
          ? { proofPostId: existingClaim.proofPostId }
          : {}),
        npub,
        handle: destination.handle,
        twitterId: destination.twitterId,
      }
    }

    const identity = await this.#repository.getXIdentity(destination.twitterId)
    let proofPostId: string | undefined
    if (
      typeof identity?.postId === 'string' &&
      isTwitterNumericId(identity.postId) &&
      identity.postNpub?.toLowerCase() === npub.toLowerCase()
    ) {
      proofPostId = identity.postId
    } else if (
      typeof identity?.nip39PostId === 'string' &&
      isTwitterNumericId(identity.nip39PostId)
    ) {
      proofPostId = identity.nip39PostId
    } else if (existingClaim?.proofPostId) {
      proofPostId = existingClaim.proofPostId
    }

    if (!proofPostId) {
      const found = await this.#findProofPostOnX(destination.handle, npub)
      if (found) {
        await this.#recordPostSide({
          handle: destination.handle,
          twitterId: destination.twitterId,
          postId: found,
          npub,
        })
        proofPostId = found
      }
    }

    if (!proofPostId) {
      return {
        status: 'needs_proof_post',
        reason:
          'No linking proof post found on X. Post a linking tweet with your npub, then try Publish Binding again.',
        npub,
        handle: destination.handle,
        twitterId: destination.twitterId,
      }
    }

    const existing = await this.#currentNip39Event(pubkey)
    const published = await this.#signPersistAndPublishXIdentity({
      handle: destination.handle,
      twitterId: destination.twitterId,
      proofPostId,
      existing,
      flush: true,
      npub,
    })

    return {
      status: 'published',
      eventId: published.eventId,
      proofPostId,
      npub,
      handle: destination.handle,
      twitterId: destination.twitterId,
      ...(published.deliveryStatus
        ? { deliveryStatus: published.deliveryStatus }
        : {}),
    }
  }

  async #clearXIdentitySides(
    twitterId: string,
    sides: { bio: boolean; post: boolean; nip39: boolean },
  ): Promise<{ cleared: { bio: boolean; post: boolean; nip39: number } }> {
    const tid = requireString(twitterId, 'X account ID', 24)
    if (!isTwitterNumericId(tid)) throw new Error('Invalid X account ID')
    const now = this.#now()
    let bio = false
    let post = false
    let nip39 = 0
    if (sides.bio) {
      bio = await this.#repository.clearBioSide(tid, now)
      try {
        const pubkey = this.#pubkey()
        await this.#markXBindingSetup({
          twitterId: tid,
          pubkey,
          clearBioUpdated: true,
          clearBioMismatch: true,
        })
      } catch {
        /* vault locked / unbound */
      }
    }
    if (sides.post) {
      post = await this.#repository.clearPostSide(tid, now)
    }
    if (sides.nip39) {
      try {
        const npub = nip19.npubEncode(this.#pubkey())
        nip39 = await this.#repository.clearNip39BindingByNpub(npub, now)
      } catch {
        nip39 = 0
      }
    }
    await this.#syncXIdentityStatus(tid)
    return { cleared: { bio, post, nip39 } }
  }

  async #onActiveXTabRemoved(tabId: number): Promise<void> {
    const now = this.#now()
    const registry = await loadActiveXTabRegistry(now)
    const next = removeActiveXTabObservation(registry, tabId)
    await saveActiveXTabRegistry(next)
    const focused = getCachedFocusedProductTab()
    if (focused?.kind === 'ok' && focused.tabId === tabId) {
      this.#activeXAccount = undefined
      void chrome.storage.session
        .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
        .catch(() => undefined)
    }
  }

  async #resolveReportTab(source?: {
    tabId?: number
    windowId?: number
  }): Promise<{ tabId: number; windowId: number } | null> {
    if (typeof source?.tabId === 'number') {
      return {
        tabId: source.tabId,
        windowId:
          typeof source.windowId === 'number' ? source.windowId : 0,
      }
    }
    const focused = await hydrateFocusedProductTab()
    if (focused.kind !== 'ok' || !focused.isX) return null
    return { tabId: focused.tabId, windowId: focused.windowId }
  }

  #isFocusedXTab(tabId: number): boolean {
    const focused = getCachedFocusedProductTab()
    return focused?.kind === 'ok' && focused.isX && focused.tabId === tabId
  }

  async #projectFocusedActiveXAccount(
    now: number,
  ): Promise<ActiveXAccountReport | undefined> {
    const focused = getCachedFocusedProductTab() ?? (await hydrateFocusedProductTab())
    if (focused.kind !== 'ok' || !focused.isX) {
      this.#activeXAccount = undefined
      void chrome.storage.session
        .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
        .catch(() => undefined)
      return undefined
    }
    const registry = await loadActiveXTabRegistry(now)
    const observation = observationForTab(registry, focused.tabId)
    if (observation?.status === 'identified' && observation.account?.twitterId) {
      this.#activeXAccount = structuredClone(observation.account)
      void chrome.storage.session
        .set({ [ACTIVE_X_ACCOUNT_SESSION_KEY]: this.#activeXAccount })
        .catch(() => undefined)
      return structuredClone(this.#activeXAccount)
    }
    if (observation?.status === 'loggedOut') {
      this.#activeXAccount = undefined
      void chrome.storage.session
        .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
        .catch(() => undefined)
      return undefined
    }
    return this.#activeXAccount
      ? structuredClone(this.#activeXAccount)
      : undefined
  }

  async #reportActiveXAccount(
    account: ActiveXAccountReport | null,
    source?: { tabId?: number; windowId?: number },
  ): Promise<ActiveXAccountReport | null> {
    const tab = await this.#resolveReportTab(source)
    if (!tab) {
      if (account === null) return null
      return (await this.#projectFocusedActiveXAccount(this.#now())) ?? null
    }
    const now = this.#now()
    let registry = await loadActiveXTabRegistry(now)
    const previous = observationForTab(registry, tab.tabId)

    if (account === null) {
      const observation: ActiveXTabObservation = {
        tabId: tab.tabId,
        windowId: tab.windowId,
        status: 'loggedOut',
        observedAt: now,
        navigationEpoch: previous?.navigationEpoch ?? 0,
      }
      registry = upsertActiveXTabObservation(registry, observation, now)
      await saveActiveXTabRegistry(registry)
      if (this.#isFocusedXTab(tab.tabId)) {
        this.#activeXAccount = undefined
        void chrome.storage.session
          .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
          .catch(() => undefined)
      }
      return null
    }
    const rawHandle =
      typeof account.handle === 'string'
        ? account.handle.trim().replace(/^@/, '').toLowerCase()
        : ''
    if (rawHandle && !/^[a-z0-9_]{1,15}$/.test(rawHandle)) {
      throw new Error('Invalid active X handle')
    }
    const handle = rawHandle
    const incomingId =
      account.twitterId === undefined
        ? undefined
        : requireString(account.twitterId, 'X account ID', 24)
    if (incomingId !== undefined && !isTwitterNumericId(incomingId)) {
      throw new Error('Invalid active X account ID')
    }
    const previousAccount = previous?.account
    const twitterId =
      incomingId ??
      (previousAccount?.handle === handle &&
      previousAccount.twitterId &&
      isTwitterNumericId(previousAccount.twitterId)
        ? previousAccount.twitterId
        : undefined)

    const incomingDisplay =
      typeof account.displayName === 'string'
        ? normalizeXDisplayName(account.displayName)
        : undefined
    const incomingIcon =
      typeof account.iconPath === 'string'
        ? isXProfileIconPath(account.iconPath)
          ? account.iconPath
          : normalizeXProfileIconPath(account.iconPath)
        : undefined
    const displayName =
      incomingDisplay ??
      (previousAccount?.handle === handle
        ? previousAccount.displayName
        : undefined)
    const iconPath =
      incomingIcon ??
      (previousAccount?.handle === handle ? previousAccount.iconPath : undefined)

    const detectedAt = now
    const merged: ActiveXAccountReport = {
      handle,
      detectedAt,
      ...(twitterId ? { twitterId } : {}),
      ...(displayName ? { displayName } : {}),
      ...(iconPath ? { iconPath } : {}),
    }
    const observation: ActiveXTabObservation = {
      tabId: tab.tabId,
      windowId: tab.windowId,
      status: twitterId ? 'identified' : 'unknown',
      observedAt: now,
      navigationEpoch: previous?.navigationEpoch ?? 0,
      account: merged,
    }
    registry = upsertActiveXTabObservation(registry, observation, now)
    await saveActiveXTabRegistry(registry)

    const focused = this.#isFocusedXTab(tab.tabId)
    if (focused) {
      this.#activeXAccount = structuredClone(merged)
      void chrome.storage.session
        .set({ [ACTIVE_X_ACCOUNT_SESSION_KEY]: this.#activeXAccount })
        .catch(() => undefined)
    }

    if (twitterId && focused) {
      const existing = await this.#repository.getXIdentity(twitterId)
      const { record, dataChanged } = buildXIdentityFromObservation(existing, {
        twitterId,
        handle,
        observedAt: detectedAt,
        sourceOperation: 'active-account',
        ...(displayName ? { displayName } : {}),
        ...(iconPath ? { iconPath } : {}),
      })
      await this.#repository.putXIdentity(record)
      if (dataChanged) {
        await this.#syncXIdentityStatus(twitterId)
        const latest =
          (await this.#repository.getXIdentity(twitterId)) ?? record
        this.#broadcastXIdentityUpdated(latest, { statusChanged: false })
      }
      await this.#followXBoundNostrAccount(twitterId)
    }

    return focused ? structuredClone(merged) : structuredClone(merged)
  }

  /**
   * Auto-select the vault Nostr account bound to this X id.
   * Does not silent auto-bind leftovers — UI shows needsNostrForX instead.
   */
  async #followXBoundNostrAccount(twitterId: string): Promise<void> {
    const tid = normalizeBoundTwitterId(twitterId)
    if (!tid) return
    if (vault.isLocked() || !(await vault.exists())) return

    const bound = findAccountByBoundTwitterId(
      vault.listAccounts().map((a) => toBoundAccountView(a)),
      tid,
    )
    if (!bound) return
    const currentId = vault.getActiveAccountId()
    if (currentId === bound.id) return

    const oldId = currentId
    await vault.setActiveAccount(bound.id)
    await chrome.storage.local.set({ activeAccountId: bound.id })
    if (bound.pubkey) {
      config.myPubkey = bound.pubkey
      await chrome.storage.sync.set({ myPubkey: bound.pubkey })
      broadcastAccountChanged(bound.pubkey)
    }
    await signer.onActiveAccountChanged(oldId, bound.id)
    await this.#rebuildGraph()
  }

  /** Require active Nostr to be bound to the signed-in X before X publishes. */
  #assertActiveNostrBoundToX(): void {
    const twitterId = normalizeBoundTwitterId(this.#activeXAccount?.twitterId)
    // No signed-in X session yet (tests / non-X): do not gate here.
    if (!twitterId) return
    const active = vault.getActiveAccount()
    if (!active) throw new Error('No active Nostr account')
    if (active.readOnly) {
      throw new Error('Read-only Nostr accounts cannot publish X trust or proofs')
    }
    if (!accountIsBoundTo(active, twitterId)) {
      throw new Error(
        'Active Nostr account is not bound to the signed-in X user',
      )
    }
  }

  async #loadActiveXAccount(): Promise<ActiveXAccountReport | undefined> {
    const projected = await this.#projectFocusedActiveXAccount(this.#now())
    if (projected) return projected

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
    if (typeof record.detectedAt !== 'number') {
      return undefined
    }
    if (this.#now() - record.detectedAt > ACTIVE_ACCOUNT_TTL_MS) {
      this.#activeXAccount = undefined
      void chrome.storage.session
        .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
        .catch(() => undefined)
      return undefined
    }
    const handle =
      typeof record.handle === 'string'
        ? normalizeObservedHandle(record.handle)
        : undefined
    const twitterId =
      typeof record.twitterId === 'string' && isTwitterNumericId(record.twitterId)
        ? record.twitterId
        : undefined
    if (!handle && !twitterId) return undefined
    const displayName =
      typeof record.displayName === 'string'
        ? normalizeXDisplayName(record.displayName)
        : undefined
    const iconPath =
      typeof record.iconPath === 'string'
        ? isXProfileIconPath(record.iconPath)
          ? record.iconPath
          : normalizeXProfileIconPath(record.iconPath)
        : undefined
    return {
      handle: handle ?? '',
      detectedAt: record.detectedAt,
      ...(twitterId ? { twitterId } : {}),
      ...(displayName ? { displayName } : {}),
      ...(iconPath ? { iconPath } : {}),
    }
  }

  async #refreshActiveXAccountFromTab(
    tabId?: number,
  ): Promise<ActiveXAccountReport | undefined> {
    try {
      const targetId =
        tabId ??
        (await (async () => {
          const focused = await hydrateFocusedProductTab()
          return focused.kind === 'ok' && focused.isX ? focused.tabId : undefined
        })())
      if (typeof targetId !== 'number') return undefined
      const tab = await chrome.tabs.get(targetId).catch(() => undefined)
      const response = (await chrome.tabs.sendMessage(targetId, {
        type: 'GET_ACTIVE_X_ACCOUNT',
      })) as { account?: ActiveXAccountReport | null } | undefined
      if (!response?.account?.handle) return undefined
      let account = response.account
      if (!account.twitterId || !isTwitterNumericId(account.twitterId)) {
        const fromCookie = await this.#readTwidTwitterIdFromCookies()
        if (fromCookie) {
          account = { ...account, twitterId: fromCookie }
        }
      }
      return (
        (await this.#reportActiveXAccount(account, {
          tabId: targetId,
          windowId: tab?.windowId,
        })) ?? undefined
      )
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
    const verified = await this.#revalidatePageProofPost({
      postId,
      handle: session.handle,
      npub: session.npub,
    })
    if (!verified) {
      throw new Error('Could not independently verify the captured proof post')
    }
    this.#proofSession = {
      ...session,
      capturedPostId: verified.postId,
    }
    this.#logExtensionActivity({
      method: 'xProofFound',
      decision: 'found',
      domain: 'x.com',
    })
    // Capture is an explicit found-proof observation — write post* only here.
    await this.#recordPostSide({
      handle: session.handle,
      twitterId: session.twitterId,
      postId: verified.postId,
      npub: session.npub,
    })
    const result = await this.#publishXIdentity(
      session.handle,
      session.twitterId,
      verified.postId,
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
      await this.#recordVerifiedIdentity(verification)
    } else {
      await this.#recordNip39Side(event)
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
    if (!identity?.postId || identity.postId !== postId) {
      // Allow publish when the proof post matches the local X-proof side, or
      // when the caller supplies a freshly verified post id (composer capture).
      if (identity?.postId && identity.postId !== postId) {
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

  async #prepareXIdentityClear(
    handle: string,
    twitterId: string,
  ): Promise<XIdentityClearPreview | { status: 'nothing-to-clear'; reason: string }> {
    const destination = normalizeProofDestination(handle, twitterId)
    await this.#requireMatchingActiveAccount(destination)
    this.#assertActiveNostrBoundToX()
    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)
    try {
      await this.#refreshNip39FromRelays(pubkey)
    } catch {
      /* use cached */
    }
    const existing = await this.#currentNip39Event(pubkey)
    const inspected = existing
      ? inspectExistingTwitterTags(existing.tags)
      : { rawTwitterTags: [], hasTwitterTags: false }
    if (!inspected.hasTwitterTags) {
      return {
        status: 'nothing-to-clear',
        reason: 'No Twitter claim on your current kind 10011 to remove.',
      }
    }
    return this.#buildXIdentityClearPreview({
      handle: destination.handle,
      twitterId: destination.twitterId,
      npub,
      existing,
    })
  }

  #buildXIdentityClearPreview(input: {
    handle: string
    twitterId: string
    npub: string
    existing: Event | undefined
  }): XIdentityClearPreview {
    const inspected = input.existing
      ? inspectExistingTwitterTags(input.existing.tags)
      : { rawTwitterTags: [], hasTwitterTags: false }
    const createdAt = Math.max(
      Math.floor(this.#now() / 1_000),
      (input.existing?.created_at ?? -1) + 1,
    )
    const template = buildKind10011ClearEvent({
      createdAt,
      existingEvent: input.existing,
    })
    const preservedTagCount = countPreservedKind10011Tags(
      input.existing?.tags ?? [],
    )
    return {
      handle: input.handle,
      twitterId: input.twitterId,
      npub: input.npub,
      existingEventId: input.existing?.id ?? null,
      change: 'clear',
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

  async #confirmXIdentityClear(input: {
    handle: string
    twitterId: string
    existingEventId: string | null
  }): Promise<XIdentityClearResult> {
    const destination = normalizeProofDestination(input.handle, input.twitterId)
    await this.#requireMatchingActiveAccount(destination)
    this.#assertActiveNostrBoundToX()

    const pubkey = this.#pubkey()
    const npub = nip19.npubEncode(pubkey)
    try {
      await this.#refreshNip39FromRelays(pubkey)
    } catch {
      /* use cached */
    }
    const existing = await this.#currentNip39Event(pubkey)
    const currentId = existing?.id ?? null
    if (currentId !== input.existingEventId) {
      const inspected = existing
        ? inspectExistingTwitterTags(existing.tags)
        : { hasTwitterTags: false }
      if (!inspected.hasTwitterTags) {
        return {
          status: 'nothing-to-clear',
          reason: 'No Twitter claim on your current kind 10011 to remove.',
        }
      }
      return {
        status: 'stale-preview',
        reason:
          'Your kind 10011 changed since the preview. Review the updated clear event before publishing.',
        preview: this.#buildXIdentityClearPreview({
          handle: destination.handle,
          twitterId: destination.twitterId,
          npub,
          existing,
        }),
      }
    }

    const inspected = existing
      ? inspectExistingTwitterTags(existing.tags)
      : { hasTwitterTags: false }
    if (!inspected.hasTwitterTags) {
      return {
        status: 'nothing-to-clear',
        reason: 'No Twitter claim on your current kind 10011 to remove.',
      }
    }

    const template = buildKind10011ClearEvent({
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
    const signed = validateSignedKind10011Event(event)
    if (!signed.valid) {
      throw new Error(signed.errors.join('; '))
    }

    await this.#repository.storeEventAndEnqueue(event, this.#settings.relays, {
      now: this.#now(),
    })
    await this.#reconcileNip39Winner(event.pubkey, event)
    await this.#markXBindingSetup({
      twitterId: destination.twitterId,
      pubkey,
      clearPublishedBinding: true,
    })

    const heldUntil = outboxHoldUntil(this.#now())
    const delivery: PublishResult = {
      eventId: event.id,
      deliveredTo: 0,
      attemptedRelays: 0,
      deliveryStatus: 'pending',
      heldUntil,
    }
    await this.#scheduleOutboxHoldRelease(heldUntil)
    this.#logPublishedEvent(event, delivery)

    return {
      status: 'published',
      eventId: delivery.eventId,
      deliveredTo: delivery.deliveredTo,
      attemptedRelays: delivery.attemptedRelays,
      deliveryStatus: delivery.deliveryStatus,
      heldUntil,
      handle: destination.handle,
      twitterId: destination.twitterId,
      npub,
    }
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
    this.#assertActiveNostrBoundToX()

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
    if (
      verification.state === 'verified' &&
      verification.twitterId === input.twitterId
    ) {
      // May stay unverified if X-proof side was never discovered independently.
      await this.#recordVerifiedIdentity(verification)
    } else {
      await this.#recordNip39Side(event)
    }
    const row = await this.#repository.getXIdentity(input.twitterId)
    const identityState: 'verified' | 'pending' | 'unverified' =
      row?.state === 'verified' ? 'verified' : 'unverified'
    const proofSource: XIdentityProofSource | undefined = row?.proofSource

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

    await this.#markXBindingSetup({
      twitterId: input.twitterId,
      pubkey: event.pubkey,
      publishedBinding: true,
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
      ...(proofSource ? { proofSource } : {}),
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
   * Recompute `state` / `proofSource` from the current xNpub/postNpub/
   * nip39Npub/eventNpub columns after any xIdentities write. Any source may
   * arrive first; sync runs on every update. Kind 10011 is self-verified
   * once its columns are written — there is no live oEmbed re-verify here.
   */
  async #syncXIdentityStatus(
    twitterId: string,
  ): Promise<XIdentityRecord | undefined> {
    if (!isTwitterNumericId(twitterId)) return undefined
    const row = await this.#repository.getXIdentity(twitterId)
    if (!row) return undefined

    const previousState = row.state
    const previousProofSource = row.proofSource
    const now = this.#now()
    const evaluation = evaluateXIdentityRow(row)

    // A winning nip39 binding excludes this npub from any other row.
    if (
      evaluation.state === 'verified' &&
      evaluation.proofSource === 'nip39' &&
      evaluation.winningNpub
    ) {
      const npub = evaluation.winningNpub.toLowerCase()
      const boundElsewhere = (
        await this.#repository.getXIdentitiesByNip39Npub(npub)
      ).filter((sibling) => sibling.twitterId !== twitterId)
      if (boundElsewhere.length > 0) {
        await this.#repository.clearNip39BindingByNpub(npub, now)
        for (const sibling of boundElsewhere) {
          await this.#syncXIdentityStatus(sibling.twitterId)
        }
      }
    }

    const next: XIdentityRecord = {
      ...row,
      state: evaluation.state,
      updatedAt: now,
    }
    if (evaluation.proofSource) {
      next.proofSource = evaluation.proofSource
    } else {
      delete next.proofSource
    }
    if (evaluation.state === 'verified') {
      next.verifiedAt = row.verifiedAt ?? now
    } else {
      delete next.verifiedAt
    }

    const statusChanged =
      next.state !== previousState || next.proofSource !== previousProofSource
    await this.#repository.putXIdentity(next)
    this.#reindexIdentityNpubs(next)
    if (statusChanged) {
      this.#markGraphDirtyOnVerifiedChange(previousState, next.state)
      this.#broadcastXIdentityUpdated(next, { statusChanged: true })
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
    const previousProofSource = before.proofSource
    const synced = await this.#syncXIdentityStatus(twitterId)
    const identity = synced ?? before
    const changed =
      identity.state !== previousState ||
      identity.proofSource !== previousProofSource
    return {
      twitterId,
      previousState,
      ...(previousProofSource ? { previousProofSource } : {}),
      state: identity.state,
      ...(identity.proofSource ? { proofSource: identity.proofSource } : {}),
      changed,
      identity: this.#toXIdentityListRow(identity),
    }
  }

  #broadcastXIdentityUpdated(
    record: XIdentityRecord,
    options: { statusChanged: boolean },
  ): void {
    const message = {
      type: 'X_IDENTITY_UPDATED' as const,
      twitterId: record.twitterId,
      state: record.state,
      handle: record.handle,
      statusChanged: options.statusChanged,
      ...(record.proofSource ? { proofSource: record.proofSource } : {}),
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
   * After live `verifyNip39Proof` succeeded, write nip39 columns and sync.
   */
  async #recordVerifiedIdentity(
    verification: Extract<ProofVerificationResult, { state: 'verified' }>,
  ): Promise<boolean> {
    const npub = npubFromPubkey(verification.nostrPubkey)
    if (!npub) return false
    const existing = await this.#repository.getXIdentity(verification.twitterId)
    const now = this.#now()
    const handle =
      normalizeObservedHandle(verification.handle) ?? verification.handle

    // Ensure nip39 columns reflect this event without touching post*/x*.
    await this.#repository.putXIdentity({
      twitterId: verification.twitterId,
      handle,
      ...preserveXIdentityProofFields(existing),
      nip39Npub: npub,
      nip39XId: verification.twitterId,
      nip39Handle: handle,
      nip39PostId: verification.proofPostId,
      nip39Date: now,
      state: existing?.state ?? 'unverified',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    const synced = await this.#syncXIdentityStatus(verification.twitterId)
    return synced?.state === 'verified'
  }

  /**
   * Record the post-proof side from a found linking post (GraphQL / page
   * scan). Authoritative for `post*` columns only — precedence against
   * Bio/10011/32009 is resolved by `evaluateXIdentityRow` at sync time.
   * Newer proof posts win via `isNewerSourceDate` on `postDate`; older
   * candidates for a different post are skipped. Always re-runs status
   * sync afterward when columns change.
   */
  async #recordPostSide(input: {
    handle: string
    twitterId: string
    postId: string
    npub: string
    /** Proof post creation ms from GraphQL `legacy.created_at`. */
    postedAt?: number
  }): Promise<'written' | 'refreshed' | 'skipped-older' | 'ignored'> {
    const now = this.#now()
    const npub = input.npub.trim().toLowerCase()
    if (!npub.startsWith('npub1')) return 'ignored'
    try {
      npubDecode(npub)
    } catch {
      return 'ignored'
    }
    const handle =
      normalizeObservedHandle(input.handle) ?? input.handle.toLowerCase()
    const postedAt =
      typeof input.postedAt === 'number' &&
      Number.isSafeInteger(input.postedAt) &&
      input.postedAt > 0
        ? input.postedAt
        : undefined

    const existing = await this.#repository.getXIdentity(input.twitterId)

    if (existing?.postId === input.postId) {
      const npubChanged = existing.postNpub?.toLowerCase() !== npub
      await this.#repository.putXIdentity({
        twitterId: input.twitterId,
        handle: existing.handle || handle,
        ...preserveXIdentityProofFields(existing),
        postNpub: npub,
        postId: input.postId,
        postHandle: handle,
        ...(existing.postDate !== undefined
          ? { postDate: existing.postDate }
          : postedAt !== undefined
            ? { postDate: postedAt }
            : {}),
        postObservedAt: now,
        createdAt: existing.createdAt,
        updatedAt: now,
        lastSeen: existing.lastSeen,
      })
      if (npubChanged) {
        await this.#syncXIdentityStatus(input.twitterId)
      }
      return 'refreshed'
    }

    if (existing?.postId && !isNewerSourceDate(postedAt, existing.postDate)) {
      return 'skipped-older'
    }

    await this.#repository.putXIdentity({
      twitterId: input.twitterId,
      handle,
      ...preserveXIdentityProofFields(existing),
      postNpub: npub,
      postId: input.postId,
      postHandle: handle,
      ...(postedAt !== undefined ? { postDate: postedAt } : {}),
      postObservedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    await this.#syncXIdentityStatus(input.twitterId)
    return 'written'
  }

  async #recordXProofPostChrome(input: {
    postId: string
    twitterId: string
    handle: string
    observedAt: number
  }): Promise<void> {
    await this.#repository.upsertXPostChrome(
      {
        postId: input.postId,
        authorTwitterId: input.twitterId,
        authorHandle: input.handle,
      },
      input.observedAt,
    )
  }

  /**
   * Passive GraphQL proof candidates: oEmbed-revalidate, then newer-wins write.
   */
  async #ingestXProofCandidates(
    rawCandidates: unknown[],
  ): Promise<{ recorded: number; skipped: number }> {
    let recorded = 0
    let skipped = 0
    const now = this.#now()
    if (
      now - this.#proofCandidateOembedWindowStartedAt >
      60_000
    ) {
      this.#proofCandidateOembedWindowStartedAt = now
      this.#proofCandidateOembedCount = 0
    }

    for (const raw of rawCandidates) {
      const candidate = sanitizeObservedXProofCandidate(raw)
      if (!candidate) {
        skipped += 1
        continue
      }
      try {
        npubDecode(candidate.npub)
      } catch {
        skipped += 1
        continue
      }

      const existing = await this.#repository.getXIdentity(candidate.twitterId)
      if (
        existing?.postId &&
        existing.postId !== candidate.postId &&
        !isNewerSourceDate(candidate.postedAt, existing.postDate)
      ) {
        skipped += 1
        continue
      }
      if (
        existing?.postId === candidate.postId &&
        existing.postNpub?.toLowerCase() === candidate.npub
      ) {
        // Already stored — cheap refresh without another oEmbed.
        await this.#recordPostSide({
          handle: candidate.handle,
          twitterId: candidate.twitterId,
          postId: candidate.postId,
          npub: candidate.npub,
          ...(candidate.postedAt !== undefined
            ? { postedAt: candidate.postedAt }
            : {}),
        })
        await this.#recordXProofPostChrome({
          postId: candidate.postId,
          twitterId: candidate.twitterId,
          handle: candidate.handle,
          observedAt: candidate.observedAt,
        })
        recorded += 1
        continue
      }

      if (this.#proofCandidateOembedCount >= 30) {
        skipped += 1
        continue
      }
      this.#proofCandidateOembedCount += 1

      const verified = await this.#revalidatePageProofPost({
        postId: candidate.postId,
        handle: candidate.handle,
        npub: candidate.npub,
      })
      if (!verified) {
        skipped += 1
        continue
      }
      const outcome = await this.#recordPostSide({
        handle: candidate.handle,
        twitterId: candidate.twitterId,
        postId: verified.postId,
        npub: candidate.npub,
        ...(candidate.postedAt !== undefined
          ? { postedAt: candidate.postedAt }
          : {}),
      })
      if (outcome === 'skipped-older' || outcome === 'ignored') {
        skipped += 1
      } else {
        await this.#recordXProofPostChrome({
          postId: verified.postId,
          twitterId: candidate.twitterId,
          handle: candidate.handle,
          observedAt: candidate.observedAt,
        })
        recorded += 1
        this.#logExtensionActivity({
          method: 'xProofFound',
          decision: 'found',
          domain: 'x.com',
        })
      }
    }
    return { recorded, skipped }
  }

  /** Passive GraphQL bio candidates: newer-wins write, no oEmbed round trip. */
  async #ingestXBioCandidates(
    rawCandidates: unknown[],
  ): Promise<{ recorded: number; skipped: number }> {
    let recorded = 0
    let skipped = 0
    for (const raw of rawCandidates) {
      const candidate = sanitizeObservedXBioCandidate(raw)
      if (!candidate) {
        skipped += 1
        continue
      }
      await this.#reconcileOwnBioFromPassive(candidate)
      if (candidate.npubCount === 1 && candidate.npub) {
        const outcome = await this.#recordBioSide({
          twitterId: candidate.twitterId,
          handle: candidate.handle,
          npub: candidate.npub,
          ...(candidate.postId ? { postId: candidate.postId } : {}),
          postCreatedAt: candidate.postCreatedAt,
        })
        if (outcome === 'written') {
          recorded += 1
        } else {
          skipped += 1
        }
      } else {
        skipped += 1
      }
    }
    return { recorded, skipped }
  }

  /**
   * When a passive bio observation is for a vault-bound X id, update
   * bioUpdatedAt / bioMismatchNpub. No-ops when state is unchanged.
   */
  async #reconcileOwnBioFromPassive(
    candidate: ObservedXBioCandidate,
  ): Promise<void> {
    if (vault.isLocked()) return
    const tid = normalizeBoundTwitterId(candidate.twitterId)
    if (!tid) return
    const accounts = vault.listAccounts()
    const bound = accounts.find((a) => accountIsBoundTo(a, tid))
    if (!bound?.pubkey) return

    const full = vault.getAccountById(bound.id)
    let activeNpub: string
    try {
      activeNpub = nip19.npubEncode(bound.pubkey)
    } catch {
      return
    }

    type Next = 'match' | 'mismatch' | 'missing'
    let next: Next
    let otherNpub: string | undefined
    if (candidate.npubCount === 1 && candidate.npub) {
      if (candidate.npub.toLowerCase() === activeNpub.toLowerCase()) {
        next = 'match'
      } else {
        next = 'mismatch'
        otherNpub = candidate.npub.toLowerCase()
      }
    } else {
      next = 'missing'
    }

    const hadUpdated = typeof full?.bioUpdatedAt === 'number'
    const prevMismatch =
      typeof full?.bioMismatchNpub === 'string'
        ? full.bioMismatchNpub.toLowerCase()
        : undefined

    if (next === 'match') {
      if (hadUpdated && !prevMismatch) return
      await this.#markXBindingSetup({
        twitterId: tid,
        pubkey: bound.pubkey,
        bioUpdated: true,
        clearBioMismatch: true,
      })
      return
    }
    if (next === 'mismatch' && otherNpub) {
      if (!hadUpdated && prevMismatch === otherNpub) return
      await this.#markXBindingSetup({
        twitterId: tid,
        pubkey: bound.pubkey,
        clearBioUpdated: true,
        bioMismatchNpub: otherNpub,
      })
      return
    }
    // missing / ambiguous
    if (!hadUpdated && !prevMismatch) return
    await this.#markXBindingSetup({
      twitterId: tid,
      pubkey: bound.pubkey,
      clearBioUpdated: true,
      clearBioMismatch: true,
    })
  }

  /**
   * Record the Bio (primary X) side of an identity row. Writes `xNpub` /
   * `xDate` / `xObservedAt` only when the carrier post is newer than the
   * stored `xDate`, or ties on the same npub (observation-only refresh).
   * Precedence against post/10011/32009 is resolved by
   * `evaluateXIdentityRow` at sync time.
   */
  async #recordBioSide(input: {
    twitterId: string
    handle?: string
    npub: string
    postId?: string
    postCreatedAt?: number
  }): Promise<'written' | 'skipped'> {
    const npub = input.npub.trim().toLowerCase()
    if (!npub.startsWith('npub1')) return 'skipped'
    try {
      npubDecode(npub)
    } catch {
      return 'skipped'
    }

    const existing = await this.#repository.getXIdentity(input.twitterId)
    const sameNpub = existing?.xNpub?.toLowerCase() === npub
    const newer = isNewerSourceDate(input.postCreatedAt, existing?.xDate)
    const tie =
      sameNpub &&
      typeof input.postCreatedAt === 'number' &&
      input.postCreatedAt === existing?.xDate
    // First bio for this row may write without a carrier post date; later
    // overwrites require a strictly newer `postCreatedAt` (or same-date refresh).
    if (existing?.xNpub && !newer && !tie) return 'skipped'

    const now = this.#now()
    const handle =
      (input.handle ? normalizeObservedHandle(input.handle) : undefined) ??
      existing?.handle ??
      ''
    await this.#repository.putXIdentity({
      twitterId: input.twitterId,
      handle,
      ...preserveXIdentityProofFields(existing),
      xNpub: npub,
      ...(newer && typeof input.postCreatedAt === 'number'
        ? { xDate: input.postCreatedAt }
        : existing?.xDate !== undefined
          ? { xDate: existing.xDate }
          : {}),
      xObservedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    await this.#syncXIdentityStatus(input.twitterId)
    return 'written'
  }

  /**
   * Record the kind-10011 side of an identity row. Writes `nip39*` only —
   * self-verified once written, no oEmbed round trip. Precedence against
   * Bio/post/32009 is resolved by `evaluateXIdentityRow` at sync time.
   * Always re-runs status sync afterward.
   */
  async #recordNip39Side(event: Event): Promise<void> {
    const parsed = parseNip39TwitterClaim(event)
    if (parsed.state !== 'valid') return

    const npub = npubFromPubkey(event.pubkey)
    if (!npub) return

    const claim = parsed.claim
    const existing = await this.#repository.getXIdentity(claim.twitterId)
    const now = this.#now()
    const handle = claim.handle
    await this.#repository.putXIdentity({
      twitterId: claim.twitterId,
      handle,
      ...preserveXIdentityProofFields(existing),
      nip39Npub: npub,
      nip39XId: claim.twitterId,
      nip39Handle: handle,
      nip39PostId: claim.proofPostId,
      nip39Date: event.created_at * 1000,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSeen: existing?.lastSeen ?? now,
    })
    await this.#syncXIdentityStatus(claim.twitterId)
  }

  async #retryPendingIdentityProofs(): Promise<void> {
    const identities = await this.#repository.getAllXIdentities()
    const candidates = identities
      .filter(
        (row) =>
          row.state === 'unverified' &&
          Boolean(row.nip39Npub && row.nip39PostId),
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
    if (event.kind === 32009 || event.kind === 32014) {
      // Demo mode never stores live kind 32009/32014 from relays / legacy import paths.
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
        const fromPost = pubkeyFromNpub(identity.postNpub)
        const fromNip39 = pubkeyFromNpub(identity.nip39Npub)
        if (fromPost) keys.push(fromPost)
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
      await this.#recordVerifiedIdentity(verification)
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

    await this.#recordNip39Side(winner)
  }

  /**
   * Rebuild the in-memory graph from IndexedDB winners.
   * - Demo: only demo-tagged/state kind 32009/32014 events.
   * - Production: only events authored by the operator or verified X identities.
   * Kind 32014 claims are indexed separately and never become hops.
   */
  async #rebuildGraph(): Promise<void> {
    const mode = this.#appMode()
    const identities = await this.#repository.getAllXIdentities()
    this.#rebuildNpubIndex(identities)
    await this.#pruneIneligibleRatingEvents()
    const twitterIdToPubkey = new Map<string, string>()
    const verifiedPubkeys = new Set<string>()
    for (const identity of identities) {
      if (identity.state !== 'verified') continue
      const pubkey = pubkeyFromNpub(primaryNpubFromRow(identity))
      if (!pubkey) continue
      const normalized = pubkey.toLowerCase()
      verifiedPubkeys.add(normalized)
      twitterIdToPubkey.set(identity.twitterId, normalized)
    }

    const scoped = await this.#loadGraphSourceEvents(mode, verifiedPubkeys)
    const reduced = await reduceKind32009Events(scoped)
    const real: ReducedTrustStatement[] = []
    for (const statement of reduced.statements) {
      const row = reducedStatement(statement)
      if (!row) continue
      real.push(row)
    }

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

    const ratingEvents = await this.#loadRatingSourceEvents(mode, verifiedPubkeys)
    const reducedRatings = await reduceKind32014Events(ratingEvents)
    const ratingNow = Math.floor(this.#now() / 1_000)
    const claims: ReducedRatingClaim[] = []
    for (const statement of reducedRatings.statements) {
      if (!isRatingStatementActive(statement, ratingNow)) continue
      const claim = reducedRatingClaim(statement)
      if (!claim) continue
      claims.push(claim)
    }
    this.#graph.rebuildClaims(claims)

    this.#graphDirty = false
    this.#trustMemo.clear()
    this.#trustMemoVersion = this.#graph.graphVersion

    if (mode !== 'demo') {
      await this.#projectTrust32009Identity()
    }
  }

  /**
   * Project a WoT-gated bare-npub identity hint from kind 32009 `i=user:id`
   * statements (`s=x.com`) into `xIdentities.eventNpub` — lowest precedence,
   * only when the row has no Bio/post/10011 npub yet. Eligible issuers are
   * the local root, or any pubkey the root trusts with ratio > 0.75. Ranking
   * prefers the root's own statements, then lower degree, then higher trust
   * count, then newer `created_at`, then pubkey order.
   */
  async #projectTrust32009Identity(onlyTwitterId?: string): Promise<void> {
    const root = this.#operatorPubkey()
    if (!root) return

    const events = (await this.#repository.getEventsByKind(32009)).filter(
      (event) => !isDemoWotEvent(event),
    )
    if (events.length === 0) return
    const reduced = await reduceKind32009Events(selectXEligibleTrustEvents(events))
    const now = Math.floor(this.#now() / 1_000)

    interface Candidate {
      twitterId: string
      npub: string
      issuer: string
      createdAt: number
      eventId: string
      ownIssuer: boolean
      degree: number
      trust: number
    }
    const candidatesByTwitterId = new Map<string, Candidate[]>()

    for (const statement of reduced.statements) {
      if (statement.subject.type !== 'i' || statement.value !== '1') continue
      if (statement.k !== 'user:id') continue
      if (!statement.scopes.includes(X_TRUST_SCOPE)) continue
      if (!isTrustStatementActive(statement, now)) continue
      const parsed = parseCanonicalTwitterSubject(statement.subject.value)
      if (parsed?.type !== 'account') continue
      if (onlyTwitterId && parsed.twitterId !== onlyTwitterId) continue
      const npub = subjectNpubFromHints(statement.subjectHints)
      if (!npub || !canonicalizeNpubHint(npub)) continue

      const issuer = statement.event.pubkey.toLowerCase()
      const ownIssuer = issuer === root
      let degree = 0
      let trust = Number.POSITIVE_INFINITY
      if (!ownIssuer) {
        const issuerTrust = this.#graph.query({
          rootPubkey: root,
          subject: { type: 'p', value: issuer },
          context: IDENTITY_TRUST_CONTEXT,
        })
        const total = issuerTrust.trust + issuerTrust.distrust
        if (total === 0 || issuerTrust.trust / total <= 0.75) continue
        degree = issuerTrust.degree
        trust = issuerTrust.trust
      }

      const list = candidatesByTwitterId.get(parsed.twitterId) ?? []
      list.push({
        twitterId: parsed.twitterId,
        npub,
        issuer,
        createdAt: statement.event.created_at,
        eventId: statement.event.id,
        ownIssuer,
        degree,
        trust,
      })
      candidatesByTwitterId.set(parsed.twitterId, list)
    }

    const compareCandidates = (a: Candidate, b: Candidate): number => {
      if (a.ownIssuer !== b.ownIssuer) return a.ownIssuer ? -1 : 1
      if (a.degree !== b.degree) return a.degree - b.degree
      if (a.trust !== b.trust) return b.trust - a.trust
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
      return a.issuer.localeCompare(b.issuer)
    }

    for (const [twitterId, candidates] of candidatesByTwitterId) {
      const existing = await this.#repository.getXIdentity(twitterId)
      if (existing?.xNpub || existing?.postNpub || existing?.nip39Npub) {
        continue
      }
      candidates.sort(compareCandidates)
      const winner = candidates[0]
      if (!winner) continue
      if (
        existing?.eventNpub === winner.npub &&
        existing?.eventId === winner.eventId
      ) {
        continue
      }
      const now2 = this.#now()
      await this.#repository.putXIdentity({
        twitterId,
        handle: existing?.handle ?? '',
        ...preserveXIdentityProofFields(existing),
        eventNpub: winner.npub,
        eventDate: winner.createdAt * 1_000,
        eventId: winner.eventId,
        eventIssuer: winner.issuer,
        createdAt: existing?.createdAt ?? now2,
        updatedAt: now2,
        lastSeen: existing?.lastSeen ?? now2,
      })
      await this.#syncXIdentityStatus(twitterId)
    }
  }

  async #loadGraphSourceEvents(
    mode: AppMode,
    verifiedPubkeys: ReadonlySet<string>,
  ): Promise<EventRecord[]> {
    if (mode === 'demo') {
      const events = await this.#repository.getEventsByKind(32009)
      return selectXEligibleTrustEvents(
        events.filter((event) => isDemoWotEvent(event)),
      )
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
    return selectXEligibleTrustEvents([...byId.values()])
  }

  async #loadRatingSourceEvents(
    mode: AppMode,
    verifiedPubkeys: ReadonlySet<string>,
  ): Promise<EventRecord[]> {
    if (mode === 'demo') {
      const events = await this.#repository.getEventsByKind(RATING_STATEMENT_KIND)
      return selectXEligibleRatingEvents(
        events.filter((event) => isDemoWotEvent(event)),
      )
    }

    const authors = new Set(verifiedPubkeys)
    const operator = this.#operatorPubkey()
    if (operator) authors.add(operator)
    if (authors.size === 0) return []

    const byId = new Map<string, EventRecord>()
    for (const pubkey of authors) {
      for (const event of await this.#repository.getEventsByPubkey(pubkey)) {
        if (event.kind !== RATING_STATEMENT_KIND) continue
        if (isDemoWotEvent(event)) continue
        byId.set(event.id, event)
      }
    }
    return selectXEligibleRatingEvents([...byId.values()])
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
      // New remote evidence landed: refresh content-script caches so the
      // timeline reflects the rebuilt graph without a page reload.
      if (result.eventsStored > 0 && !controller.signal.aborted) {
        this.#broadcastTrustGraphUpdated()
      }
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

  #syncIntervalMinutes(): number {
    return normalizeSyncIntervalMinutes(this.#settings.syncIntervalMinutes)
  }

  #wotAutoLowerEnabled(): boolean {
    return this.#settings.wotAutoLower !== false
  }

  /** Reconcile the periodic maintenance alarm with the configured interval. */
  async reconcileMaintenanceAlarm(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.alarms?.create) return
    try {
      const interval = this.#syncIntervalMinutes()
      if (interval === WOT_SYNC_INTERVAL_PAUSED_MINUTES) {
        await chrome.alarms.clear(MAINTENANCE_ALARM)
        return
      }
      await chrome.alarms.create(MAINTENANCE_ALARM, {
        periodInMinutes: interval,
      })
    } catch {
      // Alarms unavailable in some test environments.
    }
  }

  async #setSyncIntervalMinutes(value: unknown): Promise<number> {
    const next = normalizeSyncIntervalMinutes(value)
    if (next !== this.#syncIntervalMinutes()) {
      this.#settings.syncIntervalMinutes = next
      await this.#persistSettings()
    }
    await this.reconcileMaintenanceAlarm()
    return next
  }

  async #setWotAutoLower(value: unknown): Promise<boolean> {
    if (typeof value !== 'boolean') {
      throw new Error('enabled must be a boolean')
    }
    if (value !== this.#wotAutoLowerEnabled()) {
      this.#settings.wotAutoLower = value
      await this.#persistSettings()
    }
    return value
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
    const demoKind0 = (await this.#repository.getEventsByKind(0)).filter(
      (event) =>
        event.state === DEMO_EVENT_STATE || isDemoWotEvent(event),
    )
    await forgetProfileMetadata(demoKind0.map((event) => event.pubkey))

    const ids = await this.#repository.getEventIdsByState(DEMO_EVENT_STATE)
    let deleted = 0
    for (const eventId of ids) {
      if (await this.#repository.deleteEvent(eventId)) deleted += 1
    }
    await this.#rebuildGraph()
    this.#broadcastTrustGraphUpdated()
    return { deleted, eventCount: 0 }
  }

  async #ensureDemoWotChainIdentities(): Promise<void> {
    const identities = await this.#repository.getAllXIdentities()
    const missing = demoWotMissingChainMembers(
      identities.map((row) => ({
        twitterId: row.twitterId,
        handle: row.handle,
        lastSeen: row.lastSeen,
      })),
    )
    if (missing.length === 0) return
    const now = this.#now()
    for (const member of missing) {
      const record: XIdentityRecord = {
        twitterId: member.twitterId,
        handle: member.handle,
        displayName: member.displayName,
        ...(member.verifiedType ? { verifiedType: member.verifiedType } : {}),
        ...(member.affiliationBadgePath
          ? { affiliationBadgePath: member.affiliationBadgePath }
          : {}),
        ...(member.affiliationLabel
          ? { affiliationLabel: member.affiliationLabel }
          : {}),
        state: 'unverified',
        createdAt: now,
        updatedAt: now,
        lastSeen: now,
      }
      await this.#repository.putXIdentity(record)
      await this.#syncXIdentityStatus(member.twitterId)
      const latest =
        (await this.#repository.getXIdentity(member.twitterId)) ?? record
      this.#broadcastXIdentityUpdated(latest, { statusChanged: true })
    }
  }

  async #demoWotExcludedTwitterIds(): Promise<string[]> {
    const ids = new Set<string>()
    const activeAccount = vault.getActiveAccount()
    if (activeAccount) {
      for (const id of boundTwitterIdsOf(activeAccount)) ids.add(id)
    }
    const activeX = await this.#loadActiveXAccount()
    const fromX = normalizeBoundTwitterId(activeX?.twitterId)
    if (fromX) ids.add(fromX)
    return [...ids]
  }

  /**
   * Local-only demo graph. Kind 32009 rows include a short `content` quote
   * for StatementScan. Demo authors also get local kind-0 + profile-cache
   * chrome (name + HTTPS picture). Chain accounts are seeded into
   * `xIdentities` first so Panel and Graph can resolve chrome; post subjects
   * come from observed `xPosts` only — demo never synthesizes posts.
   * Existing demo graphs keep truncated npubs until re-seed: send
   * `SEED_DEMO_WOT` (clears, then ingests), or leave Demo and re-enter
   * (`SET_APP_MODE` production clears; demo seeds when the demo store is empty).
   */
  async #seedDemoWot(): Promise<DemoWotSeedResult> {
    // Require an unlocked signing identity so root→degree-1 edges can be local.
    this.#pubkey()
    const cleared = await this.#clearDemoWot()
    await this.#ensureDemoWotChainIdentities()

    const identities = await this.#repository.getAllXIdentities()
    const posts = await this.#repository.getAllXPosts()
    const excludeTwitterIds = await this.#demoWotExcludedTwitterIds()
    const plan = planDemoWotNetwork({
      users: identities.map((row) => ({
        twitterId: row.twitterId,
        handle: row.handle,
        lastSeen: row.lastSeen,
        ...(row.displayName ? { displayName: row.displayName } : {}),
      })),
      posts: posts.map((row) => ({
        postId: row.postId,
        lastSeen: row.lastSeen,
        ...(row.authorTwitterId ? { authorTwitterId: row.authorTwitterId } : {}),
        createdAt: row.createdAt,
      })),
      ...(excludeTwitterIds.length > 0 ? { excludeTwitterIds } : {}),
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

      const now = this.#now()
      for (let i = 0; i < plan.authors.length; i += 1) {
        const slot = plan.authors[i]!
        const pubkey = fakePubkeys[i]
        if (!pubkey) {
          throw new Error(`Missing demo author pubkey at ${i}`)
        }
        const npub = npubFromPubkey(pubkey)
        if (!npub) continue
        const existing = await this.#repository.getXIdentity(slot.twitterId)
        if (!existing) continue
        if (excludeTwitterIds.includes(slot.twitterId)) continue
        await this.#repository.putXIdentity({
          ...existing,
          eventNpub: npub,
          updatedAt: now,
        })
        await this.#syncXIdentityStatus(slot.twitterId)
        const latest =
          (await this.#repository.getXIdentity(slot.twitterId)) ?? existing
        this.#broadcastXIdentityUpdated(latest, { statusChanged: true })
      }

      const rootKey = this.#secretKey()
      const baseCreatedAt = Math.floor(this.#now() / 1_000)

      try {
        for (let i = 0; i < plan.fakeAuthorCount; i += 1) {
          const secret = fakeKeys[i]
          const pubkey = fakePubkeys[i]
          if (!secret || !pubkey) {
            throw new Error(`Missing demo author key at ${i}`)
          }
          const profile = demoWotAuthorProfile(i, plan.authors[i])
          const metadata = {
            name: profile.name,
            display_name: profile.display_name,
            picture: profile.picture,
          }
          const event = finalizeEvent(
            {
              kind: 0,
              created_at: baseCreatedAt,
              tags: DEMO_WOT_EXTRA_TAGS.map((tag) => [...tag]),
              content: JSON.stringify(metadata),
            },
            secret,
          )
          await this.#repository.ingestEvent({
            event,
            state: DEMO_EVENT_STATE,
          })
          await putProfileMetadata(pubkey, metadata)
          created += 1
        }

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
            context: trustPublishContextForSubject(subject),
            scopes: publishTags.scopes,
            k: publishTags.k,
            content: sanitizeTrustContent(row.content),
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

        for (let i = 0; i < plan.ratings.length; i += 1) {
          if (i % 32 === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
          const row = plan.ratings[i]!
          const authorKey =
            row.authorIndex === -1 ? rootKey : fakeKeys[row.authorIndex]
          if (!authorKey) {
            throw new Error(`Missing demo rating key at ${row.authorIndex}`)
          }
          const subject = materializeDemoSubject(row.subject, fakePubkeys)
          const publishTags = defaultTrustPublishTags(subject)
          const template = await buildKind32014Event({
            subject,
            score: row.score,
            context: ratingPublishContextForSubject(subject),
            scopes: publishTags.scopes,
            k: publishTags.k,
            labels: row.labels,
            content: '',
            createdAt: baseCreatedAt + plan.statements.length + i,
            extraTags: DEMO_WOT_EXTRA_TAGS.map((tag) => [...tag]),
          })
          const event = finalizeEvent(template, authorKey)
          if (i === 0) {
            const validation = await validateKind32014Event(event)
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
    await this.#pruneOrphanXPosts()
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
    this.#graph.rebuildClaims([])
    this.#graphDirty = false
    void chrome.storage.session
      .remove(ACTIVE_X_ACCOUNT_SESSION_KEY)
      .catch(() => undefined)
    this.#broadcastTrustGraphUpdated()
  }

  async #destroyKeysAndLogout(): Promise<void> {
    await signer.cancelAllUnlockWaiters()
    await vault.destroy()
    await clearLocalAccounts({
      reason: 'destroy',
      extraRemove: ['autoLockMs', 'vaultUnlockGuard'],
    })
    await chrome.storage.sync.remove('myPubkey')
    config.myPubkey = ''
    await signerPermissions.clear()
  }

  async #clearExtensionLocalState(): Promise<void> {
    this.#settings = {
      relays: [...DEFAULT_RELAYS],
      mode: DEFAULT_APP_MODE,
      wotMaxDegree: WOT_MAX_DEGREE_DEFAULT,
      syncIntervalMinutes: WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
      wotAutoLower: true,
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
    await removeOperatorLifecycle()
    await this.#settingsStore.write({
      relays: [...DEFAULT_RELAYS],
      mode: DEFAULT_APP_MODE,
      wotMaxDegree: WOT_MAX_DEGREE_DEFAULT,
      syncIntervalMinutes: WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
      wotAutoLower: true,
    })
    await this.reconcileMaintenanceAlarm()
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
    this.#broadcastRuntimeAndXTabs(message)
  }

  #broadcastSelectedSubjectChanged(selected: SelectedSubject): void {
    this.#broadcastRuntimeAndXTabs({
      type: SELECTED_SUBJECT_CHANGED_MESSAGE,
      subject: selected.subject,
      ...(selected.context !== undefined ? { context: selected.context } : {}),
    })
  }

  #broadcastRuntimeAndXTabs(message: Record<string, unknown>): void {
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


  #rebuildNpubIndex(identities: readonly XIdentityRecord[]): void {
    this.#npubToTwitterId.clear()
    for (const row of identities) this.#reindexIdentityNpubs(row)
  }

  #reindexIdentityNpubs(row: XIdentityRecord): void {
    for (const [key, twitterId] of [...this.#npubToTwitterId.entries()]) {
      if (twitterId === row.twitterId) this.#npubToTwitterId.delete(key)
    }
    for (const key of winningNpubLookupKeys(row)) {
      this.#npubToTwitterId.set(key, row.twitterId)
    }
  }

  async #twitterIdForNpub(npubOrHex: string): Promise<string | undefined> {
    const wanted = normalizeNpubOrHex(npubOrHex)
    for (const key of [wanted.npub, wanted.hex]) {
      if (!key) continue
      const hit = this.#npubToTwitterId.get(key)
      if (hit) return hit
    }
    return this.#repository.twitterIdForNpub(npubOrHex)
  }

  async #normalizeSelectedSubject(
    selected: SelectedSubject,
  ): Promise<SelectedSubject> {
    if (selected.subject.type !== 'p') return selected
    const twitterId = await this.#twitterIdForNpub(selected.subject.value)
    if (!twitterId) return selected
    return {
      ...selected,
      subject: { type: 'i', value: `user:id:${twitterId}` },
    }
  }

  async #pruneIneligibleRatingEvents(): Promise<void> {
    const events = await this.#repository.getEventsByKind(RATING_STATEMENT_KIND)
    for (const event of events) {
      if (isEligibleXRatingScope(scopesFromEventTags(event.tags))) continue
      await this.#repository.deleteEvent(event.id)
    }
  }

  async #attachConnectionKeys<T extends { eventId: string }>(
    statements: readonly T[],
  ): Promise<Array<T & { connectionKey?: string }>> {
    const attached: Array<T & { connectionKey?: string }> = []
    for (const statement of statements) {
      const event = await this.#repository.getEvent(statement.eventId)
      attached.push(
        event?.addressKey
          ? { ...statement, connectionKey: event.addressKey }
          : { ...statement },
      )
    }
    return attached
  }

  async #attachConnectionKeysToTrustResult(
    result: TrustQueryResult,
  ): Promise<TrustQueryResult> {
    const statements = await this.#attachConnectionKeys(result.statements)
    const direct = result.direct
      ? (await this.#attachConnectionKeys([result.direct]))[0]
      : undefined
    return {
      ...result,
      statements,
      ...(direct ? { direct } : {}),
    }
  }

  async #openSidePanel(
    subject: TrustSubject,
    context: string | undefined,
    tabId: number | undefined,
  ): Promise<{ opened: boolean; subject: TrustSubject }> {
    const selected = this.#selectedSubjectFromRequest(subject, context)

    // Invoke `open` before any `await` so a remaining user gesture is kept.
    let opened = false
    let opening: Promise<void> | undefined
    if (typeof tabId === 'number') {
      const sidePanel = (
        chrome as typeof chrome & {
          sidePanel?: { open?: (options: { tabId: number }) => Promise<void> }
        }
      ).sidePanel
      if (sidePanel?.open) {
        opening = sidePanel.open({ tabId })
        opened = true
      }
    }

    try {
      await chrome.storage.session.set({ [OPEN_NOTES_ON_LAUNCH_KEY]: true })
    } catch {
      /* session storage unavailable */
    }
    const normalized = await this.#normalizeSelectedSubject(selected)
    await this.#commitSelectedSubject(normalized)
    if (opening) {
      try {
        await opening
      } catch {
        /* the SW message listener may already have opened the panel */
      }
    }
    return { opened, subject: normalized.subject }
  }

  async #selectSubject(
    subject: TrustSubject,
    context: string | undefined,
  ): Promise<{ subject: TrustSubject }> {
    const selected = this.#selectedSubjectFromRequest(subject, context)
    try {
      await chrome.storage.session.set({ [OPEN_NOTES_ON_LAUNCH_KEY]: true })
    } catch {
      /* session storage unavailable */
    }
    const normalized = await this.#normalizeSelectedSubject(selected)
    await this.#commitSelectedSubject(normalized)
    return { subject: normalized.subject }
  }

  #selectedSubjectFromRequest(
    subject: TrustSubject,
    context: string | undefined,
  ): SelectedSubject {
    const subjectError = getTrustSubjectValidationError(subject)
    if (subjectError) throw new Error(subjectError)
    const resolvedContext = context ?? ''
    if (!isCanonicalTrustContext(resolvedContext)) {
      throw new Error('Context is not canonical')
    }
    return {
      subject: { ...subject },
      ...(resolvedContext !== '' ? { context: resolvedContext } : {}),
    }
  }

  async #getSelectedSubjectSnapshot(): Promise<SelectedSubjectSnapshot> {
    const selected = await this.#readSelectedSubject()
    const history = await this.#readSelectedSubjectHistory()
    return { selected, ...selectedSubjectHistoryFlags(history) }
  }

  async #moveSelectedSubjectHistory(
    direction: SelectedSubjectHistoryDirection,
  ): Promise<SelectedSubjectSnapshot> {
    const history = await this.#readSelectedSubjectHistory()
    const moved = moveSelectedSubjectHistory(history, direction)
    if (!moved) return this.#getSelectedSubjectSnapshot()
    const selected = moved.entries[moved.index]
    if (!selected) return this.#getSelectedSubjectSnapshot()
    await this.#persistSelectedSubject(selected, moved)
    this.#broadcastSelectedSubjectChanged(selected)
    return { selected, ...selectedSubjectHistoryFlags(moved) }
  }

  async #commitSelectedSubject(selected: SelectedSubject): Promise<void> {
    const current = await this.#readSelectedSubject()
    let history = await this.#readSelectedSubjectHistory()
    if (
      history.entries.length === 0 &&
      current &&
      selectedSubjectIdentity(current) !== selectedSubjectIdentity(selected)
    ) {
      history = pushSelectedSubjectHistory(history, current)
    }
    history = pushSelectedSubjectHistory(history, selected)
    await this.#persistSelectedSubject(selected, history)
    this.#broadcastSelectedSubjectChanged(selected)
  }

  async #persistSelectedSubject(
    selected: SelectedSubject,
    history: SelectedSubjectHistory,
  ): Promise<void> {
    try {
      await chrome.storage.session.set({
        [SELECTED_SUBJECT_STORAGE_KEY]: selected,
        [SELECTED_SUBJECT_HISTORY_STORAGE_KEY]: history,
      })
    } catch {
      /* session storage unavailable */
    }
  }

  async #readSelectedSubject(): Promise<SelectedSubject | null> {
    try {
      const stored = await chrome.storage.session.get(
        SELECTED_SUBJECT_STORAGE_KEY,
      )
      const value = stored[SELECTED_SUBJECT_STORAGE_KEY]
      return isSelectedSubject(value) ? value : null
    } catch {
      return null
    }
  }

  async #readSelectedSubjectHistory(): Promise<SelectedSubjectHistory> {
    try {
      const stored = await chrome.storage.session.get(
        SELECTED_SUBJECT_HISTORY_STORAGE_KEY,
      )
      const value = stored[SELECTED_SUBJECT_HISTORY_STORAGE_KEY]
      return isSelectedSubjectHistory(value)
        ? value
        : emptySelectedSubjectHistory()
    } catch {
      return emptySelectedSubjectHistory()
    }
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
