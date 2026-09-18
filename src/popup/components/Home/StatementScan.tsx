import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@lib/i18n.js'
import { getInitial, truncateNpub } from '@shared/format/text.ts'
import { safeImageUrl } from '@shared/safeUrl.js'
import Avatar from '@components/Avatar/Avatar'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
import Button from '@components/Button/Button'
import XUserBadges from '@components/XUserBadges/XUserBadges'
import { IconChevronDown, IconUser, IconUsers } from '@assets'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type QueryIncomingTrustResult,
  type QueryOutgoingTrustResult,
  type QueryTrustBatchResult,
  type XIdentityDisplay,
} from '../../../shared/contracts'
import {
  isArtifactSubject,
  outgoingTargetTwitterId,
  type ActiveTrustValue,
  type RatingClaimEvidence,
  type RatingQueryResult,
  type ResolvedStatement,
  type TrustQueryResult,
  type TrustSubject,
} from '../../../graph'
import { buildXProfileIconUrl } from '../../../shared/x-profile-display'
import {
  pickXVerifiedChrome,
  type XVerifiedType,
} from '../../../shared/x-verified'
import { trustScorePercent } from '../../../shared/trust-score'
import { formatAtHandle } from './subjectHeaderFormat'
import RatingHistogram, {
  AnalogStars,
  matchesStarFilter,
  starsFromScore,
  type HistogramStar,
} from './SubjectRatings'
import styles from './StatementScan.module.css'
import { useViewer } from '../../context/ViewerContext'

const PUBKEY_DISPLAY_BATCH = 50
export const STATEMENT_PAGE_SIZE = 50

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string

export type StatementPolarity = 'trust' | 'neutral' | 'distrust'

const POLARITY_OPTIONS: readonly StatementPolarity[] = [
  'trust',
  'neutral',
  'distrust',
]

export interface StatementAuthorDisplay {
  name?: string
  picture?: string
  handle?: string
  twitterId?: string
  verifiedType?: XVerifiedType
  affiliationBadgePath?: string
  affiliationLabel?: string
}

export type StatementDirection = 'in' | 'out'

export type PolarityLabelKey =
  | 'panel.statementScan.trust'
  | 'panel.statementScan.neutral'
  | 'panel.statementScan.distrust'

export type PolarityHintKey =
  | 'panel.statementScan.trustHint'
  | 'panel.statementScan.neutralHint'
  | 'panel.statementScan.distrustHint'

export type StatementSubjectKind = 'account' | 'post'

