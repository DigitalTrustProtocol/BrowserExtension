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
  labelsFromXIdentityDisplay,
  nodeNeedsXProfileEnrichment,
  pictureFromXIdentityDisplay,
  twitterIdFromNodeId,
} from './graph-display'
import { loadProfileDisplays, loadXIdentityDisplays } from './graph-rpc'
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
  const selectedEnrichmentRequests = useRef(new Set<string>())

  const clearDisplayRequestCaches = useCallback(() => {
    pubkeyProfileRequests.current.clear()
    xDisplayRequests.current.clear()
    selectedEnrichmentRequests.current.clear()
  }, [])

  const prevShowUserIcons = useRef(showUserIcons)
  useEffect(() => {
    if (showUserIcons && !prevShowUserIcons.current) {
      clearDisplayRequestCaches()
    }
    prevShowUserIcons.current = showUserIcons
  }, [clearDisplayRequestCaches, showUserIcons])

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
              const labels = labelsFromXIdentityDisplay(display)
              const picture = pictureFromXIdentityDisplay(display)
              const next = {
                ...node,
                ...(labels.label ? { label: labels.label } : {}),
                ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
                ...(picture ? { picture } : {}),
              }
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
            const next = {
              ...node,
              ...(profile.name ? { label: profile.name } : {}),
              ...(profile.picture ? { picture: profile.picture } : {}),
              ...(!node.subtitle && subject?.type === 'p'
                ? { subtitle: `${subject.value.slice(0, 8)}…` }
                : {}),
            }
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
    if (node.picture && !nodeNeedsXProfileEnrichment(node)) return
    if (selectedEnrichmentRequests.current.has(selectedId)) return

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
          const labels = labelsFromXIdentityDisplay(display)
          const picture = pictureFromXIdentityDisplay(display)
          setRawData((current) => {
            let changed = false
            const nodes = current.nodes.map((entry) => {
              if (entry.id !== selectedId) return entry
              const next = {
                ...entry,
                ...(labels.label ? { label: labels.label } : {}),
                ...(labels.subtitle ? { subtitle: labels.subtitle } : {}),
                ...(picture ? { picture } : {}),
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
