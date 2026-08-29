import { t } from '../i18n'
import { openSidePanel } from '../open-side-panel'
import {
  findProfileNameRoot,
  placeAfterDisplayNameIcons,
  profileHandleFromPathname,
  X_RESERVED_PATH_SEGMENTS,
} from '../scanner'
import { trustDescriptor } from '../trust-helpers'
import { descriptorKey, trustStore } from '../trust-store'
import { summarizeTrust, chipToneForSummary, type TrustSummary } from '../trust-summary'
import {
  detailScoreParts,
  type XAugmentationFeatures,
} from '../../shared/x-augmentation'
import type { TrustTone } from '../types'
import { createTrustChip, type TrustChip } from './chip'
import { profileTargetForHandle } from './profile-target'
import { createTrustScoreLabel, type TrustScoreLabel } from './score'
import { formatTrustScore, readDisplayName, setProfileTone } from './signals'
import { openTrustDialog } from './trust-dialog'
import { cloneAuthorVerifiedBadge } from './hide'

const HOST_ATTR = 'data-attentionx-profile-header'
const CHIP_ATTR = 'data-attentionx-profile-chip'
const SCORE_ATTR = 'data-attentionx-profile-score'

function currentProfileHandle(): string | undefined {
  const handle = profileHandleFromPathname(location.pathname)
  if (!handle || X_RESERVED_PATH_SEGMENTS.has(handle)) return undefined
  return handle
}

/**
 * Profile-page UserHero: ambient underline on the display name, with
 * score and chip last on the name line after verified/affiliation icons.
 * This is the profile `UserName` slot, not tweet UserAuthor.
 *
 * Owns a MutationObserver so late-loading X header chrome is still caught.
 */
