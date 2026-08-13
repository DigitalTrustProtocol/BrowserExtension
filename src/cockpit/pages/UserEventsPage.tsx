import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type EventListRow,
  type EventSortDir,
  type EventSortField,
  type EventsState,
  type ExtensionResponse,
  type XIdentityListRow,
} from '../../shared/contracts'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import { IconChevronLeft } from '../../assets'
import styles from '../CockpitApp.module.css'

const PAGE_SIZE = 50

async function loadUserEvents(options: {
  twitterId: string
  query: string
  offset: number
  sortBy: EventSortField
  sortDir: EventSortDir
}): Promise<EventsState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_EVENTS',
    version: BACKGROUND_API_VERSION,
    twitterId: options.twitterId,
    query: options.query,
    offset: options.offset,
    limit: PAGE_SIZE,
    sortBy: options.sortBy,
    sortDir: options.sortDir,
  })) as ExtensionResponse<EventsState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function truncateHex(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function subjectCell(row: EventListRow): string {
  if (row.subjectLabel) return row.subjectLabel
  if (row.subjectSummary) return row.subjectSummary
  return '—'
}

function trustLabel(row: EventListRow): string {
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
  if (row.trustValue === '0') return 'cancel'
  return row.trustValue ?? '—'
}

export interface UserEventsPageProps {
  twitterId: string
  identity?: XIdentityListRow
  refreshToken: number
  onBack: () => void
}

export default function UserEventsPage({
  twitterId,
  identity,
  refreshToken,
  onBack,
}: UserEventsPageProps) {
  const [filterInput, setFilterInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortBy] = useState<EventSortField>('created_at')
  const [sortDir] = useState<EventSortDir>('desc')
  const [data, setData] = useState<EventsState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setData(
        await loadUserEvents({
          twitterId,
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
  }, [twitterId, appliedQuery, offset, sortBy, sortDir])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  const title =
    identity?.displayName?.trim() ||
    (identity?.handle ? `@${identity.handle}` : twitterId)
  const avatarUrl = identity?.iconPath
    ? buildXProfileIconUrl(identity.iconPath)
    : undefined
  const total = data?.total ?? 0
  const linked = (data?.filterPubkeys?.length ?? 0) > 0
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <div className={styles.userEventsHeader}>
          <button
            type="button"
            className={styles.backLink}
            onClick={onBack}
            aria-label="Back to users"
          >
            <IconChevronLeft size={18} aria-hidden="true" />
            Users
          </button>
          <div className={styles.userIdentity}>
            {avatarUrl ? (
              <img
                className={styles.userAvatar}
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className={styles.userAvatarFallback} aria-hidden>
                {title.charAt(0).toUpperCase()}
              </span>
            )}
            <span className={styles.userIdentityText}>
              <span className={styles.userDisplayName}>{title}</span>
              {identity?.handle ? (
                <span className={styles.userHandleSub}>@{identity.handle}</span>
              ) : null}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <SectionLabel>Events by linked Nostr identity</SectionLabel>
        <Card className={styles.panel}>
          {!linked && !busy ? (
            <p className={styles.muted}>
              No linked Nostr pubkey for this X user yet. Events appear here
              when Bio, post, NIP-39, or trust-hint npub is set.
            </p>
          ) : null}

          <div className={styles.filterRow}>
            <input
              className={styles.filterInput}
              value={filterInput}
              onChange={(event) => setFilterInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setOffset(0)
                  setAppliedQuery(filterInput.trim())
                }
              }}
              placeholder="Filter events…"
              aria-label="Filter events"
            />
            <Button
              small
              variant="secondary"
              onClick={() => {
                setOffset(0)
                setAppliedQuery(filterInput.trim())
              }}
            >
              Apply
            </Button>
          </div>

          {busy && !data ? (
            <p className={styles.muted}>Loading events…</p>
          ) : null}

          {data && total === 0 && linked ? (
            <p className={styles.muted}>No events for this author.</p>
          ) : null}

          {data && total > 0 ? (
            <div
              className={`${styles.userTable} ${styles.userEventsTable}`}
              role="table"
              aria-label="User events"
            >
              <div className={styles.userTableHead} role="row">
                <span role="columnheader">Kind</span>
                <span role="columnheader">Trust</span>
                <span role="columnheader">Subject</span>
                <span role="columnheader">Created</span>
                <span role="columnheader">Event</span>
              </div>
              {data.events.map((row) => (
                <div key={row.id} className={styles.userTableRow} role="row">
                  <div className={styles.userCell} role="cell">
                    {row.kind === 32009
                      ? '32009'
                      : row.kind === 32014
                        ? '32014'
                        : row.kind === 10011
                          ? '10011'
                          : row.kind}
                  </div>
                  <div className={styles.userCell} role="cell">
                    {trustLabel(row)}
                  </div>
                  <div className={styles.userCell} role="cell" title={row.subjectId}>
                    {subjectCell(row)}
                    {row.subjectRole ? (
                      <span className={styles.mutedInline}> · {row.subjectRole}</span>
                    ) : null}
                    {row.subjectHandle ? (
                      <span className={styles.userHandleSub}> @{row.subjectHandle}</span>
                    ) : null}
                  </div>
                  <div className={`${styles.userCell} ${styles.mutedInline}`} role="cell">
                    {new Date(row.created_at * 1000).toLocaleString()}
                  </div>
                  <div className={`${styles.userCell} ${styles.mono}`} role="cell" title={row.id}>
                    {truncateHex(row.id)}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {data && total > 0 ? (
            <div className={styles.pager}>
              <p className={styles.muted}>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </p>
              <div className={styles.pagerActions}>
                <Button
                  small
                  variant="secondary"
                  disabled={!canPrev || busy}
                  onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
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
    </>
  )
}
