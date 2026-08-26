import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { XIdentityDisplay, XPostDisplay } from '../../shared/contracts'
import type { TrustSubject } from '../../graph'
import { parseNodeId } from '../../shared/graph-deeplink'
import {
  applyXDisplayToGraphNode,
  graphNodeChromeChanged,
  hydrateGraphDataChrome,
  nodeNeedsXPostEnrichment,
  nodeNeedsXProfileEnrichment,
  postIdFromNodeId,
  rootNeedsSignedInXProfile,
  twitterIdFromNodeId,
  type GraphChromeCaches,
  type GraphPubkeyProfileChrome,
} from './graph-display'
import {
  GRAPH_DISPLAY_BATCH,
  loadActiveXAccount,
  loadProfileDisplays,
  loadXIdentityDisplays,
  loadXIdentityDisplaysForPubkeys,
  loadXPostDisplays,
} from './graph-rpc'
import type { GraphVizData } from './types'

function displayHasChrome(display: XIdentityDisplay | undefined): boolean {
  return Boolean(
    display?.iconPath || display?.displayName || display?.handle,
  )
}

/**
 * Enriches graph nodes with display labels / pictures. Neighborhood RPC has
 * no avatars, so chrome is loaded once and reapplied from memory on
 * expand/collapse instead of refetching (click used to be the only retry).
 */
