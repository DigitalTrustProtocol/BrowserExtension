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
    ? new URL(authorUrl, location.origin).pathname.split('/').filter(Boolean)[0]
    : undefined
  const legacyHandle = article
    .querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]')
    ?.getAttribute('href')
    ?.split('/')
    .filter(Boolean)[0]
  const handle = (
    primaryArticle
      ? [
          legacyHandle,
          authorUrlHandle,
          pageStatus?.handle,
          selfLink?.handle,
          statusMatch?.handle,
        ]
      : [
          selfLink?.handle,
          statusMatch?.handle,
          authorUrlHandle,
          legacyHandle,
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

export function classifyPage(): string {
  const path = location.pathname
  if (/^\/[^/]+\/status\/\d+/.test(path)) return 'status'
  if (/^\/(home|explore|notifications|search)/.test(path)) return 'timeline'
  if (/^\/[A-Za-z0-9_]{1,15}\/?$/.test(path)) return 'profile'
  return 'other'
}

/** Row holding the author's display name and handle inside a tweet. */
export function findAuthorNameRow(
  article: HTMLElement,
): HTMLElement | undefined {
  return (
    article.querySelector<HTMLElement>('[data-testid="User-Name"]') ??
    article.querySelector<HTMLAnchorElement>(
      '[data-testid="User-Name"] a[href^="/"]',
    )?.parentElement ??
    undefined
  )
}

/** The reply / repost / like row at the bottom of a tweet. */
export function findPostActionBar(
  article: HTMLElement,
): HTMLElement | undefined {
  return (
    article.querySelector<HTMLElement>('[role="group"]') ??
    article.querySelector<HTMLElement>('[data-testid="reply"]')?.parentElement ??
    undefined
  )
}

function isGrokControl(el: Element): boolean {
  const label = (
    el.getAttribute('aria-label') ??
    el.getAttribute('title') ??
    ''
  ).toLowerCase()
  if (label.includes('grok')) return true
  const testId = el.getAttribute('data-testid')?.toLowerCase() ?? ''
  return testId.includes('grok')
}

/**
 * Finds where to insert the author chip: immediately before the Grok control
 * in the tweet header when present, otherwise at the end of the name row.
 */
export function findAuthorChipSlot(article: HTMLElement): {
  parent: HTMLElement
  before: ChildNode | null
} | undefined {
  const nameRow = findAuthorNameRow(article)
  if (!nameRow) return undefined

  const header =
    nameRow.parentElement ?? nameRow.closest<HTMLElement>('div') ?? nameRow
  for (const el of header.querySelectorAll<HTMLElement>(
    'button, a, div[role="button"]',
  )) {
    if (!isGrokControl(el)) continue
    if (el.parentElement) {
      return { parent: el.parentElement, before: el }
    }
  }

  return { parent: nameRow, before: null }
}

/** Bookmark / remove-bookmark control in the post action bar. */
export function findBookmarkControl(
  article: HTMLElement,
): HTMLElement | undefined {
  return (
    article.querySelector<HTMLElement>(
      '[data-testid="bookmark"], [data-testid="removeBookmark"]',
    ) ?? undefined
  )
}

/**
 * Finds where to insert the post chip: immediately before the bookmark icon.
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

/**
 * Finds tweet articles across SPA navigation and reports which of them are
 * near the viewport, so trust lookups follow what the operator can actually see.
 */
export class ArticleScanner {
  #mutationObserver?: MutationObserver
  #intersectionObserver?: IntersectionObserver
  #scanTimer: ReturnType<typeof setTimeout> | undefined
  #enabled = false
  readonly #onScan: ArticleScanHandler
  readonly #onVisibility: ArticleVisibilityHandler
  readonly #onRemoved?: ArticleRemovalHandler
  readonly #onPageChange?: (page: string) => void
  readonly #targets = new WeakMap<HTMLElement, ArticleTargets>()
  #observed = new Set<HTMLElement>()

  constructor(options: {
    onScan: ArticleScanHandler
    onVisibility: ArticleVisibilityHandler
    onRemoved?: ArticleRemovalHandler
    onPageChange?: (page: string) => void
  }) {
    this.#onScan = options.onScan
    this.#onVisibility = options.onVisibility
    this.#onRemoved = options.onRemoved
    this.#onPageChange = options.onPageChange
  }

  get enabled(): boolean {
    return this.#enabled
  }

  start(root: HTMLElement = document.documentElement): void {
    if (this.#enabled) return
    this.#enabled = true
    this.#mutationObserver = new MutationObserver(() => this.schedule())
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
    window.removeEventListener('popstate', this.#onPopState)
  }

  schedule(): void {
    if (!this.#enabled) return
    if (this.#scanTimer !== undefined) clearTimeout(this.#scanTimer)
    this.#scanTimer = setTimeout(() => this.scan(), 180)
  }

  scan(): void {
    if (!this.#enabled) return
    const page = classifyPage()
    document.documentElement.dataset.attentionxPage = page
    this.#onPageChange?.(page)

    const seen = new Set<HTMLElement>()
    for (const article of document.querySelectorAll<HTMLElement>(
      ARTICLE_SELECTOR,
    )) {
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
  }

  #onPopState = (): void => {
    this.schedule()
  }
}
