import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type CockpitState,
  type ExtensionResponse,
} from '../../shared/contracts'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

const STORE_LABELS: Record<string, string> = {
  events: 'Signed events',
  addresses: 'Address winners',
  tagIndex: 'Tag index rows',
  relayObservations: 'Relay observations',
  syncCursors: 'Sync cursors',
  xIdentities: 'X identity records',
  handleAliases: 'Handle aliases',
  identityObservations: 'Identity observations',
  identityResolutionCache: 'Resolution cache',
  outbox: 'Outbox jobs',
  relayHealth: 'Relay health',
  relayErrorLog: 'Relay error log',
}

async function loadCockpit(): Promise<CockpitState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_COCKPIT_STATE',
  })) as ExtensionResponse<CockpitState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function StatGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number }>
}) {
  return (
    <div className={styles.statGrid}>
      {items.map((item) => (
        <div key={item.label} className={styles.statCard}>
          <span className={styles.statValue}>{item.value}</span>
          <span className={styles.statLabel}>{item.label}</span>
        </div>
      ))}
    </div>
  )
}

interface CockpitPageProps {
  refreshToken: number
}

export default function CockpitPage({ refreshToken }: CockpitPageProps) {
  const [state, setState] = useState<CockpitState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setState(await loadCockpit())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cockpit')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  const extension = state?.extension
  const storage = state?.storage
  const chromeStorage = state?.chromeStorage

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      {!state && busy ? (
        <Card className={styles.section}>
          <p className={styles.muted}>Loading telemetry…</p>
        </Card>
      ) : null}

      {state ? (
        <>
          <section className={styles.section}>
            <SectionLabel>Overview</SectionLabel>
            <StatGrid
              items={[
                {
                  label: 'Identity',
                  value: extension?.hasIdentity
                    ? extension.vaultLocked
                      ? 'Locked'
                      : 'Ready'
                    : 'None',
                },
                {
                  label: 'Trust events (32009)',
                  value: extension?.cachedEventCount ?? 0,
                },
                {
                  label: 'Relays',
                  value: extension?.relays.length ?? 0,
                },
                {
                  label: 'Sync',
                  value: extension?.syncStatus?.state ?? 'idle',
                },
                {
                  label: 'Accounts',
                  value: chromeStorage?.accountCount ?? 0,
                },
                {
                  label: 'Connected sites',
                  value: chromeStorage?.allowedDomainCount ?? 0,
                },
              ]}
            />
          </section>

          <section className={styles.section}>
            <SectionLabel>Identity & session</SectionLabel>
            <Card className={styles.panel}>
              <dl className={styles.detailList}>
                <div>
                  <dt>npub</dt>
                  <dd className={styles.mono}>{extension?.npub ?? '—'}</dd>
                </div>
                <div>
                  <dt>Active X account</dt>
                  <dd>
                    {extension?.activeXAccount
                      ? `@${extension.activeXAccount.handle}${
                          extension.activeXAccount.twitterId
                            ? ` · ${extension.activeXAccount.twitterId}`
                            : ''
                        }`
                      : 'Not observed'}
                  </dd>
                </div>
                <div>
                  <dt>Proof session</dt>
                  <dd>
                    {extension?.proofSession
                      ? `@${extension.proofSession.handle} · ${extension.proofSession.twitterId}`
                      : 'None'}
                  </dd>
                </div>
                <div>
                  <dt>Vault</dt>
                  <dd>
                    {chromeStorage?.vaultExists
                      ? extension?.vaultLocked
                        ? 'Encrypted · locked'
                        : 'Encrypted · unlocked'
                      : 'Not created'}
                  </dd>
                </div>
                <div>
                  <dt>Configured relays</dt>
                  <dd className={styles.mono}>
                    {(extension?.relays ?? []).join('\n') || '—'}
                  </dd>
                </div>
              </dl>
            </Card>
          </section>

          <section className={styles.section}>
            <SectionLabel>
              IndexedDB · {storage?.databaseName} v{storage?.databaseVersion}
            </SectionLabel>
            <StatGrid
              items={(storage ? Object.entries(storage.stores) : []).map(
                ([key, count]) => ({
                  label: STORE_LABELS[key] ?? key,
                  value: count,
                }),
              )}
            />
            <div className={styles.split}>
              <Card className={styles.panel}>
                <h2>Events by kind</h2>
                {storage && Object.keys(storage.eventsByKind).length > 0 ? (
                  <ul className={styles.list}>
                    {Object.entries(storage.eventsByKind)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([kind, count]) => (
                        <li key={kind}>
                          <span className={styles.mono}>kind {kind}</span>
                          <strong>{count}</strong>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className={styles.muted}>No cached events yet.</p>
                )}
              </Card>
              <Card className={styles.panel}>
                <h2>Outbox relay states</h2>
                {storage ? (
                  <ul className={styles.list}>
                    {Object.entries(storage.outboxByStatus).map(
                      ([status, count]) => (
                        <li key={status}>
                          <span>{status}</span>
                          <strong>{count}</strong>
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </Card>
            </div>
          </section>

          <section className={styles.section}>
            <SectionLabel>chrome.storage</SectionLabel>
            <StatGrid
              items={[
                {
                  label: 'local keys',
                  value: chromeStorage?.localKeys.length ?? 0,
                },
                {
                  label: 'sync keys',
                  value: chromeStorage?.syncKeys.length ?? 0,
                },
                {
                  label: 'local size (est.)',
                  value: formatBytes(chromeStorage?.localBytesEstimate ?? 0),
                },
                {
                  label: 'sync size (est.)',
                  value: formatBytes(chromeStorage?.syncBytesEstimate ?? 0),
                },
                {
                  label: 'NIP-07 activity entries',
                  value: chromeStorage?.activityLogCount ?? 0,
                },
              ]}
            />
            <p className={styles.muted}>
              API v{BACKGROUND_API_VERSION} ·{' '}
              {new Date(state.generatedAt).toLocaleString()}
            </p>
          </section>
        </>
      ) : null}
    </>
  )
}