export class ProfileHeaderAugmentor {
  #chip?: TrustChip
  #score?: TrustScoreLabel
  #chipMount?: HTMLElement
  #scoreMount?: HTMLElement
  #handle?: string
  #watchedHandle?: string
  #unsubscribe?: () => void
  #observer?: MutationObserver
  #syncTimer: ReturnType<typeof setTimeout> | undefined
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
      this.#observer = new MutationObserver(() => this.#scheduleSync())
      this.#observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    }
    this.sync()
  }

  setFeatures(options: {
    chip: boolean
    ambient: boolean
    detailText: boolean
    detailDegree: boolean
  }): void {
    const changed =
      this.#chipEnabled !== options.chip ||
      this.#ambientEnabled !== options.ambient ||
      this.#detailTextEnabled !== options.detailText ||
      this.#detailDegreeEnabled !== options.detailDegree
    this.#chipEnabled = options.chip
    this.#ambientEnabled = options.ambient
    this.#detailTextEnabled = options.detailText
    this.#detailDegreeEnabled = options.detailDegree
    if (changed) {
      this.#teardownMounts()
      this.sync()
    }
  }

  stop(): void {
    this.#enabled = false
    this.#observer?.disconnect()
    this.#observer = undefined
    if (this.#syncTimer !== undefined) clearTimeout(this.#syncTimer)
    this.#syncTimer = undefined
    this.#teardown()
  }

  /** Non-resetting debounce — same pattern as ArticleScanner.schedule. */
  #scheduleSync(): void {
    if (!this.#enabled) return
    if (this.#syncTimer !== undefined) return
    this.#syncTimer = setTimeout(() => {
      this.#syncTimer = undefined
      this.sync()
    }, 120)
  }

  sync(): void {
    if (!this.#enabled) return
    const handle = currentProfileHandle()
    if (!handle) {
      this.#teardown()
      return
    }

    const needsChip = this.#chipEnabled && !this.#chipMount?.isConnected
    const needsScore =
      this.#detailScoreEnabled() && !this.#scoreMount?.isConnected
    const sameHandle = this.#handle === handle

    const nameRoot = findProfileNameRoot()
    if (sameHandle && !needsChip && !needsScore) {
      if (nameRoot) {
        if (this.#scoreMount) {
          placeAfterDisplayNameIcons(nameRoot, this.#scoreMount)
        }
        if (this.#chipMount) {
          placeAfterDisplayNameIcons(nameRoot, this.#chipMount)
        }
      }
      this.#watch(handle)
      return
    }

    if (!sameHandle) this.#teardownMounts()
    this.#handle = handle

    if (this.#detailScoreEnabled() && !this.#scoreMount?.isConnected) {
      if (nameRoot) {
        const scoreMount = document.createElement('span')
        scoreMount.setAttribute(SCORE_ATTR, 'true')
        scoreMount.style.cssText =
          'display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;'
        this.#score = createTrustScoreLabel()
        this.#score.setOnOpenPath(() => {
          const target = profileTargetForHandle(handle)
          const descriptor = trustDescriptor(target)
          if (!descriptor) return
          void openSidePanel({
            subject: descriptor.subject,
            context: descriptor.context,
          }).catch(() => {
            // Notes / rating popover surface failures; compact score stays quiet.
          })
        })
        scoreMount.append(this.#score.host)
        placeAfterDisplayNameIcons(nameRoot, scoreMount)
        this.#scoreMount = scoreMount
      }
    } else if (nameRoot && this.#scoreMount?.isConnected) {
      placeAfterDisplayNameIcons(nameRoot, this.#scoreMount)
    }

    if (this.#chipEnabled && !this.#chipMount?.isConnected) {
      if (nameRoot) {
        const chipMount = document.createElement('span')
        chipMount.setAttribute(CHIP_ATTR, 'true')
        chipMount.setAttribute(HOST_ATTR, 'true')
        chipMount.style.cssText =
          'display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;'
        this.#chip = createTrustChip({
          title: t('content.card.authorChipTitle'),
          onClick: () => {
            const verifiedBadge = cloneAuthorVerifiedBadge(nameRoot)
            openTrustDialog({
              target: profileTargetForHandle(handle),
              variant: 'author',
              title: readDisplayName(nameRoot),
              ...(verifiedBadge ? { verifiedBadge } : {}),
            })
          },
        })
        chipMount.append(this.#chip.host)
        placeAfterDisplayNameIcons(nameRoot, chipMount)
        this.#chipMount = chipMount
      }
    } else if (nameRoot && this.#chipMount?.isConnected) {
      placeAfterDisplayNameIcons(nameRoot, this.#chipMount)
    }

    this.#watch(handle)
  }

  #watch(handle: string): void {
    // Repeat syncs for the same profile must not re-subscribe / re-paint;
    // trust-store notifications drive repaints while subscribed.
    if (this.#watchedHandle === handle && this.#unsubscribe) return
    this.#watchedHandle = handle
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    const target = profileTargetForHandle(handle)
    const descriptor = trustDescriptor(target)
    if (!descriptor) {
      this.#paint(undefined)
      return
    }
    const key = descriptorKey(descriptor)
    const cached = trustStore.get(key)
    if (cached) this.#paint(summarizeTrust(cached), trustStore.isLoading(key))
    this.#unsubscribe = trustStore.subscribe(key, (result) => {
      this.#paint(
        result ? summarizeTrust(result) : undefined,
        trustStore.isLoading(key),
      )
    })
    trustStore.request(key, descriptor)
    if (!cached) this.#paint(undefined, trustStore.isLoading(key))
  }

  #detailScoreEnabled(): boolean {
    return this.#detailTextEnabled || this.#detailDegreeEnabled
  }

  #detailScoreParts(): Pick<XAugmentationFeatures, 'detailText' | 'detailDegree'> {
    return {
      detailText: this.#detailTextEnabled,
      detailDegree: this.#detailDegreeEnabled,
    }
  }

  #paint(summary: TrustSummary | undefined, loading = false): void {
    const tone: TrustTone = summary?.tone ?? 'neutral'
    const chipTone: TrustTone = summary
      ? chipToneForSummary(summary)
      : 'neutral'
    const nameRoot = findProfileNameRoot()

    if (this.#ambientEnabled && nameRoot) {
      setProfileTone(nameRoot, tone)
    } else if (nameRoot) {
      setProfileTone(nameRoot, undefined)
    }

    this.#chip?.setLoading(loading)
    this.#chip?.setTone(chipTone)
    const scoreParts = detailScoreParts(this.#detailScoreParts())
    const chipTitle =
      summary && summary.resolution !== 'none'
        ? formatTrustScore(summary, scoreParts) ??
          t('content.card.authorChipTitle')
        : t('content.card.authorChipTitle')
    this.#chip?.setLabel(chipTitle)
    this.#score?.set(
      this.#detailScoreEnabled() && summary
        ? formatTrustScore(summary, scoreParts)
        : undefined,
      tone,
    )
  }

  #teardownMounts(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#watchedHandle = undefined
    this.#chip?.destroy()
    this.#chip = undefined
    this.#score?.destroy()
    this.#score = undefined
    this.#chipMount?.remove()
    this.#chipMount = undefined
    this.#scoreMount?.remove()
    this.#scoreMount = undefined
    const nameRoot = findProfileNameRoot()
    if (nameRoot) setProfileTone(nameRoot, undefined)
    for (const stale of document.querySelectorAll(
      `[${HOST_ATTR}], [${CHIP_ATTR}], [${SCORE_ATTR}]`,
    )) {
      stale.remove()
    }
  }

  #teardown(): void {
    this.#teardownMounts()
    this.#handle = undefined
  }
}
