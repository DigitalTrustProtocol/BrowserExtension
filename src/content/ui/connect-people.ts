import { t } from '../i18n'
import {
  parseProfileHref,
  placeAfterDisplayNameIcons,
  rememberObservedHandle,
} from '../scanner'
import { detailScoreParts } from '../../shared/x-augmentation'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, trustStore } from '../trust-store'
import {
  chipToneForSummary,
  summarizeTrust,
  type TrustSummary,
} from '../trust-summary'
import type { TrustTone } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { cloneAuthorVerifiedBadge } from './verified-badge'
import {
  profileTargetForHandle,
  twitterIdFromFollowTestId,
  USER_ACTION_TESTID_SELECTOR,
} from './profile-target'
import { createTrustScoreLabel, type TrustScoreLabel } from './score'
import {
  formatTrustScore,
  readDisplayName,
  setConnectPeopleTone,
} from './signals'
import { openAuthorTrustOrPanel } from './operator-gate'

export const CONNECT_META_ATTR = 'data-attentionx-connect-meta'
export const USER_CELL_SELECTOR = '[data-testid="UserCell"]'
export const USER_CHROME_ATTR = 'data-attentionx-user-chrome'

const SCAN_MS = 180
const VISIBLE_ROOT_MARGIN = '200px'
const PENDING_CELL_ATTRS = ['data-testid', 'href']

function isHtmlElement(node: Node | null | undefined): node is HTMLElement {
  return node instanceof Element && node.namespaceURI !== 'http://www.w3.org/2000/svg'
}

/** Compact suggestion cards X renders as a single control (profile You might like). */
export function isClickableSuggestionCell(cell: HTMLElement): boolean {
  return cell.tagName === 'BUTTON' || cell.getAttribute('role') === 'button'
}

function slotPayload(
  row: HTMLElement,
  nameColumn: HTMLElement,
  followColumn: HTMLElement,
  handle: string,
  twitterId?: string,
): UserCellSlot {
  return {
    row,
    nameColumn,
    followColumn,
    handle,
    ...(twitterId ? { twitterId } : {}),
  }
}

export type UserCellChrome = 'row' | 'rail'

export interface UserCellSlot {
  row: HTMLElement
  nameColumn: HTMLElement
  followColumn: HTMLElement
  handle: string
  twitterId?: string
}

export { twitterIdFromFollowTestId }

export function resolveUserCellHandle(
  cell: HTMLElement,
): string | undefined {
  for (const link of cell.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const handle = parseProfileHref(link.getAttribute('href'))
    if (handle) return handle
  }
  return undefined
}

/**
 * Flex row inside a UserCell: name column, then Follow or Subscribe.
 * Button-hosted suggestion cards still resolve via the handle link + action.
 */
export function findUserCellSlot(cell: HTMLElement): UserCellSlot | undefined {
  const actionBtn = cell.querySelector<HTMLElement>(USER_ACTION_TESTID_SELECTOR)
  if (!actionBtn) return undefined
  const handle = resolveUserCellHandle(cell)
  if (!handle) return undefined
  const twitterId = twitterIdFromFollowTestId(
    actionBtn.getAttribute('data-testid'),
  )

  let node: HTMLElement | null = actionBtn.parentElement
  while (node && cell.contains(node)) {
    const kids = [...node.children]
    const followIdx = kids.findIndex((child) => child.contains(actionBtn))
    const nameColumn = kids[0]
    if (
      followIdx > 0 &&
      isHtmlElement(nameColumn) &&
      resolveUserCellHandle(nameColumn)
    ) {
      return slotPayload(
        node,
        nameColumn,
        kids[followIdx] as HTMLElement,
        handle,
        twitterId,
      )
    }
    if (node === cell) break
    node = node.parentElement
  }

  return fallbackUserCellSlot(cell, actionBtn, handle, twitterId)
}

function fallbackUserCellSlot(
  cell: HTMLElement,
  actionBtn: HTMLElement,
  handle: string,
  twitterId?: string,
): UserCellSlot | undefined {
  let handleLink: HTMLElement | undefined
  for (const link of cell.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (parseProfileHref(link.getAttribute('href')) === handle) {
      handleLink = link
      break
    }
  }
  if (!handleLink) return undefined

  let node: HTMLElement | null = handleLink.parentElement
  while (node && cell.contains(node)) {
    const kids = [...node.children]
    const nameIdx = kids.findIndex((child) => child.contains(handleLink))
    const followIdx = kids.findIndex((child) => child.contains(actionBtn))
    if (nameIdx >= 0 && followIdx >= 0 && nameIdx !== followIdx) {
      const nameColumn = kids[nameIdx]
      const followColumn = kids[followIdx]
      if (isHtmlElement(nameColumn) && isHtmlElement(followColumn)) {
        return slotPayload(node, nameColumn, followColumn, handle, twitterId)
      }
    }
    if (node === cell) break
    node = node.parentElement
  }

  return slotPayload(cell, cell, actionBtn, handle, twitterId)
}

