import { IconChevronLeft, IconChevronRight } from '../../assets'
import { t } from '../../lib/i18n'
import type { TrustSummary } from '../../content/trust-summary'
import type { GraphVizNode } from './types'
import styles from './GraphOverlays.module.css'

export interface GraphSelectionPanelProps {
  node: GraphVizNode
  summary?: TrustSummary
  busy?: boolean
  message?: string
  canAct: boolean
  collapsed: boolean
  mode: 'graph' | 'path'
  canOpenPath: boolean
  onTrust: () => void
  onDistrust: () => void
  onCancel: () => void
  onToggleCollapse: () => void
  onOpenPath: () => void
}

function avatarFallback(node: GraphVizNode): string {
  const label = node.label?.trim()
  if (!label) return '?'
  if (node.isRoot) return 'Y'
  return label.charAt(0).toUpperCase()
}

function PersonAvatar({
  picture,
  fallback,
}: {
  picture?: string
  fallback: string
}) {
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
      {fallback}
    </div>
  )
}

export default function GraphSelectionPanel({
  node,
  summary,
  busy,
  message,
  canAct,
  collapsed,
  mode,
  canOpenPath,
  onTrust,
  onDistrust,
  onCancel,
  onToggleCollapse,
  onOpenPath,
}: GraphSelectionPanelProps) {
  const resolution = summary?.resolution ?? 'none'
  const direct = summary?.direct
  const title = node.label || t('graph.unknown')
  const subtitle =
    node.subtitle ??
    (node.kind === 'pubkey' && !node.isRoot
      ? `${node.id.replace(/^p:/, '').slice(0, 12)}…`
      : undefined)

  if (collapsed) {
    return (
      <aside
        className={`${styles.selection} ${styles.selectionCollapsed}`}
        aria-label={t('graph.selectedNode')}
      >
        <button
          type="button"
          className={styles.collapsedToggle}
          aria-label={t('graph.expandPanel')}
          onClick={onToggleCollapse}
        >
          <PersonAvatar picture={node.picture} fallback={avatarFallback(node)} />
          <IconChevronRight size={18} aria-hidden="true" />
        </button>
      </aside>
    )
  }

  return (
    <aside className={styles.selection} aria-label={t('graph.selectedNode')}>
      <div className={styles.selectionHeader}>
        <div className={styles.profileCard}>
          <PersonAvatar picture={node.picture} fallback={avatarFallback(node)} />
          <div className={styles.profileText}>
            <h2 title={title}>{title}</h2>
            {subtitle ? (
              <p className={styles.profileSubtitle}>{subtitle}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className={styles.chevronBtn}
          aria-label={t('graph.collapsePanel')}
          onClick={onToggleCollapse}
        >
          <IconChevronLeft size={18} aria-hidden="true" />
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

      {mode === 'graph' ? (
        <button
          type="button"
          className={styles.modeBtn}
          disabled={!canOpenPath}
          onClick={onOpenPath}
        >
          {t('graph.openPath')}
        </button>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </aside>
  )
}
