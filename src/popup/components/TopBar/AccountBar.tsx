import { t } from '@lib/i18n.js'
import { IconLockOpen } from '@assets'
import { useAccount } from '../../context/AccountContext'
import { useVault } from '../../context/VaultContext'
import Avatar from '@components/Avatar/Avatar'
import styles from './TopBar.module.css'

/** Identity chip. Opens the account switcher; on X the bound key is locked. */
export default function AccountBar(props: {
  compact?: boolean
  accountsOpen?: boolean
  onOpenAccounts?: () => void
}) {
  const { displayName, displaySub, avatarUrl, initial, isReadOnly, active } =
    useAccount()
  const vault = useVault()

  const fallbackText = !active ? '+' : isReadOnly ? '\u{1F441}' : initial
  const label = props.compact
    ? `${t('topbar.activeAccount')}: ${displayName}`
    : t('topbar.activeAccount')

  const identity = (
    <>
      <div className={styles.avatarWrap}>
        <Avatar
          src={avatarUrl}
          fallback={fallbackText}
          imgClassName={styles.avatar}
          fallbackClassName={styles.avatarFallback}
        />
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
      {props.onOpenAccounts ? (
        <button
          type="button"
          className={styles.accountBarToggle}
          aria-label={label}
          aria-expanded={props.accountsOpen}
          aria-haspopup="menu"
          title={label}
          onClick={props.onOpenAccounts}
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
