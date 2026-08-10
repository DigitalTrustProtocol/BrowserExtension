import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type XIdentitiesState,
  type XIdentityListRow,
  type XIdentitySortDir,
  type XIdentitySortField,
} from '../../shared/contracts'
import { primaryNpubFromRow } from '../../identity/x-identity-row'
import { buildXProfileIconUrl } from '../../shared/x-profile-display'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

const PAGE_SIZE = 50

const SORT_COLUMNS: Array<{
  id: XIdentitySortField
  label: string
}> = [
  { id: 'username', label: 'Username' },
  { id: 'twitterId', label: 'X ID' },
  { id: 'proofState', label: 'Proof' },
  { id: 'npub', label: 'npub' },
  { id: 'lastSeen', label: 'Last seen' },
  { id: 'updatedAt', label: 'Updated' },
]

async function loadIdentities(options: {
  query: string
  offset: number
  sortBy: XIdentitySortField
  sortDir: XIdentitySortDir
}): Promise<XIdentitiesState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_X_IDENTITIES',
    version: BACKGROUND_API_VERSION,
    query: options.query,
    offset: options.offset,
    limit: PAGE_SIZE,
    sortBy: options.sortBy,
    sortDir: options.sortDir,
  })) as ExtensionResponse<XIdentitiesState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function primaryHandle(row: XIdentityListRow): string {
  return row.handle ? `@${row.handle}` : '—'
}

function primaryLabel(row: XIdentityListRow): string {
  const name = row.displayName?.trim()
  if (name) return name
  return primaryHandle(row)
}

function rowAvatarUrl(row: XIdentityListRow): string | undefined {
  return row.iconPath ? buildXProfileIconUrl(row.iconPath) : undefined
}

function primaryNpub(row: XIdentityListRow): string | undefined {
  return primaryNpubFromRow(row)
}

function proofStatusLabel(row: XIdentityListRow): string {
  if (row.state !== 'verified' || !row.proofSource) return row.state
  switch (row.proofSource) {
    case 'bio':
      return 'bio'
    case 'post':
      return 'post proof'
    case 'nip39':
      return '10011'
    case 'trust32009':
      return 'trust-derived'
    default: {
      const exhaustive: never = row.proofSource
      return exhaustive
    }
  }
}

function formatRowValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  if (typeof value === 'number' && Number.isFinite(value) && value > 1e11) {
    return new Date(value).toLocaleString()
  }
  return String(value)
}

const RAW_ROW_FIELDS: Array<keyof XIdentityListRow> = [
  'twitterId',
  'handle',
  'displayName',
  'iconPath',
  'state',
  'proofSource',
  'xNpub',
  'xDate',
  'xObservedAt',
  'postNpub',
  'postId',
  'postHandle',
  'postDate',
  'postObservedAt',
  'nip39Npub',
  'nip39XId',
  'nip39Handle',
  'nip39PostId',
  'nip39Date',
  'eventNpub',
  'eventDate',
  'eventId',
  'eventIssuer',
  'verifiedAt',
  'createdAt',
  'updatedAt',
  'lastSeen',
]

function defaultSortDir(field: XIdentitySortField): XIdentitySortDir {
  return field === 'updatedAt' || field === 'lastSeen' ? 'desc' : 'asc'
}

function sortMarker(
  field: XIdentitySortField,
  sortBy: XIdentitySortField,
  sortDir: XIdentitySortDir,
): string {
  if (field !== sortBy) return ''
  return sortDir === 'asc' ? ' ↑' : ' ↓'
}

function popoverStyle(anchor: DOMRect): CSSProperties {
  const width = Math.min(420, window.innerWidth - 24)
  const maxHeight = Math.min(360, window.innerHeight - 24)
  let left = anchor.left
  let top = anchor.bottom + 8
  if (left + width > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - width - 12)
  }
  if (top + Math.min(240, maxHeight) > window.innerHeight - 12) {
    top = Math.max(12, anchor.top - 8 - Math.min(240, maxHeight))
  }
  return {
    position: 'fixed',
    left,
    top,
    width,
    maxHeight,
  }
}

interface UsersPageProps {
  refreshToken: number
  onOpenUserEvents?: (row: XIdentityListRow) => void
}

