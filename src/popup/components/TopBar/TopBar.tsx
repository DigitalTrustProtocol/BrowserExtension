import { useState } from 'react'
import GlobeButton from './GlobeButton'
import AccountBar from './AccountBar'
import AccountDropdown from './AccountDropdown'
import styles from './TopBar.module.css'

export default function TopBar(props: {
  onCover?: boolean
  onAddAccount?: () => void
}) {
  const [accountsOpen, setAccountsOpen] = useState(false)

  return (
    <div
      className={`${styles.topBar}${props.onCover ? ` ${styles.topBarOnCover}` : ''}`}
    >
      <div className={styles.accountWrap}>
        <AccountBar
          compact={props.onCover}
          {...(props.onCover
            ? {
                accountsOpen,
                onOpenAccounts: () => setAccountsOpen((open) => !open),
              }
            : {})}
        />
        {accountsOpen ? (
          <AccountDropdown
            onClose={() => setAccountsOpen(false)}
            onAddAccount={() => {
              setAccountsOpen(false)
              props.onAddAccount?.()
            }}
          />
        ) : null}
      </div>
      <GlobeButton />
    </div>
  )
}
