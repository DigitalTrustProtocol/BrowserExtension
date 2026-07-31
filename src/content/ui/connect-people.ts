import { isConnectPeoplePage, parseProfileHref } from '../scanner'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, trustStore } from '../trust-store'
import { summarizeTrust, type TrustSummary } from '../trust-summary'
import type { TrustTone } from '../types'
import { profileTargetForHandle } from './profile-target'
import { setConnectPeopleTone } from './signals'

export const CONNECT_META_ATTR = 'data-attentionx-connect-meta'
export const USER_CELL_SELECTOR = '[data-testid="UserCell"]'

export interface ConnectPeopleSlot {
  row: HTMLElement
  nameColumn: HTMLElement
  followColumn: HTMLElement
  handle: string
}

export function resolveConnectPeopleHandle(
  cell: HTMLElement,
): string | undefined {
  for (const link of cell.querySelectorAll<HTMLAnchorElement>(
    'a[href^="/"]',
  )) {
    const handle = parseProfileHref(link.getAttribute('href'))
    if (handle) return handle
  }
  return undefined
}

/**
 * Flex row inside a Connect People `UserCell`: name column, then Follow.
 */
export function findConnectPeopleSlot(
  cell: HTMLElement,
): ConnectPeopleSlot | undefined {
  const followBtn = cell.querySelector<HTMLElement>(
    '[data-testid$="-follow"], [data-testid$="-unfollow"]',
  )
  if (!followBtn) return undefined
  const handle = resolveConnectPeopleHandle(cell)
  if (!handle) return undefined

  let node: HTMLElement | null = followBtn.parentElement
  while (node && cell.contains(node)) {
    const kids = [...node.children]
    const followIdx = kids.findIndex((child) => child.contains(followBtn))
    if (followIdx > 0 && kids[0] instanceof HTMLElement) {
      const nameColumn = kids[0]
      if (nameColumn.querySelector('a[href^="/"]')) {
        return {
          row: node,
          nameColumn,
          followColumn: kids[followIdx] as HTMLElement,
          handle,
        }
      }
    }
    if (node === cell) break
    node = node.parentElement
  }
  return undefined
}

function removeStaleConnectMetaMounts(): void {
  for (const stale of document.querySelectorAll<HTMLElement>(
    `[${CONNECT_META_ATTR}]`,
  )) {
    stale.remove()
  }
}

interface CellState {
  cell: HTMLElement
  nameColumn: HTMLElement
  handle: string
}

/**
 * Connect People (`/i/connect_people`) suggestions: ambient display name only.
 */
export class ConnectPeopleAugmentor {
  #cells = new Map<HTMLElement, CellState>()
  #unsubs = new Map<HTMLElement, () => void>()
  #observer?: MutationObserver
  #syncTimer: ReturnType<typeof setTimeout> | undefined
  #enabled = false
  #ambientEnabled = true

  start(options?: { ambient?: boolean }): void {
    this.#enabled = true
    this.#ambientEnabled = options?.ambient !== false
    if (!this.#observer) {
      this.#observer = new MutationObserver(() => this.#scheduleSync())
      this.#observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    }
    this.sync()
  }

  stop(): void {
    this.#enabled = false
    this.#observer?.disconnect()
    this.#observer = undefined
    if (this.#syncTimer !== undefined) clearTimeout(this.#syncTimer)
    this.#syncTimer = undefined
    this.#teardownAll()
    removeStaleConnectMetaMounts()
  }

  #scheduleSync(): void {
    if (!this.#enabled) return
    if (this.#syncTimer !== undefined) clearTimeout(this.#syncTimer)
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = undefined
      this.sync()
    }, 120)
  }

  sync(): void {
    if (!this.#enabled) return
    if (!isConnectPeoplePage()) {
      this.#teardownAll()
      return
    }

    removeStaleConnectMetaMounts()

    const seen = new Set<HTMLElement>()
    for (const cell of document.querySelectorAll<HTMLElement>(
      USER_CELL_SELECTOR,
    )) {
      seen.add(cell)
      this.#ensureCell(cell)
    }

    for (const cell of [...this.#cells.keys()]) {
      if (!seen.has(cell) || !cell.isConnected) this.#teardownCell(cell)
    }
  }

  #ensureCell(cell: HTMLElement): void {
    const slot = findConnectPeopleSlot(cell)
    if (!slot) {
      this.#teardownCell(cell)
      return
    }

    if (!this.#ambientEnabled) {
      this.#teardownCell(cell)
      return
    }

    const existing = this.#cells.get(cell)
    const handleChanged = existing && existing.handle !== slot.handle

    if (existing && !handleChanged) {
      existing.nameColumn = slot.nameColumn
      this.#watch(cell, slot.handle)
      return
    }

    if (existing) this.#teardownCell(cell)

    this.#cells.set(cell, {
      cell,
      nameColumn: slot.nameColumn,
      handle: slot.handle,
    })
    this.#watch(cell, slot.handle)
  }

  #watch(cell: HTMLElement, handle: string): void {
    this.#unsubs.get(cell)?.()
    this.#unsubs.delete(cell)

    const target = profileTargetForHandle(handle)
    const descriptor = trustDescriptor(target)
    const state = this.#cells.get(cell)
    if (!descriptor || !state) {
      this.#paint(cell, undefined)
      return
    }

    const key = descriptorKey(descriptor)
    const cached = trustStore.get(key)
    if (cached) {
      this.#paint(cell, summarizeTrust(cached), trustStore.isLoading(key))
    }

    const unsubscribe = trustStore.subscribe(key, (result) => {
      this.#paint(
        cell,
        result ? summarizeTrust(result) : undefined,
        trustStore.isLoading(key),
      )
    })
    this.#unsubs.set(cell, unsubscribe)
    trustStore.request(key, descriptor)
    if (!cached) this.#paint(cell, undefined, trustStore.isLoading(key))
  }

  #paint(
    cell: HTMLElement,
    summary: TrustSummary | undefined,
    _loading = false,
  ): void {
    const state = this.#cells.get(cell)
    if (!state) return

    const tone: TrustTone = summary?.tone ?? 'neutral'
    setConnectPeopleTone(state.nameColumn, tone)
  }

  #teardownCell(cell: HTMLElement): void {
    this.#unsubs.get(cell)?.()
    this.#unsubs.delete(cell)

    const state = this.#cells.get(cell)
    if (state) {
      setConnectPeopleTone(state.nameColumn, undefined)
      this.#cells.delete(cell)
    }
  }

  #teardownAll(): void {
    for (const cell of [...this.#cells.keys()]) this.#teardownCell(cell)
  }
}
