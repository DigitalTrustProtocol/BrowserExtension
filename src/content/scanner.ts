import {
  isXNumericId,
  normalizeObservedHandle,
  type ObservedXIdentity,
} from '../shared/observed-x-identity'
import {
  canonicalTwitterPostUrl,
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
} from '../shared/x-identity'
import type { ArticleTargets, ObservedIdentityLookup } from './types'

export const ARTICLE_SELECTOR =
  'article[data-tweet-id], article[data-testid="tweet"], div[data-testid="tweet"], article[itemtype="https://schema.org/SocialMediaPosting"]'

/** First-path segments that are never profile handles on x.com. */
export const X_RESERVED_PATH_SEGMENTS = new Set([
  'home',
  'explore',
  'search',
  'notifications',
  'messages',
  'settings',
  'i',
  'compose',
  'intent',
  'share',
  'hashtag',
  'login',
  'signup',
  'logout',
  'tos',
  'privacy',
])

/** Profile tabs under `/<handle>/…` (posts tab is `/<handle>` only). */
export const PROFILE_TAB_SEGMENTS = new Set([
  'with_replies',
  'media',
  'likes',
  'highlights',
  'articles',
  'followers',
  'following',
  'verified_followers',
  'affiliates',
  'subscriptions',
])

export const identitiesByHandle = new Map<string, ObservedIdentityLookup>()
export const identitiesByPostId = new Map<string, ObservedIdentityLookup>()

function metaContent(root: ParentNode, selector: string): string | undefined {
  return root.querySelector<HTMLMetaElement>(selector)?.content || undefined
}

export function selectTwitterId(
  postId: string,
  handle: string,
  domTwitterId: string | undefined,
  byHandle: ReadonlyMap<string, ObservedIdentityLookup> = identitiesByHandle,
  byPostId: ReadonlyMap<string, ObservedIdentityLookup> = identitiesByPostId,
): string | undefined {
  const normalizedHandle = normalizeObservedHandle(handle)
  if (!isXNumericId(postId) || !normalizedHandle) return domTwitterId
  const postIdentity = byPostId.get(postId)

  return (
    (postIdentity?.handle === normalizedHandle
      ? postIdentity.twitterId
      : undefined) ??
    byHandle.get(normalizedHandle)?.twitterId ??
    domTwitterId
  )
}

export function applyIdentityObservations(
  observations: readonly ObservedXIdentity[],
): boolean {
  if (observations.length === 0) return false

  for (const observation of observations) {
    const lookup = {
      twitterId: observation.twitterId,
      handle: observation.handle,
      observedAt: observation.observedAt,
    }
    const previousHandle = identitiesByHandle.get(observation.handle)
    if (
      !previousHandle ||
      observation.observedAt >= previousHandle.observedAt
    ) {
      identitiesByHandle.set(observation.handle, lookup)
    }

    for (const postId of observation.postIds ?? []) {
      const previousPost = identitiesByPostId.get(postId)
      if (!previousPost || observation.observedAt >= previousPost.observedAt) {
        identitiesByPostId.set(postId, lookup)
      }
    }
  }

  return true
}

/** Parses `/handle/status/id` from relative or absolute X status URLs. */
export function parseStatusHref(
  href: string | null | undefined,
): { handle: string; postId: string } | undefined {
  if (!href) return undefined
  let path = href
  try {
    if (/^https?:\/\//i.test(href)) {
      path = new URL(href).pathname
    }
  } catch {
    return undefined
  }
  const match = path.match(
    /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,24})(?:$|[/?#])/i,
  )
  if (!match?.[1] || !match[2]) return undefined
  const handle = normalizeObservedHandle(match[1])
  if (!handle || !isXNumericId(match[2])) return undefined
  return { handle, postId: match[2] }
}

export function parseStatusPathname(
  pathname = typeof location !== 'undefined' ? location.pathname : '',
): { handle: string; postId: string } | undefined {
  return parseStatusHref(pathname)
}

/**
 * Parses a profile href (`/handle` or `https://x.com/handle`) into a handle.
 * Rejects status URLs, reserved paths, and multi-segment app routes.
 */
