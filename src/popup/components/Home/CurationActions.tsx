import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type AppMode,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
} from '../../../shared/contracts'
import type { RatingQueryResult, TrustQueryResult } from '../../../graph'
import { isIdentitySubject } from '../../../graph'
import {
  ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
  sanitizeTrustContent,
} from '../../../shared/trust-content'
import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import { normalizeBoundTwitterId } from '../../../accounts/x-binding'
import {
  claimsForPolarity,
  type RatingClaimPolarity,
  type RatingQuickClaim,
  type RatingQuickClaimId,
} from '../../../content/ui/rating-claims'
import { useAccount } from '../../context/AccountContext'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
import {
  IconMinusCircle,
  IconShieldCheck,
  IconTriangleAlert,
  IconUndo,
} from '@assets'
import {
  AnalogStar,
  ownRatingScore,
  ratingStarFill,
  shouldShowRatingDelete,
  type RatingStarFill,
} from './SubjectRatings'
import styles from './CurationActions.module.css'

/** Same 20-point star buttons as the timeline rating popover. */
const OVERLAY_STAR_SCORES = ['20', '40', '60', '80', '100'] as const
type OverlayRatingScore = (typeof OVERLAY_STAR_SCORES)[number] | '0'

type OverlayRatingTone = 'trust' | 'question' | 'misleading' | 'neutral'

export type CurationPolarity = 'trust' | 'neutral' | 'distrust'

export type PublishTrustValue = '1' | '0' | '-1'

/** Trust popup polarity order: Trust, Neutral, Distrust. */
export const TRUST_OVERLAY_POLARITIES: readonly CurationPolarity[] = [
  'trust',
  'neutral',
  'distrust',
]

const OVERLAY_POLARITIES = TRUST_OVERLAY_POLARITIES

/** User-panel chrome retract opens the Trust overlay (comment + retract). */
export function chromeRetractOpensTrustOverlay(
  panel: 'user' | 'post',
): boolean {
  return panel === 'user'
}

export type TrustOverlayIntent = 'publish' | 'retract'

/** Retract-only overlay asks why the statement is being taken back. */
export function trustOverlayNoteKeys(intent: TrustOverlayIntent): {
  label: string
  placeholder: string
} {
  switch (intent) {
    case 'retract':
      return {
        label: 'panel.curate.retractNoteLabel',
        placeholder: 'panel.curate.retractNotePlaceholder',
      }
    case 'publish':
      return {
        label: 'content.dialog.noteLabel',
        placeholder: 'content.dialog.notePlaceholder',
      }
    default: {
      const _exhaustive: never = intent
      return _exhaustive
    }
  }
}

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

/** When an own statement already exists, the launch control is Re-trust. */
export function trustLaunchLabelKey(showDelete: boolean): string {
  return showDelete ? 'panel.curate.reTrust' : 'panel.curate.trust'
}

/** When an own rating already exists, the launch control is Re-rate. */
export function rateLaunchLabelKey(hasOwn: boolean): string {
  return hasOwn ? 'panel.curate.reRate' : 'panel.curate.rate'
}

