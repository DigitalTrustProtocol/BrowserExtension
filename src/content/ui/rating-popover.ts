import { t } from '../i18n'
import { isDemoMode } from '../app-mode'
import {
  BACKGROUND_API_VERSION,
  type PublishResult,
} from '../../shared/contracts'
import {
  ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
  sanitizeTrustContent,
} from '../../shared/trust-content'
import { openSidePanel } from '../open-side-panel'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, sendMessage } from '../trust-store'
import { ratingStore } from '../rating-store'
import {
  formatRatingScore,
  starRowFill,
  summarizeRating,
} from '../rating-summary'
import type { Target } from '../types'
import { ratingStarIcon, X_FONT } from './icons'
import { openPopover } from './popover'
import { capCardTitle } from './card-title'
import { TONE_COLORS } from './signals'

const STAR_SCORES = ['20', '40', '60', '80', '100'] as const

const QUICK_LABELS = [
  { id: 'spam', score: '0' },
  { id: 'ai-slop', score: '50' },
  { id: 'genuine', score: '100' },
] as const

type QuickLabelId = (typeof QUICK_LABELS)[number]['id']

function quickLabelText(id: QuickLabelId): string {
  switch (id) {
    case 'spam':
      return t('content.rating.labelSpam')
    case 'ai-slop':
      return t('content.rating.labelAiSlop')
    case 'genuine':
      return t('content.rating.labelGenuine')
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

const POPOVER_STYLE = `
  * { box-sizing: border-box; }
  .card {
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 12px;
    background: #ffffff;
    color: #0f1419;
    font-family: ${X_FONT};
    font-size: 13px;
    line-height: 1.4;
    padding: 12px 12px 10px;
    min-width: 240px;
    max-width: min(300px, 85vw);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  :host-context([data-ax-color-scheme="dark"]) .card,
  .card.dark {
    background: #16181c;
    color: #e7e9ea;
  }
  .title {
    font-weight: 700;
    font-size: 14px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stars {
    display: flex;
    gap: 4px;
  }
  .star-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: color-mix(in srgb, currentColor 8%, transparent);
    color: inherit;
    cursor: pointer;
    display: inline-grid;
    place-items: center;
  }
  .star-btn.filled,
  .star-btn[aria-pressed="true"] { color: ${TONE_COLORS.question}; }
  .star-btn:disabled { opacity: .5; cursor: default; }
  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .label-btn {
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    border-radius: 999px;
    padding: 3px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .label-btn[aria-pressed="true"] {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }
  .label-btn:disabled { opacity: .5; cursor: default; }
  .comment-toggle {
    border: 0;
    background: transparent;
    color: inherit;
    opacity: .72;
    font: inherit;
    font-size: 12px;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }
  .comment {
    width: 100%;
    min-height: 56px;
    resize: vertical;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 6px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .who {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    text-align: left;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }
  .clear {
    border: 0;
    background: transparent;
    color: ${TONE_COLORS.misleading};
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  .clear:disabled, .who:disabled { opacity: .5; cursor: default; }
  .message {
    min-height: 1.2em;
    font-size: 12px;
    opacity: .8;
    white-space: pre-wrap;
  }
  .footnote {
    font-size: 11px;
    opacity: .64;
  }
`

function applyStarFill(stars: HTMLElement, score: number | undefined): void {
  stars.querySelectorAll<HTMLButtonElement>('.star-btn').forEach((btn, index) => {
    const fill = starRowFill(score, index)
    btn.classList.toggle('filled', fill !== 'none')
    btn.setAttribute('aria-pressed', String(fill !== 'none'))
    btn.innerHTML = ratingStarIcon(fill, 16)
  })
}

function formatPublishMessage(result: PublishResult): string {
  if (result.localOnly || isDemoMode()) {
    return t('content.rating.demoPublishSuccess')
  }
  if (result.heldUntil !== undefined) {
    return t('content.dialog.heldSuccess')
  }
  return t('content.publishSuccess', {
    delivered: result.deliveredTo,
    attempted: result.attemptedRelays,
  })
}

function formatCancelMessage(result: PublishResult): string {
  if (result.localOnly || isDemoMode()) {
    return t('content.rating.demoCancelSuccess')
  }
  if (result.heldUntil !== undefined) {
    return t('content.dialog.heldCancelSuccess')
  }
  return t('content.cancelSuccess', {
    delivered: result.deliveredTo,
    attempted: result.attemptedRelays,
  })
}

export function openRatingPopover(options: {
  target: Target
  anchor: HTMLElement
  title?: string
}): void {
  const descriptor = trustDescriptor(options.target)
  if (descriptor === undefined) return
  const subject = descriptor.subject
  const ratingContext = descriptor.context
  const key = descriptorKey(descriptor)

  openPopover(options.anchor, (container) => {
    container.innerHTML = `<style>${POPOVER_STYLE}</style>`
    const card = document.createElement('div')
    card.className = 'card'
    container.append(card)

    let busy = false
    let commentOpen = false
    let message = ''

    function currentOwn() {
      return ratingStore.get(key)?.own
    }

    function setMessage(next: string): void {
      message = next
      paint()
    }

    function paint(): void {
      const result = ratingStore.get(key)
      const summary = result ? summarizeRating(result) : undefined
      const own = result?.own
      const avgLabel = summary ? formatRatingScore(summary) : undefined
      const title = capCardTitle(options.title ?? t('content.rating.title'))

      card.replaceChildren()
      const heading = document.createElement('div')
      heading.className = 'title'
      heading.textContent = title
      card.append(heading)

      const stars = document.createElement('div')
      stars.className = 'stars'
      stars.setAttribute('role', 'group')
      stars.setAttribute('aria-label', t('content.rating.stars'))
      STAR_SCORES.forEach((score, index) => {
        const count = index + 1
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'star-btn'
        btn.disabled = busy
        btn.setAttribute(
          'aria-label',
          t('content.rating.starN', { n: String(count) }),
        )
        btn.addEventListener('pointerenter', () => {
          applyStarFill(stars, count * 20)
        })
        btn.addEventListener('click', () => {
          void publish(score, own?.labels)
        })
        stars.append(btn)
      })
      stars.addEventListener('pointerleave', () => {
        applyStarFill(stars, currentOwn()?.score)
      })
      applyStarFill(stars, own?.score)
      card.append(stars)

      const labels = document.createElement('div')
      labels.className = 'labels'
      for (const label of QUICK_LABELS) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'label-btn'
        btn.disabled = busy
        btn.setAttribute(
          'aria-pressed',
          String(own?.labels.includes(label.id) === true),
        )
        btn.textContent = quickLabelText(label.id)
        btn.addEventListener('click', () => {
          void publish(label.score, [label.id])
        })
        labels.append(btn)
      }
      card.append(labels)

      const commentToggle = document.createElement('button')
      commentToggle.type = 'button'
      commentToggle.className = 'comment-toggle'
      commentToggle.textContent = commentOpen
        ? t('content.rating.hideComment')
        : t('content.rating.addComment')
      commentToggle.addEventListener('click', () => {
        commentOpen = !commentOpen
        paint()
      })
      card.append(commentToggle)

      if (commentOpen) {
        const textarea = document.createElement('textarea')
        textarea.className = 'comment'
        textarea.maxLength = ATTENTIONX_TRUST_CONTENT_UI_LIMIT
        textarea.placeholder = t('content.rating.commentPlaceholder')
        textarea.value = own?.content ?? ''
        textarea.disabled = busy
        card.append(textarea)
      }

      const row = document.createElement('div')
      row.className = 'row'
      const who = document.createElement('button')
      who.type = 'button'
      who.className = 'who'
      who.disabled = busy
      const count = summary?.claimCount ?? 0
      who.textContent =
        avgLabel !== undefined
          ? t('content.rating.whoRatedAvg', {
              count: String(count),
              avg: avgLabel,
            })
          : t('content.rating.whoRatedEmpty')
      who.addEventListener('click', () => {
        void openSidePanel({
          subject,
          context: ratingContext,
        }).catch((error: unknown) => {
          setMessage(
            error instanceof Error
              ? error.message
              : t('content.rating.openPanelError'),
          )
        })
      })
      row.append(who)
      if (own) {
        const clear = document.createElement('button')
        clear.type = 'button'
        clear.className = 'clear'
        clear.disabled = busy
        clear.textContent = t('content.rating.clear')
        clear.addEventListener('click', () => {
          void cancel()
        })
        row.append(clear)
      }
      card.append(row)

      const msg = document.createElement('div')
      msg.className = 'message'
      msg.textContent = message
      card.append(msg)

      const footnote = document.createElement('div')
      footnote.className = 'footnote'
      footnote.textContent = isDemoMode()
        ? t('content.rating.demoNotice')
        : t('content.dialog.holdNotice')
      card.append(footnote)
    }

    function noteContent(): string {
      const textarea = card.querySelector('textarea')
      return sanitizeTrustContent(textarea?.value ?? currentOwn()?.content ?? '')
    }

    async function publish(score: string, labels?: string[]): Promise<void> {
      busy = true
      paint()
      setMessage(
        isDemoMode()
          ? t('content.rating.demoPublishing')
          : t('content.publishing'),
      )
      try {
        const result = await sendMessage<PublishResult>({
          type: 'PUBLISH_RATING_STATEMENT',
          version: BACKGROUND_API_VERSION,
          subject,
          score,
          labels: labels ?? currentOwn()?.labels ?? [],
          context: ratingContext,
          content: noteContent(),
        })
        ratingStore.invalidate([key])
        setMessage(formatPublishMessage(result))
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : t('content.publishError'),
        )
      } finally {
        busy = false
        paint()
      }
    }

    async function cancel(): Promise<void> {
      busy = true
      paint()
      setMessage(
        isDemoMode()
          ? t('content.rating.demoCancelling')
          : t('content.cancelling'),
      )
      try {
        const result = await sendMessage<PublishResult>({
          type: 'CANCEL_RATING_STATEMENT',
          version: BACKGROUND_API_VERSION,
          subject,
          context: ratingContext,
          content: noteContent(),
        })
        ratingStore.invalidate([key])
        setMessage(formatCancelMessage(result))
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : t('content.publishError'),
        )
      } finally {
        busy = false
        paint()
      }
    }

    const unsub = ratingStore.subscribe(key, () => paint())
    ratingStore.request(key, descriptor)
    paint()
    return () => unsub()
  })
}
