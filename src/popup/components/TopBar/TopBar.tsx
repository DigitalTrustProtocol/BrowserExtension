import GlobeButton from './GlobeButton'
import AccountBar from './AccountBar'
import styles from './TopBar.module.css'

export default function TopBar() {
  return (
    <div className={styles.topBar}>
      <div className={styles.accountWrap}>
        <AccountBar />
      </div>
      <GlobeButton />
    </div>
  )
}
