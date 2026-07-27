import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type AppLogsState,
  type ExtensionResponse,
} from '../../shared/contracts'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import StatusDot from '@components/StatusDot/StatusDot'
import styles from '../CockpitApp.module.css'

async function loadLogs(): Promise<AppLogsState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_APP_LOGS',
    version: BACKGROUND_API_VERSION,
    errorLimit: 100,
    activityLimit: 80,
  })) as ExtensionResponse<AppLogsState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^wss:\/\//, '')
  }
}

interface LogPageProps {
  refreshToken: number
}

export default function LogPage({ refreshToken }: LogPageProps) {
  const [logs, setLogs] = useState<AppLogsState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setLogs(await loadLogs())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}
      {!logs && busy ? (
        <Card className={styles.section}>
          <p className={styles.muted}>Loading logs…</p>
        </Card>
      ) : null}

      {logs ? (
        <>
          <section className={styles.section}>
            <SectionLabel>Relay health</SectionLabel>
            <Card className={styles.panel}>
              {logs.relayHealth.length > 0 ? (
                <ul className={styles.list}>
                  {logs.relayHealth
                    .slice()
                    .sort((a, b) => a.relayUrl.localeCompare(b.relayUrl))
                    .map((row) => (
                      <li key={row.relayUrl}>
                        <span className={styles.relayLogRow}>
                          <StatusDot
                            status={
                              row.status === 'up'
                                ? 'reachable'
                                : row.status === 'down'
                                  ? 'unreachable'
                                  : 'checking'
                            }
                          />
                          <span className={styles.mono}>{hostOf(row.relayUrl)}</span>
                          {row.status === 'down' ? (
                            <span className={styles.downTag}>Down</span>
                          ) : null}
                        </span>
                        <strong className={styles.mutedInline}>
                          {row.lastError ??
                            (row.status === 'up' ? 'OK' : 'Unknown')}
                        </strong>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className={styles.muted}>
                  No relay health records yet. Open Network settings or sync to
                  probe relays.
                </p>
              )}
            </Card>
          </section>

          <section className={styles.section}>
            <SectionLabel>Relay error log</SectionLabel>
            <Card className={styles.panel}>
              {logs.relayErrors.length > 0 ? (
                <ul className={styles.logList}>
                  {logs.relayErrors.map((row) => (
                    <li key={row.id}>
                      <div className={styles.logMeta}>
                        <span className={styles.mono}>{hostOf(row.relayUrl)}</span>
                        <span className={styles.logKind}>{row.kind}</span>
                        <span className={styles.mutedInline}>
                          {new Date(row.at).toLocaleString()}
                        </span>
                      </div>
                      <p className={styles.logMessage}>{row.message}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No relay errors recorded.</p>
              )}
            </Card>
          </section>

          <section className={styles.section}>
            <SectionLabel>Activity</SectionLabel>
            <Card className={styles.panel}>
              {logs.activityLog.length > 0 ? (
                <ul className={styles.logList}>
                  {logs.activityLog.map((entry, index) => {
                    const ts =
                      typeof entry.ts === 'number'
                        ? entry.ts
                        : typeof entry.timestamp === 'number'
                          ? entry.timestamp
                          : undefined
                    const action =
                      typeof entry.action === 'string'
                        ? entry.action
                        : typeof entry.method === 'string'
                          ? entry.method
                          : 'activity'
                    const decision =
                      typeof entry.decision === 'string' ? entry.decision : ''
                    const kind =
                      typeof entry.kind === 'number' ? entry.kind : undefined
                    const origin =
                      typeof entry.origin === 'string'
                        ? entry.origin
                        : typeof entry.domain === 'string'
                          ? entry.domain
                          : ''
                    const label = [
                      action,
                      kind !== undefined ? String(kind) : undefined,
                      decision || undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                    return (
                      <li key={`${ts ?? index}:${action}:${origin}`}>
                        <div className={styles.logMeta}>
                          <span>{label}</span>
                          {origin ? (
                            <span className={styles.mono}>{origin}</span>
                          ) : null}
                          {ts ? (
                            <span className={styles.mutedInline}>
                              {new Date(ts).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className={styles.muted}>No activity yet.</p>
              )}
            </Card>
          </section>
        </>
      ) : null}
    </>
  )
}
