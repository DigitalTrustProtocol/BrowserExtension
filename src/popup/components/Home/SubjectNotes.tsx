import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
  type XIdentitiesState,
} from '../../../shared/contracts'
import type { ViewerState } from '../../../shared/session-actor.ts'
import type { RatingQueryResult, TrustQueryResult } from '../../../graph'
import { parseXProfileHandle, parseXStatusPostId } from '../../../shared/x-status-url'
import type { SelectedSubject, SelectedSubjectSnapshot } from '../../../shared/selected-subject'
import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import { twitterIdFromSubject } from '../../../shared/selected-ids'
import { subscribeStateTopic } from '../../../shared/state-topics.ts'
import {
  contextField,
  trustQueryContextForSubject,
} from '../../../shared/trust-context'
import {
  getPageEntityStore,
  type OutgoingTrustState,
} from '../../../shared/page-entity-store'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import { usePanelSession } from '../../context/PanelSessionContext'
import { useViewer } from '../../context/ViewerContext'
import Card from '@components/Card/Card'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import CurationActions from './CurationActions'
import StatementScan from './StatementScan'
import SubjectHeader from './SubjectHeader'
import { impersonateControlState } from './impersonateControl'
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

/**
 * Intent selected wins. URL fallback + keep-previous only when selected is null.
 */
export function notesSubjectForLoad(input: {
  selected: SelectedSubject | null
  urlResolved: SerializableTrustSubject | null
  previous: SerializableTrustSubject | null
}): SerializableTrustSubject | null {
  if (input.selected?.subject) return input.selected.subject
  return keepNotesSubject(input.urlResolved, input.previous)
}

export default function SubjectNotes(props: {
  selected: SelectedSubject | null
  canGoBack: boolean
  canGoForward: boolean
  onPath: () => void
  onGraph: () => void
}) {
  const { tabUrl } = useSiteConnection()
  const { snapshot } = usePanelSession()
  const { viewer } = useViewer()
  const demoMode = snapshot?.appMode === 'demo'
  const impersonating = viewer?.origin === 'impersonation'
  const operatorTwitterId =
    snapshot?.x.kind === 'identified' ? snapshot.x.twitterId : null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState<SerializableTrustSubject | null>(null)
  const [trust, setTrust] = useState<TrustQueryResult | null>(null)
  const [rating, setRating] = useState<RatingQueryResult | null>(null)
  const [outgoing, setOutgoing] = useState<OutgoingTrustState>({
    status: 'idle',
  })
  const subjectRef = useRef(subject)
  subjectRef.current = subject

  const resolveSubject = useCallback(async (): Promise<SerializableTrustSubject | null> => {
    if (props.selected?.subject) {
      return props.selected.subject
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
  }, [props.selected, tabUrl])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = notesSubjectForLoad({
        selected: props.selected,
        urlResolved: await resolveSubject(),
        previous: subjectRef.current,
      })
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
          const [ratingResult, trustResult] = await Promise.all([
            axRequest<RatingQueryResult>({
              type: 'QUERY_RATING',
              version: BACKGROUND_API_VERSION,
              subject: next,
            }),
            axRequest<TrustQueryResult>({
              type: 'QUERY_TRUST',
              version: BACKGROUND_API_VERSION,
              subject: next,
              ...contextField(trustQueryContextForSubject(next)),
            }),
          ])
          setRating(ratingResult)
          setTrust(trustResult)
          return
        }
        case 'user': {
          setRating(null)
          setTrust(
            await axRequest<TrustQueryResult>({
              type: 'QUERY_TRUST',
              version: BACKGROUND_API_VERSION,
              subject: next,
              ...contextField(trustQueryContextForSubject(next)),
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
  }, [props.selected, resolveSubject])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const store = getPageEntityStore()
    const selected = props.selected
    store.prefetchSelection(selected)
    const stop = store.subscribe(() => {
      const current = subjectRef.current
      setOutgoing(
        current ? store.getOutgoing(current) : { status: 'idle' },
      )
    })
    if (subjectRef.current) {
      setOutgoing(store.getOutgoing(subjectRef.current))
    }
    return stop
  }, [props.selected])

  useEffect(() => {
    const stopTrustGraph = subscribeStateTopic('trustGraph', () => {
      void load()
    })
    const stopIdentity = subscribeStateTopic('identity', (message) => {
      const current = subjectRef.current
      if (twitterIdFromSubject(current ?? undefined) !== message.twitterId) {
        return
      }
      void load()
    })
    return () => {
      stopTrustGraph()
      stopIdentity()
    }
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
  const subjectTwitterId = twitterIdFromSubject(subject) ?? null
  const control = impersonateControlState({
    demoMode,
    panelKind: kind,
    subjectTwitterId,
    operatorTwitterId,
    impersonating,
  })
  const setViewer = (twitterId: string | null): void => {
    void axRequest<ViewerState>({
      type: 'SET_VIEWER',
      version: BACKGROUND_API_VERSION,
      twitterId,
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t('common.error'))
    })
  }

  return (
    <div className={styles.root}>
      <SubjectHeader
        subject={subject}
        trust={trust}
        showHistory
        canGoBack={props.canGoBack}
        canGoForward={props.canGoForward}
        onGoBack={() => goHistory('back')}
        onGoForward={() => goHistory('forward')}
        onPath={props.onPath}
        onGraph={props.onGraph}
        demoMode={demoMode}
        control={control}
        onImpersonate={() => {
          if (!subjectTwitterId) return
          setError(null)
          setViewer(subjectTwitterId)
        }}
        onRevert={() => {
          setError(null)
          setViewer(null)
        }}
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
      {kind === 'user' && outgoing.status === 'unavailable' ? (
        <p className={styles.muted}>{t('panel.notes.outgoingUnavailable')}</p>
      ) : null}
      {kind === 'user' && trust ? (
        <StatementScan variant="users" trust={trust} />
      ) : null}
      {kind === 'post' && rating ? (
        <StatementScan variant="ratings" rating={rating} />
      ) : null}
    </div>
  )
}
