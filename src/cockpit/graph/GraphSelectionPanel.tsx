import type { TrustSummary } from '../../content/trust-summary'
import { t } from '../../lib/i18n'
import type { GraphVizNode } from './types'
import styles from './GraphOverlays.module.css'

export interface GraphSelectionPanelProps {
  node: GraphVizNode
  summary?: TrustSummary
  busy?: boolean
  message?: string
  canAct: boolean
  onTrust: () => void
  onDistrust: () => void
  onCancel: () => void
  onClose: () => void
}

export default function GraphSelectionPanel({
  node,
  summary,
  busy,
  message,
  canAct,
  onTrust,
  onDistrust,
  onCancel,
  onClose,
}: GraphSelectionPanelProps) {
  const resolution = summary?.resolution ?? 'none'
  const direct = summary?.direct

  return (
    <aside className={styles.selection} aria-label={t('graph.selectedNode')}>
      <div className={styles.selectionHeader}>
        <div>
          <p className={styles.kind}>{node.kind}</p>
          <h2 title={node.id}>{node.label}</h2>
          <p className={styles.mono}>{node.id}</p>
        </div>
        <button
          type="button"
          className={styles.panelDismiss}
          aria-label={t('graph.closePanel')}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <p className={styles.verdict}>
        {resolution === 'none'
          ? t('graph.noEvidence')
          : [
              resolution === 'trusted'
                ? t('content.resolution.trusted')
                : resolution === 'distrusted'
                  ? t('content.resolution.distrusted')
                  : resolution === 'mixed'
                    ? t('content.resolution.mixed')
                    : t('graph.unknown'),
              summary?.degree !== undefined ? `${summary.degree}°` : null,
              summary
                ? `+${summary.trustCount} / −${summary.distrustCount}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
      </p>
      {summary?.truncated ? (
        <p className={styles.hint}>{t('graph.evidenceTruncated')}</p>
      ) : null}

      {canAct ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.trustBtn}
            disabled={busy || direct === 1}
            aria-pressed={direct === 1}
            onClick={onTrust}
          >
            {t('graph.trust')}
          </button>
          <button
            type="button"
            className={styles.distrustBtn}
            disabled={busy || direct === -1}
            aria-pressed={direct === -1}
            onClick={onDistrust}
          >
            {t('graph.distrust')}
          </button>
          <button
            type="button"
            className={styles.cancelBtn}
            disabled={busy || direct === undefined}
            onClick={onCancel}
          >
            {t('graph.cancel')}
          </button>
        </div>
      ) : (
        <p className={styles.hint}>
          {t('graph.selectActionable')}
        </p>
      )}

      {message ? <p className={styles.message}>{message}</p> : null}
    </aside>
  )
}
