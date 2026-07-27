import i18n from 'i18next'
import { i18nOptions } from '../i18n/resources'
import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../shared/contracts'
import { resolveActiveAccount, twitterIdFromTwidCookie } from './active-account'
import {
  startIdentityBridge,
  type IdentityObservationBatch,
} from './identity-bridge'
import { startProofCaptureBridge } from './proof-capture-bridge'
import { startProofSearchBridge } from './proof-search-bridge'
import {
  applyIdentityObservations,
  ArticleScanner,
  identitiesByHandle,
} from './scanner'
import { trustDescriptor } from './trust-helpers'
import { descriptorKey, sendMessage, trustStore } from './trust-store'
import { summarizeTrust } from './trust-summary'
import type { ArticleTargets } from './types'
import { HoverCardAugmentor } from './ui/hovercard'
import { destroyPopover } from './ui/popover'
import {
  createPreset,
  DEFAULT_X_AUGMENTATION_STYLE,
  isXAugmentationStyle,
  X_AUGMENTATION_STYLE_KEY,
  type ArticlePreset,
  type XAugmentationStyle,
} from './ui/presets'
import { ProfileHeaderAugmentor } from './ui/profile-header'
import { clearAllSignals, ensureSignalStylesheet } from './ui/signals'

export {
  parseArticle,
  selectTwitterId,
  ARTICLE_SELECTOR,
} from './scanner'
export {
  publishValueForVerdict,
  trustDescriptor,
  trustDisplay,
  type TrustDisplay,
} from './trust-helpers'
export type { TrustDescriptor } from './types'

let augmentationEnabled = true
let style: XAugmentationStyle = DEFAULT_X_AUGMENTATION_STYLE
let preset: ArticlePreset | undefined
let scanner: ArticleScanner | undefined
const hoverCard = new HoverCardAugmentor()
const profileHeader = new ProfileHeaderAugmentor()
const mountedArticles = new Map<HTMLElement, ArticleTargets>()
const subscriptions = new Map<HTMLElement, Array<() => void>>()

function hostAliases(hostname: string): string[] {
  const bare = hostname.replace(/^www\./i, '').toLowerCase()
  return [...new Set([hostname.toLowerCase(), bare, `www.${bare}`])]
}

function listIncludesHost(list: unknown, hostname: string): boolean {
  if (!Array.isArray(list)) return false
  const aliases = new Set(hostAliases(hostname))
  return list.some(
    (entry) => typeof entry === 'string' && aliases.has(entry.toLowerCase()),
  )
}

function isIdentityDisabledForHost(
  disabledSites: unknown,
  hostname = location.hostname,
): boolean {
  return listIncludesHost(disabledSites, hostname)
}

async function readAugmentationEnabled(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get('identityDisabledSites')
    return !isIdentityDisabledForHost(data.identityDisabledSites)
  } catch {
    return true
  }
}

async function readAugmentationStyle(): Promise<XAugmentationStyle> {
  try {
    const data = await chrome.storage.local.get(X_AUGMENTATION_STYLE_KEY)
    const stored = data[X_AUGMENTATION_STYLE_KEY]
    return isXAugmentationStyle(stored)
      ? stored
      : DEFAULT_X_AUGMENTATION_STYLE
  } catch {
    return DEFAULT_X_AUGMENTATION_STYLE
  }
}

function repaint(article: HTMLElement): void {
  const targets = mountedArticles.get(article)
  if (!targets || !preset) return
  const authorDescriptor = trustDescriptor(targets.profileTarget)
  const postDescriptor = trustDescriptor(targets.postTarget)
  const author = authorDescriptor
    ? trustStore.get(descriptorKey(authorDescriptor))
    : undefined
  const post = postDescriptor
    ? trustStore.get(descriptorKey(postDescriptor))
    : undefined

  preset.update(article, targets, {
    ...(author ? { author: summarizeTrust(author) } : {}),
    ...(post ? { post: summarizeTrust(post) } : {}),
  })
}

function unwatch(article: HTMLElement): void {
  for (const dispose of subscriptions.get(article) ?? []) dispose()
  subscriptions.delete(article)
}

/** Requests trust for an article's two subjects and repaints on every result. */
function watch(article: HTMLElement, targets: ArticleTargets): void {
  unwatch(article)
  const disposers: Array<() => void> = []

  for (const target of [targets.profileTarget, targets.postTarget]) {
    const descriptor = trustDescriptor(target)
    if (!descriptor) continue
    const key = descriptorKey(descriptor)
    disposers.push(trustStore.subscribe(key, () => repaint(article)))
    trustStore.request(key, descriptor)
  }

  subscriptions.set(article, disposers)
  repaint(article)
}

