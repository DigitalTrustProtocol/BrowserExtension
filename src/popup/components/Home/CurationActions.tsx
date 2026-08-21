import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type AppMode,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
} from '../../../shared/contracts'
import type { TrustQueryResult } from '../../../graph'
import { isIdentitySubject } from '../../../graph'
import {
  ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
  sanitizeTrustContent,
} from '../../../shared/trust-content'
import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import { normalizeBoundTwitterId } from '../../../accounts/x-binding'
import { useAccount } from '../../context/AccountContext'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
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

/** Timeline dialog order: Trust, Distrust, Neutral. */
const OVERLAY_POLARITIES: readonly CurationPolarity[] = [
  'trust',
  'distrust',
  'neutral',
]

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

/** Account Notes use a Trust overlay; posts keep the inline three-disc row. */
export function shouldUseTrustOverlay(
  subject: SerializableTrustSubject,
): boolean {
  return parseCanonicalTwitterSubject(subject.value)?.type === 'account'
}

/** When an own statement already exists, the launch control is Re-trust. */
export function trustLaunchLabelKey(showDelete: boolean): string {
  return showDelete ? 'panel.curate.reTrust' : 'panel.curate.trust'
}

/** Trusting the operator’s own X account is a no-op; Delete may still retract. */
export function isSelfAccountSubject(
  subject: SerializableTrustSubject,
  ownTwitterIds: readonly (string | null | undefined)[],
): boolean {
  const parsed = parseCanonicalTwitterSubject(subject.value)
  if (parsed?.type !== 'account') return false
  const id = parsed.twitterId
  for (const own of ownTwitterIds) {
    if (normalizeBoundTwitterId(own) === id) return true
  }
  return false
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

function pillClass(polarity: CurationPolarity): string {
  switch (polarity) {
    case 'trust':
      return styles.pillTrust
    case 'neutral':
      return styles.pillNeutral
    case 'distrust':
      return styles.pillDistrust
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
  history?: ReactNode
  onChanged: () => void
}) {
  const { subject, trust, history, onChanged } = props
  const { active, activeXTwitterId } = useAccount()
  const noteId = useId()
  const statusId = useId()
  const [note, setNote] = useState(trust?.direct?.content ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const { shouldRender, animating } = useAnimatedVisible(overlayOpen)
  const busyRef = useRef(false)
  const directId = trust?.direct?.eventId
  const directContent = trust?.direct?.content ?? ''
  const current = ownDirectPolarity(trust)
  const showDelete = shouldShowDelete(trust)
  const useOverlay = shouldUseTrustOverlay(subject)
  const isSelf = isSelfAccountSubject(subject, [
    active?.boundTwitterId,
    activeXTwitterId,
  ])

  useEffect(() => {
    setNote(directContent)
  }, [directId, directContent])

  useEffect(() => {
    if (isSelf) setOverlayOpen(false)
  }, [isSelf])

  useEffect(() => {
    if (!overlayOpen) return
    let cancelled = false
    void axRequest<{ mode: AppMode }>({
      type: 'GET_APP_MODE',
      version: BACKGROUND_API_VERSION,
    })
      .then((result) => {
        if (!cancelled) setDemoMode(result.mode === 'demo')
      })
      .catch(() => {
        if (!cancelled) setDemoMode(false)
      })
    return () => {
      cancelled = true
    }
  }, [overlayOpen])

  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await task()
      setOverlayOpen(false)
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
    if (isSelf) return
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

  const polarityGroup = (
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
  )

  const noteField = (id: string) => (
    <div className={styles.noteRow}>
      <label htmlFor={id} className={styles.noteLabel}>
        {t('panel.curate.note')}
      </label>
      <input
        id={id}
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
  )

  const overlayPills = (
    <div
      className={styles.pills}
      role="group"
      aria-label={t('panel.curate.group')}
    >
      {OVERLAY_POLARITIES.map((polarity) => {
        const selected = isAlreadySelected(polarity, current)
        const label = t(polarityLabelKey(polarity))
        return (
          <button
            key={polarity}
            type="button"
            className={`${styles.pill} ${pillClass(polarity)}`}
            aria-pressed={selected}
            aria-label={label}
            title={
              selected
                ? t('panel.curate.alreadySelected')
                : t(polarityHintKey(polarity))
            }
            disabled={busy || isSelf}
            onClick={() => publish(polarity)}
          >
            <PolarityGlyph polarity={polarity} size={16} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )

  const overlayNote = (
    <div>
      <label htmlFor={noteId} className={styles.overlayNoteLabel}>
        {t('content.dialog.noteLabel')}
      </label>
      <textarea
        id={noteId}
        className={styles.overlayNote}
        value={note}
        maxLength={ATTENTIONX_TRUST_CONTENT_UI_LIMIT}
        rows={3}
        placeholder={t('content.dialog.notePlaceholder')}
        disabled={busy}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className={styles.noteMeta}>
        {note.length} / {ATTENTIONX_TRUST_CONTENT_UI_LIMIT}
      </div>
    </div>
  )

  const deleteButton = showDelete ? (
    <button
      type="button"
      className={useOverlay ? `${styles.delete} ${styles.deleteOnChrome}` : styles.delete}
      disabled={busy}
      onClick={deleteOwn}
      title={t('panel.curate.deleteHint')}
      aria-label={t('panel.curate.delete')}
    >
      <IconTrash size={15} aria-hidden="true" />
      {t('panel.curate.delete')}
    </button>
  ) : null

  return (
    <div className={styles.root} aria-busy={busy}>
      {useOverlay ? (
        <>
          <button
            type="button"
            className={styles.trustLaunch}
            disabled={busy || isSelf}
            onClick={() => {
              if (!isSelf) setOverlayOpen(true)
            }}
          >
            {t(trustLaunchLabelKey(showDelete))}
          </button>
          {history || deleteButton ? (
            <div className={styles.chromeRow}>
              {history}
              {deleteButton}
            </div>
          ) : null}
          <div id={statusId} className={styles.status} aria-live="polite">
            {busy ? t('panel.curate.publishing') : null}
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          {shouldRender
            ? createPortal(
                <OverlayPanel
                  title={t('panel.curate.group')}
                  onClose={() => setOverlayOpen(false)}
                  animating={animating}
                  zIndex={400}
                >
                  <div className={styles.overlayBody}>
                    {demoMode ? (
                      <p className={styles.demoNotice} role="status">
                        {t('content.demoNotice')}
                      </p>
                    ) : null}
                    {overlayNote}
                    {overlayPills}
                    <div className={styles.status} aria-live="polite">
                      {busy ? t('panel.curate.publishing') : null}
                    </div>
                    {error ? (
                      <p className={styles.error} role="alert">
                        {error}
                      </p>
                    ) : null}
                  </div>
                </OverlayPanel>,
                document.body,
              )
            : null}
        </>
      ) : (
        <>
          {polarityGroup}
          {noteField(noteId)}
          {deleteButton}
          <div id={statusId} className={styles.status} aria-live="polite">
            {busy ? t('panel.curate.publishing') : null}
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
