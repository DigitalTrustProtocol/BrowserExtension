import i18n from 'i18next'
import type { TrustQueryResult, TrustResolution } from '../graph'
import { i18nOptions } from '../i18n/resources'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type PublishResult,
  type SerializableTrustSubject,
} from '../shared/contracts'
import {
  isXNumericId,
  normalizeObservedHandle,
  type ObservedXIdentity,
} from '../shared/observed-x-identity'
import {
  canonicalTwitterAccountSubject,
  canonicalTwitterPostSubject,
  canonicalTwitterPostUrl,
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
} from '../shared/x-identity'
import {
  startIdentityBridge,
  type IdentityObservationBatch,
} from './identity-bridge'

type Verdict = 'trust' | 'question' | 'misleading'
type TargetType = 'post' | 'profile'

interface Target {
  type: TargetType
  id: string
  url: string
  handle?: string
  twitterId?: string
}

export interface TrustDescriptor {
  subject: SerializableTrustSubject
  context: 'identity' | 'news:accuracy'
}

interface ObservedIdentityLookup {
  twitterId: string
  handle: string
  observedAt: number
}

export interface TrustDisplay {
  resolution: TrustResolution
  tone: Verdict | 'neutral'
  evidence?: 'direct' | 'network'
  freshness: {
    unit: 'now' | 'minute' | 'hour' | 'day'
    count?: number
  }
  truncated: boolean
}

interface Panel {
  article: HTMLElement
  host: HTMLElement
  root: ShadowRoot
  postTarget: Target
  profileTarget: Target
  results: Partial<Record<TargetType, TrustQueryResult>>
  localQuestions: Set<TargetType>
  busy: boolean
}

const ARTICLE_SELECTOR =
  'article[data-tweet-id], article[data-testid="tweet"], article[itemtype="https://schema.org/SocialMediaPosting"]'
const mountedPanels = new Map<string, Set<Panel>>()
const identitiesByHandle = new Map<string, ObservedIdentityLookup>()
const identitiesByPostId = new Map<string, ObservedIdentityLookup>()
let scanTimer: number | undefined

function classifyPage(): string {
  const path = location.pathname
  if (/^\/[^/]+\/status\/\d+/.test(path)) return 'status'
  if (/^\/(home|explore|notifications|search)/.test(path)) return 'timeline'
  if (/^\/[A-Za-z0-9_]{1,15}\/?$/.test(path)) return 'profile'
  return 'other'
}

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

function applyIdentityObservations(
  observations: readonly ObservedXIdentity[],
): boolean {
  let identityChanged = false

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
      identityChanged ||= previousHandle?.twitterId !== observation.twitterId
    }

    for (const postId of observation.postIds ?? []) {
      const previousPost = identitiesByPostId.get(postId)
      if (!previousPost || observation.observedAt >= previousPost.observedAt) {
        identitiesByPostId.set(postId, lookup)
        identityChanged ||= previousPost?.twitterId !== observation.twitterId
      }
    }
  }

  return identityChanged
}