export function ratingClaimLabelKey(id: RatingQuickClaimId): string {
  switch (id) {
    case 'insightful':
      return 'content.rating.labelInsightful'
    case 'genuine':
      return 'content.rating.labelGenuine'
    case 'funny':
      return 'content.rating.labelFunny'
    case 'ai-slop':
      return 'content.rating.labelAiSlop'
    case 'misleading':
      return 'content.rating.labelMisleading'
    case 'spam':
      return 'content.rating.labelSpam'
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

function overlayRatingTone(score: number | undefined): OverlayRatingTone {
  if (score === undefined) return 'neutral'
  if (score >= 80) return 'trust'
  if (score >= 30) return 'question'
  return 'misleading'
}

function overlayStarRowClass(tone: OverlayRatingTone): string {
  switch (tone) {
    case 'trust':
      return `${styles.starRow} ${styles.starRowTrust}`
    case 'question':
      return `${styles.starRow} ${styles.starRowQuestion}`
    case 'misleading':
      return `${styles.starRow} ${styles.starRowMisleading}`
    case 'neutral':
      return styles.starRow
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

function overlayClaimClass(score: number): string {
  const tone = overlayRatingTone(score)
  switch (tone) {
    case 'trust':
      return `${styles.claimBtn} ${styles.claimTrust}`
    case 'question':
      return `${styles.claimBtn} ${styles.claimQuestion}`
    case 'misleading':
      return `${styles.claimBtn} ${styles.claimMisleading}`
    case 'neutral':
      return styles.claimBtn
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

function overlayPreviewScore(
  hoverIndex: number | null,
  ownScore: number | null,
): number | undefined {
  if (hoverIndex !== null) return (hoverIndex + 1) * 20
  return ownScore === null ? undefined : ownScore
}

function overlayStarFill(
  previewScore: number | undefined,
  index: number,
): RatingStarFill {
  if (previewScore === undefined) return 'none'
  return ratingStarFill(previewScore, index)
}

/** Trusting the operator’s own X account or active pubkey is a no-op. */
export function isSelfAccountSubject(
  subject: SerializableTrustSubject,
  ownTwitterIds: readonly (string | null | undefined)[],
  ownPubkey?: string | null,
): boolean {
  if (
    subject.type === 'p' &&
    typeof ownPubkey === 'string' &&
    ownPubkey.length > 0 &&
    subject.value.toLowerCase() === ownPubkey.toLowerCase()
  ) {
    return true
  }
  const parsed = parseCanonicalTwitterSubject(subject.value)
  if (parsed?.type !== 'account') return false
  const id = parsed.twitterId
  for (const own of ownTwitterIds) {
    if (normalizeBoundTwitterId(own) === id) return true
  }
  return false
}

/**
 * Current own polarity, used to mark the matching overlay button as pressed.
 * Re-click still publishes so the operator can keep Trust and change the note.
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
  panel: 'user' | 'post'
  subject: SerializableTrustSubject
  trust: TrustQueryResult | null
  rating: RatingQueryResult | null
  onChanged: () => void
}) {
  const { panel, subject, trust, rating, onChanged } = props
  const { active, activeXTwitterId } = useAccount()
  const noteId = useId()
  const statusId = useId()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayIntent, setOverlayIntent] = useState<TrustOverlayIntent>(
    'publish',
  )
  const [demoMode, setDemoMode] = useState(false)
  const [hoverStarIndex, setHoverStarIndex] = useState<number | null>(null)
  const { shouldRender, animating } = useAnimatedVisible(overlayOpen)
  const busyRef = useRef(false)
  const directId = trust?.direct?.eventId
  const directContent = trust?.direct?.content ?? ''
  const ratingId = rating?.own?.eventId
  const ratingContent = rating?.own?.content ?? ''
  const current = ownDirectPolarity(trust)
  const ownScore = ownRatingScore(rating?.own)
  const previewScore = overlayPreviewScore(hoverStarIndex, ownScore)
  const showDelete =
    panel === 'post'
      ? shouldShowRatingDelete(rating)
      : shouldShowDelete(trust)
  const isSelf =
    panel === 'user' &&
    isSelfAccountSubject(
      subject,
      [active?.boundTwitterId, activeXTwitterId],
      active?.pubkey,
    )

  useEffect(() => {
    if (overlayIntent === 'retract') return
    setNote(panel === 'post' ? ratingContent : directContent)
  }, [panel, directId, directContent, ratingId, ratingContent, overlayIntent])

  useEffect(() => {
    if (!isSelf) return
    setOverlayOpen(false)
    setOverlayIntent('publish')
  }, [isSelf])

  useEffect(() => {
    if (shouldRender) return
    setHoverStarIndex(null)
    setOverlayIntent('publish')
  }, [shouldRender])

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

  const sanitizedNote = (): string =>
    sanitizeTrustContent(note, ATTENTIONX_TRUST_CONTENT_UI_LIMIT)

  const publish = (polarity: CurationPolarity): void => {
    if (isSelf) return
    const content = sanitizedNote()
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

  const publishRating = (
    score: OverlayRatingScore,
    labels: string[] | undefined,
  ): void => {
    // Re-tapping the current star or claim still publishes so the note can change.
    const content = sanitizedNote()
    void run(async () => {
      await axRequest({
        type: 'PUBLISH_RATING_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject,
        score,
        labels: labels ?? rating?.own?.labels ?? [],
        ...(content ? { content } : {}),
      })
    })
  }

  const deleteOwn = (): void => {
    if (panel === 'post') {
      if (!rating?.own) return
      const content = sanitizedNote()
      void run(async () => {
        await axRequest({
          type: 'CANCEL_RATING_STATEMENT',
          version: BACKGROUND_API_VERSION,
          subject,
          ...(content ? { content } : {}),
        })
      })
      return
    }
    if (!trust?.direct) return
    const context = trust.direct.context
    const content = sanitizedNote()
    void run(async () => {
      await axRequest({
        type: 'CANCEL_TRUST_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject,
        ...(context ? { context } : {}),
        ...(content ? { content } : {}),
      })
    })
  }

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
            title={t(polarityHintKey(polarity))}
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

  const overlayStars = (() => {
    const ownLabels = rating?.own?.labels
    const renderClaimGroup = (polarity: RatingClaimPolarity) => (
      <div
        key={polarity}
        className={styles.claimGroup}
        role="group"
        aria-label={
          polarity === 'good'
            ? t('content.rating.claimsGood')
            : t('content.rating.claimsBad')
        }
      >
        <div className={styles.claimHeading}>
          {polarity === 'good'
            ? t('content.rating.claimsGood')
            : t('content.rating.claimsBad')}
        </div>
        {claimsForPolarity(polarity).map((claim: RatingQuickClaim) => {
          const label = t(ratingClaimLabelKey(claim.id))
          const pressed = ownLabels?.includes(claim.id) === true
          return (
            <button
              key={claim.id}
              type="button"
              className={overlayClaimClass(Number(claim.score))}
              aria-pressed={pressed}
              aria-label={`${label}, ${t('content.rating.starN', {
                n: String(claim.stars),
              })}`}
              disabled={busy}
              onClick={() => publishRating(claim.score, [claim.id])}
            >
              <span>{label}</span>
              <span className={styles.claimStars}>
                {t('content.rating.claimStars', { n: String(claim.stars) })}
              </span>
            </button>
          )
        })}
      </div>
    )

    return (
      <>
        <textarea
          id={noteId}
          className={`${styles.overlayNote} ${styles.comment}`}
          value={note}
          maxLength={ATTENTIONX_TRUST_CONTENT_UI_LIMIT}
          placeholder={t('content.rating.commentPlaceholder')}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
        <div
          className={overlayStarRowClass(overlayRatingTone(previewScore))}
          role="group"
          aria-label={t('content.rating.stars')}
          onPointerLeave={() => setHoverStarIndex(null)}
        >
          {OVERLAY_STAR_SCORES.map((score, index) => {
            const fill = overlayStarFill(previewScore, index)
            const filled = fill !== 'none'
            return (
              <button
                key={score}
                type="button"
                className={`${styles.starBtn}${filled ? ` ${styles.starBtnFilled}` : ''}`}
                disabled={busy}
                aria-pressed={filled}
                aria-label={t('content.rating.starN', { n: String(index + 1) })}
                onPointerEnter={() => setHoverStarIndex(index)}
                onClick={() => publishRating(score, rating?.own?.labels)}
              >
                <AnalogStar fill={fill} />
              </button>
            )
          })}
        </div>
        <div className={styles.claims}>
          {renderClaimGroup('good')}
          {renderClaimGroup('bad')}
          {rating?.own ? (
            <button
              type="button"
              className={`${styles.claimBtn} ${styles.claimClear}`}
              disabled={busy}
              onClick={deleteOwn}
            >
              <IconUndo size={16} aria-hidden="true" />
              <span>{t('content.rating.clear')}</span>
            </button>
          ) : null}
        </div>
        <p className={styles.footnote}>
          {demoMode
            ? t('content.rating.demoNotice')
            : t('content.dialog.holdNotice')}
        </p>
      </>
    )
  })()

  const overlayNoteCopy = trustOverlayNoteKeys(overlayIntent)
  const overlayNote = (
    <div>
      <label htmlFor={noteId} className={styles.overlayNoteLabel}>
        {t(overlayNoteCopy.label)}
      </label>
      <textarea
        id={noteId}
        className={styles.overlayNote}
        value={note}
        maxLength={ATTENTIONX_TRUST_CONTENT_UI_LIMIT}
        rows={3}
        placeholder={t(overlayNoteCopy.placeholder)}
        disabled={busy}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className={styles.noteMeta}>
        {note.length} / {ATTENTIONX_TRUST_CONTENT_UI_LIMIT}
      </div>
    </div>
  )

  const retractLabel =
    panel === 'post'
      ? t('content.rating.clear')
      : t('content.card.delete')
  const storedNote = panel === 'post' ? ratingContent : directContent
  const openTrustOverlay = (intent: TrustOverlayIntent): void => {
    if (isSelf && intent === 'publish') return
    setOverlayIntent(intent)
    setNote(intent === 'retract' ? '' : storedNote)
    setOverlayOpen(true)
  }
  const closeTrustOverlay = (): void => {
    setOverlayOpen(false)
  }
  const deleteButton = showDelete ? (
    <button
      type="button"
      className={`${styles.delete} ${styles.deleteOnChrome}`}
      disabled={busy}
      onClick={() => {
        if (chromeRetractOpensTrustOverlay(panel)) openTrustOverlay('retract')
        else deleteOwn()
      }}
      title={
        panel === 'post'
          ? t('panel.curate.deleteRatingHint')
          : t('panel.curate.deleteHint')
      }
      aria-label={retractLabel}
    >
      <IconUndo size={15} aria-hidden="true" />
      {retractLabel}
    </button>
  ) : null

  const launchLabel =
    panel === 'post'
      ? t(rateLaunchLabelKey(showDelete))
      : t(trustLaunchLabelKey(showDelete))
  const overlayTitle =
    panel === 'post'
      ? t('content.rating.title')
      : t('panel.curate.group')

  const overlayRetract =
    panel === 'user' && showDelete ? (
      <button
        type="button"
        className={styles.overlayRetract}
        disabled={busy}
        onClick={deleteOwn}
        title={t('panel.curate.deleteHint')}
        aria-label={retractLabel}
      >
        <IconUndo size={16} aria-hidden="true" />
        <span>{retractLabel}</span>
      </button>
    ) : null

  return (
    <div className={styles.root} aria-busy={busy}>
      <button
        type="button"
        className={styles.trustLaunch}
        disabled={busy || isSelf}
        onClick={() => openTrustOverlay('publish')}
      >
        {launchLabel}
      </button>
      {deleteButton ? (
        <div className={styles.chromeRow}>{deleteButton}</div>
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
              title={overlayTitle}
              onClose={closeTrustOverlay}
              animating={animating}
              zIndex={400}
            >
              <div className={styles.overlayBody}>
                {panel === 'post' ? (
                  overlayStars
                ) : (
                  <>
                    {demoMode ? (
                      <p className={styles.demoNotice} role="status">
                        {t('content.demoNotice')}
                      </p>
                    ) : null}
                    {overlayNote}
                    {overlayIntent === 'retract' ? null : overlayPills}
                    {overlayRetract}
                  </>
                )}
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
    </div>
  )
}
