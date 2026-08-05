import { IconChevronLeft, IconChevronRight } from '../../assets'
import { t } from '../../lib/i18n'
import type { TrustSummary } from '../../content/trust-summary'
import {
  canonicalTwitterPostUrl,
  canonicalTwitterProfileUrl,
} from '../../shared/x-identity'
import { formatTrustScore } from '../../shared/trust-score-format'
import { twitterIdFromNodeId } from './graph-display'
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
  canFocus: boolean
  onTrust: () => void
  onDistrust: () => void
  onCancel: () => void
  onToggleCollapse: () => void
  onOpenPath: () => void
  onFocus: () => void
  onOpenGraph: () => void
}

function avatarFallback(node: GraphVizNode): string {
  const label = node.label?.trim()
  if (!label) return '?'
  if (node.isRoot && (label === 'You' || label === 'Me')) return 'Y'
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

function toneClass(
  tone: TrustSummary['tone'] | undefined,
): string | undefined {
  if (tone === 'trust') return styles.toneTrust
  if (tone === 'question') return styles.toneQuestion
  if (tone === 'misleading') return styles.toneMisleading
  return undefined
}

function profileUrlForNode(node: GraphVizNode): string | undefined {
  if (node.kind === 'twitter_id' || node.isRoot) {
    const twitterId =
      node.kind === 'twitter_id' ? twitterIdFromNodeId(node.id) : undefined
    const handle = node.subtitle?.startsWith('@')
      ? node.subtitle.slice(1)
      : node.label.startsWith('@')
        ? node.label.slice(1)
        : undefined
    if (handle) {
      try {
        return canonicalTwitterProfileUrl({ handle })
      } catch {
        // Fall through to numeric id.
      }
    }
    if (twitterId) {
      try {
        return canonicalTwitterProfileUrl({ twitterId })
      } catch {
        return undefined
      }
    }
    return undefined
  }
  if (node.kind === 'post' && node.id.startsWith('i:post:id:')) {
    const postId = node.id.slice('i:post:id:'.length)
    try {
      return canonicalTwitterPostUrl(postId)
    } catch {
      return undefined
    }
  }
  return undefined
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
  canFocus,
  onTrust,
  onDistrust,
  onCancel,
  onToggleCollapse,
  onOpenPath,
  onFocus,
  onOpenGraph,
}: GraphSelectionPanelProps) {
  const direct = summary?.direct
  const title = node.label || t('graph.unknown')
  const handle = node.subtitle?.startsWith('@') ? node.subtitle : undefined
  const pubkeyHint =
    !handle && node.kind === 'pubkey' && !node.isRoot
      ? `${node.id.replace(/^p:/, '').slice(0, 12)}…`
      : undefined
  const detail = summary ? formatTrustScore(summary, t) : undefined
  const nameTone = toneClass(summary?.tone)
  const detailTone = toneClass(summary?.tone)
  const profileUrl = profileUrlForNode(node)

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
      <div className={styles.selectionBody}>
        <div className={styles.selectionHeader}>
          <div className={styles.profileCard}>
            <PersonAvatar
              picture={node.picture}
              fallback={avatarFallback(node)}
            />
            <div className={styles.profileText}>
              <div className={styles.nameRow}>
                {profileUrl ? (
                  <a
                    className={[styles.displayName, styles.displayNameLink, nameTone]
                      .filter(Boolean)
                      .join(' ')}
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('graph.openProfile')}
                  >
                    {title}
                  </a>
                ) : (
                  <h2
                    className={[styles.displayName, nameTone]
                      .filter(Boolean)
                      .join(' ')}
                    title={title}
                  >
                    {title}
                  </h2>
                )}
                {detail ? (
                  <span
                    className={[styles.trustDetail, detailTone]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {detail}
                  </span>
                ) : null}
              </div>
              {handle ? (
                <p className={styles.profileSubtitle}>{handle}</p>
              ) : pubkeyHint ? (
                <p className={styles.profileSubtitleMuted}>{pubkeyHint}</p>
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

        {summary?.truncated ? (
          <p className={styles.hint}>{t('graph.evidenceTruncated')}</p>
        ) : null}

        {!detail && summary?.resolution === 'none' ? (
          <p className={styles.hint}>{t('graph.noEvidence')}</p>
        ) : null}

        <div className={styles.midActions}>
          {canFocus ? (
            <button type="button" className={styles.modeBtn} onClick={onFocus}>
              {t('graph.focus')}
            </button>
          ) : null}
          {mode === 'graph' ? (
            <button
              type="button"
              className={styles.modeBtn}
              disabled={!canOpenPath}
              onClick={onOpenPath}
            >
              {t('graph.openPath')}
            </button>
          ) : (
            <button
              type="button"
              className={styles.modeBtn}
              onClick={onOpenGraph}
            >
              {t('graph.openGraph')}
            </button>
          )}
        </div>

        {message ? <p className={styles.message}>{message}</p> : null}
      </div>

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
    </aside>
  )
}
