import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  BACKGROUND_API_VERSION,
  type EventListRow,
  type EventSortDir,
  type EventSortField,
  type EventsState,
  type ExtensionResponse,
} from '../../shared/contracts'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

const PAGE_SIZE = 50

const SORT_COLUMNS: Array<{
  id: EventSortField
  label: string
}> = [
  { id: 'kind', label: 'Kind' },
  { id: 'id', label: 'Event ID' },
  { id: 'pubkey', label: 'Author' },
  { id: 'created_at', label: 'Created' },
  { id: 'firstSeenAt', label: 'First seen' },
]

const RAW_ROW_FIELDS: Array<keyof EventListRow> = [
  'id',
  'pubkey',
  'npub',
  'created_at',
  'kind',
  'addressKey',
  'state',
  'tags',
  'content',
  'sig',
  'firstSeenAt',
]

async function loadEvents(options: {
  query: string
  offset: number
  sortBy: EventSortField
  sortDir: EventSortDir
}): Promise<EventsState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_EVENTS',
    version: BACKGROUND_API_VERSION,
    query: options.query,
    offset: options.offset,
    limit: PAGE_SIZE,
    sortBy: options.sortBy,
    sortDir: options.sortDir,
  })) as ExtensionResponse<EventsState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function kindLabel(kind: number): string {
  if (kind === 32009) return '32009 trust'
  if (kind === 32014) return '32014 rating'
  if (kind === 10011) return '10011 identity'
  return String(kind)
}

function eventValueLabel(row: EventListRow): string {
  if (row.kind === 32014) {
    if (row.ratingScore === '') return 'cancel'
    const labels =
      row.ratingLabels && row.ratingLabels.length > 0
        ? ` · ${row.ratingLabels.join(', ')}`
        : ''
    return row.ratingScore !== undefined ? `${row.ratingScore}${labels}` : '—'
  }
  if (row.trustValue === '1') return 'trust'
  if (row.trustValue === '-1') return 'distrust'
  if (row.trustValue === '0') return 'neutral'
  if (row.trustValue === '') return 'delete'
  return row.trustValue ?? '—'
}

