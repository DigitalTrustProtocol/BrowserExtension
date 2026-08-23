import { useEffect, useState } from 'react'
import type { XPostRecord } from '../../storage/types'
import type { XPostDisplay } from '../contracts'
import { getPageEntityStore } from '../page-entity-store'

export function usePost(postId: string | undefined): {
  post: XPostDisplay | XPostRecord | null | undefined
  loading: boolean
} {
  const store = getPageEntityStore()
  const [, setRev] = useState(0)
  useEffect(() => store.subscribe(() => setRev((n) => n + 1)), [store])
  useEffect(() => {
    if (postId) store.requestPost(postId)
  }, [store, postId])
  const post = postId ? store.getPost(postId) : undefined
  return { post, loading: Boolean(postId) && post === undefined }
}