export function useGraphNodeEnrichment(
  rawData: GraphVizData,
  setRawData: Dispatch<SetStateAction<GraphVizData>>,
  selectedId: string | undefined,
  showUserIcons: boolean,
): {
  clearDisplayRequestCaches: () => void
  hydrateFromCache: (data: GraphVizData) => GraphVizData
} {
  const xByTwitterId = useRef(new Map<string, XIdentityDisplay>())
  const xByPubkey = useRef(new Map<string, XIdentityDisplay>())
  const profileByPubkey = useRef(new Map<string, GraphPubkeyProfileChrome>())
  const postById = useRef(new Map<string, XPostDisplay>())
  const rootXDisplay = useRef<XIdentityDisplay | undefined>(undefined)

  const xDisplayInFlight = useRef(new Set<string>())
  const pubkeyXDisplayInFlight = useRef(new Set<string>())
  const pubkeyXTried = useRef(new Set<string>())
  const pubkeyProfileInFlight = useRef(new Set<string>())
  const pubkeyProfileTried = useRef(new Set<string>())
  const xPostInFlight = useRef(new Set<string>())
  const selectedEnrichmentRequests = useRef(new Set<string>())
  const rootXProfileRequested = useRef(false)

  const snapshotCaches = useCallback((): GraphChromeCaches => {
    return {
      xByTwitterId: xByTwitterId.current,
      xByPubkey: xByPubkey.current,
      profileByPubkey: profileByPubkey.current,
      postById: postById.current,
      ...(rootXDisplay.current ? { rootXDisplay: rootXDisplay.current } : {}),
    }
  }, [])

  const hydrateFromCache = useCallback(
    (data: GraphVizData): GraphVizData =>
      hydrateGraphDataChrome(data, snapshotCaches()),
    [snapshotCaches],
  )

  const clearDisplayRequestCaches = useCallback(() => {
    xByTwitterId.current.clear()
    xByPubkey.current.clear()
    profileByPubkey.current.clear()
    postById.current.clear()
    rootXDisplay.current = undefined
    xDisplayInFlight.current.clear()
    pubkeyXDisplayInFlight.current.clear()
    pubkeyXTried.current.clear()
    pubkeyProfileInFlight.current.clear()
    pubkeyProfileTried.current.clear()
    xPostInFlight.current.clear()
    selectedEnrichmentRequests.current.clear()
    rootXProfileRequested.current = false
  }, [])

  useEffect(() => {
    const onMessage = (message: {
      type?: string
      twitterId?: string
    }) => {
      if (message?.type !== 'X_IDENTITY_UPDATED') return
      const twitterId = message.twitterId
      if (typeof twitterId === 'string' && /^\d{1,24}$/.test(twitterId)) {
        xByTwitterId.current.delete(twitterId)
        xDisplayInFlight.current.delete(twitterId)
        for (const [pubkey, display] of xByPubkey.current) {
          if (display.twitterId === twitterId) {
            xByPubkey.current.delete(pubkey)
            pubkeyXDisplayInFlight.current.delete(pubkey)
            pubkeyXTried.current.delete(pubkey)
          }
        }
        if (rootXDisplay.current?.twitterId === twitterId) {
          rootXDisplay.current = undefined
          rootXProfileRequested.current = false
        }
        for (const id of [...selectedEnrichmentRequests.current]) {
          if (twitterIdFromNodeId(id) === twitterId) {
            selectedEnrichmentRequests.current.delete(id)
          }
        }
      } else {
        clearDisplayRequestCaches()
      }
      setRawData((current) => ({ ...current, nodes: current.nodes.slice() }))
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [clearDisplayRequestCaches, setRawData])

  // Reattach cached chrome whenever nodes are recreated (expand / collapse).
  useEffect(() => {
    setRawData((current) => hydrateFromCache(current))
  }, [hydrateFromCache, rawData.nodes, setRawData])

  // Root "You" ← signed-in X account xIdentities chrome (name / @handle / avatar).
  useEffect(() => {
    const root = rawData.nodes.find((node) => node.isRoot)
    if (!root || rootXProfileRequested.current) return
    if (!rootNeedsSignedInXProfile(root) && !rootXDisplay.current) {
      rootXProfileRequested.current = true
      return
    }
    if (rootXDisplay.current && !rootNeedsSignedInXProfile(root)) {
      rootXProfileRequested.current = true
      return
    }
    rootXProfileRequested.current = true
    const rootId = root.id
    void loadActiveXAccount()
      .then(async (active) => {
        if (!active?.twitterId) {
          rootXProfileRequested.current = false
          return
        }
        const displays = await loadXIdentityDisplays([active.twitterId])
        const display = displays[active.twitterId]
        if (!display) {
          rootXProfileRequested.current = false
          return
        }
        rootXDisplay.current = display
        xByTwitterId.current.set(active.twitterId, display)
        setRawData((current) => {
          let changed = false
          const nodes = current.nodes.map((node) => {
            if (node.id !== rootId || !node.isRoot) return node
            const next = applyXDisplayToGraphNode(node, display)
            if (graphNodeChromeChanged(node, next)) {
              changed = true
              return next
            }
            return node
          })
          return changed ? { ...current, nodes } : current
        })
      })
      .catch(() => {
        rootXProfileRequested.current = false
      })
  }, [rawData.nodes, setRawData])

  // Bound xIdentities chrome for pubkey hops (demo authors, eventNpub, bio npub).
  useEffect(() => {
    const pubkeys = [
      ...new Set(
        rawData.nodes
          .filter((node) => node.kind === 'pubkey' && !node.isRoot)
          .map((node) => parseNodeId(node.id))
          .filter(
            (subject): subject is Extract<TrustSubject, { type: 'p' }> =>
              subject?.type === 'p',
          )
          .map((subject) => subject.value)
          .filter(
            (pubkey) =>
              !xByPubkey.current.has(pubkey) &&
              !pubkeyXTried.current.has(pubkey) &&
              !pubkeyXDisplayInFlight.current.has(pubkey),
          ),
      ),
    ].slice(0, GRAPH_DISPLAY_BATCH)
    if (pubkeys.length === 0) return
    for (const pubkey of pubkeys) pubkeyXDisplayInFlight.current.add(pubkey)
    void loadXIdentityDisplaysForPubkeys(pubkeys)
      .then((displays) => {
        for (const pubkey of pubkeys) {
          pubkeyXDisplayInFlight.current.delete(pubkey)
          pubkeyXTried.current.add(pubkey)
          const display = displays[pubkey]
          if (displayHasChrome(display)) {
            xByPubkey.current.set(pubkey, display)
            if (display.twitterId) {
              xByTwitterId.current.set(display.twitterId, display)
            }
          }
        }
        setRawData((current) => hydrateFromCache(current))
      })
      .catch(() => {
        for (const pubkey of pubkeys) {
          pubkeyXDisplayInFlight.current.delete(pubkey)
        }
      })
  }, [hydrateFromCache, rawData.nodes, setRawData])

  // xPosts chrome for post nodes (headline / @author).
  useEffect(() => {
    const postIds = [
      ...new Set(
        rawData.nodes
          .map((node) => nodeNeedsXPostEnrichment(node))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
      .filter(
        (id) => !postById.current.has(id) && !xPostInFlight.current.has(id),
      )
      .slice(0, GRAPH_DISPLAY_BATCH)

    if (postIds.length === 0) return
    for (const id of postIds) xPostInFlight.current.add(id)
    void loadXPostDisplays(postIds)
      .then((displays) => {
        for (const id of postIds) {
          xPostInFlight.current.delete(id)
          postById.current.set(id, displays[id] ?? {})
        }
        setRawData((current) => hydrateFromCache(current))
      })
      .catch(() => {
        for (const id of postIds) xPostInFlight.current.delete(id)
      })
  }, [hydrateFromCache, rawData.nodes, setRawData])

  useEffect(() => {
    if (!showUserIcons) return

    const twitterIds = [
      ...new Set(
        rawData.nodes
          .filter(
            (node) =>
              node.kind === 'twitter_id' &&
              (!node.picture || nodeNeedsXProfileEnrichment(node)),
          )
          .map((node) => twitterIdFromNodeId(node.id))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
      .filter(
        (id) =>
          !xByTwitterId.current.has(id) && !xDisplayInFlight.current.has(id),
      )
      .slice(0, GRAPH_DISPLAY_BATCH)

    if (twitterIds.length > 0) {
      for (const id of twitterIds) xDisplayInFlight.current.add(id)
      void loadXIdentityDisplays(twitterIds)
        .then((displays) => {
          for (const id of twitterIds) {
            xDisplayInFlight.current.delete(id)
            xByTwitterId.current.set(id, displays[id] ?? {})
          }
          setRawData((current) => hydrateFromCache(current))
        })
        .catch(() => {
          for (const id of twitterIds) xDisplayInFlight.current.delete(id)
        })
    }

    const pubkeys = rawData.nodes
      .filter((node) => node.kind === 'pubkey' && !node.isRoot && !node.picture)
      .map((node) => parseNodeId(node.id))
      .filter(
        (subject): subject is Extract<TrustSubject, { type: 'p' }> =>
          subject?.type === 'p' &&
          !xByPubkey.current.has(subject.value) &&
          !profileByPubkey.current.has(subject.value) &&
          !pubkeyProfileTried.current.has(subject.value) &&
          !pubkeyProfileInFlight.current.has(subject.value),
      )
      .map((subject) => subject.value)
      .slice(0, GRAPH_DISPLAY_BATCH)

    if (pubkeys.length === 0) return
    for (const pubkey of pubkeys) pubkeyProfileInFlight.current.add(pubkey)
    void loadProfileDisplays(pubkeys)
      .then((profiles) => {
        for (const pubkey of pubkeys) {
          pubkeyProfileInFlight.current.delete(pubkey)
          pubkeyProfileTried.current.add(pubkey)
          const profile = profiles[pubkey]
          if (profile?.name || profile?.picture) {
            profileByPubkey.current.set(pubkey, profile)
          }
        }
        setRawData((current) => hydrateFromCache(current))
      })
      .catch(() => {
        for (const pubkey of pubkeys) {
          pubkeyProfileInFlight.current.delete(pubkey)
        }
      })
  }, [hydrateFromCache, rawData.nodes, setRawData, showUserIcons])

  useEffect(() => {
    if (showUserIcons) return
    const twitterIds = [
      ...new Set(
        rawData.nodes
          .map((node) => nodeNeedsXProfileEnrichment(node))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
      .filter(
        (id) =>
          !xByTwitterId.current.has(id) && !xDisplayInFlight.current.has(id),
      )
      .slice(0, GRAPH_DISPLAY_BATCH)
    if (twitterIds.length === 0) return
    for (const id of twitterIds) xDisplayInFlight.current.add(id)
    void loadXIdentityDisplays(twitterIds)
      .then((displays) => {
        for (const id of twitterIds) {
          xDisplayInFlight.current.delete(id)
          xByTwitterId.current.set(id, displays[id] ?? {})
        }
        setRawData((current) => hydrateFromCache(current))
      })
      .catch(() => {
        for (const id of twitterIds) xDisplayInFlight.current.delete(id)
      })
  }, [hydrateFromCache, rawData.nodes, setRawData, showUserIcons])

  useEffect(() => {
    if (!selectedId) return
    const node = rawData.nodes.find((entry) => entry.id === selectedId)
    if (!node) return
    if (
      !node.picture ||
      nodeNeedsXProfileEnrichment(node) ||
      nodeNeedsXPostEnrichment(node) ||
      rootNeedsSignedInXProfile(node)
    ) {
      setRawData((current) => hydrateFromCache(current))
    }
    if (
      node.picture &&
      !nodeNeedsXProfileEnrichment(node) &&
      !nodeNeedsXPostEnrichment(node) &&
      !rootNeedsSignedInXProfile(node)
    ) {
      return
    }
    if (selectedEnrichmentRequests.current.has(selectedId)) return

    const postId = postIdFromNodeId(node.id)
    if (postId && node.kind === 'post') {
      selectedEnrichmentRequests.current.add(selectedId)
      void loadXPostDisplays([postId])
        .then((displays) => {
          const display = displays[postId]
          if (!display) {
            selectedEnrichmentRequests.current.delete(selectedId)
            return
          }
          postById.current.set(postId, display)
          setRawData((current) => hydrateFromCache(current))
        })
        .catch(() => {
          selectedEnrichmentRequests.current.delete(selectedId)
        })
      return
    }

    const twitterId = twitterIdFromNodeId(node.id)
    if (twitterId) {
      selectedEnrichmentRequests.current.add(selectedId)
      void loadXIdentityDisplays([twitterId])
        .then((displays) => {
          const display = displays[twitterId]
          if (!display) {
            selectedEnrichmentRequests.current.delete(selectedId)
            return
          }
          xByTwitterId.current.set(twitterId, display)
          setRawData((current) => hydrateFromCache(current))
        })
        .catch(() => {
          selectedEnrichmentRequests.current.delete(selectedId)
        })
      return
    }

    if (node.isRoot && rootNeedsSignedInXProfile(node)) {
      selectedEnrichmentRequests.current.add(selectedId)
      void loadActiveXAccount()
        .then(async (active) => {
          if (!active?.twitterId) {
            selectedEnrichmentRequests.current.delete(selectedId)
            return
          }
          const displays = await loadXIdentityDisplays([active.twitterId])
          const display = displays[active.twitterId]
          if (!display) {
            selectedEnrichmentRequests.current.delete(selectedId)
            return
          }
          rootXDisplay.current = display
          xByTwitterId.current.set(active.twitterId, display)
          setRawData((current) => hydrateFromCache(current))
        })
        .catch(() => {
          selectedEnrichmentRequests.current.delete(selectedId)
        })
      return
    }

    const subject = parseNodeId(node.id)
    if (subject?.type !== 'p' || node.isRoot) return
    if (xByPubkey.current.has(subject.value)) {
      setRawData((current) => hydrateFromCache(current))
      return
    }
    selectedEnrichmentRequests.current.add(selectedId)
    void loadProfileDisplays([subject.value])
      .then((profiles) => {
        const profile = profiles[subject.value]
        if (!profile) {
          selectedEnrichmentRequests.current.delete(selectedId)
          return
        }
        profileByPubkey.current.set(subject.value, profile)
        setRawData((current) => hydrateFromCache(current))
      })
      .catch(() => {
        selectedEnrichmentRequests.current.delete(selectedId)
      })
  }, [hydrateFromCache, rawData.nodes, selectedId, setRawData])

  return { clearDisplayRequestCaches, hydrateFromCache }
}
