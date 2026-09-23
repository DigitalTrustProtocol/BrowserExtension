import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type CockpitState,
  type CockpitStorageStats,
  type ExtensionResponse,
} from '../../shared/contracts'
import { formatBytes } from '../../shared/format/bytes'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

const STORE_LABELS: Record<string, string> = {
  events: 'Signed events',
  relayObservations: 'Relay observations',
  syncCursors: 'Sync cursors',
  xIdentities: 'X identity records',
  xPosts: 'X post records',
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

const MB = 1024 * 1024

const BUDGET_STATUS_LABELS = {
  ok: 'Within budget',
  overSoft: 'Over soft budget',
  overHard: 'Over hard budget',
} as const

function StorageBudgetCard({ storage }: { storage: CockpitStorageStats }) {
  const retention = storage.retention
  if (!retention) return null
  const { settings, stats } = retention
  return (
    <Card className={styles.panel}>
      <h2>Storage budget and idle data</h2>
      <p className={styles.muted}>
        Estimates only; nothing is pruned yet. Idle rows were last seen on X
        before the cutoff. Pruning runs only above the soft budget: idle-post
        events, and events by authors outside every local key&apos;s WoT (Max
        degree). X identity and post rows always stay.
      </p>
      <StatGrid
        items={[
          {
            label: 'Origin usage',
            value:
              stats.usageBytes !== undefined
                ? formatBytes(stats.usageBytes)
                : '—',
          },
          {
            label: 'IndexedDB usage',
            value:
              stats.indexedDbBytes !== undefined
                ? formatBytes(stats.indexedDbBytes)
                : '—',
          },
          {
            label: 'Browser quota',
            value:
              stats.quotaBytes !== undefined
                ? formatBytes(stats.quotaBytes)
                : '—',
          },
          {
            label: 'Budget (soft / hard)',
            value: `${formatBytes(settings.softBudgetMb * MB)} / ${formatBytes(settings.hardBudgetMb * MB)}`,
          },
          { label: 'Status', value: BUDGET_STATUS_LABELS[stats.budgetStatus] },
          {
            label: 'Persistent storage',
            value:
              stats.persisted === undefined
                ? '—'
                : stats.persisted
                  ? 'Granted'
                  : 'Not granted',
          },
          {
            label: 'Avg event size',
            value: formatBytes(stats.avgEventBytes),
          },
          {
            label: 'Events (est. size)',
            value: `${stats.eventCount} · ${formatBytes(stats.estimatedEventBytes)}`,
          },
        ]}
      />
      <div className={styles.split}>
        <div>
          <h2>Idle rows by last seen</h2>
          <ul className={styles.list}>
            {storage.idleBuckets.map((bucket) => (
              <li key={bucket.days}>
                <span>&gt; {bucket.days} days</span>
                <strong>
                  {bucket.posts} posts · {bucket.users} users
                </strong>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Reclaimable at current knobs</h2>
          <ul className={styles.list}>
            <li>
              <span>
                Posts idle &gt; {settings.postIdleDays} days
                {settings.prunePostEvents ? ' (pruning on)' : ''}
              </span>
              <strong>
                {stats.idlePosts.rows} ({stats.idlePosts.seenOnce} seen once) ·{' '}
                {stats.idlePosts.events} events ·{' '}
                {formatBytes(stats.idlePosts.estimatedBytes)}
              </strong>
            </li>
            <li>
              <span>
                Outside WoT, held &gt; 30 days
                {settings.pruneUserEvents ? ' (pruning on)' : ''}
              </span>
              <strong>
                {stats.outsideWot.authors} authors · {stats.outsideWot.events}{' '}
                events · {formatBytes(stats.outsideWot.estimatedBytes)}
              </strong>
            </li>
            <li>
              <span>Pruner</span>
              <strong>
                {stats.prune.lastRunAt !== undefined
                  ? `last ${new Date(stats.prune.lastRunAt).toLocaleString()} · ${stats.prune.lastDeleted} removed · ${stats.prune.totalDeleted} this session`
                  : stats.prune.lastSkipped
                    ? `idle (${stats.prune.lastSkipped})`
                    : 'not run yet'}
              </strong>
            </li>
          </ul>
        </div>
      </div>
    </Card>
  )
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
                {
                  label: 'Sync & Resolve degree',
                  value: extension?.wotMaxDegree ?? '—',
                },
                {
                  label: 'Follow-trust band',
                  value:
                    extension?.followTrustRed !== undefined &&
                    extension?.followTrustGreen !== undefined
                      ? `${extension.followTrustRed}–${extension.followTrustGreen}%`
                      : '—',
                },
              ]}
            />
          </section>

          <section className={styles.section}>
            <SectionLabel>Trust resolve timing</SectionLabel>
            <p className={styles.muted}>
              Cold resolves only (memo hits skipped). Averages shift as the local
              graph grows. Bucketed by hitting degree, not the slider setting.
            </p>
            <StatGrid
              items={[
                ...([1, 2, 3, 4, 5] as const).map((degree) => {
                  const bucket = state.resolveTiming?.byDegree[degree]
                  return {
                    label: `${degree}° avg`,
                    value:
                      bucket && bucket.samples > 0
                        ? `${bucket.avgMs.toFixed(1)} ms · ${bucket.samples}`
                        : '—',
                  }
                }),
                {
                  label: 'No match avg',
                  value:
                    state.resolveTiming?.noMatch.samples
                      ? `${state.resolveTiming.noMatch.avgMs.toFixed(1)} ms · ${state.resolveTiming.noMatch.samples}`
                      : '—',
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
            {storage ? <StorageBudgetCard storage={storage} /> : null}
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
