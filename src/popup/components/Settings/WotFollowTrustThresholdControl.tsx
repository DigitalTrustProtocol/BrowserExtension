import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { t } from '@lib/i18n.js'
import { TONE_COLORS } from '../../../shared/trust-score-format'
import {
  FOLLOW_TRUST_THRESHOLD_MAX,
  FOLLOW_TRUST_THRESHOLD_MIN,
  FOLLOW_TRUST_THRESHOLD_STEP,
  moveFollowTrustKnob,
  type FollowTrustBand,
} from '../../../shared/wot-follow-trust-threshold'
import styles from './WotFollowTrustThresholdControl.module.css'

interface WotFollowTrustThresholdControlProps {
  band: FollowTrustBand
  description: string
  saving?: boolean
  onCommit: (band: FollowTrustBand) => void
}

type ActiveThumb = 'red' | 'green'

/**
 * Two-knob follow-trust bar — Settings → Graph.
 * Green indicator sits above the track; red sits below. Knobs push, never cross.
 * The color bar is inset by half a knob so 0–100 matches native range travel.
 */
export default function WotFollowTrustThresholdControl({
  band,
  description,
  saving = false,
  onCommit,
}: WotFollowTrustThresholdControlProps) {
  const [draft, setDraft] = useState(band)
  const [active, setActive] = useState<ActiveThumb>('green')
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    setDraft(band)
  }, [band, saving])

  const commit = (next: FollowTrustBand) => {
    if (saving) return
    setDraft(next)
    if (next.red === band.red && next.green === band.green) return
    onCommit(next)
  }

  const commitDraft = () => {
    commit(draftRef.current)
  }

  const setRed = (raw: number) => {
    setActive('red')
    const next = moveFollowTrustKnob(draftRef.current, 'red', raw)
    draftRef.current = next
    setDraft(next)
  }

  const setGreen = (raw: number) => {
    setActive('green')
    const next = moveFollowTrustKnob(draftRef.current, 'green', raw)
    draftRef.current = next
    setDraft(next)
  }

  const yellowWidth = Math.max(0, draft.green - draft.red)

  return (
    <div
      className={styles.section}
      style={
        {
          '--ax-red': TONE_COLORS.misleading,
          '--ax-yellow': TONE_COLORS.question,
          '--ax-green': TONE_COLORS.trust,
          '--red-pct': `${draft.red}%`,
          '--green-pct': `${draft.green}%`,
        } as CSSProperties
      }
    >
      <p className={styles.hint}>{description}</p>
      <div className={styles.slider}>
        <div className={styles.knobRow}>
          <span className={`${styles.percent} ${styles.percentGreen}`}>
            {draft.green}%
          </span>
          <input
            type="range"
            className={`${styles.thumbGreen} ${active === 'green' ? styles.active : ''}`}
            min={FOLLOW_TRUST_THRESHOLD_MIN}
            max={FOLLOW_TRUST_THRESHOLD_MAX}
            step={FOLLOW_TRUST_THRESHOLD_STEP}
            value={draft.green}
            aria-valuemin={FOLLOW_TRUST_THRESHOLD_MIN}
            aria-valuemax={FOLLOW_TRUST_THRESHOLD_MAX}
            aria-valuenow={draft.green}
            aria-label={t('settings.graph.followTrustGreenSlider')}
            onChange={(event) => setGreen(Number(event.target.value))}
            onPointerDown={() => setActive('green')}
            onPointerUp={commitDraft}
            onKeyUp={commitDraft}
            onBlur={commitDraft}
          />
        </div>
        <div className={styles.trackRow} aria-hidden="true">
          <span className={styles.percentSpacer} />
          <div className={styles.track}>
            <span className={styles.segRed} />
            {yellowWidth > 0 ? <span className={styles.segYellow} /> : null}
            <span className={styles.segGreen} />
          </div>
        </div>
        <div className={styles.knobRow}>
          <span className={`${styles.percent} ${styles.percentRed}`}>
            {draft.red}%
          </span>
          <input
            type="range"
            className={`${styles.thumbRed} ${active === 'red' ? styles.active : ''}`}
            min={FOLLOW_TRUST_THRESHOLD_MIN}
            max={FOLLOW_TRUST_THRESHOLD_MAX}
            step={FOLLOW_TRUST_THRESHOLD_STEP}
            value={draft.red}
            aria-valuemin={FOLLOW_TRUST_THRESHOLD_MIN}
            aria-valuemax={FOLLOW_TRUST_THRESHOLD_MAX}
            aria-valuenow={draft.red}
            aria-label={t('settings.graph.followTrustRedSlider')}
            onChange={(event) => setRed(Number(event.target.value))}
            onPointerDown={() => setActive('red')}
            onPointerUp={commitDraft}
            onKeyUp={commitDraft}
            onBlur={commitDraft}
          />
        </div>
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchRed}`} />
          {t('settings.graph.followTrustRed')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchYellow}`} />
          {t('settings.graph.followTrustYellow')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchGreen}`} />
          {t('settings.graph.followTrustGreen')}
        </span>
      </div>
    </div>
  )
}
