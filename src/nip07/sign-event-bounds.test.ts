import { describe, expect, it } from 'vitest'
import { ATTENTIONX_TRUST_CONTENT_UI_LIMIT } from '../shared/trust-content.ts'
import { TRUST_STATEMENT_KIND } from '../shared/kind-32009.ts'
import { RATING_STATEMENT_KIND } from '../shared/kind-32014.ts'
import { validateNip07Params } from './bg/nip07-handlers.ts'
import {
  assertBoundedCryptoPayload,
  assertBoundedUnsignedEvent,
  boundsForSignEventKind,
  NIP07_DEFAULT_SIGN_BOUNDS,
  NIP07_MAX_CRYPTO_PAYLOAD_CHARS,
} from './sign-event-bounds.ts'

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 1,
    content: 'hello',
    tags: [['t', 'test']],
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
}

describe('sign-event-bounds', () => {
  it('uses the AttentionX 144-char cap for kind 32009', () => {
    expect(boundsForSignEventKind(TRUST_STATEMENT_KIND).maxContentChars).toBe(
      ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
    )
    expect(ATTENTIONX_TRUST_CONTENT_UI_LIMIT).toBe(144)
  })

  it('uses the same 144-char cap for kind 32014 ratings', () => {
    expect(boundsForSignEventKind(RATING_STATEMENT_KIND).maxContentChars).toBe(
      ATTENTIONX_TRUST_CONTENT_UI_LIMIT,
    )
  })

  it('allows longer content for ordinary notes than for 32009', () => {
    expect(boundsForSignEventKind(1).maxContentChars).toBeGreaterThan(
      boundsForSignEventKind(TRUST_STATEMENT_KIND).maxContentChars,
    )
    expect(boundsForSignEventKind(1).maxContentChars).toBe(
      NIP07_DEFAULT_SIGN_BOUNDS.maxContentChars,
    )
  })

  it('requires tags and created_at', () => {
    expect(() =>
      assertBoundedUnsignedEvent({
        kind: 1,
        content: 'x',
      }),
    ).toThrow(/tags/)
    expect(() =>
      assertBoundedUnsignedEvent({
        kind: 1,
        content: 'x',
        tags: [],
      }),
    ).toThrow(/created_at/)
  })

  it('rejects kind 32009 content over 144 Unicode characters', () => {
    const content = 'a'.repeat(ATTENTIONX_TRUST_CONTENT_UI_LIMIT + 1)
    expect(() =>
      assertBoundedUnsignedEvent(
        baseEvent({
          kind: TRUST_STATEMENT_KIND,
          content,
          tags: [
            ['d', 'i:user:id:1:1'],
            ['i', 'user:id:1'],
            ['v', '1'],
          ],
        }),
      ),
    ).toThrow(/kind 32009 limit of 144/)
  })

  it('accepts kind 32009 content at the 144-character boundary', () => {
    const content = 'a'.repeat(ATTENTIONX_TRUST_CONTENT_UI_LIMIT)
    const bounded = assertBoundedUnsignedEvent(
      baseEvent({
        kind: TRUST_STATEMENT_KIND,
        content,
        tags: [
          ['d', 'i:user:id:1:1'],
          ['i', 'user:id:1'],
          ['v', '1'],
        ],
      }),
    )
    expect(bounded.content).toBe(content)
  })

  it('accepts a longer kind-1 note that would be illegal for 32009', () => {
    const content = 'a'.repeat(1_000)
    const bounded = assertBoundedUnsignedEvent(baseEvent({ kind: 1, content }))
    expect(bounded.content.length).toBe(1_000)
  })

  it('rejects too many tags for kind 32009', () => {
    const tags = Array.from({ length: 40 }, (_, i) => ['t', String(i)])
    expect(() =>
      assertBoundedUnsignedEvent(
        baseEvent({ kind: TRUST_STATEMENT_KIND, content: '', tags }),
      ),
    ).toThrow(/limit of 32 tags/)
  })

  it('bounds crypto payloads', () => {
    expect(assertBoundedCryptoPayload('plaintext', 'ok')).toBe('ok')
    expect(() =>
      assertBoundedCryptoPayload(
        'plaintext',
        'x'.repeat(NIP07_MAX_CRYPTO_PAYLOAD_CHARS + 1),
      ),
    ).toThrow(/plaintext exceeds limit/)
  })
})

describe('validateNip07Params', () => {
  it('normalizes a valid signEvent payload onto params.event', () => {
    const params: Record<string, unknown> = {
      event: baseEvent({ content: 'note' }),
      origin: 'example.com',
    }
    validateNip07Params('nip07_signEvent', params)
    expect(params.event).toEqual({
      kind: 1,
      content: 'note',
      tags: [['t', 'test']],
      created_at: (params.event as { created_at: number }).created_at,
    })
  })

  it('rejects oversized 32009 before signing', () => {
    expect(() =>
      validateNip07Params('nip07_signEvent', {
        event: baseEvent({
          kind: TRUST_STATEMENT_KIND,
          content: 'x'.repeat(200),
          tags: [
            ['d', 'i:user:id:1:1'],
            ['i', 'user:id:1'],
            ['v', '1'],
          ],
        }),
      }),
    ).toThrow(/144/)
  })

  it('rejects missing created_at', () => {
    expect(() =>
      validateNip07Params('nip07_signEvent', {
        event: { kind: 1, content: '', tags: [] },
      }),
    ).toThrow(/created_at/)
  })
})
