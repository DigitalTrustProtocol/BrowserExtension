import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { TrustSubject } from '../../graph'
import { parseNodeId } from '../../shared/graph-deeplink'
import {
  applyXDisplayToGraphNode,
  applyXPostDisplayToGraphNode,
  labelsFromXIdentityDisplay,
  nodeNeedsXPostEnrichment,
  nodeNeedsXProfileEnrichment,
  postIdFromNodeId,
  rootNeedsSignedInXProfile,
  twitterIdFromNodeId,
} from './graph-display'
import {
  loadActiveXAccount,
  loadProfileDisplays,
  loadXIdentityDisplays,
  loadXPostDisplays,
} from './graph-rpc'
import type { GraphVizData } from './types'

/**
 * Enriches graph nodes with display labels / pictures. Owns request-dedupe
 * caches for the view instance that calls it.
 */
export function useGraphNodeEnrichment(
  rawData: GraphVizData,
  setRawData: Dispatch<SetStateAction<GraphVizData>>,
  selectedId: string | undefined,
  showUserIcons: boolean,
): { clearDisplayRequestCaches: () => void } {
  const pubkeyProfileRequests = useRef(new Set<string>())
  const xDisplayRequests = useRef(new Set<string>())
  const xPostDisplayRequests = useRef(new Set<string>())
  const selectedEnrichmentRequests = useRef(new Set<string>())
  const rootXProfileRequested = useRef(false)

  const clearDisplayRequestCaches = useCallback(() => {
    pubkeyProfileRequests.current.clear()
    xDisplayRequests.current.clear()
    xPostDisplayRequests.current.clear()
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
        xDisplayRequests.current.delete(twitterId)
        for (const id of [...selectedEnrichmentRequests.current]) {
          if (twitterIdFromNodeId(id) === twitterId) {
            selectedEnrichmentRequests.current.delete(id)
          }
        }
        // Signed-in profile may have changed — re-enrich root "You".
        rootXProfileRequested.current = false
      } else {
        clearDisplayRequestCaches()
      }
      // Force enrichment effects to re-run against current nodes.
      setRawData((current) => ({ ...current, nodes: current.nodes.slice() }))
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [clearDisplayRequestCaches, setRawData])

  const prevShowUserIcons = useRef(showUserIcons)
  useEffect(() => {
    if (showUserIcons && !prevShowUserIcons.current) {
      clearDisplayRequestCaches()
    }
    prevShowUserIcons.current = showUserIcons
  }, [clearDisplayRequestCaches, showUserIcons])

  // Root "You" ← signed-in X account xIdentities chrome (name / @handle / avatar).
  useEffect(() => {
    const root = rawData.nodes.find((node) => node.isRoot)
    if (!root || rootXProfileRequested.current) return
    if (!rootNeedsSignedInXProfile(root)) {
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
        setRawData((current) => {
          let changed = false
          const nodes = current.nodes.map((node) => {
            if (node.id !== rootId || !node.isRoot) return node
            const next = applyXDisplayToGraphNode(node, display)
            if (
              next.label !== node.label ||
              next.subtitle !== node.subtitle ||
              next.picture !== node.picture ||
              next.unidentifiedKind !== node.unidentifiedKind
            ) {
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

  // xPosts chrome for post nodes (headline / @author); optional author avatar.
  useEffect(() => {
    const postIds = [
      ...new Set(
        rawData.nodes
          .map((node) => nodeNeedsXPostEnrichment(node))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
      .filter((id) => !xPostDisplayRequests.current.has(id))
      .slice(0, 12)

    if (postIds.length === 0) return
    for (const id of postIds) xPostDisplayRequests.current.add(id)
    void loadXPostDisplays(postIds)
      .then((displays) => {
        for (const id of postIds) {
          if (
            !displays[id]?.headline &&
            !displays[id]?.authorHandle &&
            !displays[id]?.authorTwitterId
          ) {
            xPostDisplayRequests.current.delete(id)
          }
        }

        setRawData((current) => {
          let changed = false
          const nodes = current.nodes.map((node) => {
            const postId = postIdFromNodeId(node.id)
            if (!postId || node.kind !== 'post') return node
            const display = displays[postId]
            if (!display) return node
            const next = applyXPostDisplayToGraphNode(node, display)
            if (
              next.label !== node.label ||
              next.subtitle !== node.subtitle
            ) {
              changed = true
              return next
            }
            return node
          })
          return changed ? { ...current, nodes } : current
        })
      })
      .catch(() => {
        for (const id of postIds) xPostDisplayRequests.current.delete(id)
      })
  }, [rawData.nodes, setRawData])

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
      .filter((id) => !xDisplayRequests.current.has(id))
      .slice(0, 12)

    if (twitterIds.length > 0) {
      for (const id of twitterIds) xDisplayRequests.current.add(id)
      void loadXIdentityDisplays(twitterIds)
        .then((displays) => {
          for (const id of twitterIds) {
            if (
              !displays[id]?.iconPath &&
              !displays[id]?.displayName &&
              !displays[id]?.handle
            ) {
              xDisplayRequests.current.delete(id)
            }
          }
          setRawData((current) => {
            let changed = false
            const nodes = current.nodes.map((node) => {
              const twitterId = twitterIdFromNodeId(node.id)
              if (!twitterId) return node
              const display = displays[twitterId]
              if (!display) return node
              const next = applyXDisplayToGraphNode(node, display)
              if (
                next.label !== node.label ||
                next.subtitle !== node.subtitle ||
                next.picture !== node.picture
              ) {
                changed = true
                return next
              }
              return node
            })
            return changed ? { ...current, nodes } : current
          })
        })
        .catch(() => {
          for (const id of twitterIds) xDisplayRequests.current.delete(id)
        })
    }

    const pubkeys = rawData.nodes
      .filter((node) => node.kind === 'pubkey' && !node.isRoot && !node.picture)
      .map((node) => parseNodeId(node.id))
      .filter(
        (subject): subject is Extract<TrustSubject, { type: 'p' }> =>
          subject?.type === 'p' &&
          !pubkeyProfileRequests.current.has(subject.value),
      )
      .map((subject) => subject.value)
      .slice(0, 12)

    if (pubkeys.length === 0) return
    for (const pubkey of pubkeys) pubkeyProfileRequests.current.add(pubkey)
    void loadProfileDisplays(pubkeys)
      .then((profiles) => {
        for (const pubkey of pubkeys) {
          if (!profiles[pubkey]) pubkeyProfileRequests.current.delete(pubkey)
        }
        setRawData((current) => {
          let changed = false
          const nodes = current.nodes.map((node) => {
            const subject = parseNodeId(node.id)
            const profile =
              subject?.type === 'p' ? profiles[subject.value] : undefined
            if (!profile) return node
            // Do not overwrite root X chrome with Nostr metadata.
            if (node.isRoot && node.subtitle?.startsWith('@')) return node
            const next = {
              ...node,
              ...(profile.name ? { label: profile.name } : {}),
              ...(profile.picture ? { picture: profile.picture } : {}),
              ...(!node.subtitle && subject?.type === 'p'
                ? { subtitle: `${subject.value.slice(0, 8)}…` }
                : {}),
              ...(!node.isRoot ? { unidentifiedKind: 'external' as const } : {}),
            }
            if (
              next.label !== node.label ||
              next.subtitle !== node.subtitle ||
              next.picture !== node.picture ||
              next.unidentifiedKind !== node.unidentifiedKind
            ) {
              changed = true
              return next
            }
            return node
          })
          return changed ? { ...current, nodes } : current
        })
      })
      .catch(() => {
        for (const pubkey of pubkeys) {
          pubkeyProfileRequests.current.delete(pubkey)
        }
      })
  }, [rawData.nodes, setRawData, showUserIcons])

  useEffect(() => {
    if (showUserIcons) return
    const twitterIds = [
      ...new Set(
        rawData.nodes
          .map((node) => nodeNeedsXProfileEnrichment(node))
          .filter((id): id is string => Boolean(id)),
      ),
    ]
      .filter((id) => !xDisplayRequests.current.has(id))
      .slice(0, 12)
    if (twitterIds.length === 0) return
    for (const id of twitterIds) xDisplayRequests.current.add(id)
    void loadXIdentityDisplays(twitterIds)
      .then((displays) => {
        for (const id of twitterIds) {
          if (!displays[id]) xDisplayRequests.current.delete(id)
        }
        setRawData((current) => {
          let changed = false
          const nodes = current.nodes.map((node) => {
            const twitterId = twitterIdFromNodeId(node.id)
            if (!twitterId) return node
            const display = displays[twitterId]
            if (!display) return node
            const labels = labelsFromXIdentityDisplay(display)
            if (!labels.label) return node
            const next = {
              ...node,
              label: labels.label,
              ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
            }
            if (next.label !== node.label || next.subtitle !== node.subtitle) {
              changed = true
              return next
            }
            return node
          })
          return changed ? { ...current, nodes } : current
        })
      })
      .catch(() => {
        for (const id of twitterIds) xDisplayRequests.current.delete(id)
      })
  }, [rawData.nodes, setRawData, showUserIcons])

  useEffect(() => {
    if (!selectedId) return
    const node = rawData.nodes.find((entry) => entry.id === selectedId)
    if (!node) return
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
          setRawData((current) => {
            let changed = false
            const nodes = current.nodes.map((entry) => {
              if (entry.id !== selectedId) return entry
              const next = applyXPostDisplayToGraphNode(entry, display)
              if (
                next.label !== entry.label ||
                next.subtitle !== entry.subtitle
              ) {
                changed = true
                return next
              }
              return entry
            })
            return changed ? { ...current, nodes } : current
          })
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
          setRawData((current) => {
            let changed = false
            const nodes = current.nodes.map((entry) => {
              if (entry.id !== selectedId) return entry
              const next = applyXDisplayToGraphNode(entry, display)
              if (
                next.label !== entry.label ||
                next.subtitle !== entry.subtitle ||
                next.picture !== entry.picture
              ) {
                changed = true
                return next
              }
              return entry
            })
            return changed ? { ...current, nodes } : current
          })
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
          setRawData((current) => {
            let changed = false
            const nodes = current.nodes.map((entry) => {
              if (entry.id !== selectedId || !entry.isRoot) return entry
              const next = applyXDisplayToGraphNode(entry, display)
              if (
                next.label !== entry.label ||
                next.subtitle !== entry.subtitle ||
                next.picture !== entry.picture
              ) {
                changed = true
                return next
              }
              return entry
            })
            return changed ? { ...current, nodes } : current
          })
        })
        .catch(() => {
          selectedEnrichmentRequests.current.delete(selectedId)
        })
      return
    }

    const subject = parseNodeId(node.id)
    if (subject?.type !== 'p' || node.isRoot) return
    selectedEnrichmentRequests.current.add(selectedId)
    void loadProfileDisplays([subject.value])
      .then((profiles) => {
        const profile = profiles[subject.value]
        if (!profile) {
          selectedEnrichmentRequests.current.delete(selectedId)
          return
        }
        setRawData((current) => {
          let changed = false
          const nodes = current.nodes.map((entry) => {
            if (entry.id !== selectedId) return entry
            const next = {
              ...entry,
              ...(profile.name ? { label: profile.name } : {}),
              ...(profile.picture ? { picture: profile.picture } : {}),
              ...(!entry.subtitle
                ? { subtitle: `${subject.value.slice(0, 8)}…` }
                : {}),
            }
            if (
              next.label !== entry.label ||
              next.subtitle !== entry.subtitle ||
              next.picture !== entry.picture
            ) {
              changed = true
              return next
            }
            return entry
          })
          return changed ? { ...current, nodes } : current
        })
      })
      .catch(() => {
        selectedEnrichmentRequests.current.delete(selectedId)
      })
  }, [rawData.nodes, selectedId, setRawData])

  return { clearDisplayRequestCaches }
}
