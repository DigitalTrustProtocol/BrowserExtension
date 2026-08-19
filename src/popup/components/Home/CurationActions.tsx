import { useEffect, useId, useRef, useState } from 'react'
import browser from '@shared/browser.ts'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
} from '../../../shared/contracts'
import type { TrustQueryResult } from '../../../graph'
import { isIdentitySubject } from '../../../graph'
import { buildGraphPageUrl, subjectNodeId } from '../../../shared/graph-deeplink'
import {
  ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
  sanitizeTrustContent,
} from '../../../shared/trust-content'
import {
  IconMinusCircle,
  IconShieldCheck,
  IconTrash,
  IconTriangleAlert,
} from '@assets'
import styles from './CurationActions.module.css'

export type CurationPolarity = 'trust' | 'neutral' | 'distrust'

export type PublishTrustValue = '1' | '0' | '-1'

const POLARITIES: readonly CurationPolarity[] = ['trust', 'neutral', 'distrust']

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export function polarityToPublishValue(
  polarity: CurationPolarity,
): PublishTrustValue {
  switch (polarity) {
    case 'trust':
      return '1'
    case 'neutral':
      return '0'
    case 'distrust':
      return '-1'
    default: {
      const _exhaustive: never = polarity
      return _exhaustive
    }
  }
}

export function ownDirectPolarity(
  trust: TrustQueryResult | null,
): CurationPolarity | null {
  const value = trust?.direct?.value
  if (value === undefined) return null
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

/** Delete is shown only when the operator already has a winning statement. */
export function shouldShowDelete(trust: TrustQueryResult | null): boolean {
  return trust?.direct !== undefined
}

/** Graph overview is for identity subjects; posts are terminal `i` evidence. */
export function shouldShowOpenGraph(subject: SerializableTrustSubject): boolean {
  return isIdentitySubject(subject)
}

/**
 * Re-clicking the current polarity is a no-op. The filled disc is the
 * feedback (Maps Directions-disc pattern). Delete retracts the own winner.
 */
export function isAlreadySelected(
  polarity: CurationPolarity,
  current: CurationPolarity | null,
): boolean {
  return current === polarity
}

function polarityLabelKey(polarity: CurationPolarity): string {
  switch (polarity) {
    case 'trust':
      return 'panel.curate.trust'
    case 'neutral':
      return 'panel.curate.neutral'
    case 'distrust':
      return 'panel.curate.distrust'
    default: {
      const _exhaustive: never = polarity
      return _exhaustive
    }
  }
}

function polarityHintKey(polarity: CurationPolarity): string {
  switch (polarity) {
    case 'trust':
      return 'panel.curate.trustHint'
    case 'neutral':
      return 'panel.curate.neutralHint'
    case 'distrust':
      return 'panel.curate.distrustHint'
    default: {
      const _exhaustive: never = polarity
      return _exhaustive
    }
  }
}

function PolarityGlyph(props: {
  polarity: CurationPolarity
  size: number
}) {
  const { polarity, size } = props
  switch (polarity) {
    case 'trust':
      return <IconShieldCheck size={size} aria-hidden="true" />
    case 'neutral':
      return <IconMinusCircle size={size} aria-hidden="true" />
    case 'distrust':
      return <IconTriangleAlert size={size} aria-hidden="true" />
    default: {
      const _exhaustive: never = polarity
      return _exhaustive
    }
  }
}

export default function CurationActions(props: {
  subject: SerializableTrustSubject
  trust: TrustQueryResult | null
  onChanged: () => void
}) {
  const { subject, trust, onChanged } = props
  const noteId = useId()
  const statusId = useId()
  const [note, setNote] = useState(trust?.direct?.content ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const directId = trust?.direct?.eventId
  const directContent = trust?.direct?.content ?? ''
  const current = ownDirectPolarity(trust)
  const showDelete = shouldShowDelete(trust)
  const showGraph = shouldShowOpenGraph(subject)

  useEffect(() => {
    setNote(directContent)
  }, [directId, directContent])

  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await task()
      onChanged()
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : t('panel.curate.error'),
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const publish = (polarity: CurationPolarity): void => {
    if (isAlreadySelected(polarity, current)) return
    const content = sanitizeTrustContent(
      note,
      ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
    )
    void run(async () => {
      await axRequest({
        type: 'PUBLISH_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject,
        value: polarityToPublishValue(polarity),
        ...(content ? { content } : {}),
      })
    })
  }

  const deleteOwn = (): void => {
    if (!trust?.direct) return
    const context = trust.direct.context
    void run(async () => {
      await axRequest({
        type: 'CANCEL_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject,
        ...(context ? { context } : {}),
      })
    })
  }

  const openGraph = (): void => {
    if (!showGraph) return
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

  return (
    <div className={styles.root} aria-busy={busy}>
      <div
        className={styles.primary}
        role="group"
        aria-label={t('panel.curate.group')}
      >
        {POLARITIES.map((polarity) => {
          const selected = isAlreadySelected(polarity, current)
          const label = t(polarityLabelKey(polarity))
          return (
            <button
              key={polarity}
              type="button"
              className={styles.action}
              aria-pressed={selected}
              aria-label={label}
              title={
                selected
                  ? t('panel.curate.alreadySelected')
                  : t(polarityHintKey(polarity))
              }
              disabled={busy}
              onClick={() => publish(polarity)}
            >
              <span className={styles.disc} aria-hidden="true">
                <PolarityGlyph polarity={polarity} size={22} />
              </span>
              <span className={styles.caption} aria-hidden="true">
                {label}
              </span>
            </button>
          )
        })}
      </div>

      <div className={styles.noteRow}>
        <label htmlFor={noteId} className={styles.noteLabel}>
          {t('panel.curate.note')}
        </label>
        <input
          id={noteId}
          className={styles.note}
          type="text"
          value={note}
          maxLength={ATTENTIONX_TRUST_CONTENT_UI_LIMIT}
          placeholder={t('panel.curate.notePlaceholder')}
          disabled={busy}
          autoComplete="off"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {showDelete ? (
        <button
          type="button"
          className={styles.delete}
          disabled={busy}
          onClick={deleteOwn}
          title={t('panel.curate.deleteHint')}
          aria-label={t('panel.curate.delete')}
        >
          <IconTrash size={15} aria-hidden="true" />
          {t('panel.curate.delete')}
        </button>
      ) : null}

      {showGraph ? (
        <button
          type="button"
          className={styles.graph}
          onClick={openGraph}
        >
          {t('panel.curate.openGraph')}
        </button>
      ) : null}

      <div id={statusId} className={styles.status} aria-live="polite">
        {busy ? t('panel.curate.publishing') : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
