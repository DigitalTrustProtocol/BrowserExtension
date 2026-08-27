import { t } from '@lib/i18n.js'
import { IconClose, IconSettings } from '@assets'
import GlobeButton from './GlobeButton'
import AccountBar from './AccountBar'
import styles from './TopBar.module.css'

export default function TopBar(props: {
  onCover?: boolean
  onClose?: () => void
  onMenu?: () => void
  onOpenIdentity?: () => void
}) {
  return (
    <div
      className={`${styles.topBar}${props.onCover ? ` ${styles.topBarOnCover}` : ''}`}
    >
      <div className={styles.accountWrap}>
        <AccountBar compact={props.onCover} onOpenIdentity={props.onOpenIdentity} />
      </div>
      <GlobeButton />
      {props.onMenu ? (
        <button
          type="button"
          className={styles.menuBtn}
          onClick={props.onMenu}
          title={t('panel.menu')}
          aria-label={t('panel.menu')}
        >
          <IconSettings size={16} />
        </button>
      ) : null}
      {props.onCover && props.onClose ? (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={props.onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <IconClose size={16} />
        </button>
      ) : null}
    </div>
  )
}
