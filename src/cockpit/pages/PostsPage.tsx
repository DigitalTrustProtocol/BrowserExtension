import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type XPostListRow,
  type XPostSortDir,
  type XPostSortField,
  type XPostsState,
} from '../../shared/contracts'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'

const PAGE_SIZE = 50

const SORT_COLUMNS: Array<{ id: XPostSortField; label: string }> = [
  { id: 'postId', label: 'Post ID' },
  { id: 'authorHandle', label: 'Author' },
  { id: 'lastSeen', label: 'Last seen' },
  { id: 'updatedAt', label: 'Updated' },
]

async function loadPosts(options: {
  query: string
  offset: number
  sortBy: XPostSortField
  sortDir: XPostSortDir
}): Promise<XPostsState> {
  const response = (await chrome.runtime.sendMessage({
    type: 'GET_X_POSTS',
    version: BACKGROUND_API_VERSION,
    query: options.query,
    offset: options.offset,
    limit: PAGE_SIZE,
    sortBy: options.sortBy,
    sortDir: options.sortDir,
  })) as ExtensionResponse<XPostsState>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function sortMarker(
  field: XPostSortField,
  sortBy: XPostSortField,
  sortDir: XPostSortDir,
): string {
  if (field !== sortBy) return ''
  return sortDir === 'asc' ? ' ↑' : ' ↓'
}

function defaultSortDir(field: XPostSortField): XPostSortDir {
  return field === 'postId' || field === 'authorHandle' ? 'asc' : 'desc'
}

interface PostsPageProps {
  refreshToken: number
}

export default function PostsPage({ refreshToken }: PostsPageProps) {
  const [filterInput, setFilterInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [sortBy, setSortBy] = useState<XPostSortField>('lastSeen')
  const [sortDir, setSortDir] = useState<XPostSortDir>('desc')
  const [data, setData] = useState<XPostsState>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      setData(
        await loadPosts({
          query: appliedQuery,
          offset,
          sortBy,
          sortDir,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts')
    } finally {
      setBusy(false)
    }
  }, [appliedQuery, offset, sortBy, sortDir])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  const toggleSort = (field: XPostSortField) => {
    setOffset(0)
    if (field === sortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortBy(field)
    setSortDir(defaultSortDir(field))
  }

  const total = data?.total ?? 0
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <>
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.section}>
        <SectionLabel>Trust-gated post chrome</SectionLabel>
        <Card className={styles.panel}>
          <p className={styles.muted}>
            Posts observed on X that have local trust evidence. Bare event
            subjects without chrome are not listed here.
          </p>
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
              placeholder="Filter posts…"
              aria-label="Filter posts"
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

          {busy && !data ? <p className={styles.muted}>Loading posts…</p> : null}
          {data && total === 0 ? (
            <p className={styles.muted}>No trusted post chrome yet.</p>
          ) : null}

          {data && total > 0 ? (
            <div
              className={`${styles.userTable} ${styles.postsTable}`}
              role="table"
              aria-label="X posts"
            >
              <div className={styles.userTableHead} role="row">
                {SORT_COLUMNS.map((column) => {
                  const active = column.id === sortBy
                  return (
                    <button
                      key={column.id}
                      type="button"
                      role="columnheader"
                      className={`${styles.userSortHeader} ${active ? styles.userSortHeaderActive : ''}`}
                      onClick={() => toggleSort(column.id)}
                    >
                      {column.label}
                      {sortMarker(column.id, sortBy, sortDir)}
                    </button>
                  )
                })}
                <span role="columnheader">Headline</span>
                <span role="columnheader">Role</span>
              </div>
              {data.posts.map((row: XPostListRow) => (
                <div key={row.postId} className={styles.userTableRow} role="row">
                  <div className={`${styles.userCell} ${styles.mono}`} role="cell">
                    {row.postId}
                  </div>
                  <div className={styles.userCell} role="cell">
                    {row.authorHandle
                      ? `@${row.authorHandle}`
                      : (row.authorTwitterId ?? '—')}
                  </div>
                  <div className={`${styles.userCell} ${styles.mutedInline}`} role="cell">
                    {new Date(row.lastSeen).toLocaleString()}
                  </div>
                  <div className={`${styles.userCell} ${styles.mutedInline}`} role="cell">
                    {new Date(row.updatedAt).toLocaleString()}
                  </div>
                  <div className={styles.userCell} role="cell">
                    {row.headline ?? '—'}
                  </div>
                  <div className={styles.userCell} role="cell">
                    {row.role ?? '—'}
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