/**
 * Narrow suggestion cards (Who to follow / sidebar / You might like) vs
 * wide lists with bio. `/i/connect_people` hosts rows as `<button UserCell>`
 * with a bio — that is UserRow, not UserRail. Do not treat `BUTTON` as rail.
 */
export function isUserRailCell(
  cell: HTMLElement,
  slot: UserCellSlot,
): boolean {
  if (cell.closest('[data-testid="sidebarColumn"]')) return true
  return !userCellHasBio(cell, slot)
}

const BIO_EXCLUDE_SELECTOR = [
  'a[href^="/"]',
  USER_ACTION_TESTID_SELECTOR,
  `[${CONNECT_META_ATTR}]`,
  '[data-attentionx-chip]',
  '[data-attentionx-score]',
  '[data-testid^="UserAvatar"]',
  '[data-testid="icon-verified"]',
].join(', ')

/**
 * Bio = visible text outside name/handle links, the action button, avatars,
 * badges, and our own mounts. Text-node walk; no innerHTML round-trip.
 */
function userCellHasBio(cell: HTMLElement, slot: UserCellSlot): boolean {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      return el.closest(BIO_EXCLUDE_SELECTOR)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    },
  })
  let leftover = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    leftover += node.textContent
  }
  const text = leftover.replace(/\s+/g, ' ').trim()
  if (text.length === 0) return false
  // Name column may still contain the display name if it is not an <a>.
  const nameText = (slot.nameColumn.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text !== nameText
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
  twitterId?: string
  chrome: UserCellChrome
  chip?: TrustChip
  score?: TrustScoreLabel
  metaMount?: HTMLElement
  visible: boolean
}

/**
 * UserCell chrome: UserRow (wide lists: score + chip on the name line) or
 * UserRail (Who to follow / sidebar: degree on the name line).
 * Both use `placeAfterDisplayNameIcons` — not tweet UserAuthor.
 */
export class UserCellAugmentor {
  #cells = new Map<HTMLElement, CellState>()
  #unsubs = new Map<HTMLElement, () => void>()
  #pending = new Map<HTMLElement, MutationObserver>()
  #observer?: MutationObserver
  #visibility?: IntersectionObserver
  #syncTimer: ReturnType<typeof setTimeout> | undefined
  #catchUpTimer: ReturnType<typeof setTimeout> | undefined
  #enabled = false
  #chipEnabled = true
  #ambientEnabled = true
  #detailTextEnabled = true
  #detailDegreeEnabled = true

