import { useMemo, useState } from 'react'
import TopoBg from '@components/TopoBg/TopoBg'
import Button from '@components/Button/Button'
import GraphPage from './pages/GraphPage'
import CockpitPage from './pages/CockpitPage'
import LogPage from './pages/LogPage'
import UsersPage from './pages/UsersPage'
import styles from './CockpitApp.module.css'

type AppPage = 'graph' | 'users' | 'cockpit' | 'log'

const PAGES: Array<{ id: AppPage; label: string; blurb: string }> = [
  {
    id: 'graph',
    label: 'Graph',
    blurb: 'In-memory Web of Trust from the active Nostr identity.',
  },
  {
    id: 'users',
    label: 'Users',
    blurb: 'Durable X↔Nostr bindings from IndexedDB xIdentities.',
  },
  {
    id: 'cockpit',
    label: 'Cockpit',
    blurb: 'Local telemetry: IndexedDB, chrome.storage, sync, and identity.',
  },
  {
    id: 'log',
    label: 'Log',
    blurb: 'Relay health, socket errors, and NIP-07 activity.',
  },
]

export default function ApplicationApp() {
  const [page, setPage] = useState<AppPage>('graph')
  const [refreshToken, setRefreshToken] = useState(0)

  const active = useMemo(
    () => PAGES.find((entry) => entry.id === page) ?? PAGES[0]!,
    [page],
  )

  return (
    <TopoBg className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>AttentionX</p>
          <h1>Application</h1>
          <p className={styles.subtitle}>{active.blurb}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            small
            variant="secondary"
            onClick={() => setRefreshToken((value) => value + 1)}
          >
            Refresh
          </Button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Application pages">
        {PAGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`${styles.tab} ${page === entry.id ? styles.tabActive : ''}`}
            onClick={() => setPage(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {page === 'graph' ? <GraphPage refreshToken={refreshToken} /> : null}
      {page === 'users' ? <UsersPage refreshToken={refreshToken} /> : null}
      {page === 'cockpit' ? <CockpitPage refreshToken={refreshToken} /> : null}
      {page === 'log' ? <LogPage refreshToken={refreshToken} /> : null}
    </TopoBg>
  )
}