function parseArticleUnsafe(article: HTMLElement): {
  postTarget: Target
  profileTarget: Target
} | undefined {
  const statusMatch = [
    ...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'),
  ]
    .map((link) => link.getAttribute('href') ?? '')
    .map((href) =>
      href.match(
        /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,24})(?:$|[/?#])/i,
      ),
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

  if (!postId || !handle) {
    return undefined
  }

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

export function parseArticle(article: HTMLElement): {
  postTarget: Target
  profileTarget: Target
} | undefined {
  try {
    return parseArticleUnsafe(article)
  } catch {
    return undefined
  }
}

function icon(name: 'shield' | 'question' | 'alert' | 'person'): string {
  const paths = {
    shield:
      '<path d="M12 3 5 6v5c0 4.4 2.9 7.6 7 10 4.1-2.4 7-5.6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    question:
      '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 0 1 4.4 1c0 1.7-2.2 2-2.2 3.5"/><path d="M12 17h.01"/>',
    alert:
      '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    person:
      '<circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v4M17 10h4"/>',
  }

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`
}

function formatAuthorLabel(target: Target): string {
  if (target.handle && target.twitterId) {
    return i18n.t('content.authorWithId', {
      handle: target.handle,
      twitterId: target.twitterId,
    })
  }

  return `@${target.handle ?? target.id}`
}

export function trustDescriptor(target: Target): TrustDescriptor | undefined {
  if (target.type === 'profile') {
    if (!target.twitterId) return undefined
    return {
      subject: {
        type: 'i',
        value: canonicalTwitterAccountSubject(target.twitterId),
      },
      context: 'identity',
    }
  }

  return {
    subject: {
      type: 'i',
      value: canonicalTwitterPostSubject(target.id),
    },
    context: 'news:accuracy',
  }
}

export function publishValueForVerdict(
  verdict: Verdict,
): '1' | '-1' | undefined {
  if (verdict === 'trust') return '1'
  if (verdict === 'misleading') return '-1'
  return undefined
}

export function trustDisplay(
  result: TrustQueryResult,
  nowSeconds = Math.floor(Date.now() / 1_000),
): TrustDisplay {
  const ageSeconds = Math.max(0, nowSeconds - result.computedAt)
  let freshness: TrustDisplay['freshness']
  if (ageSeconds < 60) {
    freshness = { unit: 'now' }
  } else if (ageSeconds < 3_600) {
    freshness = { unit: 'minute', count: Math.floor(ageSeconds / 60) }
  } else if (ageSeconds < 86_400) {
    freshness = { unit: 'hour', count: Math.floor(ageSeconds / 3_600) }
  } else {
    freshness = { unit: 'day', count: Math.floor(ageSeconds / 86_400) }
  }

  const tone =
    result.resolution === 'trusted'
      ? 'trust'
      : result.resolution === 'distrusted'
        ? 'misleading'
        : result.resolution === 'mixed'
          ? 'question'
          : 'neutral'

  return {
    resolution: result.resolution,
    tone,
    ...(result.direct
      ? { evidence: 'direct' as const }
      : result.statements.length > 0
        ? { evidence: 'network' as const }
        : {}),
    freshness,
    truncated: result.truncated,
  }
}

function createPanel(
  article: HTMLElement,
  postTarget: Target,
  profileTarget: Target,
): Panel {
  const oldHost = article.querySelector<HTMLElement>(
    ':scope > [data-attentionx-host]',
  )
  oldHost?.remove()

  const host = document.createElement('div')
  host.dataset.attentionxHost = 'true'
  host.style.cssText =
    'display:block;box-sizing:border-box;margin:2px 12px 10px 58px;max-width:calc(100% - 70px);'
  const root = host.attachShadow({ mode: 'open' })

  root.innerHTML = `
    <style>
      :host { color-scheme: light dark; }
      * { box-sizing: border-box; }
      .panel {
        --ax-accent: #1d9bf0;
        --ax-trust: #00a36c;
        --ax-question: #d49b16;
        --ax-alert: #e5484d;
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, Canvas 94%, var(--ax-accent) 6%);
        color: CanvasText;
        font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 9px 10px;
      }
      .top, .signal, .actions, .group { display: flex; align-items: center; }
      .top { justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .brand { color: var(--ax-accent); font-weight: 700; letter-spacing: .01em; }
      .page { opacity: .58; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
      .signals { display: grid; gap: 4px; }
      .signal { min-width: 0; gap: 6px; }
      .signal-name { min-width: 82px; font-weight: 600; }
      .signal-name.profile-label { min-width: 0; max-width: 46%; flex: 0 1 auto; }
      .signal-value { min-width: 0; opacity: .76; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: 0 0 auto; opacity: .42; }
      .tone-trust .dot { color: var(--ax-trust); opacity: 1; }
      .tone-question .dot { color: var(--ax-question); opacity: 1; }
      .tone-misleading .dot { color: var(--ax-alert); opacity: 1; }
      .actions {
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
        padding-top: 7px;
        border-top: 1px solid color-mix(in srgb, currentColor 13%, transparent);
      }
      .group { gap: 4px; }
      .group-label { opacity: .55; font-size: 10px; margin-right: 2px; }
      button {
        width: 25px;
        height: 25px;
        display: inline-grid;
        place-items: center;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: .68;
        padding: 5px;
      }
      button:hover { background: color-mix(in srgb, currentColor 10%, transparent); opacity: 1; }
      button:focus-visible { outline: 2px solid var(--ax-accent); outline-offset: 1px; }
      button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 14%, transparent); opacity: 1; }
      button[data-verdict="trust"] { color: var(--ax-trust); }
      button[data-verdict="question"] { color: var(--ax-question); }
      button[data-verdict="misleading"] { color: var(--ax-alert); }
      button:disabled { cursor: not-allowed; opacity: .35; }
      svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .message { min-height: 14px; margin-top: 5px; opacity: .62; font-size: 10px; }
      @media (max-width: 430px) {
        .actions { align-items: flex-start; flex-direction: column; }
      }
    </style>
    <section class="panel" aria-label="${i18n.t('content.panelLabel')}">
      <div class="top">
        <span class="brand">AttentionX</span>
        <span class="page">${i18n.t(`content.page.${classifyPage()}`)}</span>
      </div>
      <div class="signals">
        <div class="signal" data-signal="profile">
          <span class="dot"></span>
          <span class="signal-name profile-label"></span>
          <span class="signal-value">${i18n.t('content.checking')}</span>
        </div>
        <div class="signal" data-signal="post">
          <span class="dot"></span>
          <span class="signal-name">${i18n.t('content.post')}</span>
          <span class="signal-value">${i18n.t('content.checking')}</span>
        </div>
      </div>
      <div class="actions">
        <div class="group">
          <span class="group-label">${i18n.t('content.author')}</span>
          <button type="button" data-target="profile" data-verdict="trust" title="${i18n.t('content.trustAuthor')}" aria-label="${i18n.t('content.trustAuthor')}">${icon('person')}</button>
          <button type="button" data-target="profile" data-verdict="question" title="${i18n.t('content.questionAuthor')}" aria-label="${i18n.t('content.questionAuthor')}">${icon('question')}</button>
        </div>
        <div class="group">
          <span class="group-label">${i18n.t('content.post')}</span>
          <button type="button" data-target="post" data-verdict="trust" title="${i18n.t('content.trustPost')}" aria-label="${i18n.t('content.trustPost')}">${icon('shield')}</button>
          <button type="button" data-target="post" data-verdict="question" title="${i18n.t('content.questionPost')}" aria-label="${i18n.t('content.questionPost')}">${icon('question')}</button>
          <button type="button" data-target="post" data-verdict="misleading" title="${i18n.t('content.misleadingPost')}" aria-label="${i18n.t('content.misleadingPost')}">${icon('alert')}</button>
        </div>
      </div>
      <div class="message" role="status"></div>
    </section>
  `

  const profileName = root.querySelector<HTMLElement>(
    '[data-signal="profile"] .signal-name',
  )
  if (profileName) {
    profileName.textContent = formatAuthorLabel(profileTarget)
    profileName.title = formatAuthorLabel(profileTarget)
  }

  article.append(host)
  article.dataset.attentionxPostId = postTarget.id
  article.dataset.attentionxTwitterId = profileTarget.twitterId ?? ''

  const panel: Panel = {
    article,
    host,
    root,
    postTarget,
    profileTarget,
    results: {},
    localQuestions: new Set(),
    busy: false,
  }
  syncButtonStates(panel)
  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button[data-target][data-verdict]',
    )
    if (!button) return

    const targetType =
      button.dataset.target === 'profile' ? 'profile' : 'post'
    const target =
      targetType === 'profile' ? panel.profileTarget : panel.postTarget
    const verdict = button.dataset.verdict as Verdict
    if (verdict === 'question') {
      toggleLocalQuestion(panel, targetType)
      return
    }
    void publish(panel, target, verdict)
  })

  return panel
}

function describeTrust(result: TrustQueryResult): string {
  const display = trustDisplay(result)
  const parts = [
    i18n.t(`content.resolution.${display.resolution}`),
    display.evidence
      ? i18n.t(`content.evidence.${display.evidence}`)
      : undefined,
    i18n.t(`content.freshness.${display.freshness.unit}`, {
      count: display.freshness.count,
    }),
    display.truncated ? i18n.t('content.partialResult') : undefined,
  ]
  return parts.filter(Boolean).join(' · ')
}

function renderSignal(
  panel: Panel,
  targetType: TargetType,
  result?: TrustQueryResult,
): void {
  const row = panel.root.querySelector<HTMLElement>(
    `[data-signal="${targetType}"]`,
  )
  const value = row?.querySelector<HTMLElement>('.signal-value')
  if (!row || !value) return

  const unresolvedProfile =
    targetType === 'profile' && !panel.profileTarget.twitterId
  const display = result ? trustDisplay(result) : undefined
  row.className = `signal tone-${display?.tone ?? 'neutral'}`
  value.textContent = unresolvedProfile
    ? i18n.t('content.profileUnresolved')
    : result
      ? describeTrust(result)
      : i18n.t('content.noTrustEvidence')

  for (const button of panel.root.querySelectorAll<HTMLButtonElement>(
    `button[data-target="${targetType}"]`,
  )) {
    const directVerdict =
      result?.direct?.value === 1
        ? 'trust'
        : result?.direct?.value === -1
          ? 'misleading'
          : undefined
    button.setAttribute(
      'aria-pressed',
      String(
        button.dataset.verdict === 'question'
          ? panel.localQuestions.has(targetType)
          : button.dataset.verdict === directVerdict,
      ),
    )
  }
}

function renderPanel(panel: Panel): void {
  renderSignal(panel, 'profile', panel.results.profile)
  renderSignal(panel, 'post', panel.results.post)
}

async function sendMessage<T>(message: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as ExtensionResponse<T>
  if (response.version !== BACKGROUND_API_VERSION) {
    throw new Error('Unsupported AttentionX background API version')
  }
  if (!response.ok) {
    throw new Error(response.error || i18n.t('content.backgroundError'))
  }
  return response.data
}

function syncButtonStates(panel: Panel): void {
  for (const button of panel.root.querySelectorAll<HTMLButtonElement>(
    'button[data-target][data-verdict]',
  )) {
    const requiresResolvedProfile =
      button.dataset.target === 'profile' &&
      button.dataset.verdict !== 'question' &&
      !panel.profileTarget.twitterId
    button.disabled = panel.busy || requiresResolvedProfile
    if (requiresResolvedProfile) {
      const label = i18n.t('content.resolveProfileFirst')
      button.title = label
      button.setAttribute('aria-label', label)
    }
  }
}

function setPanelBusy(panel: Panel, busy: boolean, message = ''): void {
  panel.busy = busy
  syncButtonStates(panel)
  const status = panel.root.querySelector<HTMLElement>('.message')
  if (status) status.textContent = message
}

function toggleLocalQuestion(panel: Panel, targetType: TargetType): void {
  if (panel.localQuestions.has(targetType)) {
    panel.localQuestions.delete(targetType)
  } else {
    panel.localQuestions.add(targetType)
  }
  renderSignal(panel, targetType, panel.results[targetType])
  const status = panel.root.querySelector<HTMLElement>('.message')
  if (status) status.textContent = i18n.t('content.questionLocalOnly')
}

function descriptorKey(descriptor: TrustDescriptor): string {
  return `${descriptor.subject.type}:${descriptor.subject.value}|${descriptor.context}`
}

async function refreshPanels(panels: Panel[]): Promise<void> {
  if (panels.length === 0) return

  const descriptors = new Map<string, TrustDescriptor>()
  for (const panel of panels) {
    for (const target of [panel.postTarget, panel.profileTarget]) {
      const descriptor = trustDescriptor(target)
      if (descriptor) descriptors.set(descriptorKey(descriptor), descriptor)
    }
  }

  try {
    const results = new Map(
      await Promise.all(
        [...descriptors.entries()].map(async ([key, descriptor]) => [
          key,
          await sendMessage<TrustQueryResult>({
            type: 'QUERY_TRUST',
            version: BACKGROUND_API_VERSION,
            subject: descriptor.subject,
            context: descriptor.context,
          }),
        ] as const),
      ),
    )
    for (const panel of panels) {
      if (!panel.host.isConnected) continue
      const profile = trustDescriptor(panel.profileTarget)
      const post = trustDescriptor(panel.postTarget)
      panel.results = {
        ...(profile ? { profile: results.get(descriptorKey(profile)) } : {}),
        ...(post ? { post: results.get(descriptorKey(post)) } : {}),
      }
      renderPanel(panel)
    }
  } catch (error) {
    for (const panel of panels) {
      const status = panel.root.querySelector<HTMLElement>('.message')
      if (status) {
        status.textContent =
          error instanceof Error ? error.message : i18n.t('content.loadError')
      }
    }
  }
}

async function publish(
  panel: Panel,
  target: Target,
  verdict: Verdict,
): Promise<void> {
  const descriptor = trustDescriptor(target)
  const value = publishValueForVerdict(verdict)
  if (!descriptor || !value) {
    setPanelBusy(panel, false, i18n.t('content.resolveProfileFirst'))
    return
  }
  setPanelBusy(panel, true, i18n.t('content.publishing'))

  try {
    const result = await sendMessage<PublishResult>({
      type: 'PUBLISH_TRUST_STATEMENT',
      version: BACKGROUND_API_VERSION,
      subject: descriptor.subject,
      value,
      context: descriptor.context,
    })
    panel.localQuestions.delete(target.type)
    setPanelBusy(
      panel,
      false,
      i18n.t('content.publishSuccess', {
        delivered: result.deliveredTo,
        attempted: result.attemptedRelays,
      }),
    )
    await refreshPanels([panel])
  } catch (error) {
    setPanelBusy(
      panel,
      false,
      error instanceof Error ? error.message : i18n.t('content.publishError'),
    )
  }
}

function registerPanel(panel: Panel): void {
  const panels = mountedPanels.get(panel.postTarget.id) ?? new Set<Panel>()
  panels.add(panel)
  mountedPanels.set(panel.postTarget.id, panels)
}

function cleanupPanels(): void {
  for (const [postId, panels] of mountedPanels) {
    for (const panel of panels) {
      if (!panel.article.isConnected || !panel.host.isConnected) {
        panels.delete(panel)
      }
    }
    if (panels.size === 0) mountedPanels.delete(postId)
  }
}

function scan(): void {
  cleanupPanels()
  document.documentElement.dataset.attentionxPage = classifyPage()
  const newPanels: Panel[] = []

  for (const article of document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)) {
    const parsed = parseArticle(article)
    if (!parsed) continue

    const existingHost = article.querySelector<HTMLElement>(
      ':scope > [data-attentionx-host]',
    )
    if (
      article.dataset.attentionxPostId === parsed.postTarget.id &&
      article.dataset.attentionxTwitterId ===
        (parsed.profileTarget.twitterId ?? '') &&
      existingHost?.isConnected
    ) {
      continue
    }

    const panel = createPanel(
      article,
      parsed.postTarget,
      parsed.profileTarget,
    )
    registerPanel(panel)
    newPanels.push(panel)
  }

  void refreshPanels(newPanels)
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer)
  scanTimer = window.setTimeout(scan, 180)
}

async function forwardIdentityBatch(
  batch: IdentityObservationBatch,
): Promise<void> {
  const changed = applyIdentityObservations(batch.observations)
  if (changed && document.documentElement) scheduleScan()

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

async function initializeUi(): Promise<void> {
  await i18n.init({
    ...i18nOptions,
    lng: navigator.language,
  })

  const root = await waitForDocumentElement()
  const observer = new MutationObserver(scheduleScan)
  observer.observe(root, {
    childList: true,
    subtree: true,
  })

  window.addEventListener('popstate', scheduleScan)
  scan()
}

function bootstrap(): void {
  startIdentityBridge({
    forwardBatch: forwardIdentityBatch,
    onForwardError(error) {
      console.info('AttentionX identity observation forwarding failed', error)
    },
  })
  void initializeUi()
}

if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
  bootstrap()
}
