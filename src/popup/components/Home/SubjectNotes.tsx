import { useCallback, useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
} from '../../../shared/contracts'
import type { TrustQueryResult } from '../../../graph'
import { parseXStatusPostId } from '../../../shared/x-status-url'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import Card from '@components/Card/Card'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import Button from '@components/Button/Button'
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

export default function SubjectNotes() {
  const { tabUrl } = useSiteConnection()
  const postId = tabUrl ? parseXStatusPostId(tabUrl) : null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TrustQueryResult | null>(null)

  const load = useCallback(async () => {
    if (!postId) {
      setResult(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const subject: SerializableTrustSubject = {
        type: 'i',
        value: `post:id:${postId}`,
      }
      const data = await axRequest<TrustQueryResult>({
        type: 'QUERY_TRUST',
        version: BACKGROUND_API_VERSION,
        subject,
        format: 'path',
      })
      setResult(data)
    } catch (err: unknown) {
      setResult(null)
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    void load()
  }, [load])

  if (!postId) {
    return (
      <Card>
        <SectionLabel>{t('panel.notesTitle')}</SectionLabel>
        <SectionHint>{t('panel.notesNeedPost')}</SectionHint>
      </Card>
    )
  }

  return (
    <div className={styles.root}>
      <Card>
        <div className={styles.headerRow}>
          <div>
            <SectionLabel>{t('panel.notesTitle')}</SectionLabel>
            <SectionHint>
              {t('panel.notesSubject', { id: postId })}
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

        {loading && !result ? (
          <p className={styles.muted}>{t('panel.notesLoading')}</p>
        ) : null}

        {result ? (
          <>
            <p className={styles.verdict} role="status">
              {resolutionLabel(result.resolution)}
              {result.truncated ? ` · ${t('panel.notesTruncated')}` : ''}
            </p>
            <SectionHint>
              {t('panel.notesCounts', {
                trust: String(result.trust),
                distrust: String(result.distrust),
                degree: String(result.degree),
              })}
            </SectionHint>

            {result.statements.length === 0 ? (
              <p className={styles.muted}>{t('panel.notesEmptyEvidence')}</p>
            ) : (
              <ul className={styles.list}>
                {result.statements.map((stmt) => (
                  <li key={`${stmt.eventId}:${stmt.author}`} className={styles.item}>
                    <div className={styles.itemTop}>
                      <span className={styles.value}>
                        {stmt.value === 1
                          ? t('panel.notesValueTrust')
                          : t('panel.notesValueDistrust')}
                      </span>
                      <span className={styles.meta}>
                        {t('panel.notesHop', { n: String(stmt.distance) })}
                      </span>
                    </div>
                    <div className={styles.author}>{shortPubkey(stmt.author)}</div>
                    {stmt.context ? (
                      <div className={styles.meta}>
                        {t('panel.notesContext', { context: stmt.context })}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {result.paths.length > 0 ? (
              <div className={styles.paths}>
                <SectionLabel>{t('panel.notesPaths')}</SectionLabel>
                <ul className={styles.list}>
                  {result.paths.slice(0, 8).map((path, index) => (
                    <li key={`${path.sourceEventIds.join('-')}-${index}`} className={styles.pathItem}>
                      {path.authors.map(shortPubkey).join(' → ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </Card>
    </div>
  )
}