function detach(article: HTMLElement): void {
  unwatch(article)
  mountedArticles.delete(article)
  preset?.unmount(article)
}

function onScan(article: HTMLElement, targets: ArticleTargets): void {
  if (!augmentationEnabled || !preset) return
  const previous = mountedArticles.get(article)
  mountedArticles.set(article, targets)
  if (!previous) preset.mount(article, targets)
  repaint(article)
  profileHeader.sync()
}

function onVisibility(
  article: HTMLElement,
  targets: ArticleTargets,
  visible: boolean,
): void {
  if (!augmentationEnabled) return
  if (visible) watch(article, targets)
  else unwatch(article)
}

function applyPreset(next: XAugmentationStyle): void {
  style = next
  preset?.destroy()
  destroyPopover()
  clearAllSignals()
  for (const article of [...subscriptions.keys()]) unwatch(article)
  mountedArticles.clear()

  if (!augmentationEnabled || next === 'off') {
    preset = undefined
    return
  }

  ensureSignalStylesheet()
  preset = createPreset(next)
  scanner?.scan()
}

function enablePageAugmentation(): void {
  if (augmentationEnabled && preset) return
  augmentationEnabled = true
  scanner?.start()
  hoverCard.start()
  profileHeader.start()
  applyPreset(style)
  scheduleActiveAccountReport()
  void syncProofCaptureSession()
}

function disablePageAugmentation(): void {
  augmentationEnabled = false
  for (const article of [...mountedArticles.keys()]) detach(article)
  preset?.destroy()
  preset = undefined
  destroyPopover()
  clearAllSignals()
  hoverCard.stop()
  profileHeader.stop()
  scanner?.stop()
  delete document.documentElement.dataset.attentionxPage
  proofCapture?.disable()
}

async function syncAugmentationFromStorage(
  disabledSites?: unknown,
): Promise<void> {
  const enabled =
    disabledSites === undefined
      ? await readAugmentationEnabled()
      : !isIdentityDisabledForHost(disabledSites)
  if (enabled) enablePageAugmentation()
  else disablePageAugmentation()
}

async function forwardIdentityBatch(
  batch: IdentityObservationBatch,
): Promise<void> {
  const changed = applyIdentityObservations(batch.observations)
  if (changed && document.documentElement) scanner?.schedule()
  scheduleActiveAccountReport()

  await sendMessage<{ ingested: number }>({
    type: 'INGEST_X_IDENTITIES',
    version: BACKGROUND_API_VERSION,
    observations: batch.observations,
  })
}

async function waitForDocumentElement(): Promise<HTMLElement> {
  if (document.documentElement) return document.documentElement

  await new Promise<void>((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), {
      once: true,
    })
  })
  return document.documentElement
}

let accountChangeTimer: number | undefined

/**
 * The injected UI stays mounted; only the cached verdicts are dropped so the
 * new active Nostr identity is reflected without reloading the host page.
 */
function onActiveNostrAccountChanged(): void {
  if (!augmentationEnabled) return
  window.clearTimeout(accountChangeTimer)
  accountChangeTimer = window.setTimeout(() => {
    trustStore.invalidateAll()
    void syncProofCaptureSession()
  }, 50)
}

async function initializeUi(): Promise<void> {
  await i18n.init({
    ...i18nOptions,
    lng: navigator.language,
  })

  // Bridges are created in bootstrap() so SEARCH_PROOF_POST is available early.

  await waitForDocumentElement()
  style = await readAugmentationStyle()
  scanner = new ArticleScanner({
    onScan,
    onVisibility,
    onRemoved: detach,
    onPageChange: () => profileHeader.sync(),
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.activeAccountId) onActiveNostrAccountChanged()
    if (changes.identityDisabledSites) {
      void syncAugmentationFromStorage(changes.identityDisabledSites.newValue)
    }
    const styleChange = changes[X_AUGMENTATION_STYLE_KEY]
    if (styleChange) {
      const next = isXAugmentationStyle(styleChange.newValue)
        ? styleChange.newValue
        : DEFAULT_X_AUGMENTATION_STYLE
      if (next !== style) applyPreset(next)
    }
  })
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === 'NOSTR_ACCOUNT_CHANGED') {
      onActiveNostrAccountChanged()
    }
    if (message?.type === 'X_IDENTITY_UPDATED') {
      // Verified / status changes affect trust overlays immediately.
      trustStore.invalidateAll()
    }
  })

  await syncAugmentationFromStorage()
  scheduleActiveAccountReport()
  window.setInterval(scheduleActiveAccountReport, 4_000)
  void syncProofCaptureSession()
  window.setInterval(() => {
    void syncProofCaptureSession()
  }, 3_000)
}

