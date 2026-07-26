import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type XIdentitiesState,
  type XIdentityListRow,
  type XIdentitySortDir,
  type XIdentitySortField,
} from '../../shared/contracts'
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
  return row.handles[0] ? `@${row.handles[0]}` : '—'
}

function primaryNpub(row: XIdentityListRow): string | undefined {
  return row.xProofNpub ?? row.nip39Npub
}

function proofStatusLabel(row: XIdentityListRow): string {
  if (row.state === 'verified') return 'verified'
  switch (row.blockedBy) {
    case 'missing-nip39':
      return 'X proof only'
    case 'missing-x-proof':
      return '10011 only'
    case 'proof-unavailable':
      return 'checking proof'
    case 'mismatch':
      return 'sides disagree'
    default:
      return row.state
  }
}

function defaultSortDir(field: XIdentitySortField): XIdentitySortDir {
  return field === 'updatedAt' ? 'desc' : 'asc'
}

function sortMarker(
  field: XIdentitySortField,
  sortBy: XIdentitySortField,
  sortDir: XIdentitySortDir,
): string {
  if (field !== sortBy) return ''
  return sortDir === 'asc' ? ' ↑' : ' ↓'
}

interface UsersPageProps {
  refreshToken: number
}

export default function UsersPage({ refreshToken }: UsersPageProps) {
  const [filterInput, setFilterInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState<XIdentitySortField>('username')
  const [sortDir, setSortDir] = useState<XIdentitySortDir>('asc')
  const [data, setData] = useState<XIdentitiesState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
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
                return (
                  <div
                    key={row.twitterId}
                    className={styles.userTableRow}
                    role="row"
                  >
                    <div className={styles.userCell} role="cell">
                      <span className={styles.userHandle}>
                        {primaryHandle(row)}
                      </span>
                      {row.handles.length > 1 ? (
                        <span className={styles.mutedInline}>
                          +{row.handles.length - 1}
                        </span>
                      ) : null}
                    </div>
                    <div className={`${styles.userCell} ${styles.mono}`} role="cell">
                      {row.twitterId}
                    </div>
                    <div className={styles.userCell} role="cell">
                      <span
                        className={styles.proofBadge}
                        data-state={row.state}
                        title={
                          row.blockedBy
                            ? `blockedBy: ${row.blockedBy}`
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
    </>
  )
}
