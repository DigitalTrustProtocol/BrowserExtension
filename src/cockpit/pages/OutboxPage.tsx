import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type OutboxListRow,
  type OutboxState,
  type PublishResult,
} from '../../shared/contracts'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

interface OutboxPageProps {
  refreshToken: number
}

async function loadOutbox(): Promise<OutboxState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_OUTBOX',
    version: BACKGROUND_API_VERSION,
  })) as ExtensionResponse<OutboxState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function truncateHex(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function formatHold(heldUntil: number | undefined, now: number): string {
  if (heldUntil === undefined) return '—'
  const remaining = heldUntil - now
  if (remaining <= 0) return 'Due now'
  const seconds = Math.ceil(remaining / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  return `~${minutes}m`
}

function needsPublish(row: OutboxListRow): boolean {
  return row.relays.some(
    (relay) =>
      relay.status === 'pending' ||
      relay.status === 'failed' ||
      relay.status === 'exhausted',
  )
}

function relaySummary(row: OutboxListRow): string {
  const counts = { pending: 0, published: 0, failed: 0, exhausted: 0 }
  for (const relay of row.relays) {
    counts[relay.status] += 1
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`)
    .join(' · ')
}

export default function OutboxPage({ refreshToken }: OutboxPageProps) {
  const [data, setData] = useState<OutboxState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)
  const [actionBusy, setActionBusy] = useState<string>()
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setData(await loadOutbox())
      setNow(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  async function publishOne(eventId: string): Promise<void> {
    setActionBusy(eventId)
    setError(undefined)
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'PUBLISH_OUTBOX_NOW',
        version: BACKGROUND_API_VERSION,
        eventId,
      })) as ExtensionResponse<PublishResult>
      if (!response.ok) throw new Error(response.error)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(undefined)
    }
  }

  async function publishAll(): Promise<void> {
    setActionBusy('all')
    setError(undefined)
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'PUBLISH_OUTBOX_ALL_NOW',
        version: BACKGROUND_API_VERSION,
      })) as ExtensionResponse<{ published: number }>
      if (!response.ok) throw new Error(response.error)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(undefined)
    }
  }

  async function removeOne(row: OutboxListRow): Promise<void> {
    const warn = row.anyPublished
      ? 'This event was already delivered to at least one relay. Remove only deletes the local copy and does not recall relay copies. Continue?'
      : 'Remove this event from the local outbox and graph?'
    if (!window.confirm(warn)) return
    setActionBusy(`delete:${row.eventId}`)
    setError(undefined)
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'DELETE_OUTBOX_EVENT',
        version: BACKGROUND_API_VERSION,
        eventId: row.eventId,
      })) as ExtensionResponse<{ deleted: boolean }>
      if (!response.ok) throw new Error(response.error)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(undefined)
    }
  }

  const items = data?.items ?? []
  const pendingCount = items.filter(needsPublish).length

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <div className={styles.headerActions} style={{ marginBottom: 12 }}>
          <SectionLabel>Outbox Manager</SectionLabel>
          <Button
            small
            variant="secondary"
            disabled={busy || actionBusy !== undefined || pendingCount === 0}
            onClick={() => void publishAll()}
          >
            {actionBusy === 'all' ? 'Publishing…' : 'Publish all now'}
          </Button>
        </div>
        <Card className={styles.panel}>
          <p className={styles.muted}>
            Signed events waiting for relay delivery. New publishes are held
            about 5 minutes so you can replace or remove them first. Remove
            deletes the local event and graph edge; it does not recall
            already-delivered relay copies.
          </p>

          {busy && !data ? <p className={styles.muted}>Loading…</p> : null}
          {!busy && items.length === 0 ? (
            <p className={styles.muted}>Outbox is empty.</p>
          ) : null}

          {items.length > 0 ? (
            <ul className={styles.list}>
              {items.map((row) => (
                <li key={row.eventId}>
                  <div>
                    <strong>
                      {row.kind ?? '—'} · {truncateHex(row.eventId)}
                    </strong>
                    <div className={styles.muted}>
                      {row.subjectSummary ?? 'no subject preview'}
                      {row.trustValue ? ` · v=${row.trustValue}` : ''}
                      {row.ratingScore !== undefined
                        ? ` · score=${row.ratingScore}`
                        : ''}
                      {row.ratingLabels && row.ratingLabels.length > 0
                        ? ` · ${row.ratingLabels.join(', ')}`
                        : ''}
                      {' · hold '}
                      {formatHold(row.heldUntil, now)}
                      {' · '}
                      {relaySummary(row)}
                    </div>
                    {row.content ? (
                      <div className={styles.muted}>{row.content}</div>
                    ) : null}
                  </div>
                  <div className={styles.headerActions}>
                    <Button
                      small
                      variant="secondary"
                      disabled={
                        actionBusy !== undefined || !needsPublish(row)
                      }
                      onClick={() => void publishOne(row.eventId)}
                    >
                      {actionBusy === row.eventId
                        ? 'Publishing…'
                        : 'Publish now'}
                    </Button>
                    <Button
                      small
                      variant="danger"
                      disabled={actionBusy !== undefined}
                      onClick={() => void removeOne(row)}
                    >
                      {actionBusy === `delete:${row.eventId}`
                        ? 'Removing…'
                        : 'Remove'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>
    </>
  )
}