let activeAccountTimer: number | undefined
let lastReportedAccountKey = ''
let proofCapture: ReturnType<typeof startProofCaptureBridge> | undefined
let proofSearch: ReturnType<typeof startProofSearchBridge> | undefined

function scheduleActiveAccountReport(): void {
  if (!augmentationEnabled) return
  window.clearTimeout(activeAccountTimer)
  activeAccountTimer = window.setTimeout(() => {
    void reportActiveAccount()
  }, 250)
}

async function reportActiveAccount(): Promise<void> {
  const account = resolveActiveAccount(identitiesByHandle)
  const twid = twitterIdFromTwidCookie()

  // Transient DOM misses must not wipe a known active account. Only clear when
  // the signed-in twid cookie is also gone (likely logged out of X).
  if (!account) {
    if (!twid && lastReportedAccountKey) {
      lastReportedAccountKey = ''
      try {
        await sendMessage({
          type: 'REPORT_ACTIVE_X_ACCOUNT',
          version: BACKGROUND_API_VERSION,
          account: null,
        })
      } catch {
        /* ignore */
      }
    }
    return
  }

  const key = `${account.handle}:${account.twitterId ?? ''}`
  if (key === lastReportedAccountKey) return
  // Do not re-report the same handle without an ID after we already sent one.
  if (
    !account.twitterId &&
    lastReportedAccountKey.startsWith(`${account.handle}:`) &&
    lastReportedAccountKey.length > account.handle.length + 1
  ) {
    return
  }
  lastReportedAccountKey = key
  try {
    await sendMessage({
      type: 'REPORT_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
      account,
    })
  } catch (error) {
    console.info('AttentionX active account report failed', error)
  }
}

async function syncProofCaptureSession(): Promise<void> {
  if (!proofCapture) return
  if (!augmentationEnabled) {
    proofCapture.disable()
    return
  }
  try {
    const session = await sendMessage<
      | {
          handle: string
          twitterId: string
          proofText: string
          confirmedAt: number
        }
      | undefined
    >({
      type: 'GET_PROOF_COMPOSER_SESSION',
      version: BACKGROUND_API_VERSION,
    })
    if (session?.proofText) {
      proofCapture.enable(session.proofText, session.handle)
    } else {
      proofCapture.disable()
    }
  } catch {
    proofCapture.disable()
  }
}

function bootstrap(): void {
  // Ready before any async UI init so SEARCH_PROOF_POST from the popup works
  // as soon as the content script is injected.
  proofSearch = startProofSearchBridge()
  proofCapture = startProofCaptureBridge({
    onCaptured(postId) {
      void sendMessage<PublishResult>({
        type: 'CAPTURE_X_PROOF_POST',
        version: BACKGROUND_API_VERSION,
        proofTweetId: postId,
      })
        .then(() => {
          proofCapture?.disable()
        })
        .catch((error: unknown) => {
          console.info('AttentionX proof capture publish failed', error)
        })
    },
    onError(error) {
      console.info('AttentionX proof capture failed', error)
    },
  })

  startIdentityBridge({
    forwardBatch: forwardIdentityBatch,
    onForwardError(error) {
      console.info('AttentionX identity observation forwarding failed', error)
    },
  })
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'ATTENTIONX_REACTIVATE') {
      void syncAugmentationFromStorage().then(() => {
        sendResponse({ ok: true, enabled: augmentationEnabled })
      })
      return true
    }
    if (message?.type === 'GET_ACTIVE_X_ACCOUNT') {
      try {
        const account = resolveActiveAccount(identitiesByHandle)
        sendResponse({ account: account ?? null })
      } catch {
        sendResponse({ account: null })
      }
      return
    }
    if (message?.type === 'SEARCH_PROOF_POST') {
      const handle =
        typeof message.handle === 'string' ? message.handle : undefined
      const npub = typeof message.npub === 'string' ? message.npub : undefined
      const proofText =
        typeof message.proofText === 'string' ? message.proofText : undefined
      const timeoutMs =
        typeof message.timeoutMs === 'number' ? message.timeoutMs : 12_000
      if (!handle || !proofSearch) {
        sendResponse({})
        return
      }
      void proofSearch
        .search({
          expectedHandle: handle,
          expectedNpub: npub,
          expectedProofText: proofText,
          timeoutMs,
        })
        .then((match) =>
          sendResponse(
            match
              ? {
                  postId: match.postId,
                  handle: match.handle,
                  fullText: match.fullText,
                }
              : {},
          ),
        )
        .catch(() => sendResponse({}))
      return true
    }
    return
  })
  void initializeUi()
}

if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
  bootstrap()
}
