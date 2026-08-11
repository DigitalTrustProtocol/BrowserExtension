import {
  BACKGROUND_API_VERSION,
  type PublishResult,
  type XIdentityUpdatedMessage,
} from '../shared/contracts'
import {
  initContentI18n,
  watchXHostLanguage,
} from './i18n'
import {
  activeAccountReportKey,
  previousReportHadTwitterId,
  resolveActiveAccount,
  twitterIdFromTwidCookie,
} from './active-account'
import {
  startIdentityBridge,
  type IdentityObservationBatch,
} from './identity-bridge'
import { ensurePageWorldContentPort } from './page-world-port'
import { startProofCaptureBridge } from './proof-capture-bridge'
import { startProofCandidateBridge } from './proof-candidate-bridge'
import { startBioCandidateBridge } from './bio-candidate-bridge'
import { startProfileBioObserver, type ProfileBioObserver } from './profile-bio-observer'
import { readVisibleXBioText } from './read-x-bio'
import { startProofSearchBridge } from './proof-search-bridge'
import {
  applyIdentityObservations,
  ArticleScanner,
  identitiesByHandle,
} from './scanner'
import { trustDescriptor } from './trust-helpers'
import { descriptorKey, sendMessage, setTrustStoreResolvedHook, trustStore } from './trust-store'
import { summarizeTrust } from './trust-summary'
import type { ArticleTargets } from './types'
import { HoverCardAugmentor } from './ui/hovercard'
import { destroyPopover } from './ui/popover'
import {
  createPreset,
  DEFAULT_X_AUGMENTATION_FEATURES,
  detailScoreEnabled,
  anyTrustFilterActive,
  needsArticleTrustScan,
  normalizeXAugmentationFeatures,
  X_AUGMENTATION_FEATURES_KEY,
  X_AUGMENTATION_PANEL_KEYS,
  type ArticlePreset,
  type XAugmentationFeatures,
} from './ui/presets'
import { ConnectPeopleAugmentor } from './ui/connect-people'
import { startXPageColorSchemeSync } from './ui/x-theme-sync'
import { ProfileHeaderAugmentor } from './ui/profile-header'
import { setActionIconsEnabled } from './ui/icons'
import { clearAllFilters, ensureFilterStylesheet } from './ui/hide'
import {
  clearTimelineDecorateUi,
  startTimelineDecorateObserver,
  type TimelineDecorateController,
} from './ui/timeline-decorate'
import { clearAllSignals, ensureSignalStylesheet } from './ui/signals'
import { TRUST_GRAPH_UPDATED_MESSAGE } from '../shared/demo-wot'
import { APP_MODE_CHANGED_MESSAGE } from '../shared/app-mode'
import { WOT_MAX_DEGREE_CHANGED_MESSAGE } from '../shared/wot-max-degree'
import { initContentAppMode } from './app-mode'
import {
  startJsonTrustFilterBridge,
  UI_TIMELINE_FILTERING_ENABLED,
  type JsonTrustFilterBridge,
} from './json-filter-bridge'
import {
  noteDomPostChrome,
  onPostTrustResolved,
  startPostChromeBridge,
} from './post-chrome-bridge'

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
let features: XAugmentationFeatures = { ...DEFAULT_X_AUGMENTATION_FEATURES }
let preset: ArticlePreset | undefined
let scanner: ArticleScanner | undefined
let jsonFilterBridge: JsonTrustFilterBridge | undefined
let timelineDecorate: TimelineDecorateController | undefined
let profileBioObserver: ProfileBioObserver | undefined
const hoverCard = new HoverCardAugmentor()
const profileHeader = new ProfileHeaderAugmentor()
const connectPeople = new ConnectPeopleAugmentor()
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

async function readAugmentationFeatures(): Promise<XAugmentationFeatures> {
  try {
    const data = await chrome.storage.local.get(X_AUGMENTATION_FEATURES_KEY)
    return normalizeXAugmentationFeatures(data[X_AUGMENTATION_FEATURES_KEY])
  } catch {
    return { ...DEFAULT_X_AUGMENTATION_FEATURES }
  }
}

