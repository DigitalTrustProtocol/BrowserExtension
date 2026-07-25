import i18n from 'i18next'
import { i18nOptions } from '../i18n/resources'
import {
  canonicalTwitterProfileId,
  canonicalTwitterProfileUrl,
  normalizeTwitterHandle,
  parseTwitterIdFromAuthorMeta,
} from '../shared/x-identity'

type Verdict = 'trust' | 'question' | 'misleading'
type TargetType = 'post' | 'profile'

interface Target {
  type: TargetType
  id: string
  url: string
  handle?: string
  twitterId?: string
}

interface Summary {
  targetUrl: string
  counts: Record<Verdict, number>
  myVerdict?: Verdict
  contributors: number
  relayEvents: number
}

interface RuntimeResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

interface Panel {
  article: HTMLElement
  host: HTMLElement
  root: ShadowRoot
  postTarget: Target
  profileTarget: Target
}

const ARTICLE_SELECTOR =
  'article[data-tweet-id], article[data-testid="tweet"], article[itemtype="https://schema.org/SocialMediaPosting"]'
const mountedPanels = new Map<string, Set<Panel>>()
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

function parseArticle(article: HTMLElement): {
  postTarget: Target
  profileTarget: Target
} | undefined {
  const statusLink = [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')]
    .map((link) => link.getAttribute('href') ?? '')
    .find((href) => /^\/[^/]+\/status\/\d+(?:$|[?#])/.test(href))

  const statusMatch = statusLink?.match(/^\/([^/]+)\/status\/(\d+)/)
  const postId =
    article.dataset.tweetId ||
    metaContent(article, 'meta[itemprop="identifier"]') ||
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
  const handle = statusMatch?.[1] || authorUrlHandle || legacyHandle
  const authorIdentifier = metaContent(
    authorScope,
    'meta[itemprop="identifier"]',
  )
  const twitterId = parseTwitterIdFromAuthorMeta(authorIdentifier)

  if (!postId || !handle) {
    return undefined
  }

  const normalizedHandle = normalizeTwitterHandle(handle)
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
      url: `https://x.com/${normalizedHandle}/status/${postId}`,
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
      button:disabled { cursor: wait; opacity: .35; }
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

  const panel = { article, host, root, postTarget, profileTarget }
  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button[data-target][data-verdict]',
    )
    if (!button) return

    const target =
      button.dataset.target === 'profile' ? profileTarget : postTarget
    const verdict = button.dataset.verdict as Verdict
    void publish(panel, target, verdict)
  })

  return panel
}

function describeSummary(summary?: Summary): string {
  if (!summary || summary.contributors === 0) {
    return i18n.t('content.noSignals')
  }

  const parts = [
    summary.counts.trust
      ? i18n.t('content.trustCount', { count: summary.counts.trust })
      : '',
    summary.counts.question
      ? i18n.t('content.questionCount', { count: summary.counts.question })
      : '',
    summary.counts.misleading
      ? i18n.t('content.misleadingCount', {
          count: summary.counts.misleading,
        })
      : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function summaryTone(summary?: Summary): Verdict | 'neutral' {
  if (!summary || summary.contributors === 0) return 'neutral'
  if (summary.counts.misleading > summary.counts.trust) return 'misleading'
  if (summary.counts.question > summary.counts.trust) return 'question'
  return 'trust'
}

function renderSignal(
  panel: Panel,
  targetType: TargetType,
  summary?: Summary,
): void {
  const row = panel.root.querySelector<HTMLElement>(
    `[data-signal="${targetType}"]`,
  )
  const value = row?.querySelector<HTMLElement>('.signal-value')
  if (!row || !value) return

  row.className = `signal tone-${summaryTone(summary)}`
  value.textContent = describeSummary(summary)

  for (const button of panel.root.querySelectorAll<HTMLButtonElement>(
    `button[data-target="${targetType}"]`,
  )) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.verdict === summary?.myVerdict),
    )
  }
}

function renderPanel(
  panel: Panel,
  summaries: Record<string, Summary>,
): void {
  renderSignal(panel, 'profile', summaries[panel.profileTarget.url])
  renderSignal(panel, 'post', summaries[panel.postTarget.url])
}

async function sendMessage<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse<T>
  if (!response.ok || response.data === undefined) {
    throw new Error(response.error || i18n.t('content.backgroundError'))
  }
  return response.data
}

function setPanelBusy(panel: Panel, busy: boolean, message = ''): void {
  for (const button of panel.root.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = busy
  }
  const status = panel.root.querySelector<HTMLElement>('.message')
  if (status) status.textContent = message
}

async function refreshPanels(panels: Panel[]): Promise<void> {
  if (panels.length === 0) return

  const targets = panels.flatMap((panel) => [
    panel.postTarget,
    panel.profileTarget,
  ])

  try {
    const summaries = await sendMessage<Record<string, Summary>>({
      type: 'LOOKUP_CONTEXT',
      targets,
    })
    for (const panel of panels) {
      if (panel.host.isConnected) renderPanel(panel, summaries)
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
  setPanelBusy(panel, true, i18n.t('content.publishing'))

  try {
    const result = await sendMessage<{
      deliveredTo: number
      attemptedRelays: number
    }>({
      type: 'PUBLISH_ASSESSMENT',
      target,
      verdict,
    })
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

void i18n
  .init({
    ...i18nOptions,
    lng: navigator.language,
  })
  .then(() => {
    const observer = new MutationObserver(scheduleScan)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })

    window.addEventListener('popstate', scheduleScan)
    scan()
  })
