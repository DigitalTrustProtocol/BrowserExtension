import { t } from '@lib/i18n.js'
import { IconLockOpen, IconWarning } from '@assets'
import { useAccount } from '../../context/AccountContext'
import { useVault } from '../../context/VaultContext'
import Avatar from '@components/Avatar/Avatar'
import styles from './TopBar.module.css'

/** Identity chip. Opens this X user's binding detail. */
export default function AccountBar(props: {
  compact?: boolean
  onOpenIdentity?: () => void
}) {
  const {
    displayName,
    displaySub,
    avatarUrl,
    initial,
    isReadOnly,
    active,
    avatarBindingStatus,
  } = useAccount()
  const vault = useVault()

  const fallbackText = !active ? '+' : isReadOnly ? '\u{1F441}' : initial
  const label = props.compact
    ? `${t('topbar.activeAccount')}: ${displayName}`
    : t('topbar.activeAccount')
  const badgeLabel =
    avatarBindingStatus === 'complete'
      ? t('topbar.bindingComplete')
      : avatarBindingStatus === 'warning'
        ? t('topbar.bindingIncomplete')
        : undefined

  const identity = (
    <>
      <div className={styles.avatarWrap}>
        <Avatar
          src={avatarUrl}
          fallback={fallbackText}
          imgClassName={styles.avatar}
          fallbackClassName={styles.avatarFallback}
        />
        {avatarBindingStatus === 'complete' ? (
          <span
            className={`${styles.avatarBadge} ${styles.avatarBadgeOk}`}
            title={badgeLabel}
            aria-label={badgeLabel}
          >
            ✓
          </span>
        ) : null}
        {avatarBindingStatus === 'warning' ? (
          <span
            className={`${styles.avatarBadge} ${styles.avatarBadgeWarn}`}
            title={badgeLabel}
            aria-label={badgeLabel}
          >
            <IconWarning size={10} aria-hidden />
          </span>
        ) : null}
      </div>
      {props.compact ? null : (
        <div className={styles.barInfo}>
          <div className={styles.barNameRow}>
            <span className={styles.barName}>{displayName}</span>
            {isReadOnly && (
              <span className={styles.readOnlyBadge}>{t('account.readOnly')}</span>
            )}
          </div>
          <span className={styles.barSub}>{displaySub}</span>
        </div>
      )}
    </>
  )

  return (
    <div className={styles.accountBar}>
      {props.onOpenIdentity ? (
        <button
          type="button"
          className={styles.accountBarToggle}
          aria-label={badgeLabel ? `${label}. ${badgeLabel}` : label}
          title={label}
          onClick={props.onOpenIdentity}
        >
          {identity}
        </button>
      ) : (
        <div className={styles.accountBarStatic} aria-label={label}>
          {identity}
        </div>
      )}

      {vault.exists && !isReadOnly && vault.autoLockEnabled && !vault.locked && (
        <button
          type="button"
          className={`${styles.lockBtn} ${styles.lockUnlocked}`}
          title={t('topbar.vaultUnlocked')}
          onClick={(e) => {
            e.stopPropagation()
            vault.lock()
          }}
        >
          <IconLockOpen />
        </button>
      )}
    </div>
  )
}
