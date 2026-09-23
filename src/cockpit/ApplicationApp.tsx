import { useEffect, useMemo, useState } from 'react'
import TopoBg from '@components/TopoBg/TopoBg'
import Button from '@components/Button/Button'
import { t } from '../lib/i18n'
import {
  isGraphDeepLink,
  parseGraphPageUrl,
} from '../shared/graph-deeplink'
import { isAdminKeyScenarioOperator } from '../shared/admin-key-scenarios'
import { applyApplicationTabTitle } from './application-tab-title'
import { closeGraphPage, loadActiveXAccount } from './graph/graph-rpc'
import {
  APPLICATION_STALE_TOPICS,
  isStaleTopicMessage,
} from './graph/graph-stale'
import GraphPage from './pages/GraphPage'
import CockpitPage from './pages/CockpitPage'
import LogPage from './pages/LogPage'
import UsersPage from './pages/UsersPage'
import UserEventsPage from './pages/UserEventsPage'
import EventsPage from './pages/EventsPage'
import PostsPage from './pages/PostsPage'
import OutboxPage from './pages/OutboxPage'
import DangerZonePage from './pages/DangerZonePage'
import AdminPage from './pages/AdminPage'
import type { XIdentityListRow } from '../shared/contracts'
import styles from './CockpitApp.module.css'

type AppPage =
  | 'users'
  | 'user-events'
  | 'posts'
  | 'events'
  | 'outbox'
  | 'cockpit'
  | 'log'
  | 'danger'
  | 'admin'

const PAGES: Array<{ id: AppPage; label: string; blurb: string }> = [
  {
    id: 'users',
    label: 'Users',
    blurb: 'Durable X↔Nostr bindings from IndexedDB xIdentities.',
  },
  {
    id: 'posts',
    label: 'Posts',
    blurb: 'Trust-gated X post chrome from timeline-seen subjects (xPosts).',
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
  {
    id: 'admin',
    label: 'Admin',
    blurb: 'Key-management fixtures for @TrustProtocol testing.',
  },
]

function pageFromSearch(search: string): AppPage | undefined {
  const page = new URLSearchParams(search).get('page')
  if (
    page === 'users' ||
    page === 'user-events' ||
    page === 'posts' ||
    page === 'events' ||
    page === 'outbox' ||
    page === 'cockpit' ||
    page === 'log' ||
    page === 'danger' ||
    page === 'admin'
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
  const [dataStale, setDataStale] = useState(false)
  const [adminVisible, setAdminVisible] = useState(false)
  const [userEventsTwitterId, setUserEventsTwitterId] = useState<string>()
  const [userEventsIdentity, setUserEventsIdentity] = useState<
    XIdentityListRow | undefined
  >()

  const active = useMemo(() => {
    if (page === 'user-events') {
      return {
        id: 'user-events' as const,
        label: 'User events',
        blurb: 'Events authored by this X user’s linked Nostr pubkey(s).',
      }
    }
    return PAGES.find((entry) => entry.id === page) ?? PAGES[0]!
  }, [page])

  useEffect(() => {
    if (!fullscreenGraph) applyApplicationTabTitle('application')
  }, [fullscreenGraph])

  useEffect(() => {
    if (fullscreenGraph) return
    let cancelled = false
    void loadActiveXAccount()
      .then((account) => {
        if (cancelled) return
        const visible = isAdminKeyScenarioOperator(account?.handle)
        setAdminVisible(visible)
        if (!visible) {
          setPage((current) => (current === 'admin' ? 'users' : current))
        }
      })
      .catch(() => {
        if (cancelled) return
        setAdminVisible(false)
        setPage((current) => (current === 'admin' ? 'users' : current))
      })
    return () => {
      cancelled = true
    }
  }, [fullscreenGraph, refreshToken])

  useEffect(() => {
    if (fullscreenGraph) return
    const onMessage = (message: unknown) => {
      if (isStaleTopicMessage(message, APPLICATION_STALE_TOPICS)) {
        setDataStale(true)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [fullscreenGraph])

  const refreshView = () => {
    setDataStale(false)
    setRefreshToken((value) => value + 1)
  }

  if (fullscreenGraph) {
    return (
      <GraphPage
        refreshToken={refreshToken}
        deepLink={deepLink}
        fullscreen
      />
    )
  }

  const navPages = PAGES.filter(
    (entry) => entry.id !== 'user-events' && (entry.id !== 'admin' || adminVisible),
  )

  return (
    <TopoBg className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Attention</p>
          <h1>Application</h1>
          <p className={styles.subtitle}>{active.blurb}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            small
            variant="secondary"
            onClick={refreshView}
          >
            {t('application.refresh')}
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

      {dataStale ? (
        <div
          className={styles.staleBanner}
          role="status"
          data-application-stale=""
        >
          <span>{t('application.staleHint')}</span>
          <Button small variant="secondary" onClick={refreshView}>
            {t('application.refresh')}
          </Button>
        </div>
      ) : null}

      <nav className={styles.tabs} aria-label="Application pages">
        {navPages.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`${styles.tab} ${page === entry.id || (page === 'user-events' && entry.id === 'users') ? styles.tabActive : ''}`}
            onClick={() => {
              setPage(entry.id)
              if (entry.id !== 'user-events') {
                setUserEventsTwitterId(undefined)
                setUserEventsIdentity(undefined)
              }
            }}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {page === 'users' ? (
        <UsersPage
          refreshToken={refreshToken}
          onOpenUserEvents={(row) => {
            setUserEventsTwitterId(row.twitterId)
            setUserEventsIdentity(row)
            setPage('user-events')
          }}
        />
      ) : null}
      {page === 'user-events' && userEventsTwitterId ? (
        <UserEventsPage
          twitterId={userEventsTwitterId}
          identity={userEventsIdentity}
          refreshToken={refreshToken}
          onBack={() => {
            setPage('users')
            setUserEventsTwitterId(undefined)
            setUserEventsIdentity(undefined)
          }}
        />
      ) : null}
      {page === 'posts' ? <PostsPage refreshToken={refreshToken} /> : null}
      {page === 'events' ? <EventsPage refreshToken={refreshToken} /> : null}
      {page === 'outbox' ? <OutboxPage refreshToken={refreshToken} /> : null}
      {page === 'cockpit' ? <CockpitPage refreshToken={refreshToken} /> : null}
      {page === 'log' ? <LogPage refreshToken={refreshToken} /> : null}
      {page === 'danger' ? <DangerZonePage /> : null}
      {page === 'admin' && adminVisible ? (
        <AdminPage refreshToken={refreshToken} />
      ) : null}
    </TopoBg>
  )
}
