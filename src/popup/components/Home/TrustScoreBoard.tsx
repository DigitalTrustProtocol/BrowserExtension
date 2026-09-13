import { t } from '@lib/i18n.js'
import {
  trustScoreBoardView,
  type TrustScoreSummary,
} from '../../../shared/trust-score-format'
import styles from './TrustScoreBoard.module.css'

function toneClassForResolution(
  resolution: TrustScoreSummary['resolution'],
): string {
  switch (resolution) {
    case 'trusted':
      return styles.toneTrust
    case 'mixed':
      return styles.toneQuestion
    case 'distrusted':
      return styles.toneMisleading
    case 'none':
      return ''
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

export default function TrustScoreBoard(props: { summary: TrustScoreSummary }) {
  const view = trustScoreBoardView(props.summary, t)
  const toneClass = toneClassForResolution(props.summary.resolution)
  return (
    <div className={styles.root}>
      <p className={`${styles.percent} ${toneClass}`.trim()}>
        {view.percentLabel}
      </p>
      <p className={`${styles.verdict} ${toneClass}`.trim()}>{view.verdict}</p>
      {view.showBars ? (
        <div className={styles.rows}>
          <div className={`${styles.row} ${styles.trust}`}>
            <span className={styles.label}>{view.trust.label}</span>
            <span className={styles.count}>{view.trust.count}</span>
            <span className={styles.track} aria-hidden="true">
              <span
                className={styles.fill}
                style={{ width: `${view.trust.widthPct}%` }}
              />
            </span>
          </div>
          <div className={`${styles.row} ${styles.distrust}`}>
            <span className={styles.label}>{view.distrust.label}</span>
            <span className={styles.count}>{view.distrust.count}</span>
            <span className={styles.track} aria-hidden="true">
              <span
                className={styles.fill}
                style={{ width: `${view.distrust.widthPct}%` }}
              />
            </span>
          </div>
        </div>
      ) : null}
      {view.total ? <p className={styles.total}>{view.total}</p> : null}
      {view.footnote ? (
        <p className={styles.footnote}>{view.footnote}</p>
      ) : null}
    </div>
  )
}
