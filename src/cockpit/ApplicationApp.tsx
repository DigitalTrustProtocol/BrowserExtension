import { useMemo, useState } from 'react'
import TopoBg from '@components/TopoBg/TopoBg'
import Button from '@components/Button/Button'
import { t } from '../lib/i18n'
import {
  isGraphDeepLink,
  parseGraphPageUrl,
} from '../shared/graph-deeplink'
import { closeGraphPage } from './graph/graph-rpc'
import GraphPage from './pages/GraphPage'
import CockpitPage from './pages/CockpitPage'
import LogPage from './pages/LogPage'
import UsersPage from './pages/UsersPage'
import EventsPage from './pages/EventsPage'
import OutboxPage from './pages/OutboxPage'
import DangerZonePage from './pages/DangerZonePage'
import styles from './CockpitApp.module.css'

type AppPage = 'users' | 'events' | 'outbox' | 'cockpit' | 'log' | 'danger'

const PAGES: Array<{ id: AppPage; label: string; blurb: string }> = [
  {
    id: 'users',
    label: 'Users',
    blurb: 'Durable X↔Nostr bindings from IndexedDB xIdentities.',
  },
  {
    id: 'events',
    label: 'Events',
    blurb: 'Signed Nostr events cached in IndexedDB.',
  },
  {
    id: 'outbox',
    label: 'Outbox',
    blurb: 'Queued publishes with a 5-minute regret hold before relays.',
  },
  {
    id: 'cockpit',
    label: 'Telemetry',
    blurb: 'Local telemetry: IndexedDB, chrome.storage, sync, and identity.',
  },
  {
    id: 'log',
    label: 'Logs',
    blurb: 'Relay health, socket errors, and NIP-07 activity.',
  },
  {
    id: 'danger',
    label: 'Danger Zone',
    blurb: 'Permanently delete keys, accounts, or cached local data.',
  },
]

function pageFromSearch(search: string): AppPage | undefined {
  const page = new URLSearchParams(search).get('page')
  if (
    page === 'users' ||
    page === 'events' ||
    page === 'outbox' ||
    page === 'cockpit' ||
    page === 'log' ||
    page === 'danger'
  ) {
    return page
  }
  return undefined
}

export default function ApplicationApp() {
  const deepLink = useMemo(
    () => parseGraphPageUrl(window.location.search),
    [],
  )
  const fullscreenGraph = isGraphDeepLink(deepLink)
  const [page, setPage] = useState<AppPage>(
    () => pageFromSearch(window.location.search) ?? 'users',
  )
  const [refreshToken, setRefreshToken] = useState(0)

  const active = useMemo(
    () => PAGES.find((entry) => entry.id === page) ?? PAGES[0]!,
    [page],
  )

  if (fullscreenGraph) {
    return (
      <GraphPage
        refreshToken={refreshToken}
        deepLink={deepLink}
        fullscreen
      />
    )
  }

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
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => {
              void closeGraphPage().catch(() => {
                window.close()
              })
            }}
          >
            {t('common.close')}
          </button>
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

      {page === 'users' ? <UsersPage refreshToken={refreshToken} /> : null}
      {page === 'events' ? <EventsPage refreshToken={refreshToken} /> : null}
      {page === 'outbox' ? <OutboxPage refreshToken={refreshToken} /> : null}
      {page === 'cockpit' ? <CockpitPage refreshToken={refreshToken} /> : null}
      {page === 'log' ? <LogPage refreshToken={refreshToken} /> : null}
      {page === 'danger' ? <DangerZonePage /> : null}
    </TopoBg>
  )
}