function featuresEqual(
  a: XAugmentationFeatures,
  b: XAugmentationFeatures,
): boolean {
  if (!X_AUGMENTATION_PANEL_KEYS.every((key) => a[key] === b[key])) return false
  return (
    a.trustFilters.trusted === b.trustFilters.trusted &&
    a.trustFilters.mixed === b.trustFilters.mixed &&
    a.trustFilters.distrusted === b.trustFilters.distrusted &&
    a.trustFilters.none === b.trustFilters.none
  )
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

  const authorKey = authorDescriptor
    ? descriptorKey(authorDescriptor)
    : undefined
  const postKey = postDescriptor ? descriptorKey(postDescriptor) : undefined

  preset.update(article, targets, {
    ...(author ? { author: summarizeTrust(author) } : {}),
    ...(post ? { post: summarizeTrust(post) } : {}),
    ...(authorKey && trustStore.isLoading(authorKey)
      ? { authorLoading: true }
      : {}),
    ...(postKey && trustStore.isLoading(postKey) ? { postLoading: true } : {}),
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

/**
 * Track targets and mount height-safe overlays on discovery.
 * Trust lookups stay visibility-gated via IntersectionObserver.
 */
function onScan(article: HTMLElement, targets: ArticleTargets): void {
  if (!augmentationEnabled || !preset) return
  const previous = mountedArticles.get(article)
  mountedArticles.set(article, targets)
  if (targets.postTarget) {
    noteDomPostChrome(targets.postTarget.id, article, {
      ...(targets.profileTarget?.twitterId
        ? { twitterId: targets.profileTarget.twitterId }
        : targets.profileTarget?.id
          ? { twitterId: targets.profileTarget.id }
          : {}),
      ...(targets.profileTarget?.handle
        ? { handle: targets.profileTarget.handle }
        : {}),
    })
  }
  if (!previous) preset.mount(article, targets)
}

function onVisibility(
  article: HTMLElement,
  targets: ArticleTargets,
  visible: boolean,
): void {
  if (!augmentationEnabled || !preset) return
  mountedArticles.set(article, targets)
  if (visible) {
    if (targets.postTarget) {
      noteDomPostChrome(targets.postTarget.id, article, {
        ...(targets.profileTarget?.twitterId
          ? { twitterId: targets.profileTarget.twitterId }
          : targets.profileTarget?.id
            ? { twitterId: targets.profileTarget.id }
            : {}),
        ...(targets.profileTarget?.handle
          ? { handle: targets.profileTarget.handle }
          : {}),
      })
    }
    preset.mount(article, targets)
    watch(article, targets)
  } else {
    unwatch(article)
  }
}

function onScanBatchEnd(): void {
  if (!augmentationEnabled) return
  profileHeader.sync()
  connectPeople.sync()
  timelineDecorate?.applyAll()
}

function applyFeatures(next: XAugmentationFeatures): void {
  features = next
  jsonFilterBridge?.pushConfig(next.trustFilters)
  setActionIconsEnabled(next.actionIcons)
  // Drop trust subscriptions before tearing down UI to avoid stale repaints
  // re-applying the previous hide/collapse actions.
  for (const article of [...subscriptions.keys()]) unwatch(article)
  preset?.destroy()
  destroyPopover()
  clearAllSignals()
  clearAllFilters()
  clearTimelineDecorateUi()
  mountedArticles.clear()

  hoverCard.stop()
  profileHeader.stop()
  connectPeople.stop()

  if (!augmentationEnabled || !needsArticleTrustScan(next)) {
    preset = undefined
    if (augmentationEnabled) timelineDecorate?.applyAll()
    return
  }

  ensureSignalStylesheet()
  if (UI_TIMELINE_FILTERING_ENABLED && anyTrustFilterActive(next.trustFilters)) {
    ensureFilterStylesheet()
  }
  preset = createPreset(next)

  if (next.userCard) hoverCard.start()
  if (next.chip || next.ambient || detailScoreEnabled(next)) {
    profileHeader.start({
      chip: next.chip,
      ambient: next.ambient,
      detailText: next.detailText,
      detailDegree: next.detailDegree,
    })
  }
  if (next.ambient) {
    connectPeople.start({ ambient: next.ambient })
  }

  scanner?.scan()
  timelineDecorate?.applyAll()
}

function enablePageAugmentation(): void {
  if (augmentationEnabled && preset) return
  augmentationEnabled = true
  scanner?.start()
  applyFeatures(features)
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
  clearAllFilters()
  hoverCard.stop()
  profileHeader.stop()
  connectPeople.stop()
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
  // Profile UserDescription may have been visible before twitterId was known.
  profileBioObserver?.scan()

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

function refreshLocaleUi(): void {
  destroyPopover()
  for (const article of mountedArticles.keys()) repaint(article)
  profileHeader.sync()
  connectPeople.sync()
}

async function initializeUi(): Promise<void> {
  // Embedded English is available immediately; JSON may swap strings later.
  const localeReady = initContentI18n()
  void initContentAppMode()

  // Bridges are created in bootstrap() so SEARCH_PROOF_POST is available early.

  await waitForDocumentElement()
  features = await readAugmentationFeatures()
  jsonFilterBridge?.pushConfig(features.trustFilters)
  scanner = new ArticleScanner({
    onScan,
    onVisibility,
    onRemoved: detach,
    onPageChange: () => {
      profileHeader.sync()
      connectPeople.sync()
    },
    onScanBatchEnd,
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.activeAccountId) onActiveNostrAccountChanged()
    if (changes.identityDisabledSites) {
      void syncAugmentationFromStorage(changes.identityDisabledSites.newValue)
    }
    const featureChange = changes[X_AUGMENTATION_FEATURES_KEY]
    if (featureChange) {
      const next = normalizeXAugmentationFeatures(featureChange.newValue)
      if (!featuresEqual(next, features)) applyFeatures(next)
    }
  })
  watchXHostLanguage(refreshLocaleUi)
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === 'NOSTR_ACCOUNT_CHANGED') {
      onActiveNostrAccountChanged()
    }
    if (message?.type === 'X_IDENTITY_UPDATED') {
      // Only proof-status transitions change trust overlays. Me-profile chrome
      // / lastSeen pings must not clear the trust cache (chip spinner flash).
      const updated = message as XIdentityUpdatedMessage
      if (updated.statusChanged === true) trustStore.invalidateAll()
    }
    if (message?.type === TRUST_GRAPH_UPDATED_MESSAGE) {
      trustStore.invalidateAll()
    }
    if (message?.type === APP_MODE_CHANGED_MESSAGE) {
      trustStore.invalidateAll()
    }
    if (message?.type === WOT_MAX_DEGREE_CHANGED_MESSAGE) {
      trustStore.invalidateAll()
    }
  })

  await syncAugmentationFromStorage()
  if (await localeReady) refreshLocaleUi()
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

  const key = activeAccountReportKey(account)
  if (key === lastReportedAccountKey) return
  // Do not re-report the same handle without an ID after we already sent one.
  if (!account.twitterId && previousReportHadTwitterId(lastReportedAccountKey, account.handle)) {
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
  // Install the page-world MessagePort handshake before any bridge traffic.
  ensurePageWorldContentPort()
  // Keep Graph / extension pages aware of X light vs dark chrome.
  startXPageColorSchemeSync()
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
  startPostChromeBridge()
  startProofCandidateBridge()
  startBioCandidateBridge()
  profileBioObserver = startProfileBioObserver()
  setTrustStoreResolvedHook((descriptor, result) => {
    if (descriptor.subject.type !== 'i') return
    if (!descriptor.subject.value.startsWith('post:id:')) return
    if (result.resolution === 'none' && result.direct?.value !== 1 && result.direct?.value !== -1) {
      return
    }
    const postId = descriptor.subject.value.slice('post:id:'.length)
    onPostTrustResolved(postId)
  })
  jsonFilterBridge = startJsonTrustFilterBridge()
  timelineDecorate = startTimelineDecorateObserver()
  jsonFilterBridge.setOnStoreSeeded(() => {
    timelineDecorate?.applyAll()
  })
  // Push filters ASAP so page-world can rewrite the first HomeTimeline fetch.
  void chrome.storage.local.get(X_AUGMENTATION_FEATURES_KEY).then((data) => {
    const next = normalizeXAugmentationFeatures(data[X_AUGMENTATION_FEATURES_KEY])
    jsonFilterBridge?.pushConfig(next.trustFilters)
    timelineDecorate?.applyAll()
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
    if (message?.type === 'READ_ACTIVE_X_BIO') {
      try {
        const bio = readVisibleXBioText()
        sendResponse(
          bio === undefined ? { found: false } : { found: true, bio },
        )
      } catch {
        sendResponse({ found: false })
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
                  ...(match.postedAt !== undefined
                    ? { postedAt: match.postedAt }
                    : {}),
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