  start(options?: {
    chip?: boolean
    ambient?: boolean
    detailText?: boolean
    detailDegree?: boolean
  }): void {
    this.#enabled = true
    this.#chipEnabled = options?.chip !== false
    this.#ambientEnabled = options?.ambient !== false
    this.#detailTextEnabled = options?.detailText !== false
    this.#detailDegreeEnabled = options?.detailDegree !== false
    if (!this.#observer) {
      // X often inserts the node first, then sets data-testid="UserCell".
      this.#observer = new MutationObserver(() => this.#scheduleSync())
      this.#observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-testid'],
      })
    }
    if (!this.#visibility && typeof IntersectionObserver !== 'undefined') {
      this.#visibility = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const target = entry.target
            if (target.nodeType !== 1) continue
            this.#onVisibility(target as HTMLElement, entry.isIntersecting)
          }
        },
        { rootMargin: VISIBLE_ROOT_MARGIN },
      )
    }
    this.sync()
    if (this.#catchUpTimer !== undefined) clearTimeout(this.#catchUpTimer)
    this.#catchUpTimer = setTimeout(() => {
      this.#catchUpTimer = undefined
      if (this.#enabled) this.sync()
    }, 600)
  }

  stop(): void {
    this.#enabled = false
    this.#observer?.disconnect()
    this.#observer = undefined
    this.#visibility?.disconnect()
    this.#visibility = undefined
    if (this.#syncTimer !== undefined) clearTimeout(this.#syncTimer)
    this.#syncTimer = undefined
    if (this.#catchUpTimer !== undefined) clearTimeout(this.#catchUpTimer)
    this.#catchUpTimer = undefined
    this.#teardownAll()
    this.#clearAllPending()
    removeStaleConnectMetaMounts()
  }

  #scheduleSync(): void {
    if (!this.#enabled) return
    if (this.#syncTimer !== undefined) return
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = undefined
      this.sync()
    }, SCAN_MS)
  }

  sync(): void {
    if (!this.#enabled) return

    const seen = new Set<HTMLElement>()
    for (const cell of document.querySelectorAll<HTMLElement>(
      USER_CELL_SELECTOR,
    )) {
      seen.add(cell)
      try {
        this.#ensureCell(cell)
      } catch {
        this.#watchPending(cell)
      }
    }

    for (const cell of [...this.#cells.keys()]) {
      if (!seen.has(cell) || !cell.isConnected) this.#teardownCell(cell)
    }
    for (const cell of [...this.#pending.keys()]) {
      if (!seen.has(cell) || !cell.isConnected) this.#clearPending(cell)
    }
  }

  #watchPending(cell: HTMLElement): void {
    if (this.#pending.has(cell)) return
    const observer = new MutationObserver(() => this.#scheduleSync())
    observer.observe(cell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: PENDING_CELL_ATTRS,
    })
    this.#pending.set(cell, observer)
    this.#visibility?.observe(cell)
  }

  #clearPending(cell: HTMLElement): void {
    this.#pending.get(cell)?.disconnect()
    this.#pending.delete(cell)
  }

  #clearAllPending(): void {
    for (const cell of [...this.#pending.keys()]) this.#clearPending(cell)
  }

  #ensureCell(cell: HTMLElement): void {
    const slot = findUserCellSlot(cell)
    if (!slot) {
      if (this.#cells.has(cell)) this.#teardownCell(cell)
      this.#watchPending(cell)
      return
    }
    this.#clearPending(cell)

    if (slot.twitterId) {
      rememberObservedHandle(slot.handle, slot.twitterId)
    }

    // Classify only on mount or identity change: bio detection walks the
    // cell, and X virtualizes lists, so a cell that gains a bio is a fresh
    // element rather than a mutated one.
    const existing = this.#cells.get(cell)
    const sameIdentity =
      existing !== undefined &&
      existing.handle === slot.handle &&
      existing.twitterId === slot.twitterId
    const chrome: UserCellChrome = sameIdentity
      ? existing.chrome
      : isUserRailCell(cell, slot)
        ? 'rail'
        : 'row'
    const wantsRow =
      chrome === 'row' &&
      (this.#chipEnabled || this.#detailScoreEnabled())
    const wantsRail = chrome === 'rail' && this.#detailDegreeEnabled
    if (!wantsRow && !wantsRail && !this.#ambientEnabled) {
      this.#teardownCell(cell)
      return
    }

    const identityChanged = existing !== undefined && !sameIdentity

    if (existing && !identityChanged) {
      existing.nameColumn = slot.nameColumn
      if (existing.metaMount) {
        placeAfterDisplayNameIcons(existing.nameColumn, existing.metaMount)
      }
      if (existing.visible) this.#watch(cell)
      return
    }

    if (existing) this.#teardownCell(cell)

    const state: CellState = {
      cell,
      nameColumn: slot.nameColumn,
      handle: slot.handle,
      chrome,
      visible: !this.#visibility,
      ...(slot.twitterId ? { twitterId: slot.twitterId } : {}),
    }
    this.#cells.set(cell, state)
    try {
      this.#mountChrome(state, wantsRow, wantsRail)
      cell.setAttribute(USER_CHROME_ATTR, chrome)
    } catch {
      this.#teardownCell(cell)
      this.#watchPending(cell)
      return
    }
    this.#visibility?.observe(cell)
    if (state.visible) this.#watch(cell)
  }

  #detailScoreEnabled(): boolean {
    return this.#detailTextEnabled || this.#detailDegreeEnabled
  }

  #scoreParts(): ReturnType<typeof detailScoreParts> {
    return detailScoreParts({
      detailText: this.#detailTextEnabled,
      detailDegree: this.#detailDegreeEnabled,
    })
  }

  #mountChrome(
    state: CellState,
    wantsRow: boolean,
    wantsRail: boolean,
  ): void {
    const metaMount = document.createElement('span')
    metaMount.setAttribute(CONNECT_META_ATTR, 'true')
    metaMount.style.cssText =
      'display:inline-flex;align-items:center;align-self:center;flex:0 0 auto;flex-wrap:nowrap;max-height:16px;line-height:16px;vertical-align:middle;'
    placeAfterDisplayNameIcons(state.nameColumn, metaMount)
    state.metaMount = metaMount

    if (wantsRow) {
      if (this.#detailScoreEnabled()) {
        state.score = createTrustScoreLabel({ compact: true })
        state.score.setOnOpenPath(() => this.#openCard(state))
        metaMount.append(state.score.host)
      }
      if (this.#chipEnabled) {
        state.chip = createTrustChip({
          title: t('content.card.authorChipTitle'),
          role: 'author',
          variant: 'inline',
          compact: true,
          onClick: () => this.#openCard(state),
        })
        metaMount.append(state.chip.host)
      }
    }

    if (wantsRail) {
      state.score = createTrustScoreLabel({ rail: true })
      state.score.setOnOpenPath(() => this.#openCard(state))
      metaMount.append(state.score.host)
    }
  }

  #openCard(state: CellState): void {
    const target = profileTargetForHandle(state.handle, state.twitterId)
    const verifiedBadge = cloneAuthorVerifiedBadge(state.cell)
    openAuthorTrustOrPanel({
      target,
      variant: 'author',
      title: readDisplayName(state.nameColumn),
      ...(verifiedBadge ? { verifiedBadge } : {}),
    })
  }

  #onVisibility(cell: HTMLElement, visible: boolean): void {
    if (visible && !this.#cells.has(cell)) {
      try {
        this.#ensureCell(cell)
      } catch {
        this.#watchPending(cell)
      }
    }
    const state = this.#cells.get(cell)
    if (!state) return
    state.visible = visible
    if (visible) this.#watch(cell)
    else this.#unwatch(cell)
  }

  #watch(cell: HTMLElement): void {
    this.#unwatch(cell)

    const state = this.#cells.get(cell)
    if (!state) return

    const target = profileTargetForHandle(state.handle, state.twitterId)
    const descriptor = trustDescriptor(target)
    if (!descriptor) {
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

  #unwatch(cell: HTMLElement): void {
    this.#unsubs.get(cell)?.()
    this.#unsubs.delete(cell)
  }

  #paint(
    cell: HTMLElement,
    summary: TrustSummary | undefined,
    loading = false,
  ): void {
    const state = this.#cells.get(cell)
    if (!state) return

    const tone: TrustTone = summary?.tone ?? 'neutral'
    if (this.#ambientEnabled) {
      setConnectPeopleTone(state.nameColumn, tone)
    } else {
      setConnectPeopleTone(state.nameColumn, undefined)
    }

    const chipTone = summary ? chipToneForSummary(summary) : 'neutral'
    state.chip?.setLoading(loading)
    state.chip?.setTone(chipTone)
    const scoreParts = this.#scoreParts()
    const chipTitle =
      summary && summary.resolution !== 'none'
        ? formatTrustScore(summary, scoreParts) ??
          t('content.card.authorChipTitle')
        : t('content.card.authorChipTitle')
    state.chip?.setLabel(chipTitle)

    switch (state.chrome) {
      case 'rail': {
        const degreeText =
          summary && summary.resolution !== 'none'
            ? formatTrustScore(summary, { text: false, degree: true })
            : undefined
        state.score?.set(degreeText, tone)
        break
      }
      case 'row': {
        const scoreText =
          this.#detailScoreEnabled() &&
          summary &&
          summary.resolution !== 'none'
            ? formatTrustScore(summary, scoreParts)
            : undefined
        state.score?.set(scoreText, tone)
        break
      }
      default: {
        const _never: never = state.chrome
        void _never
      }
    }
  }

  #teardownCell(cell: HTMLElement): void {
    this.#unwatch(cell)
    this.#visibility?.unobserve(cell)

    const state = this.#cells.get(cell)
    if (state) {
      setConnectPeopleTone(state.nameColumn, undefined)
      state.chip?.destroy()
      state.score?.destroy()
      state.metaMount?.remove()
      this.#cells.delete(cell)
    }
    cell.removeAttribute(USER_CHROME_ATTR)
  }

  #teardownAll(): void {
    for (const cell of [...this.#cells.keys()]) this.#teardownCell(cell)
    this.#clearAllPending()
  }
}
