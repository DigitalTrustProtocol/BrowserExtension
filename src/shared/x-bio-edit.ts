/**
 * Popup "Update bio" helper: propose an X profile description that embeds the
 * active npub. Raw bio text is ephemeral (prepare response only) — never
 * persisted. See docs/NIP-39.md and x-identity.mdc.
 */

import { collectNpubsInText } from './proof-composer'

/** X profile bio character limit. */
export const X_BIO_MAX_CHARS = 160

/** Opens X's Edit profile settings (user pastes the suggested bio). */
export const X_EDIT_PROFILE_URL = 'https://x.com/settings/profile'

const NPUB_PATTERN = /^npub1[023456789ac-hj-np-z]{10,100}$/
const NPUB_WITH_NOSTR_SUFFIX =
  /npub1[023456789ac-hj-np-z]{10,100}(?:\s*\(nostr\))?/gi

export type XBioEditMode = 'add' | 'same' | 'replace' | 'remove'
export type XBioSuffixUsed = 'nostr' | 'bare' | 'none'

export interface BuildSuggestedXBioInput {
  currentBio: string
  activeNpub: string
  /** `xIdentities.xNpub` when known — used when bio text has no npub. */
  storedBioNpub?: string
  /**
   * When mode is `replace`, the copyable suggestion is only produced after the
   * user confirms. Until then `suggestedBio` stays the current bio.
   */
  confirmReplace?: boolean
  /**
   * When true, produce a bio with the active npub stripped (Unlink flow).
   * Takes precedence over add/same/replace classification.
   */
  removeNpub?: boolean
}

export interface SuggestedXBio {
  currentBio: string
  suggestedBio: string
  npub: string
  /** Conflicting npub from bio text and/or xIdentities, when mode is replace. */
  otherNpub?: string
  mode: XBioEditMode
  suffixUsed: XBioSuffixUsed
  tooLong: boolean
  length: number
}

/** Prepare-response shape for the popup Update-bio flow. */
export interface XBioEditPreview extends SuggestedXBio {
  handle: string
  twitterId: string
  /** True when the content script found a bio node (value may still be empty). */
  bioRead: boolean
  /** False when the live X tab is a different account than this binding. */
  tabMatch: boolean
  editProfileUrl: typeof X_EDIT_PROFILE_URL
}

function normalizeNpub(value: string | undefined): string | undefined {
  if (!value) return undefined
  const npub = value.trim().toLowerCase()
  return NPUB_PATTERN.test(npub) ? npub : undefined
}

/**
 * Remove every npub (and optional trailing `(nostr)`) from bio text.
 * Preserves the author's blank lines and overall line structure; only tidies
 * horizontal spaces left behind where an npub sat.
 */
export function stripNpubsFromBio(bioText: string): string {
  return bioText
    .replace(NPUB_WITH_NOSTR_SUFFIX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/^[ \t]+/, '')
    .replace(/[ \t]+$/, '')
}

function appendNpubLine(
  base: string,
  npub: string,
): { text: string; suffixUsed: Exclude<XBioSuffixUsed, 'none'>; tooLong: boolean } {
  // Keep blank lines in the author text. Only strip trailing spaces/tabs — do
  // not trimEnd() newlines, or "line\n\n" + npub becomes "line\nnpub".
  const trimmedBase = base.replace(/[ \t]+$/g, '')
  const join = (suffix: string) => {
    if (!trimmedBase) return suffix
    return trimmedBase.endsWith('\n')
      ? `${trimmedBase}${suffix}`
      : `${trimmedBase}\n${suffix}`
  }
  const withNostr = join(`${npub} (nostr)`)
  if (withNostr.length <= X_BIO_MAX_CHARS) {
    return { text: withNostr, suffixUsed: 'nostr', tooLong: false }
  }
  const bare = join(npub)
  if (bare.length <= X_BIO_MAX_CHARS) {
    return { text: bare, suffixUsed: 'bare', tooLong: false }
  }
  return { text: bare, suffixUsed: 'bare', tooLong: true }
}

function classifyMode(
  bioNpubs: string[],
  activeNpub: string,
  storedBioNpub: string | undefined,
): { mode: XBioEditMode; otherNpub?: string } {
  const foreignInBio = bioNpubs.filter((n) => n !== activeNpub)
  if (bioNpubs.length > 1 || foreignInBio.length > 0) {
    return {
      mode: 'replace',
      otherNpub: foreignInBio[0] ?? bioNpubs.find((n) => n !== activeNpub),
    }
  }
  if (bioNpubs.length === 1 && bioNpubs[0] === activeNpub) {
    return { mode: 'same' }
  }
  // No npub in live bio — fall back to stored Bio side.
  if (storedBioNpub && storedBioNpub !== activeNpub) {
    return { mode: 'replace', otherNpub: storedBioNpub }
  }
  if (storedBioNpub && storedBioNpub === activeNpub) {
    return { mode: 'same' }
  }
  return { mode: 'add' }
}

/**
 * Build a suggested X bio that embeds `activeNpub`, or strips it when
 * `removeNpub` is set (Unlink). Prefer `npub (nostr)`; drop `(nostr)` first
 * when over 160 chars.
 */
export function buildSuggestedXBio(
  input: BuildSuggestedXBioInput,
): SuggestedXBio {
  const npub = normalizeNpub(input.activeNpub)
  if (!npub) {
    throw new Error('Invalid Nostr npub')
  }
  const currentBio = typeof input.currentBio === 'string' ? input.currentBio : ''
  const storedBioNpub = normalizeNpub(input.storedBioNpub)
  const bioNpubs = collectNpubsInText(currentBio)

  if (input.removeNpub) {
    const stripped = stripNpubsFromBio(currentBio)
    const hasActive =
      bioNpubs.includes(npub) ||
      (storedBioNpub !== undefined && storedBioNpub === npub)
    return {
      currentBio,
      suggestedBio: stripped,
      npub,
      mode: hasActive || bioNpubs.length > 0 ? 'remove' : 'same',
      suffixUsed: 'none',
      tooLong: stripped.length > X_BIO_MAX_CHARS,
      length: stripped.length,
    }
  }

  const { mode, otherNpub } = classifyMode(bioNpubs, npub, storedBioNpub)

  if (mode === 'replace' && !input.confirmReplace) {
    return {
      currentBio,
      suggestedBio: currentBio,
      npub,
      ...(otherNpub ? { otherNpub } : {}),
      mode,
      suffixUsed: 'none',
      tooLong: currentBio.length > X_BIO_MAX_CHARS,
      length: currentBio.length,
    }
  }

  const base = stripNpubsFromBio(currentBio)
  const appended = appendNpubLine(base, npub)
  return {
    currentBio,
    suggestedBio: appended.text,
    npub,
    ...(otherNpub ? { otherNpub } : {}),
    mode,
    suffixUsed: appended.suffixUsed,
    tooLong: appended.tooLong,
    length: appended.text.length,
  }
}
