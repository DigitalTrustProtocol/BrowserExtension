import { useEffect, useState } from 'react'
import type { XIdentityRecord } from '../../storage/types'
import { getPageEntityStore } from '../page-entity-store'

export function useUser(twitterId: string | undefined): {
  user: XIdentityRecord | null | undefined
  loading: boolean
} {
  const store = getPageEntityStore()
  const [, setRev] = useState(0)
  useEffect(() => store.subscribe(() => setRev((n) => n + 1)), [store])
  useEffect(() => {
    if (twitterId) store.requestUser(twitterId)
  }, [store, twitterId])
  const user = twitterId ? store.getUser(twitterId) : undefined
  return { user, loading: Boolean(twitterId) && user === undefined }
}