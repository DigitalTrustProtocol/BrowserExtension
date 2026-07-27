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
  'article[data-tweet-id], article[data-testid="tweet"], article[itemtype="https://schema.org/SocialMediaPosting"]'

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

function parseArticleUnsafe(article: HTMLElement): ArticleTargets | undefined {
  const statusMatch = [
    ...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'),
  ]
    .map((link) => link.getAttribute('href') ?? '')
    .map((href) =>
      href.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,24})(?:$|[/?#])/i),
    )
    .find((match) => Boolean(match))
  const semanticPostId = metaContent(article, 'meta[itemprop="identifier"]')
  const postId =
    (isXNumericId(article.dataset.tweetId) && article.dataset.tweetId) ||
    (isXNumericId(semanticPostId) && semanticPostId) ||
    statusMatch?.[2]

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
  const handle = [statusMatch?.[1], authorUrlHandle, legacyHandle]
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
