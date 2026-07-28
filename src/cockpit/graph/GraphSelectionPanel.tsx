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

function PersonAvatar({ picture }: { picture?: string }) {
  if (picture) {
    return (
      <img
        className={styles.profileAvatar}
        src={picture}
        alt=""
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <div className={styles.profileAvatarFallback} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28">
        <circle cx="12" cy="8" r="3.5" fill="currentColor" />
        <path
          d="M5.5 19.5c1.2-3.2 3.5-4.8 6.5-4.8s5.3 1.6 6.5 4.8"
          fill="currentColor"
        />
      </svg>
    </div>
  )
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
  const title = node.label || t('graph.unknown')
  const subtitle =
    node.subtitle ??
    (node.kind === 'pubkey' && !node.isRoot
      ? `${node.id.replace(/^p:/, '').slice(0, 12)}…`
      : undefined)

  return (
    <aside className={styles.selection} aria-label={t('graph.selectedNode')}>
      <div className={styles.selectionHeader}>
        <div className={styles.profileCard}>
          <PersonAvatar picture={node.picture} />
          <div className={styles.profileText}>
            <h2 title={title}>{title}</h2>
            {subtitle ? (
              <p className={styles.profileSubtitle}>{subtitle}</p>
            ) : null}
          </div>
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
        <p className={styles.hint}>{t('graph.selectActionable')}</p>
      )}

      {message ? <p className={styles.message}>{message}</p> : null}
    </aside>
  )
}
