import { useEffect, useState } from 'react'
import {
  SHOW_NOSTR_PROFILE_CHECK_KEY,
  showNostrProfileCheckFromStorage,
} from '../nostr-profile-check'

/** Live Display setting. Missing storage means the mark stays on. */
export function useShowNostrProfileCheck(): boolean {
  const [show, setShow] = useState(true)

  useEffect(() => {
    let cancelled = false
    void chrome.storage.local
      .get(SHOW_NOSTR_PROFILE_CHECK_KEY)
      .then((data: Record<string, unknown>) => {
        if (cancelled) return
        setShow(
          showNostrProfileCheckFromStorage(data[SHOW_NOSTR_PROFILE_CHECK_KEY]),
        )
      })
      .catch(() => undefined)

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return
      const change = changes[SHOW_NOSTR_PROFILE_CHECK_KEY]
      if (!change) return
      setShow(showNostrProfileCheckFromStorage(change.newValue))
    }
    chrome.storage.onChanged.addListener(listener)
    return () => {
      cancelled = true
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  return show
}
