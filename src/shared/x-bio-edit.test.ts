import { describe, expect, it } from 'vitest'
import {
  X_BIO_MAX_CHARS,
  buildSuggestedXBio,
  stripNpubsFromBio,
} from './x-bio-edit'

const NPUB_A = `npub1${'q'.repeat(58)}`
const NPUB_B = `npub1${'z'.repeat(58)}`

describe('stripNpubsFromBio', () => {
  it('removes bare and (nostr)-suffixed npubs', () => {
    expect(stripNpubsFromBio(`Hello ${NPUB_A} (nostr) world`)).toBe(
      'Hello world',
    )
    expect(stripNpubsFromBio(`gm\n${NPUB_A}`)).toBe('gm\n')
  })

  it('strips multiple npubs', () => {
    expect(stripNpubsFromBio(`${NPUB_A} or ${NPUB_B}`)).toBe('or')
  })

  it('preserves blank lines and extra newlines in the author bio', () => {
    expect(
      stripNpubsFromBio(`Line one\n\n\nLine two\n${NPUB_A} (nostr)`),
    ).toBe('Line one\n\n\nLine two\n')
  })
})

describe('buildSuggestedXBio', () => {
  it('adds npub (nostr) when the bio has no npub', () => {
    const result = buildSuggestedXBio({
      currentBio: 'Building in public.',
      activeNpub: NPUB_A,
    })
    expect(result.mode).toBe('add')
    expect(result.suggestedBio).toBe(`Building in public.\n${NPUB_A} (nostr)`)
    expect(result.suffixUsed).toBe('nostr')
    expect(result.tooLong).toBe(false)
    expect(result.length).toBe(result.suggestedBio.length)
  })

  it('keeps blank lines when appending the npub', () => {
    const result = buildSuggestedXBio({
      currentBio: 'Hello\n\nWorld',
      activeNpub: NPUB_A,
    })
    expect(result.suggestedBio).toBe(`Hello\n\nWorld\n${NPUB_A} (nostr)`)
  })

  it('keeps the blank line before an existing trailing npub when tidying', () => {
    const result = buildSuggestedXBio({
      currentBio: `Digital Web of Trust Reputation.\n\n${NPUB_A}`,
      activeNpub: NPUB_A,
    })
    expect(result.mode).toBe('same')
    expect(result.suggestedBio).toBe(
      `Digital Web of Trust Reputation.\n\n${NPUB_A} (nostr)`,
    )
  })
  it('adds only the npub line when current bio is empty', () => {
    const result = buildSuggestedXBio({
      currentBio: '',
      activeNpub: NPUB_A,
    })
    expect(result.mode).toBe('add')
    expect(result.suggestedBio).toBe(`${NPUB_A} (nostr)`)
  })

  it('tidies the same npub without duplicating', () => {
    const result = buildSuggestedXBio({
      currentBio: `Hello\n${NPUB_A}`,
      activeNpub: NPUB_A,
    })
    expect(result.mode).toBe('same')
    expect(result.suggestedBio).toBe(`Hello\n${NPUB_A} (nostr)`)
    expect(result.suggestedBio.match(new RegExp(NPUB_A, 'g'))).toHaveLength(1)
  })

  it('removes the active npub when removeNpub is set', () => {
    const result = buildSuggestedXBio({
      currentBio: `Hello\n${NPUB_A} (nostr)`,
      activeNpub: NPUB_A,
      removeNpub: true,
    })
    expect(result.mode).toBe('remove')
    expect(result.suggestedBio).toBe('Hello\n')
    expect(result.suggestedBio).not.toContain(NPUB_A)
  })

  it('does not silently replace a different bio npub until confirmed', () => {
    const current = `Old key\n${NPUB_B} (nostr)`
    const pending = buildSuggestedXBio({
      currentBio: current,
      activeNpub: NPUB_A,
    })
    expect(pending.mode).toBe('replace')
    expect(pending.otherNpub).toBe(NPUB_B)
    expect(pending.suggestedBio).toBe(current)
    expect(pending.suffixUsed).toBe('none')

    const confirmed = buildSuggestedXBio({
      currentBio: current,
      activeNpub: NPUB_A,
      confirmReplace: true,
    })
    expect(confirmed.mode).toBe('replace')
    expect(confirmed.suggestedBio).toBe(`Old key\n${NPUB_A} (nostr)`)
    expect(confirmed.suggestedBio).not.toContain(NPUB_B)
  })

  it('offers replace from xIdentities.xNpub when bio text has no npub', () => {
    const pending = buildSuggestedXBio({
      currentBio: 'No keys here.',
      activeNpub: NPUB_A,
      storedBioNpub: NPUB_B,
    })
    expect(pending.mode).toBe('replace')
    expect(pending.otherNpub).toBe(NPUB_B)
    expect(pending.suggestedBio).toBe('No keys here.')

    const confirmed = buildSuggestedXBio({
      currentBio: 'No keys here.',
      activeNpub: NPUB_A,
      storedBioNpub: NPUB_B,
      confirmReplace: true,
    })
    expect(confirmed.suggestedBio).toBe(`No keys here.\n${NPUB_A} (nostr)`)
  })

  it('treats multi-npub bio as replace and strips all on confirm', () => {
    const current = `${NPUB_A} and ${NPUB_B}`
    const confirmed = buildSuggestedXBio({
      currentBio: current,
      activeNpub: NPUB_A,
      confirmReplace: true,
    })
    expect(confirmed.mode).toBe('replace')
    expect(confirmed.suggestedBio).toBe(`and\n${NPUB_A} (nostr)`)
    expect(confirmed.suggestedBio).not.toContain(NPUB_B)
    expect(confirmed.suggestedBio.match(new RegExp(NPUB_A, 'g'))).toHaveLength(1)
  })

  it('drops (nostr) first when characters are tight', () => {
    // Leave room for bare npub + newline but not for " (nostr)".
    const bareOverhead = 1 + NPUB_A.length // newline + npub
    const baseLen = X_BIO_MAX_CHARS - bareOverhead
    const base = 'x'.repeat(baseLen)
    const result = buildSuggestedXBio({
      currentBio: base,
      activeNpub: NPUB_A,
    })
    expect(result.suffixUsed).toBe('bare')
    expect(result.suggestedBio).toBe(`${base}\n${NPUB_A}`)
    expect(result.tooLong).toBe(false)
    expect(result.length).toBe(X_BIO_MAX_CHARS)
  })

  it('marks tooLong when even the bare npub exceeds 160', () => {
    const base = 'y'.repeat(X_BIO_MAX_CHARS)
    const result = buildSuggestedXBio({
      currentBio: base,
      activeNpub: NPUB_A,
    })
    expect(result.tooLong).toBe(true)
    expect(result.suffixUsed).toBe('bare')
    expect(result.length).toBeGreaterThan(X_BIO_MAX_CHARS)
  })

  it('treats stored same npub with empty bio as same', () => {
    const result = buildSuggestedXBio({
      currentBio: '',
      activeNpub: NPUB_A,
      storedBioNpub: NPUB_A,
    })
    expect(result.mode).toBe('same')
    expect(result.suggestedBio).toBe(`${NPUB_A} (nostr)`)
  })

  it('rejects an invalid active npub', () => {
    expect(() =>
      buildSuggestedXBio({ currentBio: '', activeNpub: 'not-an-npub' }),
    ).toThrow(/Invalid Nostr npub/)
  })
})
