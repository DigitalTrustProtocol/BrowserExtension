import { useCallback, useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
  type XIdentitiesState,
} from '../../../shared/contracts'
import type { RatingQueryResult, TrustQueryResult } from '../../../graph'
import { isArtifactSubject } from '../../../graph'
import { parseXProfileHandle, parseXStatusPostId } from '../../../shared/x-status-url'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  type SelectedSubjectSnapshot,
} from '../../../shared/selected-subject'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../../shared/demo-wot'
import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import Card from '@components/Card/Card'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import CurationActions from './CurationActions'
import StatementScan from './StatementScan'
import SubjectHeader, { SubjectHistory } from './SubjectHeader'
import SubjectRatings from './SubjectRatings'
import TrustGiven from './TrustGiven'
import headerStyles from './SubjectHeader.module.css'
import styles from './SubjectNotes.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export default function SubjectNotes() {
  const { tabUrl } = useSiteConnection()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState<SerializableTrustSubject | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [trust, setTrust] = useState<TrustQueryResult | null>(null)
  const [rating, setRating] = useState<RatingQueryResult | null>(null)

  const resolveSubject = useCallback(async (): Promise<SerializableTrustSubject | null> => {
    const snapshot = await axRequest<SelectedSubjectSnapshot>({
      type: 'GET_SELECTED_SUBJECT',
      version: BACKGROUND_API_VERSION,
    })
    setCanGoBack(snapshot.canBack)
    setCanGoForward(snapshot.canForward)
    if (snapshot.selected?.subject) return snapshot.selected.subject

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

  const goHistory = (direction: 'back' | 'forward'): void => {
    void axRequest<SelectedSubjectSnapshot>({
      type: 'SELECT_SUBJECT_HISTORY',
      version: BACKGROUND_API_VERSION,
      direction,
    }).catch(() => undefined)
  }

  if (!subject) {
    return (
      <div className={styles.empty}>
        <Card>
          <SectionLabel>{t('panel.notesTitle')}</SectionLabel>
          <SectionHint>{t('panel.notesNeedSubject')}</SectionHint>
        </Card>
      </div>
    )
  }

  const isAccount =
    parseCanonicalTwitterSubject(subject.value)?.type === 'account'

  return (
    <div className={styles.root}>
      <SubjectHeader
        subject={subject}
        trust={trust}
        showHistory={!isAccount}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={() => goHistory('back')}
        onGoForward={() => goHistory('forward')}
      />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading && !trust ? (
        <p className={styles.muted}>{t('panel.notesLoading')}</p>
      ) : null}
      {!isAccount && trust ? <TrustGiven trust={trust} /> : null}
      <CurationActions
        subject={subject}
        trust={trust}
        history={
          isAccount ? (
            <SubjectHistory
              canGoBack={canGoBack}
              canGoForward={canGoForward}
              onGoBack={() => goHistory('back')}
              onGoForward={() => goHistory('forward')}
              className={headerStyles.historyRow}
            />
          ) : undefined
        }
        onChanged={() => void load()}
      />
      <SubjectRatings
        rating={rating}
        visible={isArtifactSubject(subject)}
      />
      {trust ? (
        <StatementScan trust={trust} variant={isAccount ? 'users' : 'reviews'} />
      ) : null}
    </div>
  )
}
