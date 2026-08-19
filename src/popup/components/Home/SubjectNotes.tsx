import { useCallback, useEffect, useState } from 'react'
import browser from '@shared/browser.ts'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
  type XIdentitiesState,
} from '../../../shared/contracts'
import type { RatingQueryResult, TrustQueryResult } from '../../../graph'
import { isArtifactSubject, isIdentitySubject } from '../../../graph'
import { parseXProfileHandle, parseXStatusPostId } from '../../../shared/x-status-url'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  type SelectedSubject,
} from '../../../shared/selected-subject'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../../shared/demo-wot'
import { buildGraphPageUrl, subjectNodeId } from '../../../shared/graph-deeplink'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import Card from '@components/Card/Card'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import Button from '@components/Button/Button'
import { IconTrash } from '@assets'
import styles from './SubjectNotes.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function shortPubkey(pubkey: string): string {
  if (pubkey.length < 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`
}

function statementValueHint(value: 1 | 0 | -1): string {
  switch (value) {
    case 1:
      return t('content.card.trustHint')
    case -1:
      return t('content.card.distrustHint')
    case 0:
      return t('content.card.neutralHint')
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

function statementValueLabel(value: 1 | 0 | -1): string {
  switch (value) {
    case 1:
      return t('panel.notesValueTrust')
    case -1:
      return t('panel.notesValueDistrust')
    case 0:
      return t('panel.notesValueNeutral')
    default: {
      const _exhaustive: never = value
      return _exhaustive
    }
  }
}

function resolutionLabel(resolution: TrustQueryResult['resolution']): string {
  switch (resolution) {
    case 'trusted':
      return t('panel.notesTrusted')
    case 'distrusted':
      return t('panel.notesDistrusted')
    case 'mixed':
      return t('panel.notesMixed')
    case 'none':
      return t('panel.notesNone')
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

function subjectSummary(subject: SerializableTrustSubject): string {
  return `${subject.type}:${subject.value}`
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

export default function SubjectNotes() {
  const { tabUrl } = useSiteConnection()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState<SerializableTrustSubject | null>(null)
  const [trust, setTrust] = useState<TrustQueryResult | null>(null)
  const [rating, setRating] = useState<RatingQueryResult | null>(null)

  const resolveSubject = useCallback(async (): Promise<SerializableTrustSubject | null> => {
    const selected = await axRequest<SelectedSubject | null>({
      type: 'GET_SELECTED_SUBJECT',
      version: BACKGROUND_API_VERSION,
    })
    if (selected?.subject) return selected.subject

    if (!tabUrl) return null
    const postId = parseXStatusPostId(tabUrl)
    if (postId) return { type: 'i', value: `post:id:${postId}` }

    const handle = parseXProfileHandle(tabUrl)
    if (!handle) return null
    const identities = await axRequest<XIdentitiesState>({
      type: 'GET_X_IDENTITIES',
      version: BACKGROUND_API_VERSION,
      query: handle,
      limit: 20,
    })
    const match = identities.identities.find(
      (row) => row.handle.toLowerCase() === handle.toLowerCase(),
    )
    return match ? { type: 'i', value: `user:id:${match.twitterId}` } : null
  }, [tabUrl])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await resolveSubject()
      setSubject(next)
      if (!next) {
        setTrust(null)
        setRating(null)
        return
      }
      if (isArtifactSubject(next)) {
        const [trustResult, ratingResult] = await Promise.all([
          axRequest<TrustQueryResult>({
            type: 'QUERY_TRUST',
            version: BACKGROUND_API_VERSION,
            subject: next,
            format: 'path',
          }),
          axRequest<RatingQueryResult>({
            type: 'QUERY_RATING',
            version: BACKGROUND_API_VERSION,
            subject: next,
          }),
        ])
        setTrust(trustResult)
        setRating(ratingResult)
        return
      }

      setRating(null)
      setTrust(
        await axRequest<TrustQueryResult>({
          type: 'QUERY_TRUST',
          version: BACKGROUND_API_VERSION,
          subject: next,
          format: 'path',
        }),
      )
    } catch (err: unknown) {
      setTrust(null)
      setRating(null)
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [resolveSubject])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onMessage = (message: { type?: string }) => {
      if (
        message?.type === SELECTED_SUBJECT_CHANGED_MESSAGE ||
        message?.type === TRUST_GRAPH_UPDATED_MESSAGE
      ) {
        void load()
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [load])

  const deleteOwn = useCallback(
    async (context: string): Promise<void> => {
      if (!subject) return
      setError(null)
      try {
        await axRequest({
          type: 'CANCEL_TRUST_STATEMENT',
          version: BACKGROUND_API_VERSION,
          subject,
          context,
        })
        await load()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t('common.error'))
      }
    },
    [load, subject],
  )

  const openGraph = (): void => {
    if (!subject || !isIdentitySubject(subject)) return
    const url =
      buildGraphPageUrl({
        mode: 'path',
        subject,
        focus: subjectNodeId(subject),
        baseUrl: browser.runtime.getURL('src/cockpit/index.html'),
      }) || '?'
    void chrome.runtime.sendMessage({
      type: 'OPEN_GRAPH_PAGE',
      version: BACKGROUND_API_VERSION,
      url,
    })
  }

  if (!subject) {
    return (
      <Card>
        <SectionLabel>{t('panel.notesTitle')}</SectionLabel>
        <SectionHint>{t('panel.notesNeedSubject')}</SectionHint>
      </Card>
    )
  }

  return (
    <div className={styles.root}>
      <Card>
        <div className={styles.headerRow}>
          <div>
            <SectionLabel>
              {isArtifactSubject(subject)
                ? t('panel.notesRatingTitle')
                : t('panel.notesTitle')}
            </SectionLabel>
            <SectionHint>
              {t('panel.notesSubject', { id: subjectSummary(subject) })}
            </SectionHint>
          </div>
          <Button small variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? t('panel.notesLoading') : t('panel.notesRefresh')}
          </Button>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {loading && !trust && !rating ? (
          <p className={styles.muted}>{t('panel.notesLoading')}</p>
        ) : null}

        {trust ? (
          <>
            <p className={styles.verdict} role="status">
              {resolutionLabel(trust.resolution)}
              {trust.truncated ? ` · ${t('panel.notesTruncated')}` : ''}
            </p>
            <SectionHint>
              {t('panel.notesCounts', {
                trust: String(trust.trust),
                distrust: String(trust.distrust),
                degree: String(trust.degree),
              })}
            </SectionHint>

            {trust.statements.length === 0 ? (
              <p className={styles.muted}>{t('panel.notesEmptyEvidence')}</p>
            ) : (
              <ul className={styles.list}>
                {trust.statements.map((stmt) => {
                  const own =
                    trust.direct !== undefined &&
                    stmt.author.toLowerCase() === trust.direct.author.toLowerCase() &&
                    stmt.eventId === trust.direct.eventId
                  return (
                  <li key={`${stmt.eventId}:${stmt.author}`} className={styles.item}>
                    <div className={styles.itemTop}>
                      <span
                        className={styles.value}
                        title={statementValueHint(stmt.value)}
                      >
                        {statementValueLabel(stmt.value)}
                      </span>
                      <div className={styles.itemTopRight}>
                        <span className={styles.meta}>
                          {t('panel.notesHop', { n: String(stmt.distance) })}
                        </span>
                        {own ? (
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => void deleteOwn(stmt.context)}
                            title={t('panel.notesDelete')}
                            aria-label={t('panel.notesDelete')}
                          >
                            <IconTrash size={15} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.author}>{shortPubkey(stmt.author)}</div>
                    {stmt.context ? (
                      <div className={styles.meta}>
                        {t('panel.notesContext', { context: stmt.context })}
                      </div>
                    ) : null}
                    <LabelTokens
                      labels={stmt.labels}
                      hints={stmt.labelHints}
                    />
                    {stmt.content ? (
                      <div className={styles.meta}>{stmt.content}</div>
                    ) : null}
                  </li>
                  )
                })}
              </ul>
            )}

            {trust.paths.length > 0 ? (
              <div className={styles.paths}>
                <SectionLabel>{t('panel.notesPaths')}</SectionLabel>
                <ul className={styles.list}>
                  {trust.paths.slice(0, 8).map((path, index) => (
                    <li key={`${path.sourceEventIds.join('-')}-${index}`} className={styles.pathItem}>
                      {path.authors.map(shortPubkey).join(' → ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className={styles.paths}>
              <Button small variant="secondary" onClick={openGraph}>
                {t('panel.notesOpenGraph')}
              </Button>
            </div>
          </>
        ) : null}

        {rating ? (
          <>
            <p className={styles.verdict} role="status">
              {rating.averageScore === null
                ? t('panel.notesRatingNone')
                : t('panel.notesRatingAverage', {
                    score: String(Math.round(rating.averageScore)),
                    count: String(rating.claimCount),
                  })}
            </p>
            {rating.claims.length === 0 ? (
              <p className={styles.muted}>{t('panel.notesRatingEmpty')}</p>
            ) : (
              <ul className={styles.list}>
                {rating.claims.map((claim) => (
                  <li key={`${claim.eventId}:${claim.author}`} className={styles.item}>
                    <div className={styles.itemTop}>
                      <span className={styles.value}>
                        {t('panel.notesRatingScore', {
                          score: String(Math.round(claim.score)),
                        })}
                      </span>
                      <span className={styles.meta}>
                        {t('panel.notesHop', { n: String(claim.distance) })}
                      </span>
                    </div>
                    <div className={styles.author}>{shortPubkey(claim.author)}</div>
                    <LabelTokens
                      labels={claim.labels}
                      hints={claim.labelHints}
                    />
                    {claim.content ? (
                      <div className={styles.meta}>{claim.content}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </Card>
    </div>
  )
}
