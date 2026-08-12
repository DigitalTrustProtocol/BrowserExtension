import { t } from '@lib/i18n.js'
import { IconLockOpen } from '@assets'
import { useAccount } from '../../context/AccountContext'
import { useVault } from '../../context/VaultContext'
import Avatar from '@components/Avatar/Avatar'
import styles from './TopBar.module.css'

/** Read-only identity chip (no account switcher). */
export default function AccountBar() {
  const { displayName, displaySub, avatarUrl, initial, isReadOnly, active } =
    useAccount()
  const vault = useVault()

  const fallbackText = !active ? '+' : isReadOnly ? '\u{1F441}' : initial

  return (
    <div className={styles.accountBar}>
      <div className={styles.accountBarStatic} aria-label={t('topbar.activeAccount')}>
        <div className={styles.avatarWrap}>
          <Avatar
            src={avatarUrl}
            fallback={fallbackText}
            imgClassName={styles.avatar}
            fallbackClassName={styles.avatarFallback}
          />
        </div>
        <div className={styles.barInfo}>
          <div className={styles.barNameRow}>
            <span className={styles.barName}>{displayName}</span>
            {isReadOnly && (
              <span className={styles.readOnlyBadge}>{t('account.readOnly')}</span>
            )}
          </div>
          <span className={styles.barSub}>{displaySub}</span>
        </div>
      </div>

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
