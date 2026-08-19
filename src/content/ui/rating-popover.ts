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
  toneForRatingScore,
} from '../rating-summary'
import type { Target } from '../types'
import { ratingStarIcon, X_FONT } from './icons'
import { closePopover, openPopover } from './popover'
import { capCardTitle } from './card-title'
import { TONE_COLORS } from './signals'
import {
  claimsForPolarity,
  type RatingClaimPolarity,
  type RatingQuickClaim,
  type RatingQuickClaimId,
} from './rating-claims'

const STAR_SCORES = ['20', '40', '60', '80', '100'] as const

function quickLabelText(id: RatingQuickClaimId): string {
  switch (id) {
    case 'insightful':
      return t('content.rating.labelInsightful')
    case 'genuine':
      return t('content.rating.labelGenuine')
    case 'funny':
      return t('content.rating.labelFunny')
    case 'ai-slop':
      return t('content.rating.labelAiSlop')
    case 'misleading':
      return t('content.rating.labelMisleading')
    case 'spam':
      return t('content.rating.labelSpam')
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
    min-width: 248px;
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
  .stars.tone-trust .star-btn.filled,
  .stars.tone-trust .star-btn[aria-pressed="true"] { color: ${TONE_COLORS.trust}; }
  .stars.tone-question .star-btn.filled,
  .stars.tone-question .star-btn[aria-pressed="true"] { color: ${TONE_COLORS.question}; }
  .stars.tone-misleading .star-btn.filled,
  .stars.tone-misleading .star-btn[aria-pressed="true"] { color: ${TONE_COLORS.misleading}; }
  .star-btn:disabled { opacity: .5; cursor: default; }
  .claims {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .claim-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .claim-heading {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .02em;
    opacity: .64;
    padding: 0 2px;
  }
  .claim-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    background: transparent;
    color: inherit;
    border-radius: 8px;
    padding: 6px 10px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .claim-btn.tone-trust {
    color: ${TONE_COLORS.trust};
    border-color: color-mix(in srgb, ${TONE_COLORS.trust} 40%, transparent);
  }
  .claim-btn.tone-question {
    color: ${TONE_COLORS.question};
    border-color: color-mix(in srgb, ${TONE_COLORS.question} 40%, transparent);
  }
  .claim-btn.tone-misleading {
    color: ${TONE_COLORS.misleading};
    border-color: color-mix(in srgb, ${TONE_COLORS.misleading} 40%, transparent);
  }
  .claim-btn[aria-pressed="true"] {
    background: color-mix(in srgb, currentColor 12%, transparent);
    border-color: currentColor;
  }
  .claim-btn:disabled { opacity: .5; cursor: default; }
  .claim-stars {
    flex: 0 0 auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    opacity: .88;
  }
  .claim-cancel {
    margin-top: 2px;
    color: ${TONE_COLORS.misleading};
    border-color: color-mix(in srgb, ${TONE_COLORS.misleading} 28%, transparent);
    justify-content: center;
  }
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
  .who:disabled { opacity: .5; cursor: default; }
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
  const tone = toneForRatingScore(score === undefined ? null : score)
  stars.className = tone === 'neutral' ? 'stars' : `stars tone-${tone}`
  stars.querySelectorAll<HTMLButtonElement>('.star-btn').forEach((btn, index) => {
    const fill = starRowFill(score, index)
    btn.classList.toggle('filled', fill !== 'none')
    btn.setAttribute('aria-pressed', String(fill !== 'none'))
    btn.innerHTML = ratingStarIcon(fill, 16)
  })
}

export function openRatingPopover(options: {
  target: Target
  anchor: HTMLElement
  title?: string
  initialMessage?: string
  onCommitted?: () => void
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
    let message = options.initialMessage ?? ''
    let closedForCommit = false

    function currentOwn() {
      return ratingStore.get(key)?.own
    }

    function setMessage(next: string): void {
      message = next
      paint()
    }

    function appendClaimGroup(
      parent: HTMLElement,
      polarity: RatingClaimPolarity,
      ownLabels: string[] | undefined,
    ): void {
      const group = document.createElement('div')
      group.className = `claim-group ${polarity}`
      group.setAttribute('role', 'group')
      group.setAttribute(
        'aria-label',
        polarity === 'good'
          ? t('content.rating.claimsGood')
          : t('content.rating.claimsBad'),
      )

      const heading = document.createElement('div')
      heading.className = 'claim-heading'
      heading.textContent =
        polarity === 'good'
          ? t('content.rating.claimsGood')
          : t('content.rating.claimsBad')
      group.append(heading)

      for (const claim of claimsForPolarity(polarity)) {
        group.append(claimButton(claim, ownLabels))
      }
      parent.append(group)
    }

    function claimButton(
      claim: RatingQuickClaim,
      ownLabels: string[] | undefined,
    ): HTMLButtonElement {
      const label = quickLabelText(claim.id)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `claim-btn tone-${toneForRatingScore(Number(claim.score))}`
      btn.disabled = busy
      btn.dataset.claim = claim.id
      btn.setAttribute(
        'aria-pressed',
        String(ownLabels?.includes(claim.id) === true),
      )
      btn.setAttribute(
        'aria-label',
        `${label}, ${t('content.rating.starN', { n: String(claim.stars) })}`,
      )

      const name = document.createElement('span')
      name.textContent = label
      const stars = document.createElement('span')
      stars.className = 'claim-stars'
      stars.textContent = t('content.rating.claimStars', {
        n: String(claim.stars),
      })
      btn.append(name, stars)
      btn.addEventListener('click', () => {
        void commit((content) => publish(claim.score, [claim.id], content))
      })
      return btn
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
          void commit((content) => publish(score, own?.labels, content))
        })
        stars.append(btn)
      })
      stars.addEventListener('pointerleave', () => {
        applyStarFill(stars, currentOwn()?.score)
      })
      applyStarFill(stars, own?.score)
      card.append(stars)

      const claims = document.createElement('div')
      claims.className = 'claims'
      appendClaimGroup(claims, 'good', own?.labels)
      appendClaimGroup(claims, 'bad', own?.labels)
      if (own) {
        const clear = document.createElement('button')
        clear.type = 'button'
        clear.className = 'claim-btn claim-cancel'
        clear.disabled = busy
        clear.textContent = t('content.rating.clear')
        clear.addEventListener('click', () => {
          void commit(cancelRating)
        })
        claims.append(clear)
      }
      card.append(claims)

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
      card.append(row)

      if (message) {
        const msg = document.createElement('div')
        msg.className = 'message'
        msg.textContent = message
        card.append(msg)
      }

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

    async function commit(
      action: (content: string) => Promise<void>,
    ): Promise<void> {
      if (busy || closedForCommit) return
      const content = noteContent()
      busy = true
      closedForCommit = true
      ratingStore.beginMutation(key)
      closePopover()
      try {
        await action(content)
        ratingStore.invalidate([key])
        await ratingStore.flushNow()
        try {
          options.onCommitted?.()
        } catch {
          /* timeline flash must not surface as a publish error */
        }
      } catch (error) {
        openRatingPopover({
          ...options,
          initialMessage:
            error instanceof Error ? error.message : t('content.publishError'),
        })
      } finally {
        ratingStore.endMutation(key)
      }
    }

    async function publish(
      score: string,
      labels: string[] | undefined,
      content: string,
    ): Promise<void> {
      await sendMessage<PublishResult>({
        type: 'PUBLISH_RATING_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject,
        score,
        labels: labels ?? currentOwn()?.labels ?? [],
        context: ratingContext,
        content,
      })
    }

    async function cancelRating(content: string): Promise<void> {
      await sendMessage<PublishResult>({
        type: 'CANCEL_RATING_STATEMENT',
        version: BACKGROUND_API_VERSION,
        subject,
        context: ratingContext,
        content,
      })
    }

    const unsub = ratingStore.subscribe(key, () => {
      if (closedForCommit) return
      paint()
    })
    ratingStore.request(key, descriptor)
    paint()
    return () => unsub()
  })
}