export function parseProfileHref(
  href: string | null | undefined,
): string | undefined {
  if (!href) return undefined
  let path = href
  try {
    if (/^https?:\/\//i.test(href)) {
      path = new URL(href).pathname
    }
  } catch {
    return undefined
  }
  if (/\/status\//i.test(path)) return undefined
  const match = path.match(/^\/([A-Za-z0-9_]{1,15})\/?$/i)
  if (!match?.[1]) return undefined
  const handle = normalizeObservedHandle(match[1])
  if (!handle || X_RESERVED_PATH_SEGMENTS.has(handle)) return undefined
  return handle
}

/**
 * Profile handle from the current path, including profile tabs such as
 * `/nasa/with_replies` and `/nasa/media`. Returns undefined on status URLs,
 * reserved routes, and non-profile paths.
 */
export function profileHandleFromPathname(
  pathname = typeof location !== 'undefined' ? location.pathname : '',
): string | undefined {
  if (/^\/[^/]+\/status\/\d+/i.test(pathname)) return undefined

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return undefined

  const first = normalizeObservedHandle(segments[0]!)
  if (!first || X_RESERVED_PATH_SEGMENTS.has(first)) return undefined

  if (segments.length === 1) return first

  if (
    segments.length === 2 &&
    PROFILE_TAB_SEGMENTS.has(segments[1]!.toLowerCase())
  ) {
    return first
  }

  return undefined
}

/** Profile anchors inside a root (excludes status / reserved routes). */
export function collectProfileLinks(
  root: ParentNode,
  limit = 12,
): HTMLAnchorElement[] {
  const out: HTMLAnchorElement[] = []
  for (const link of root.querySelectorAll<HTMLAnchorElement>(
    'a[href^="/"], a[href*="://"]',
  )) {
    if (!parseProfileHref(link.getAttribute('href'))) continue
    out.push(link)
    if (out.length >= limit) break
  }
  return out
}

function parseArticleUnsafe(article: HTMLElement): ArticleTargets | undefined {
  const statusLinks = [
    ...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'),
  ]
    .map((link) => parseStatusHref(link.getAttribute('href')))
    .filter((match): match is { handle: string; postId: string } =>
      Boolean(match),
    )

  const pageStatus = parseStatusPathname()
  // On a status page the focused post is the first timeline article. Replies
  // below often link to the parent first, so prefer the page URL for primary.
  const primaryArticle =
    pageStatus &&
    document.querySelector<HTMLElement>(ARTICLE_SELECTOR) === article
  const selfLink = pageStatus
    ? statusLinks.find((link) => link.postId === pageStatus.postId)
    : undefined
  const statusMatch = selfLink ?? statusLinks[0]
  const semanticPostId = metaContent(article, 'meta[itemprop="identifier"]')

  const postId =
    (isXNumericId(article.dataset.tweetId) && article.dataset.tweetId) ||
    (isXNumericId(semanticPostId) && semanticPostId) ||
    selfLink?.postId ||
    (primaryArticle ? pageStatus?.postId : undefined) ||
    statusMatch?.postId

  const authorScope =
    article.querySelector<HTMLElement>('[itemprop="author"]') ?? article
  const authorUrl = metaContent(authorScope, 'meta[itemprop="url"]')
  const authorUrlHandle = authorUrl
    ? (parseProfileHref(authorUrl) ??
      normalizeObservedHandle(
        new URL(authorUrl, location.origin).pathname
          .split('/')
          .filter(Boolean)[0] ?? '',
      ))
    : undefined
  const profileLinkHandle = collectProfileLinks(article, 4)
    .map((link) => parseProfileHref(link.getAttribute('href')))
    .find((candidate): candidate is string => Boolean(candidate))
  const handle = (
    primaryArticle
      ? [
          profileLinkHandle,
          authorUrlHandle,
          pageStatus?.handle,
          selfLink?.handle,
          statusMatch?.handle,
        ]
      : [
          selfLink?.handle,
          statusMatch?.handle,
          authorUrlHandle,
          profileLinkHandle,
        ]
  )
    .map((candidate) =>
      typeof candidate === 'string'
        ? normalizeObservedHandle(candidate)
        : undefined,
    )
    .find((candidate) => Boolean(candidate))
  const authorIdentifier = metaContent(
    authorScope,
    'meta[itemprop="identifier"]',
  )

  if (!postId || !handle) return undefined

  const normalizedHandle = handle
  const twitterId = selectTwitterId(
    postId,
    normalizedHandle,
    isXNumericId(authorIdentifier) ? authorIdentifier : undefined,
  )
  const profileUrl = canonicalTwitterProfileUrl({
    handle: normalizedHandle,
    twitterId,
  })
  const profileId = canonicalTwitterProfileId({
    handle: normalizedHandle,
    twitterId,
  })

  return {
    postTarget: {
      type: 'post',
      id: postId,
      handle: normalizedHandle,
      twitterId,
      url: canonicalTwitterPostUrl(postId),
    },
    profileTarget: {
      type: 'profile',
      id: profileId,
      handle: normalizedHandle,
      twitterId,
      url: profileUrl,
    },
  }
}

export function parseArticle(article: HTMLElement): ArticleTargets | undefined {
  try {
    return parseArticleUnsafe(article)
  } catch {
    return undefined
  }
}

export function isConnectPeoplePage(
  pathname = typeof location !== 'undefined' ? location.pathname : '',
): boolean {
  return /^\/i\/connect_people\/?$/i.test(pathname)
}

export function classifyPage(): string {
  const path = location.pathname
  if (/^\/[^/]+\/status\/\d+/.test(path)) return 'status'
  if (/^\/(home|explore|notifications|search)(\/|$)/.test(path)) {
    return 'timeline'
  }
  if (/^\/i\/(bookmarks|lists\/\d+)/.test(path)) return 'timeline'
  if (isConnectPeoplePage(path)) return 'connect'
  if (profileHandleFromPathname(path)) return 'profile'
  return 'other'
}

function lowestCommonAncestor(
  a: HTMLElement,
  b: HTMLElement,
  stop: HTMLElement,
): HTMLElement | undefined {
  const ancestors = new Set<HTMLElement>()
  let node: HTMLElement | null = a
  for (let depth = 0; depth < 8 && node && node !== stop; depth++) {
    ancestors.add(node)
    node = node.parentElement
  }
  node = b
  for (let depth = 0; depth < 8 && node && node !== stop; depth++) {
    if (ancestors.has(node)) return node
    node = node.parentElement
  }
  return undefined
}

/**
 * Author name row via profile-link clustering — independent of X class/testid
 * churn. Scoped to the article; only inspects a small prefix of profile links.
 */
function findAuthorNameRowByProfileLinks(
  article: HTMLElement,
): HTMLElement | undefined {
  const links = collectProfileLinks(article, 10)
  if (links.length === 0) return undefined

  let displayLink: HTMLAnchorElement | undefined
  let handleLink: HTMLAnchorElement | undefined
  for (const link of links) {
    const text = (link.textContent ?? '').trim()
    if (!text) continue
    if (text.startsWith('@')) {
      handleLink ??= link
    } else if (!displayLink) {
      displayLink = link
    }
    if (displayLink && handleLink) break
  }

  if (displayLink && handleLink) {
    const row = lowestCommonAncestor(displayLink, handleLink, article)
    if (row && row !== article) return row
  }

  const seed = displayLink ?? handleLink ?? links[0]
  if (!seed) return undefined
  // Prefer a compact parent (name + handle + badge), not the whole card.
  let node: HTMLElement | null = seed.parentElement
  for (let depth = 0; depth < 4 && node && node !== article; depth++) {
    const profileCount = collectProfileLinks(node, 4).length
    if (
      profileCount >= 1 &&
      node.querySelectorAll('a[href*="/status/"]').length === 0
    ) {
      return node
    }
    node = node.parentElement
  }
  return seed.parentElement ?? seed
}

/**
 * Row holding the author's display name and handle inside a tweet.
 * Prefer Schema.org / stable hooks, then testids, then profile-link heuristic.
 */
export function findAuthorNameRow(
  article: HTMLElement,
): HTMLElement | undefined {
  const bySchema = article.querySelector<HTMLElement>('[itemprop="author"]')
  if (bySchema) {
    const named = bySchema.querySelector<HTMLElement>('[itemprop="name"]')
    if (named) {
      const row =
        named.closest<HTMLElement>('div, span, h2') ?? named.parentElement
      if (row && article.contains(row)) return row
    }
    return bySchema
  }

  // Compatibility: X still exposes these today; keep as a fast path.
  const byTestId =
    article.querySelector<HTMLElement>('[data-testid="User-Name"]') ??
    article.querySelector<HTMLElement>('[data-testid="UserName"]')
  if (byTestId) return byTestId

  return findAuthorNameRowByProfileLinks(article)
}

/**
 * Profile-page name root (not inside a tweet article).
 * Semantic / heading hooks first; testids only as compatibility.
 */
export function findProfileNameRoot(
  doc: Document = document,
): HTMLElement | undefined {
  const main =
    doc.querySelector<HTMLElement>('main[role="main"]') ??
    doc.querySelector<HTMLElement>('[data-testid="primaryColumn"]') ??
    doc.body

  const person =
    main?.querySelector<HTMLElement>(
      '[itemtype="https://schema.org/Person"], [itemtype="http://schema.org/Person"]',
    ) ?? undefined
  if (person) {
    const name =
      person.querySelector<HTMLElement>('[itemprop="name"]') ?? person
    return name.closest<HTMLElement>('div, h2, span') ?? name
  }

  const byTestId =
    main?.querySelector<HTMLElement>('[data-testid="UserName"]') ??
    main?.querySelector<HTMLElement>('[data-testid="User-Name"]')
  if (byTestId) return byTestId

  if (!main) return undefined
  const links = collectProfileLinks(main, 8)
  const pageHandle = profileHandleFromPathname(location.pathname)
  const matched = pageHandle
    ? links.filter(
        (link) => parseProfileHref(link.getAttribute('href')) === pageHandle,
      )
    : links
  if (matched.length === 0) return undefined
  const display =
    matched.find((link) => {
      const text = (link.textContent ?? '').trim()
      return text && !text.startsWith('@')
    }) ?? matched[0]
  const handleLink =
    matched.find((link) => (link.textContent ?? '').trim().startsWith('@')) ??
    matched[1]
  if (display && handleLink) {
    return (
      lowestCommonAncestor(display, handleLink, main) ??
      display.parentElement ??
      display
    )
  }
  return display?.parentElement ?? display
}

/** Verified / affiliation badge near the author name, if present. */
export function findAuthorVerifiedBadge(
  root: HTMLElement,
): SVGElement | undefined {
  const scope = findAuthorNameRow(root) ?? root
  return (
    scope.querySelector<SVGElement>('svg[data-testid="icon-verified"]') ??
    scope.querySelector<SVGElement>('svg[aria-label*="Verified" i]') ??
    scope.querySelector<SVGElement>('svg[aria-label*="Affiliated" i]') ??
    scope.querySelector<SVGElement>('svg[aria-label*="Government" i]') ??
    undefined
  )
}

/** The reply / repost / like row at the bottom of a tweet. */
export function findPostActionBar(
  article: HTMLElement,
): HTMLElement | undefined {
  // Prefer the group that contains engagement controls (semantic role).
  for (const group of article.querySelectorAll<HTMLElement>('[role="group"]')) {
    if (
      group.querySelector(
        '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"], [data-testid="bookmark"], [data-testid="removeBookmark"], button[aria-label]',
      )
    ) {
      return group
    }
  }
  return (
    article.querySelector<HTMLElement>('[role="group"]') ??
    article.querySelector<HTMLElement>('[data-testid="reply"]')?.parentElement ??
    article.querySelector<HTMLElement>('button[data-testid="like"]')
      ?.parentElement ??
    undefined
  )
}

/**
 * Last child `div` under the headline `User-Name` row for compact detail + chip.
 */
export const AUTHOR_META_ATTR = 'data-attentionx-author-meta'

const AUTHOR_META_MOUNT_STYLE = [
  'display:inline-flex',
  'align-items:center',
  'align-self:center',
  'flex:0 0 auto',
  'max-height:16px',
  'line-height:16px',
  'vertical-align:middle',
  'margin:0',
  'padding:0',
].join(';')

export function ensureAuthorNameMetaMount(
  article: HTMLElement,
): HTMLElement | undefined {
  const nameRow = findAuthorNameRow(article)
  if (!nameRow) return undefined

  const existing = nameRow.querySelector<HTMLElement>(`[${AUTHOR_META_ATTR}]`)
  if (existing) {
    if (nameRow.lastElementChild !== existing) {
      nameRow.append(existing)
    }
    return existing
  }

  const mount = document.createElement('div')
  mount.setAttribute(AUTHOR_META_ATTR, 'true')
  mount.style.cssText = AUTHOR_META_MOUNT_STYLE
  nameRow.append(mount)
  return mount
}

/**
 * Inline insert slot for the post chip: immediately before the bookmark icon.
 * Falls back to the end of the action bar.
 */
export function findPostChipSlot(article: HTMLElement): {
  parent: HTMLElement
  before: ChildNode | null
} | undefined {
  const bookmark = findBookmarkControl(article)
  if (bookmark?.parentElement) {
    return { parent: bookmark.parentElement, before: bookmark }
  }
  const bar = findPostActionBar(article)
  if (!bar) return undefined
  return { parent: bar, before: null }
}

const AVATAR_ANCHOR_SELECTOR = [
  '[data-testid^="UserAvatar"]',
  '[data-testid="Tweet-User-Avatar"]',
  '[data-testid="UserAvatar-Container"]',
].join(', ')

/**
 * Fixed-size avatar container for an absolute author-chip overlay.
 * Prefer testids; fall back to the first profile-link image wrapper.
 */
export function findAuthorAvatarAnchor(
  article: HTMLElement,
): HTMLElement | undefined {
  const byTestId = article.querySelector<HTMLElement>(AVATAR_ANCHOR_SELECTOR)
  if (byTestId) return byTestId

  for (const link of collectProfileLinks(article, 4)) {
    const img = link.querySelector('img')
    if (!img) continue
    const wrap =
      img.closest<HTMLElement>('div, span, a') ?? link
    if (wrap !== article) return wrap
  }
  return undefined
}

/**
 * Action-bar container for an absolute post-chip overlay.
 * Prefer the bookmark parent (same visual slot as before), else the group.
 */
export function findPostActionBarAnchor(
  article: HTMLElement,
): HTMLElement | undefined {
  const bookmark = findBookmarkControl(article)
  if (bookmark?.parentElement) return bookmark.parentElement
  return findPostActionBar(article)
}

/** Bookmark / remove-bookmark control in the post action bar. */
export function findBookmarkControl(
  article: HTMLElement,
): HTMLElement | undefined {
  const byTestId = article.querySelector<HTMLElement>(
    '[data-testid="bookmark"], [data-testid="removeBookmark"]',
  )
  if (byTestId) return byTestId

  for (const el of article.querySelectorAll<HTMLElement>(
    'button[aria-label], div[role="button"][aria-label]',
  )) {
    const label = (el.getAttribute('aria-label') ?? '').toLowerCase()
    if (label.includes('bookmark') || label.includes('remove bookmark')) {
      return el
    }
  }
  return undefined
}

/**
 * Tweet header ⋮ / "More" menu (right side of the author row).
 * Prefer stable hooks; aria "More" is a structure-independent fallback.
 */
export function findPostMoreMenu(
  article: HTMLElement,
): HTMLElement | undefined {
  const byTestId = article.querySelector<HTMLElement>('[data-testid="caret"]')
  if (byTestId) return byTestId

  for (const el of article.querySelectorAll<HTMLElement>(
    'button[aria-label], div[role="button"][aria-label]',
  )) {
    const label = (el.getAttribute('aria-label') ?? '').trim().toLowerCase()
    // Exact-ish: avoid "Show more replies" etc. in the tweet body/footer.
    if (label === 'more' || label.startsWith('more options')) return el
  }
  return undefined
}

export function insertAtSlot(
  node: HTMLElement,
  slot: { parent: HTMLElement; before: ChildNode | null },
): void {
  slot.parent.insertBefore(node, slot.before)
}

export type ArticleScanHandler = (
  article: HTMLElement,
  targets: ArticleTargets,
) => void

export type ArticleVisibilityHandler = (
  article: HTMLElement,
  targets: ArticleTargets,
  visible: boolean,
) => void

export type ArticleRemovalHandler = (article: HTMLElement) => void

export type ArticleScanBatchHandler = () => void

/**
 * Finds tweet articles across SPA navigation and reports which of them are
 * near the viewport, so trust lookups follow what the operator can actually see.
 */
export class ArticleScanner {
  #mutationObserver?: MutationObserver
  #intersectionObserver?: IntersectionObserver
  #scanTimer: ReturnType<typeof setTimeout> | undefined
  #enabled = false
  #needsFullScan = true
  readonly #pendingArticles = new Set<HTMLElement>()
  readonly #onScan: ArticleScanHandler
  readonly #onVisibility: ArticleVisibilityHandler
  readonly #onRemoved?: ArticleRemovalHandler
  readonly #onPageChange?: (page: string) => void
  readonly #onScanBatchEnd?: ArticleScanBatchHandler
  readonly #targets = new WeakMap<HTMLElement, ArticleTargets>()
  #observed = new Set<HTMLElement>()
  #lastPage = ''

  constructor(options: {
    onScan: ArticleScanHandler
    onVisibility: ArticleVisibilityHandler
    onRemoved?: ArticleRemovalHandler
    onPageChange?: (page: string) => void
    /** Called once after each scan pass (not per article). */
    onScanBatchEnd?: ArticleScanBatchHandler
  }) {
    this.#onScan = options.onScan
    this.#onVisibility = options.onVisibility
    this.#onRemoved = options.onRemoved
    this.#onPageChange = options.onPageChange
    this.#onScanBatchEnd = options.onScanBatchEnd
  }

  get enabled(): boolean {
    return this.#enabled
  }

  start(root: HTMLElement = document.documentElement): void {
    if (this.#enabled) return
    this.#enabled = true
    this.#needsFullScan = true
    this.#mutationObserver = new MutationObserver((mutations) => {
      let relevant = this.#needsFullScan
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue
        for (const node of mutation.addedNodes) {
          this.#collectArticles(node)
        }
        // Also schedule on removals so recycled cells detach cleanly.
        if (
          mutation.addedNodes.length > 0 ||
          mutation.removedNodes.length > 0
        ) {
          relevant = true
        }
      }
      if (relevant || this.#pendingArticles.size > 0) this.schedule()
    })
    this.#mutationObserver.observe(root, { childList: true, subtree: true })
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const article = entry.target as HTMLElement
          const targets = this.#targets.get(article) ?? parseArticle(article)
          if (!targets) continue
          this.#targets.set(article, targets)
          this.#onVisibility(article, targets, entry.isIntersecting)
        }
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    )
    window.addEventListener('popstate', this.#onPopState)
    this.scan()
  }

  stop(): void {
    this.#enabled = false
    if (this.#scanTimer !== undefined) clearTimeout(this.#scanTimer)
    this.#scanTimer = undefined
    this.#mutationObserver?.disconnect()
    this.#mutationObserver = undefined
    this.#intersectionObserver?.disconnect()
    this.#intersectionObserver = undefined
    this.#observed.clear()
    this.#pendingArticles.clear()
    this.#needsFullScan = true
    window.removeEventListener('popstate', this.#onPopState)
  }

  schedule(): void {
    if (!this.#enabled) return
    if (this.#scanTimer !== undefined) clearTimeout(this.#scanTimer)
    this.#scanTimer = setTimeout(() => this.#runScan(), 180)
  }

  /** Force a full document article pass (SPA navigation / feature reapply). */
  requestFullScan(): void {
    this.#needsFullScan = true
    this.schedule()
  }

  /** Immediate full document pass. */
  scan(): void {
    this.#needsFullScan = true
    if (this.#scanTimer !== undefined) {
      clearTimeout(this.#scanTimer)
      this.#scanTimer = undefined
    }
    this.#runScan()
  }

  #runScan(): void {
    if (!this.#enabled) return
    const page = classifyPage()
    document.documentElement.dataset.attentionxPage = page
    if (page !== this.#lastPage) {
      this.#lastPage = page
      this.#onPageChange?.(page)
    }

    // Always walk current articles. Mutations only schedule this pass; skipping
    // onScan for "unchanged" targets left chips unmounted after feature apply
    // raced ahead of the first tweet paint.
    this.#needsFullScan = false
    this.#pendingArticles.clear()

    const seen = new Set<HTMLElement>()
    for (const article of document.querySelectorAll<HTMLElement>(
      ARTICLE_SELECTOR,
    )) {
      if (!article.isConnected) continue
      const parsed = parseArticle(article)
      if (!parsed) continue
      seen.add(article)
      this.#targets.set(article, parsed)
      if (!this.#observed.has(article)) {
        this.#observed.add(article)
        this.#intersectionObserver?.observe(article)
      }
      this.#onScan(article, parsed)
    }

    for (const article of this.#observed) {
      if (seen.has(article) && article.isConnected) continue
      this.#observed.delete(article)
      this.#intersectionObserver?.unobserve(article)
      this.#onRemoved?.(article)
    }

    this.#onScanBatchEnd?.()
  }

  #collectArticles(node: Node): void {
    if (!(node instanceof HTMLElement)) return
    if (node.matches?.(ARTICLE_SELECTOR)) {
      this.#pendingArticles.add(node)
    }
    for (const article of node.querySelectorAll?.<HTMLElement>(
      ARTICLE_SELECTOR,
    ) ?? []) {
      this.#pendingArticles.add(article)
    }
  }

  #onPopState = (): void => {
    this.requestFullScan()
  }
}