export function polarityFromValue(value: ActiveTrustValue): StatementPolarity {
  switch (value) {
    case 1:
      return 'trust'
    case 0:
      return 'neutral'
    case -1:
      return 'distrust'
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

export function polarityLabelKey(value: ActiveTrustValue): PolarityLabelKey {
  switch (value) {
    case 1:
      return 'panel.statementScan.trust'
    case 0:
      return 'panel.statementScan.neutral'
    case -1:
      return 'panel.statementScan.distrust'
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

export function polarityHintKey(value: ActiveTrustValue): PolarityHintKey {
  switch (value) {
    case 1:
      return 'panel.statementScan.trustHint'
    case 0:
      return 'panel.statementScan.neutralHint'
    case -1:
      return 'panel.statementScan.distrustHint'
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

/** User vs post subject. Exhaustive on the TrustSubject union. */
export function statementSubjectKind(
  subject: TrustSubject,
): StatementSubjectKind {
  switch (subject.type) {
    case 'e':
      return 'post'
    case 'p':
      return 'account'
    case 'i':
      return isArtifactSubject(subject) ? 'post' : 'account'
    default: {
      const _exhaustive: never = subject
      return _exhaustive
    }
  }
}

export function formatPolarityLabel(
  value: ActiveTrustValue,
  translate: Translate = t,
): string {
  return translate(polarityLabelKey(value))
}

/** Own evidence is the viewer’s winning statement on this subject (`trust.direct`). */
export function isOwnStatement(
  statement: Pick<ResolvedStatement, 'author' | 'eventId'>,
  direct: TrustQueryResult['direct'],
): boolean {
  if (direct === undefined) return false
  return (
    statement.eventId === direct.eventId &&
    statement.author.toLowerCase() === direct.author.toLowerCase()
  )
}

/** Never use the full hex as a visual title. */
export function shortenPubkey(pubkey: string): string {
  const trimmed = pubkey.trim()
  if (trimmed.length < 16) return trimmed
  return truncateNpub(trimmed)
}

export function authorTitle(
  pubkey: string,
  profileName: string | undefined,
): string {
  const name = profileName?.trim()
  return name && name.length > 0 ? name : shortenPubkey(pubkey)
}

/** Timeline-style `@handle` after the display name; skip if the title is already that handle. */
export function authorHandleLabel(
  profile: Pick<StatementAuthorDisplay, 'name' | 'handle'> | undefined,
): string | undefined {
  const handle = formatAtHandle(profile?.handle)
  if (!handle) return undefined
  const name = profile?.name?.trim()
  if (name === handle) return undefined
  return handle
}

/**
 * Hop is omitted from the scan row. After face+name, polarity then the unique
 * quote (Maps-style). Distance stays on the statement for graph use.
 */
export function hopDistance(_distance: number): number | null {
  return null
}

export function uniqueStatementAuthors(
  statements: readonly Pick<ResolvedStatement, 'author'>[],
): string[] {
  const seen = new Set<string>()
  const authors: string[] = []
  for (const statement of statements) {
    const key = statement.author.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    authors.push(statement.author)
  }
  return authors
}

/** Graph inbound is per edge, not per author. */
export function incomingStatementRowId(
  statement: Pick<ResolvedStatement, 'connectionKey' | 'eventId'>,
): string {
  return statement.connectionKey ?? statement.eventId
}

export function sortIncomingStatements(
  statements: readonly ResolvedStatement[],
  profiles: Record<string, StatementAuthorDisplay>,
): ResolvedStatement[] {
  return [...statements].sort((left, right) => {
    const cmp = authorSortKey(
      left.author,
      lookupProfile(profiles, left.author),
    ).localeCompare(
      authorSortKey(right.author, lookupProfile(profiles, right.author)),
      undefined,
      { sensitivity: 'base' },
    )
    if (cmp !== 0) return cmp
    return incomingStatementRowId(left).localeCompare(
      incomingStatementRowId(right),
    )
  })
}

export function uniqueOutgoingTwitterIds(
  statements: readonly Pick<ResolvedStatement, 'subject'>[],
): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const statement of statements) {
    const twitterId = outgoingTargetTwitterId(statement)
    if (!twitterId || seen.has(twitterId)) continue
    seen.add(twitterId)
    ids.push(twitterId)
  }
  return ids
}

export function statementContentLine(
  content: string | undefined,
): string | null {
  const text = content?.trim()
  return text && text.length > 0 ? text : null
}

function lookupProfile(
  profiles: Record<string, StatementAuthorDisplay>,
  pubkey: string,
): StatementAuthorDisplay | undefined {
  return profiles[pubkey] ?? profiles[pubkey.toLowerCase()]
}

export function authorSortKey(
  pubkey: string,
  profile: StatementAuthorDisplay | undefined,
): string {
  const name = profile?.name?.trim()
  if (name) return name
  const handle = profile?.handle?.trim().replace(/^@+/u, '')
  if (handle) return handle
  return shortenPubkey(pubkey)
}

export function sortAuthorsByName(
  authors: readonly string[],
  profiles: Record<string, StatementAuthorDisplay>,
): string[] {
  return [...authors].sort((a, b) => {
    const nameA = authorSortKey(a, lookupProfile(profiles, a))
    const nameB = authorSortKey(b, lookupProfile(profiles, b))
    const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
    if (cmp !== 0) return cmp
    return a.toLowerCase().localeCompare(b.toLowerCase())
  })
}

export function matchesAuthorFilter(
  pubkey: string,
  profile: StatementAuthorDisplay | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (profile?.name?.toLowerCase().includes(q)) return true
  const handle = profile?.handle?.trim().replace(/^@+/u, '').toLowerCase()
  if (handle?.includes(q.replace(/^@+/u, ''))) return true
  if (profile?.twitterId?.includes(q)) return true
  return false
}

export function matchesPolarityFilter(
  value: ActiveTrustValue,
  polarity: StatementPolarity | null,
): boolean {
  if (polarity === null) return true
  return polarityFromValue(value) === polarity
}

export type PolarityCounts = Record<StatementPolarity, number>

export function polarityCounts(
  values: readonly ActiveTrustValue[],
): PolarityCounts {
  const counts: PolarityCounts = { trust: 0, neutral: 0, distrust: 0 }
  for (const value of values) {
    counts[polarityFromValue(value)] += 1
  }
  return counts
}

/** Exact below 1000; remainder at each rung becomes `+` (`147001` → `147k+`). */
export function formatCompactCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0'
  const n = Math.floor(count)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1_000)
    return n % 1_000 === 0 ? `${thousands}k` : `${thousands}k+`
  }
  const millions = Math.floor(n / 1_000_000)
  return n % 1_000_000 === 0 ? `${millions}m` : `${millions}m+`
}

export function formatPolarityChipLabel(
  polarity: StatementPolarity,
  count: number,
  translate: Translate = t,
): string {
  const label = translate(`panel.statementScan.${polarity}`)
  if (count <= 0) return label
  return `${label} ${formatCompactCount(count)}`
}

export function nextLoadCount(
  loaded: number,
  total: number,
  pageSize = STATEMENT_PAGE_SIZE,
): number {
  if (total <= loaded) return 0
  return Math.min(pageSize, total - loaded)
}

export function windowedItems<T>(items: readonly T[], loaded: number): T[] {
  return items.slice(0, Math.max(0, loaded))
}

export type StatementScanListPhase =
  | 'pending'
  | 'empty'
  | 'emptyFilter'
  | 'rows'

/** Hold the list until statements and chrome for this direction are ready. */
export function statementScanListPhase(input: {
  statementsReady: boolean
  chromeReady: boolean
  statementCount: number
  visibleCount: number
}): StatementScanListPhase {
  if (!input.statementsReady) return 'pending'
  if (input.statementCount === 0) return 'empty'
  if (!input.chromeReady) return 'pending'
  if (input.visibleCount === 0) return 'emptyFilter'
  return 'rows'
}

export function formatLoadMoreLabel(
  next: number,
  total: number | undefined,
  translate: Translate = t,
): string {
  if (total === undefined) {
    return translate('panel.statementScan.loadMore')
  }
  return translate('panel.statementScan.loadMoreOf', {
    next,
    total: formatCompactCount(total),
  })
}

function usePagedWindow(resetKey: string): {
  loaded: number
  loadMore: () => void
} {
  const [loaded, setLoaded] = useState(STATEMENT_PAGE_SIZE)
  useEffect(() => {
    setLoaded(STATEMENT_PAGE_SIZE)
  }, [resetKey])
  return {
    loaded,
    loadMore: () => {
      setLoaded((current) => current + STATEMENT_PAGE_SIZE)
    },
  }
}

export function formatGreenTrustPercent(
  result:
    | Pick<TrustQueryResult, 'connected' | 'trust' | 'distrust'>
    | undefined,
): string | undefined {
  if (!result?.connected) return undefined
  const percent = trustScorePercent(result.trust, result.distrust)
  return percent === null ? undefined : String(percent)
}

export function xIdentityToAuthorDisplay(
  display: XIdentityDisplay,
): StatementAuthorDisplay {
  const handle = display.handle?.trim()
  const name = display.displayName?.trim() || handle
  const picture = display.iconPath
    ? safeImageUrl(buildXProfileIconUrl(display.iconPath, '400x400'))
    : undefined
  return {
    ...(name ? { name } : {}),
    ...(handle ? { handle } : {}),
    ...(display.twitterId ? { twitterId: display.twitterId } : {}),
    ...(picture ? { picture } : {}),
    ...pickXVerifiedChrome(display),
  }
}

export function profileDisplayFromMetadata(
  profile: Record<string, unknown> | null | undefined,
): StatementAuthorDisplay | undefined {
  if (!profile) return undefined
  const picture = profile.picture
  const displayName =
    typeof profile.display_name === 'string'
      ? profile.display_name
      : typeof profile.name === 'string'
        ? profile.name
        : undefined
  const safeName = displayName?.trim().slice(0, 80)
  const candidate =
    typeof picture === 'string' ? safeImageUrl(picture) : undefined
  const safePicture =
    candidate !== undefined && candidate.length <= 2_048
      ? candidate
      : undefined
  if (!safeName && !safePicture) return undefined
  return {
    ...(safeName ? { name: safeName } : {}),
    ...(safePicture ? { picture: safePicture } : {}),
  }
}

/** X chrome wins for mapped users; kind 0 is only for unmapped Nostr authors. */
export function mergeAuthorDisplay(
  xDisplay: StatementAuthorDisplay | undefined,
  kind0: StatementAuthorDisplay | undefined,
): StatementAuthorDisplay | undefined {
  if (xDisplay?.twitterId) return xDisplay
  if (!xDisplay && !kind0) return undefined
  const name = xDisplay?.name?.trim() || kind0?.name?.trim()
  const picture = xDisplay?.picture || kind0?.picture
  const handle = xDisplay?.handle || kind0?.handle
  const twitterId = xDisplay?.twitterId || kind0?.twitterId
  return {
    ...kind0,
    ...xDisplay,
    ...(name ? { name } : {}),
    ...(picture ? { picture } : {}),
    ...(handle ? { handle } : {}),
    ...(twitterId ? { twitterId } : {}),
  }
}

function isMappedXAuthor(
  display: StatementAuthorDisplay | undefined,
): boolean {
  return Boolean(display?.twitterId)
}

async function loadKind0AuthorDisplays(
  pubkeys: string[],
): Promise<Record<string, StatementAuthorDisplay>> {
  const profiles: Record<string, StatementAuthorDisplay> = {}
  if (pubkeys.length === 0) return profiles
  const metadata = await axRequest<
    Record<string, Record<string, unknown> | null>
  >({
    type: 'GET_KIND0_PROFILES',
    version: BACKGROUND_API_VERSION,
    pubkeys,
  })
  for (const pubkey of pubkeys) {
    const mapped = profileDisplayFromMetadata(
      metadata[pubkey] ?? metadata[pubkey.toLowerCase()],
    )
    if (!mapped) continue
    profiles[pubkey] = mapped
    profiles[pubkey.toLowerCase()] = mapped
  }
  return profiles
}

export type StatementScanProps =
  | { variant: 'users'; trust: TrustQueryResult }
  | { variant: 'ratings'; rating: RatingQueryResult }

const LABEL_PROSE_JOIN = ' · '

/**
 * Label tokens as a scannable line. Prefer each token’s display hint;
 * never invent a personal quote around a bare token.
 */
export function labelProse(
  labels: readonly string[] | undefined,
  hints: Record<string, string> | undefined,
): string | null {
  const tokens =
    labels?.map((label) => label.trim()).filter((label) => label.length > 0) ??
    []
  const parts: string[] = []
  if (tokens.length > 0) {
    for (const token of tokens) {
      const hint = hints?.[token]?.trim()
      parts.push(hint && hint.length > 0 ? hint : token)
    }
  } else if (hints !== undefined) {
    for (const hint of Object.values(hints)) {
      const text = hint.trim()
      if (text.length > 0) parts.push(text)
    }
  }
  if (parts.length === 0) return null
  return parts.join(LABEL_PROSE_JOIN)
}

function polarityClass(value: ActiveTrustValue): string {
  switch (value) {
    case 1:
      return styles.polarityTrust
    case 0:
      return styles.polarityNeutral
    case -1:
      return styles.polarityDistrust
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

async function loadXAuthorDisplays(
  pubkeys: string[],
): Promise<Record<string, StatementAuthorDisplay>> {
  const profiles: Record<string, StatementAuthorDisplay> = {}
  for (let i = 0; i < pubkeys.length; i += PUBKEY_DISPLAY_BATCH) {
    const batch = pubkeys.slice(i, i + PUBKEY_DISPLAY_BATCH)
    let displays: Record<string, XIdentityDisplay> = {}
    try {
      displays = await axRequest<Record<string, XIdentityDisplay>>({
        type: 'GET_X_IDENTITY_DISPLAYS_FOR_PUBKEYS',
        version: BACKGROUND_API_VERSION,
        pubkeys: batch,
      })
    } catch {
      displays = {}
    }
    for (const [pubkey, display] of Object.entries(displays)) {
      const mapped = xIdentityToAuthorDisplay(display)
      profiles[pubkey] = mapped
      profiles[pubkey.toLowerCase()] = mapped
    }
    const missing = batch.filter((pubkey) => {
      const display = profiles[pubkey] ?? profiles[pubkey.toLowerCase()]
      return !isMappedXAuthor(display)
    })
    if (missing.length === 0) continue
    try {
      const kind0 = await loadKind0AuthorDisplays(missing)
      for (const pubkey of missing) {
        const merged = mergeAuthorDisplay(
          profiles[pubkey] ?? profiles[pubkey.toLowerCase()],
          kind0[pubkey] ?? kind0[pubkey.toLowerCase()],
        )
        if (!merged) continue
        profiles[pubkey] = merged
        profiles[pubkey.toLowerCase()] = merged
      }
    } catch {
      // Kind 0 is a fallback; X chrome already applied above.
    }
  }
  return profiles
}

async function loadAuthorTrustScores(
  profiles: Record<string, StatementAuthorDisplay>,
): Promise<Record<string, TrustQueryResult>> {
  const items: { key: string; subject: { type: 'i'; value: string } }[] = []
  const seen = new Set<string>()
  for (const profile of Object.values(profiles)) {
    const twitterId = profile.twitterId
    if (!twitterId || seen.has(twitterId)) continue
    seen.add(twitterId)
    items.push({
      key: twitterId,
      subject: { type: 'i', value: `user:id:${twitterId}` },
    })
  }
  if (items.length === 0) return {}
  const batch = await axRequest<QueryTrustBatchResult>({
    type: 'QUERY_TRUST_BATCH',
    version: BACKGROUND_API_VERSION,
    items,
  })
  return batch.results
}

export function viewerScopedKey(
  key: string,
  viewerPubkey: string | undefined,
): string {
  return `${key}\0viewer:${viewerPubkey ?? 'locked'}`
}

async function loadXTargetDisplays(
  twitterIds: string[],
): Promise<Record<string, StatementAuthorDisplay>> {
  const profiles: Record<string, StatementAuthorDisplay> = {}
  if (twitterIds.length === 0) return profiles
  for (let i = 0; i < twitterIds.length; i += PUBKEY_DISPLAY_BATCH) {
    const batch = twitterIds.slice(i, i + PUBKEY_DISPLAY_BATCH)
    if (batch.length === 0) continue
    const displays = await axRequest<Record<string, XIdentityDisplay>>({
      type: 'GET_X_IDENTITY_DISPLAYS',
      version: BACKGROUND_API_VERSION,
      twitterIds: batch,
    })
    for (const [twitterId, display] of Object.entries(displays)) {
      profiles[twitterId] = xIdentityToAuthorDisplay(display)
    }
  }
  return profiles
}

function LabelTokens({
  labels,
  hints,
}: {
  labels?: string[]
  hints?: Record<string, string>
}) {
  if (labels === undefined || labels.length === 0) return null
  return (
    <div className={styles.labels}>
      {labels.map((label) => {
        const hint = hints?.[label]
        return (
          <span
            key={label}
            className={hint ? styles.labelHint : styles.label}
            title={hint}
            aria-label={hint ? `${label}: ${hint}` : label}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

function TruncatingLine({
  text,
  className,
  onOverflowChange,
}: {
  text: string
  className: string
  onOverflowChange: (overflow: boolean) => void
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      onOverflowChange(false)
      return
    }
    const measure = () => {
      onOverflowChange(el.scrollWidth > el.clientWidth + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onOverflowChange, text])
  return (
    <p ref={ref} className={className} title={text}>
      {text}
    </p>
  )
}

function StatementDetail({
  labels,
  labelHints,
  content,
  title,
}: {
  labels?: string[]
  labelHints?: Record<string, string>
  content?: string
  title: string
}) {
  const labelsLine = labelProse(labels, labelHints)
  const contentLine = statementContentLine(content)
  const [labelsOverflow, setLabelsOverflow] = useState(false)
  const [contentOverflow, setContentOverflow] = useState(false)
  const [open, setOpen] = useState(false)
  const { shouldRender, animating } = useAnimatedVisible(open)
  const showExpand = labelsOverflow || contentOverflow
  if (!labelsLine && !contentLine) return null

  return (
    <div className={styles.detail}>
      <div className={styles.detailLines}>
        {labelsLine ? (
          <TruncatingLine
            text={labelsLine}
            className={styles.labelsLine}
            onOverflowChange={setLabelsOverflow}
          />
        ) : null}
        {contentLine ? (
          <TruncatingLine
            text={contentLine}
            className={styles.contentLine}
            onOverflowChange={setContentOverflow}
          />
        ) : null}
      </div>
      {showExpand ? (
        <button
          type="button"
          className={styles.expandBtn}
          aria-label={t('panel.statementScan.expand')}
          title={t('panel.statementScan.expand')}
          onClick={(event) => {
            event.stopPropagation()
            setOpen(true)
          }}
        >
          <IconChevronDown size={14} aria-hidden="true" />
        </button>
      ) : null}
      {shouldRender
        ? createPortal(
            <OverlayPanel
              title={title}
              onClose={() => setOpen(false)}
              animating={animating}
              zIndex={400}
            >
              <div className={styles.expandBody}>
                <LabelTokens labels={labels} hints={labelHints} />
                {contentLine ? (
                  <p className={styles.fullContent}>{contentLine}</p>
                ) : null}
              </div>
            </OverlayPanel>,
            document.body,
          )
        : null}
    </div>
  )
}

function UserChromeRow(props: {
  chromeKey: string
  profile: StatementAuthorDisplay | undefined
  percent: string | undefined
  polarity: ReactNode
  onFocus: (twitterId: string) => void
  detail: ReactNode
}) {
  const { chromeKey, profile, percent, polarity, onFocus, detail } = props
  const title = authorTitle(chromeKey, profile?.name)
  const handleLabel = authorHandleLabel(profile)
  const twitterId = profile?.twitterId
  const clickable = Boolean(twitterId)
  const score = percent
    ? t('panel.statementScan.scorePercent', { percent })
    : undefined
  const nameTitle = [title, handleLabel].filter(Boolean).join(' ')

  const identity = (
    <>
      <div className={styles.photo}>
        <Avatar
          src={profile?.picture}
          fallback={getInitial(title)}
          imgClassName={styles.avatar}
          fallbackClassName={styles.avatarFallback}
        />
      </div>
      <div className={styles.body}>
        <div className={styles.itemTop}>
          <span
            className={
              profile?.name?.trim() ? styles.author : styles.authorFallback
            }
            title={profile?.name?.trim() ? nameTitle : chromeKey}
          >
            <span className={styles.authorTitle}>{title}</span>
            <XUserBadges size={14} {...pickXVerifiedChrome(profile)} />
            {handleLabel ? (
              <span className={styles.authorHandle}>{handleLabel}</span>
            ) : null}
          </span>
          {score ? (
            <span className={styles.userScore} title={score}>
              {score}
            </span>
          ) : null}
        </div>
        {polarity}
      </div>
    </>
  )

  return (
    <li className={styles.item}>
      <div className={styles.userBlock}>
        {clickable && twitterId ? (
          <button
            type="button"
            className={styles.userButton}
            onClick={() => onFocus(twitterId)}
          >
            <div className={styles.row}>{identity}</div>
          </button>
        ) : (
          <div className={styles.row}>{identity}</div>
        )}
        <div className={styles.detailOffset}>{detail}</div>
      </div>
    </li>
  )
}

function UserStatementRow({
  statement,
  profile,
  percent,
  chromeKey,
  onFocus,
}: {
  statement: ResolvedStatement
  profile: StatementAuthorDisplay | undefined
  percent: string | undefined
  chromeKey: string
  onFocus: (twitterId: string) => void
}) {
  const title = authorTitle(chromeKey, profile?.name)
  return (
    <UserChromeRow
      chromeKey={chromeKey}
      profile={profile}
      percent={percent}
      onFocus={onFocus}
      polarity={
        <span
          className={`${styles.polarity} ${polarityClass(statement.value)}`}
          title={t(polarityHintKey(statement.value))}
        >
          {formatPolarityLabel(statement.value)}
        </span>
      }
      detail={
        <StatementDetail
          labels={statement.labels}
          labelHints={statement.labelHints}
          content={statement.content}
          title={title}
        />
      }
    />
  )
}

function RatingStatementRow({
  claim,
  profile,
  percent,
  onFocus,
}: {
  claim: RatingClaimEvidence
  profile: StatementAuthorDisplay | undefined
  percent: string | undefined
  onFocus: (twitterId: string) => void
}) {
  const title = authorTitle(claim.author, profile?.name)
  const stars = starsFromScore(claim.score)
  return (
    <UserChromeRow
      chromeKey={claim.author}
      profile={profile}
      percent={percent}
      onFocus={onFocus}
      polarity={
        <span
          className={styles.starLine}
          title={t('panel.curate.starAria', { stars: Math.max(0, stars) })}
        >
          <AnalogStars score={claim.score} />
        </span>
      }
      detail={
        <StatementDetail
          labels={claim.labels}
          labelHints={claim.labelHints}
          content={claim.content}
          title={title}
        />
      }
    />
  )
}

function useAuthorChrome(authors: string[]) {
  const { viewer } = useViewer()
  const [profiles, setProfiles] = useState<
    Record<string, StatementAuthorDisplay>
  >({})
  const [scores, setScores] = useState<Record<string, TrustQueryResult>>({})
  const authorKeySig = authors.join('\0')
  const chromeKeySig = viewerScopedKey(authorKeySig, viewer?.pubkey)

  useEffect(() => {
    let cancelled = false
    const keys = authorKeySig.length === 0 ? [] : authorKeySig.split('\0')
    if (keys.length === 0) {
      setProfiles({})
      setScores({})
      return
    }
    void loadXAuthorDisplays(keys)
      .then(async (next) => {
        const trustScores = await loadAuthorTrustScores(next)
        return { profiles: next, scores: trustScores }
      })
      .then((next) => {
        if (cancelled) return
        setProfiles(next.profiles)
        setScores(next.scores)
      })
      .catch(() => {
        if (cancelled) return
        setProfiles({})
        setScores({})
      })
    return () => {
      cancelled = true
    }
  }, [authorKeySig, chromeKeySig])

  return { profiles, scores }
}

function focusUser(twitterId: string): void {
  void axRequest({
    type: 'SELECT_SUBJECT',
    version: BACKGROUND_API_VERSION,
    subject: { type: 'i', value: `user:id:${twitterId}` },
  }).catch(() => undefined)
}

function PolarityFilterLinks({
  polarity,
  counts,
  onSelect,
  onReset,
}: {
  polarity: StatementPolarity | null
  counts: PolarityCounts
  onSelect: (next: StatementPolarity | null) => void
  onReset: () => void
}) {
  return (
    <div
      className={styles.quickLinks}
      role="group"
      aria-label={t('panel.statementScan.filterLinks')}
    >
      <span className={styles.filterOn}>
        {t('panel.statementScan.filterOn')}
      </span>
      {POLARITY_OPTIONS.map((option) => {
        const count = counts[option]
        const compact = formatCompactCount(count)
        const exact = String(count)
        const selected = polarity === option
        return (
          <button
            key={option}
            type="button"
            className={
              selected
                ? `${styles.quickLink} ${styles.quickLinkActive}`
                : styles.quickLink
            }
            aria-pressed={selected}
            disabled={count === 0}
            title={count > 0 && compact !== exact ? exact : undefined}
            onClick={() => onSelect(selected ? null : option)}
          >
            {formatPolarityChipLabel(option, count)}
          </button>
        )
      })}
      <button
        type="button"
        className={`${styles.quickLink} ${styles.quickLinkReset}`}
        onClick={onReset}
      >
        {t('panel.statementScan.reset')}
      </button>
    </div>
  )
}

function LoadMoreControl({
  loaded,
  total,
  onLoadMore,
}: {
  loaded: number
  total: number
  onLoadMore: () => void
}) {
  const next = nextLoadCount(loaded, total)
  if (next <= 0) return null
  return (
    <Button
      small
      variant="secondary"
      className={styles.loadMore}
      onClick={onLoadMore}
    >
      {formatLoadMoreLabel(next, total)}
    </Button>
  )
}

function StatementRowSkeleton() {
  return (
    <li className={styles.item} aria-hidden="true">
      <div className={styles.userBlock}>
        <div className={styles.row}>
          <div className={`${styles.photo} ${styles.skeletonPhoto}`} />
          <div className={styles.body}>
            <div className={styles.itemTop}>
              <span className={styles.skeletonLine} />
            </div>
            <span className={styles.skeletonPolarity} />
          </div>
        </div>
      </div>
    </li>
  )
}

function UserStatementScan({ trust }: { trust: TrustQueryResult }) {
  const { viewer } = useViewer()
  const [direction, setDirection] = useState<StatementDirection>('in')
  const [incoming, setIncoming] = useState<ResolvedStatement[]>([])
  const [incomingLoaded, setIncomingLoaded] = useState(false)
  const [outgoing, setOutgoing] = useState<ResolvedStatement[]>([])
  const [outgoingLoaded, setOutgoingLoaded] = useState(true)
  const outgoingMode = direction === 'out'
  const statementsReady = outgoingMode ? outgoingLoaded : incomingLoaded
  const statements = outgoingMode ? outgoing : incoming
  const authors = useMemo(
    () => uniqueStatementAuthors(statements),
    [statements],
  )
  const outgoingIds = useMemo(
    () => uniqueOutgoingTwitterIds(statements),
    [statements],
  )
  const statementByTarget = useMemo(() => {
    const map = new Map<string, ResolvedStatement>()
    for (const statement of statements) {
      const twitterId = outgoingTargetTwitterId(statement)
      if (!twitterId || map.has(twitterId)) continue
      map.set(twitterId, statement)
    }
    return map
  }, [statements])
  const chromeKeys = outgoingMode ? outgoingIds : authors
  const chromeKeySig = chromeKeys.join('\0')
  const chromeSig = viewerScopedKey(
    `${outgoingMode ? 'out' : 'in'}\0${chromeKeySig}`,
    viewer?.pubkey,
  )
  const [profiles, setProfiles] = useState<
    Record<string, StatementAuthorDisplay>
  >({})
  const [scores, setScores] = useState<Record<string, TrustQueryResult>>({})
  const [readyChromeSig, setReadyChromeSig] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [polarity, setPolarity] = useState<StatementPolarity | null>(null)
  const { loaded, loadMore } = usePagedWindow(
    `${trust.subject.type}:${trust.subject.value}:${direction}:${filter}:${polarity ?? ''}`,
  )
  const chromeReady = readyChromeSig === chromeSig

  useEffect(() => {
    if (outgoingMode) {
      setIncoming([])
      setIncomingLoaded(true)
      return
    }
    setIncoming([])
    setIncomingLoaded(false)
    let cancelled = false
    void axRequest<QueryIncomingTrustResult>({
      type: 'QUERY_INCOMING_TRUST',
      version: BACKGROUND_API_VERSION,
      subject: trust.subject,
    })
      .then((result) => {
        if (cancelled) return
        setIncoming(result.statements)
        setIncomingLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setIncoming([])
        setIncomingLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [outgoingMode, trust.subject])

  useEffect(() => {
    if (!outgoingMode) {
      setOutgoing([])
      setOutgoingLoaded(true)
      return
    }
    setOutgoing([])
    setOutgoingLoaded(false)
    let cancelled = false
    void axRequest<QueryOutgoingTrustResult>({
      type: 'QUERY_OUTGOING_TRUST',
      version: BACKGROUND_API_VERSION,
      subject: trust.subject,
    })
      .then((result) => {
        if (cancelled) return
        setOutgoing(result.statements)
        setOutgoingLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setOutgoing([])
        setOutgoingLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [outgoingMode, trust.subject])

  useEffect(() => {
    if (!statementsReady) return
    let cancelled = false
    const keys = chromeKeySig.length === 0 ? [] : chromeKeySig.split('\0')
    if (keys.length === 0) {
      setProfiles({})
      setScores({})
      setReadyChromeSig(chromeSig)
      return
    }
    const load = outgoingMode
      ? loadXTargetDisplays(keys).then(async (next) => {
          const trustScores = await loadAuthorTrustScores(next)
          return { profiles: next, scores: trustScores }
        })
      : loadXAuthorDisplays(keys).then(async (next) => {
          const trustScores = await loadAuthorTrustScores(next)
          return { profiles: next, scores: trustScores }
        })
    void load
      .then((next) => {
        if (cancelled) return
        setProfiles(next.profiles)
        setScores(next.scores)
        setReadyChromeSig(chromeSig)
      })
      .catch(() => {
        if (cancelled) return
        setProfiles({})
        setScores({})
        setReadyChromeSig(chromeSig)
      })
    return () => {
      cancelled = true
    }
  }, [chromeKeySig, chromeSig, outgoingMode, statementsReady])

  const namedIncoming = useMemo(() => {
    if (outgoingMode) return [] as ResolvedStatement[]
    return sortIncomingStatements(statements, profiles).filter((statement) =>
      matchesAuthorFilter(
        statement.author,
        lookupProfile(profiles, statement.author),
        filter,
      ),
    )
  }, [filter, outgoingMode, profiles, statements])

  const namedKeys = useMemo(() => {
    if (!outgoingMode) return [] as string[]
    return sortAuthorsByName(outgoingIds, profiles).filter((key) => {
      const statement = statementByTarget.get(key)
      if (!statement) return false
      return matchesAuthorFilter(key, lookupProfile(profiles, key), filter)
    })
  }, [filter, outgoingIds, outgoingMode, profiles, statementByTarget])

  const counts = useMemo(() => {
    if (!outgoingMode) {
      return polarityCounts(namedIncoming.map((row) => row.value))
    }
    const values: ActiveTrustValue[] = []
    for (const key of namedKeys) {
      const statement = statementByTarget.get(key)
      if (statement) values.push(statement.value)
    }
    return polarityCounts(values)
  }, [namedIncoming, namedKeys, outgoingMode, statementByTarget])

  useEffect(() => {
    if (polarity !== null && counts[polarity] === 0) setPolarity(null)
  }, [counts, polarity])

  const matchedIncoming = useMemo(() => {
    return namedIncoming.filter((statement) =>
      matchesPolarityFilter(statement.value, polarity),
    )
  }, [namedIncoming, polarity])

  const matchedKeys = useMemo(() => {
    if (!outgoingMode) return [] as string[]
    return namedKeys.filter((key) => {
      const statement = statementByTarget.get(key)
      if (!statement) return false
      return matchesPolarityFilter(statement.value, polarity)
    })
  }, [namedKeys, outgoingMode, polarity, statementByTarget])

  const visibleIncoming = windowedItems(matchedIncoming, loaded)
  const visibleKeys = windowedItems(matchedKeys, loaded)
  const listPhase = statementScanListPhase({
    statementsReady,
    chromeReady,
    statementCount: statements.length,
    visibleCount: outgoingMode ? visibleKeys.length : visibleIncoming.length,
  })
  const skeletonCount = Math.min(
    8,
    Math.max(1, windowedItems(chromeKeys, loaded).length || 6),
  )

  return (
    <section className={styles.root} aria-labelledby="statement-scan-title">
      <div
        className={styles.directionRow}
        role="group"
        aria-label={t('panel.statementScan.direction')}
      >
        <Button
          small
          variant="secondary"
          className={
            direction === 'in'
              ? `${styles.directionBtn} ${styles.directionPressed}`
              : styles.directionBtn
          }
          aria-pressed={direction === 'in'}
          onClick={() => setDirection('in')}
        >
          <IconUsers size={16} aria-hidden="true" />
          {t('panel.statementScan.trustedBy')}
        </Button>
        <Button
          small
          variant="secondary"
          className={
            direction === 'out'
              ? `${styles.directionBtn} ${styles.directionPressed}`
              : styles.directionBtn
          }
          aria-pressed={direction === 'out'}
          onClick={() => {
            setOutgoingLoaded(false)
            setDirection('out')
          }}
        >
          <IconUser size={16} aria-hidden="true" />
          {t('panel.statementScan.trusts')}
        </Button>
      </div>
      <input
        className={styles.filter}
        type="search"
        value={filter}
        placeholder={t('panel.statementScan.filterPlaceholder')}
        aria-label={t('panel.statementScan.filterPlaceholder')}
        autoComplete="off"
        onChange={(event) => setFilter(event.target.value)}
      />
      <PolarityFilterLinks
        polarity={polarity}
        counts={counts}
        onSelect={setPolarity}
        onReset={() => {
          setFilter('')
          setPolarity(null)
        }}
      />
      <p id="statement-scan-title" className={styles.title}>
        {t('panel.statementScan.title')}
      </p>
      {listPhase === 'pending' ? (
        <ul className={styles.list} aria-busy="true">
          {Array.from({ length: skeletonCount }, (_, index) => (
            <StatementRowSkeleton key={`pending:${index}`} />
          ))}
        </ul>
      ) : listPhase === 'empty' || listPhase === 'emptyFilter' ? (
        <p className={styles.empty} role="status">
          {listPhase === 'empty'
            ? outgoingMode
              ? t('panel.statementScan.emptyOutgoing')
              : t('panel.statementScan.empty')
            : t('panel.statementScan.emptyFilter')}
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {outgoingMode
              ? visibleKeys.map((key) => {
                  const statement = statementByTarget.get(key)
                  if (!statement) return null
                  const profile = lookupProfile(profiles, key)
                  const percent = formatGreenTrustPercent(scores[key])
                  return (
                    <UserStatementRow
                      key={`${statement.connectionKey ?? statement.eventId}:${key}`}
                      statement={statement}
                      profile={{
                        ...profile,
                        twitterId: profile?.twitterId ?? key,
                      }}
                      percent={percent}
                      chromeKey={key}
                      onFocus={focusUser}
                    />
                  )
                })
              : visibleIncoming.map((statement) => {
                  const profile = lookupProfile(profiles, statement.author)
                  const percent = profile?.twitterId
                    ? formatGreenTrustPercent(scores[profile.twitterId])
                    : undefined
                  return (
                    <UserStatementRow
                      key={incomingStatementRowId(statement)}
                      statement={statement}
                      profile={profile}
                      percent={percent}
                      chromeKey={statement.author}
                      onFocus={focusUser}
                    />
                  )
                })}
          </ul>
          <LoadMoreControl
            loaded={loaded}
            total={
              outgoingMode ? matchedKeys.length : matchedIncoming.length
            }
            onLoadMore={loadMore}
          />
        </>
      )}
    </section>
  )
}

function RatingStatementScan({ rating }: { rating: RatingQueryResult }) {
  const [filter, setFilter] = useState('')
  const [starFilter, setStarFilter] = useState<HistogramStar | null>(null)
  const claims = rating.claims
  const authors = useMemo(() => uniqueStatementAuthors(claims), [claims])
  const { profiles, scores } = useAuthorChrome(authors)
  const { loaded, loadMore } = usePagedWindow(`${filter}:${starFilter ?? ''}`)
  const claimByAuthor = useMemo(() => {
    const map = new Map<string, RatingClaimEvidence>()
    for (const claim of claims) {
      const key = claim.author.toLowerCase()
      if (!map.has(key)) map.set(key, claim)
    }
    return map
  }, [claims])

  const visibleAuthors = useMemo(() => {
    return sortAuthorsByName(authors, profiles).filter((author) => {
      const claim = claimByAuthor.get(author.toLowerCase())
      if (!claim) return false
      if (!matchesStarFilter(claim.score, starFilter)) return false
      return matchesAuthorFilter(author, lookupProfile(profiles, author), filter)
    })
  }, [authors, claimByAuthor, filter, profiles, starFilter])

  const windowedAuthors = windowedItems(visibleAuthors, loaded)
  const noClaims = claims.length === 0
  const empty = windowedAuthors.length === 0

  return (
    <section className={styles.root} aria-labelledby="statement-scan-title">
      <RatingHistogram
        rating={rating}
        selectedStars={starFilter}
        onSelectStars={setStarFilter}
      />
      <input
        className={styles.filter}
        type="search"
        value={filter}
        placeholder={t('panel.statementScan.filterPlaceholder')}
        aria-label={t('panel.statementScan.filterPlaceholder')}
        autoComplete="off"
        onChange={(event) => setFilter(event.target.value)}
      />
      <p id="statement-scan-title" className={styles.title}>
        {t('panel.statementScan.title')}
      </p>
      {empty ? (
        <p className={styles.empty} role="status">
          {noClaims
            ? t('panel.statementScan.emptyRatings')
            : t('panel.statementScan.emptyFilter')}
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {windowedAuthors.map((author) => {
              const claim = claimByAuthor.get(author.toLowerCase())
              if (!claim) return null
              const profile = lookupProfile(profiles, author)
              const percent = profile?.twitterId
                ? formatGreenTrustPercent(scores[profile.twitterId])
                : undefined
              return (
                <RatingStatementRow
                  key={`${claim.eventId}:${author}`}
                  claim={claim}
                  profile={profile}
                  percent={percent}
                  onFocus={focusUser}
                />
              )
            })}
          </ul>
          <LoadMoreControl
            loaded={loaded}
            total={visibleAuthors.length}
            onLoadMore={loadMore}
          />
        </>
      )}
    </section>
  )
}

export default function StatementScan(props: StatementScanProps) {
  switch (props.variant) {
    case 'users':
      return <UserStatementScan trust={props.trust} />
    case 'ratings':
      return <RatingStatementScan rating={props.rating} />
    default: {
      const _exhaustive: never = props
      return _exhaustive
    }
  }
}