export default function UsersPage({
  refreshToken,
  onOpenUserEvents,
}: UsersPageProps) {
  const [filterInput, setFilterInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState<XIdentitySortField>('username')
  const [sortDir, setSortDir] = useState<XIdentitySortDir>('asc')
  const [data, setData] = useState<XIdentitiesState>()
  const [activeTwitterId, setActiveTwitterId] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)
  const [hoverRow, setHoverRow] = useState<XIdentityListRow>()
  const [hoverAnchor, setHoverAnchor] = useState<DOMRect>()
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const activeResponse = (await chrome.runtime.sendMessage({
        type: 'GET_ACTIVE_X_ACCOUNT',
        version: BACKGROUND_API_VERSION,
      })) as ExtensionResponse<{ twitterId?: string } | undefined>
      if (activeResponse.ok) {
        setActiveTwitterId(activeResponse.data?.twitterId)
      }
      setData(
        await loadIdentities({
          query: appliedQuery,
          offset,
          sortBy,
          sortDir,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setBusy(false)
    }
  }, [appliedQuery, offset, sortBy, sortDir])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  useEffect(() => {
    const onMessage = (message: { type?: string }) => {
      if (message?.type !== 'X_IDENTITY_UPDATED') return
      void refresh()
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [refresh])

  useEffect(() => {
    setHoverRow(undefined)
    setHoverAnchor(undefined)
  }, [appliedQuery, offset, sortBy, sortDir, refreshToken])

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  const showRawRecord = (
    row: XIdentityListRow,
    target: EventTarget | null,
  ) => {
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

  const toggleSort = (field: XIdentitySortField) => {
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
              placeholder="Filter by handle, twitter id, npub, pubkey…"
              value={filterInput}
              onChange={(event) => setFilterInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilter()
              }}
              aria-label="Filter users"
            />
            <Button small variant="secondary" onClick={applyFilter}>
              Filter
            </Button>
          </div>
        </Card>
      </section>

      <section className={styles.section}>
        <SectionLabel>X identities</SectionLabel>
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
            <p className={styles.muted}>Loading users…</p>
          ) : null}

          {data && data.identities.length === 0 ? (
            <p className={styles.muted}>
              {appliedQuery
                ? 'No identities match this filter.'
                : 'No X identities stored yet.'}
            </p>
          ) : null}

          {data && data.identities.length > 0 ? (
            <div className={styles.userTable} role="table" aria-label="X identities">
              <div className={styles.userTableHead} role="row">
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
              </div>
              {data.identities.map((row) => {
                const npub = primaryNpub(row)
                const isMe = Boolean(
                  activeTwitterId && row.twitterId === activeTwitterId,
                )
                const avatarUrl = rowAvatarUrl(row)
                return (
                  <div
                    key={row.twitterId}
                    className={`${styles.userTableRow}${isMe ? ` ${styles.userTableRowMe}` : ''}`}
                    role="row"
                  >
                    <div className={styles.userCell} role="cell">
                      <button
                        type="button"
                        className={styles.userIdentity}
                        onClick={() => onOpenUserEvents?.(row)}
                        onMouseEnter={(event) =>
                          showRawRecord(row, event.currentTarget)
                        }
                        onMouseLeave={hideRawRecord}
                        onFocus={(event) =>
                          showRawRecord(row, event.currentTarget)
                        }
                        onBlur={hideRawRecord}
                      >
                        {avatarUrl ? (
                          <img
                            className={styles.userAvatar}
                            src={avatarUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className={styles.userAvatarFallback} aria-hidden>
                            {primaryLabel(row).charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className={styles.userIdentityText}>
                          <span className={styles.userDisplayName}>
                            {primaryLabel(row)}
                            {isMe ? (
                              <span className={styles.userMeBadge}>Me</span>
                            ) : null}
                          </span>
                          {row.displayName?.trim() && row.handle ? (
                            <span className={styles.userHandleSub}>
                              {primaryHandle(row)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                    <div className={`${styles.userCell} ${styles.mono}`} role="cell">
                      {row.twitterId}
                    </div>
                    <div className={styles.userCell} role="cell">
                      <span
                        className={styles.proofBadge}
                        data-state={row.state}
                        title={
                          row.proofSource
                            ? `proofSource: ${row.proofSource}`
                            : row.state
                        }
                      >
                        {proofStatusLabel(row)}
                      </span>
                    </div>
                    <div
                      className={`${styles.userCell} ${styles.mono}`}
                      role="cell"
                      title={npub}
                    >
                      {npub ?? (
                        <span className={styles.mutedInline}>—</span>
                      )}
                    </div>
                    <div className={`${styles.userCell} ${styles.mutedInline}`} role="cell">
                      {new Date(row.lastSeen).toLocaleString()}
                    </div>
                    <div className={`${styles.userCell} ${styles.mutedInline}`} role="cell">
                      {new Date(row.updatedAt).toLocaleString()}
                    </div>
                  </div>
                )
              })}
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

      {hoverRow && hoverAnchor ? (
        <Card
          className={styles.userHoverCard}
          style={popoverStyle(hoverAnchor)}
          onMouseEnter={keepRawRecord}
          onMouseLeave={hideRawRecord}
        >
          <p className={styles.userHoverTitle}>
            xIdentities · {primaryLabel(hoverRow)}
            {hoverRow.handle ? ` · ${primaryHandle(hoverRow)}` : ''}
          </p>
          <table className={styles.userHoverTable}>
            <tbody>
              {RAW_ROW_FIELDS.map((field) => (
                <tr key={field}>
                  <th scope="row">{field}</th>
                  <td className={styles.mono}>
                    {formatRowValue(hoverRow[field])}
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
