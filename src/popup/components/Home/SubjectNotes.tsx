import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
  type XIdentitiesState,
  type XIdentityDisplay,
} from '../../../shared/contracts'
import type { RatingQueryResult, TrustQueryResult } from '../../../graph'
import { parseXProfileHandle, parseXStatusPostId } from '../../../shared/x-status-url'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  type SelectedSubjectSnapshot,
} from '../../../shared/selected-subject'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../../../shared/demo-wot'
import { parseCanonicalTwitterSubject, xAccountTrustSubject } from '../../../shared/x-identity'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import Card from '@components/Card/Card'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import CurationActions from './CurationActions'
import StatementScan from './StatementScan'
import SubjectHeader from './SubjectHeader'
import styles from './SubjectNotes.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export type NotesPanelKind = 'user' | 'post'

/**
 * Notes has two entity panels. `e:` and unknown `i` values are not a third
 * chrome — they fall through to the empty “need a subject” state.
 */
export function notesPanelKind(
  subject: SerializableTrustSubject,
): NotesPanelKind | null {
  switch (subject.type) {
    case 'p':
      return 'user'
    case 'e':
      return null
    case 'i': {
      const parsed = parseCanonicalTwitterSubject(subject.value)
      if (parsed?.type === 'account') return 'user'
      if (parsed?.type === 'post') return 'post'
      return null
    }
    default: {
      const _exhaustive: never = subject
      return _exhaustive
    }
  }
}

/** User Notes chrome: X `user:id` or a Graph pubkey person. */
export function isUserPanelSubject(
  subject: SerializableTrustSubject,
): boolean {
  return notesPanelKind(subject) === 'user'
}

/**
 * Keep the current User/Post panel when the snapshot is briefly empty
 * (home timeline after retracting a rating). The post is still selected on X.
 */
export function keepNotesSubject(
  next: SerializableTrustSubject | null,
  current: SerializableTrustSubject | null,
): SerializableTrustSubject | null {
  if (next && notesPanelKind(next)) return next
  if (current && notesPanelKind(current)) return current
  return null
}

async function preferXAccountSubject(
  subject: SerializableTrustSubject,
): Promise<SerializableTrustSubject> {
  if (parseCanonicalTwitterSubject(subject.value)?.type === 'account') {
    return subject
  }
  if (subject.type !== 'p') return subject
  try {
    const displays = await axRequest<Record<string, XIdentityDisplay>>({
      type: 'GET_X_IDENTITY_DISPLAYS_FOR_PUBKEYS',
      version: BACKGROUND_API_VERSION,
      pubkeys: [subject.value],
    })
    const display =
      displays[subject.value] ?? displays[subject.value.toLowerCase()]
    return xAccountTrustSubject(display?.twitterId) ?? subject
  } catch {
    return subject
  }
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
  const subjectRef = useRef(subject)
  subjectRef.current = subject

  const resolveSubject = useCallback(async (): Promise<SerializableTrustSubject | null> => {
    const snapshot = await axRequest<SelectedSubjectSnapshot>({
      type: 'GET_SELECTED_SUBJECT',
      version: BACKGROUND_API_VERSION,
    })
    setCanGoBack(snapshot.canBack)
    setCanGoForward(snapshot.canForward)
    if (snapshot.selected?.subject) {
      return preferXAccountSubject(snapshot.selected.subject)
    }

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
      const next = keepNotesSubject(await resolveSubject(), subjectRef.current)
      const kind = next ? notesPanelKind(next) : null
      if (!next || !kind) {
        setSubject(null)
        setTrust(null)
        setRating(null)
        return
      }
      setSubject(next)
      switch (kind) {
        case 'post': {
          setTrust(null)
          setRating(
            await axRequest<RatingQueryResult>({
              type: 'QUERY_RATING',
              version: BACKGROUND_API_VERSION,
              subject: next,
            }),
          )
          return
        }
        case 'user': {
          setRating(null)
          setTrust(
            await axRequest<TrustQueryResult>({
              type: 'QUERY_TRUST',
              version: BACKGROUND_API_VERSION,
              subject: next,
              format: 'path',
            }),
          )
          return
        }
        default: {
          const _exhaustive: never = kind
          return _exhaustive
        }
      }
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

  const kind = notesPanelKind(subject)
  if (!kind) {
    return (
      <div className={styles.empty}>
        <Card>
          <SectionLabel>{t('panel.notesTitle')}</SectionLabel>
          <SectionHint>{t('panel.notesNeedSubject')}</SectionHint>
        </Card>
      </div>
    )
  }

  const waiting =
    kind === 'user' ? loading && !trust : loading && !rating

  return (
    <div className={styles.root}>
      <SubjectHeader
        subject={subject}
        trust={kind === 'user' ? trust : null}
        showHistory
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
      {waiting ? (
        <p className={styles.muted}>{t('panel.notesLoading')}</p>
      ) : null}
      <CurationActions
        panel={kind}
        subject={subject}
        trust={kind === 'user' ? trust : null}
        rating={kind === 'post' ? rating : null}
        onChanged={() => void load()}
      />
      {kind === 'user' && trust ? (
        <StatementScan variant="users" trust={trust} />
      ) : null}
      {kind === 'post' && rating ? (
        <StatementScan variant="ratings" rating={rating} />
      ) : null}
    </div>
  )
}
