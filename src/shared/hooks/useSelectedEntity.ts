import { useEffect, useState } from 'react'
import type { TrustQueryResult, TrustSubject } from '../../graph'
import {
  getPageEntityStore,
  type OutgoingTrustState,
} from '../page-entity-store'
import { postIdFromSubject, twitterIdFromSubject } from '../selected-ids'
import type { SelectedSubject } from '../selected-subject'

export function useSelectedEntity(): {
  selected: SelectedSubject | null
  twitterId: string | undefined
  postId: string | undefined
  trustedBy: TrustQueryResult | undefined
  outgoing: OutgoingTrustState
} {
  const store = getPageEntityStore()
  const [, setRev] = useState(0)
  useEffect(() => {
    const stop = store.subscribe(() => setRev((n) => n + 1))
    void store.refreshSelected()
    return stop
  }, [store])
  const selected = store.getSelected()
  const subject: TrustSubject | undefined = selected?.subject
  return {
    selected,
    twitterId: twitterIdFromSubject(subject),
    postId: postIdFromSubject(subject),
    trustedBy: subject ? store.getTrustedBy(subject) : undefined,
    outgoing: subject ? store.getOutgoing(subject) : { status: 'idle' },
  }
}