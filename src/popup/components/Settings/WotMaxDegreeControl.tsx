import { useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import type { PublicExtensionState } from '../../../shared/contracts'
import {
  WOT_MAX_DEGREE_HARD_CAP,
  WOT_MAX_DEGREE_MIN,
} from '../../../shared/wot-max-degree'
import styles from './WotMaxDegreeControl.module.css'

interface WotMaxDegreeControlProps {
  /** Committed degree (source of truth from the backend). */
  degree: number
  description: string
  saving?: boolean
  resolveHint?: PublicExtensionState['resolveTimingHint']
  onCommit: (degree: number) => void
}

/**
 * Shared max-degree slider — main panel and Settings → Graph.
 * Local draft while dragging; snaps back to `degree` when a commit fails
 * (saving flips true→false without a degree change).
 */
export default function WotMaxDegreeControl({
  degree,
  description,
  saving = false,
  resolveHint,
  onCommit,
}: WotMaxDegreeControlProps) {
  const [sliderDegree, setSliderDegree] = useState(degree)

  useEffect(() => {
    setSliderDegree(degree)
  }, [degree, saving])

  const commit = (value: number) => {
    if (saving || value === degree) return
    onCommit(value)
  }

  return (
    <div className={styles.degreeSection}>
      <p className={styles.hint}>{description}</p>
      <label className={styles.degreeSlider}>
        <span className={styles.degreeValue}>{sliderDegree}°</span>
        <input
          type="range"
          min={WOT_MAX_DEGREE_MIN}
          max={WOT_MAX_DEGREE_HARD_CAP}
          step={1}
          value={sliderDegree}
          aria-valuemin={WOT_MAX_DEGREE_MIN}
          aria-valuemax={WOT_MAX_DEGREE_HARD_CAP}
          aria-valuenow={sliderDegree}
          aria-label={t('settings.graph.degreeSlider')}
          onChange={(event) => setSliderDegree(Number(event.target.value))}
          onPointerUp={(event) => commit(Number(event.currentTarget.value))}
          onKeyUp={(event) => commit(Number(event.currentTarget.value))}
          onBlur={(event) => commit(Number(event.currentTarget.value))}
        />
      </label>
      {resolveHint ? (
        <p className={styles.warning} role="status">
          {t('settings.graph.resolveHint', {
            degree: resolveHint.heaviestDegree,
            avgMs: Math.round(resolveHint.avgMs),
            samples: resolveHint.samples,
          })}
        </p>
      ) : null}
    </div>
  )
}
