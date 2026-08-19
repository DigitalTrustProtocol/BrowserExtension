import { useEffect, useMemo, useState } from 'react'
import { t } from '@lib/i18n.js'
import { rpc } from '@shared/rpc.ts'
import { getInitial, truncateNpub } from '@shared/format/text.ts'
import { safeImageUrl } from '@shared/safeUrl.js'
import Avatar from '@components/Avatar/Avatar'
import {
  isArtifactSubject,
  type ActiveTrustValue,
  type ResolvedStatement,
  type TrustQueryResult,
  type TrustSubject,
} from '../../../graph'
import styles from './StatementScan.module.css'

const LONG_LIST_MIN = 8
const PROFILE_BATCH = 12

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string

export type StatementPolarity = 'trust' | 'neutral' | 'distrust'

export interface StatementAuthorDisplay {
  name?: string
  picture?: string
}

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

export function formatPathHint(
  count: number,
  translate: Translate = t,
): string | null {
  if (count <= 0) return null
  if (count === 1) return translate('panel.statementScan.pathOne')
  return translate('panel.statementScan.pathMany', { count })
}

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

export type ReviewSnippetStatement = Pick<
  ResolvedStatement,
  'content' | 'labels' | 'labelHints'
>

/**
 * Maps-style review body: a truncated quote of the author’s words.
 * Precedence: non-empty kind 32009 `content`, else `l` / labelHints prose.
 * No polarity templates, WoT dictionary hints, or invented first-person copy.
 */
export function reviewSnippet(
  statement: ReviewSnippetStatement,
): string | null {
  const content = statement.content?.trim()
  if (content !== undefined && content.length > 0) return content
  return labelProse(statement.labels, statement.labelHints)
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

function lookupProfile(
  profiles: Record<string, StatementAuthorDisplay>,
  pubkey: string,
): StatementAuthorDisplay | undefined {
  return profiles[pubkey] ?? profiles[pubkey.toLowerCase()]
}

async function loadAuthorDisplays(
  pubkeys: string[],
): Promise<Record<string, StatementAuthorDisplay>> {
  const profiles: Record<string, StatementAuthorDisplay> = {}
  for (let i = 0; i < pubkeys.length; i += PROFILE_BATCH) {
    const batch = pubkeys.slice(i, i + PROFILE_BATCH)
    const metadata = await rpc<
      Record<string, Record<string, unknown> | null>
    >('getProfileMetadataBatch', { pubkeys: batch })
    for (const [pubkey, profile] of Object.entries(metadata ?? {})) {
      const display = profileDisplayFromMetadata(profile)
      if (!display) continue
      profiles[pubkey] = display
      profiles[pubkey.toLowerCase()] = display
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

function StatementRow({
  statement,
  own,
  profile,
}: {
  statement: ResolvedStatement
  own: boolean
  profile: StatementAuthorDisplay | undefined
}) {
  const title = authorTitle(statement.author, profile?.name)
  const snippet = reviewSnippet(statement)

  return (
    <li className={styles.item}>
      <div className={styles.row}>
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
              title={profile?.name?.trim() ? title : statement.author}
            >
              {title}
            </span>
            <span
              className={`${styles.polarity} ${polarityClass(statement.value)}`}
              title={t(polarityHintKey(statement.value))}
            >
              {formatPolarityLabel(statement.value)}
            </span>
          </div>
          {own ? (
            <div className={styles.meta}>
              <span className={styles.ownBadge}>{t('panel.statementScan.own')}</span>
            </div>
          ) : null}
          <LabelTokens labels={statement.labels} hints={statement.labelHints} />
          {snippet ? (
            <p className={styles.snippet} title={snippet}>
              {snippet}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export default function StatementScan(props: {
  trust: TrustQueryResult
}) {
  const { trust } = props
  const statements = trust.statements
  const authors = useMemo(
    () => uniqueStatementAuthors(statements),
    [statements],
  )
  const [profiles, setProfiles] = useState<
    Record<string, StatementAuthorDisplay>
  >({})

  useEffect(() => {
    let cancelled = false
    if (authors.length === 0) {
      setProfiles({})
      return
    }
    void loadAuthorDisplays(authors)
      .then((next) => {
        if (!cancelled) setProfiles(next)
      })
      .catch(() => {
        if (!cancelled) setProfiles({})
      })
    return () => {
      cancelled = true
    }
  }, [authors])

  const longList = statements.length >= LONG_LIST_MIN
  const pathHint = formatPathHint(trust.paths.length)
  const empty = statements.length === 0

  return (
    <section className={styles.root} aria-labelledby="statement-scan-title">
      <p id="statement-scan-title" className={styles.title}>
        {t('panel.statementScan.title')}
      </p>
      {empty ? (
        <p className={styles.empty} role="status">
          {t('panel.statementScan.empty')}
        </p>
      ) : (
        <ul className={longList ? styles.listLong : styles.list}>
          {statements.map((statement) => (
            <StatementRow
              key={`${statement.eventId}:${statement.author}`}
              statement={statement}
              own={isOwnStatement(statement, trust.direct)}
              profile={lookupProfile(profiles, statement.author)}
            />
          ))}
        </ul>
      )}
      {pathHint ? <p className={styles.paths}>{pathHint}</p> : null}
    </section>
  )
}