function truncateHex(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function formatCreatedAt(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

function formatRowValue(field: keyof EventListRow, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (field === 'created_at' && typeof value === 'number') {
    return `${formatCreatedAt(value)} (${value})`
  }
  if (field === 'firstSeenAt' && typeof value === 'number') {
    return new Date(value).toLocaleString()
  }
  if (field === 'tags' && Array.isArray(value)) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  return String(value)
}

function defaultSortDir(field: EventSortField): EventSortDir {
  return field === 'created_at' || field === 'firstSeenAt' ? 'desc' : 'asc'
}

function sortMarker(
  field: EventSortField,
  sortBy: EventSortField,
  sortDir: EventSortDir,
): string {
  if (field !== sortBy) return ''
  return sortDir === 'asc' ? ' ↑' : ' ↓'
}

function popoverStyle(anchor: DOMRect): CSSProperties {
  const width = Math.min(480, window.innerWidth - 24)
  const maxHeight = Math.min(420, window.innerHeight - 24)
  let left = anchor.left
  let top = anchor.bottom + 8
  if (left + width > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - width - 12)
  }
  if (top + Math.min(280, maxHeight) > window.innerHeight - 12) {
    top = Math.max(12, anchor.top - 8 - Math.min(280, maxHeight))
  }
  return {
    position: 'fixed',
    left,
    top,
    width,
    maxHeight,
  }
}

interface EventsPageProps {
  refreshToken: number
}

export default function EventsPage({ refreshToken }: EventsPageProps) {
  const [filterInput, setFilterInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState<EventSortField>('created_at')
  const [sortDir, setSortDir] = useState<EventSortDir>('desc')
  const [data, setData] = useState<EventsState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)
  const [hoverRow, setHoverRow] = useState<EventListRow>()
  const [hoverAnchor, setHoverAnchor] = useState<DOMRect>()
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setData(
        await loadEvents({
          query: appliedQuery,
          offset,
          sortBy,
          sortDir,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      setBusy(false)
    }
  }, [appliedQuery, offset, sortBy, sortDir])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  useEffect(() => {
    setHoverRow(undefined)
    setHoverAnchor(undefined)
  }, [appliedQuery, offset, sortBy, sortDir, refreshToken])

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  const showRawRecord = (row: EventListRow, target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setHoverRow(row)
    setHoverAnchor(target.getBoundingClientRect())
  }

  const hideRawRecord = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      setHoverRow(undefined)
      setHoverAnchor(undefined)
    }, 120)
  }

  const keepRawRecord = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  const applyFilter = () => {
    const next = filterInput.trim()
    setOffset(0)
    setAppliedQuery(next)
  }

  const toggleSort = (field: EventSortField) => {
    setOffset(0)
    if (field === sortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(field)
    setSortDir(defaultSortDir(field))
  }

  const total = data?.total ?? 0
  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, total)
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <SectionLabel>Filter</SectionLabel>
        <Card className={styles.panel}>
          <div className={styles.filterRow}>
            <input
              type="search"
              className={styles.filterInput}
              placeholder="Filter by kind, id, pubkey, address, state, content, tags…"
              value={filterInput}
              onChange={(event) => setFilterInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilter()
              }}
              aria-label="Filter events"
            />
            <Button small variant="secondary" onClick={applyFilter}>
              Filter
            </Button>
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <SectionLabel>Cached events</SectionLabel>
        <div className={styles.statGrid}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{total}</span>
            <span className={styles.statLabel}>
              {appliedQuery ? 'Matching' : 'Stored'}
            </span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>
              {total === 0 ? '—' : `${pageStart}–${pageEnd}`}
            </span>
            <span className={styles.statLabel}>Showing</span>
          </div>
        </div>

        <Card className={styles.panel}>
          {!data && busy ? (
            <p className={styles.muted}>Loading events…</p>
          ) : null}

          {data && data.events.length === 0 ? (
            <p className={styles.muted}>
              {appliedQuery
                ? 'No events match this filter.'
                : 'No events cached yet.'}
            </p>
          ) : null}

          {data && data.events.length > 0 ? (
            <div
              className={styles.eventTable}
              role="table"
              aria-label="Cached events"
            >
              <div className={styles.eventTableHead} role="row">
                {SORT_COLUMNS.map((column) => {
                  const active = column.id === sortBy
                  return (
                    <button
                      key={column.id}
                      type="button"
                      role="columnheader"
                      className={`${styles.userSortHeader} ${active ? styles.userSortHeaderActive : ''}`}
                      aria-sort={
                        active
                          ? sortDir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      onClick={() => toggleSort(column.id)}
                    >
                      {column.label}
                      {sortMarker(column.id, sortBy, sortDir)}
                    </button>
                  )
                })}
                <span role="columnheader" className={styles.userSortHeader}>
                  Value
                </span>
                <span role="columnheader" className={styles.userSortHeader}>
                  Subject
                </span>
              </div>
              {data.events.map((row) => (
                <div key={row.id} className={styles.eventTableRow} role="row">
                  <div className={styles.userCell} role="cell">
                    <span
                      className={styles.proofBadge}
                      data-kind={row.kind}
                      title={`kind ${row.kind}`}
                    >
                      {kindLabel(row.kind)}
                    </span>
                  </div>
                  <div className={styles.userCell} role="cell">
                    <button
                      type="button"
                      className={`${styles.userHandle} ${styles.mono}`}
                      title={row.id}
                      onMouseEnter={(event) =>
                        showRawRecord(row, event.currentTarget)
                      }
                      onMouseLeave={hideRawRecord}
                      onFocus={(event) =>
                        showRawRecord(row, event.currentTarget)
                      }
                      onBlur={hideRawRecord}
                    >
                      {truncateHex(row.id)}
                    </button>
                  </div>
                  <div
                    className={`${styles.userCell} ${styles.mono}`}
                    role="cell"
                    title={`${row.npub}\n${row.pubkey}`}
                  >
                    {truncateHex(row.npub, 12, 8)}
                  </div>
                  <div
                    className={`${styles.userCell} ${styles.mutedInline}`}
                    role="cell"
                    title={String(row.created_at)}
                  >
                    {formatCreatedAt(row.created_at)}
                  </div>
                  <div
                    className={`${styles.userCell} ${styles.mutedInline}`}
                    role="cell"
                  >
                    {new Date(row.firstSeenAt).toLocaleString()}
                  </div>
                  <div className={styles.userCell} role="cell">
                    {eventValueLabel(row)}
                  </div>
                  <div
                    className={styles.userCell}
                    role="cell"
                    title={row.subjectId}
                  >
                    {row.subjectLabel ?? row.subjectSummary ?? '—'}
                    {row.subjectRole ? (
                      <span className={styles.mutedInline}>
                        {' '}
                        · {row.subjectRole}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {data && total > 0 ? (
            <div className={styles.pager}>
              <p className={styles.muted}>
                Page {Math.floor(offset / PAGE_SIZE) + 1} of{' '}
                {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </p>
              <div className={styles.pagerActions}>
                <Button
                  small
                  variant="secondary"
                  disabled={!canPrev || busy}
                  onClick={() =>
                    setOffset((value) => Math.max(0, value - PAGE_SIZE))
                  }
                >
                  Previous
                </Button>
                <Button
                  small
                  variant="secondary"
                  disabled={!canNext || busy}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </section>

      {hoverRow && hoverAnchor ? (
        <Card
          className={styles.userHoverCard}
          style={popoverStyle(hoverAnchor)}
          onMouseEnter={keepRawRecord}
          onMouseLeave={hideRawRecord}
        >
          <p className={styles.userHoverTitle}>
            event · kind {hoverRow.kind} · {truncateHex(hoverRow.id)}
          </p>
          <table className={styles.userHoverTable}>
            <tbody>
              {RAW_ROW_FIELDS.map((field) => (
                <tr key={field}>
                  <th scope="row">{field}</th>
                  <td className={styles.mono}>
                    {formatRowValue(field, hoverRow[field])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </>
  )
}
