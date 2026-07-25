import {
  finalizeEvent,
  generateSecretKey,
  type Event,
  type VerifiedEvent,
} from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import {
  buildKind32009D,
  buildKind32009Event,
  canonicalizeWebUrl,
  contextFallbackChain,
  getTrustStatementActiveStatus,
  isCanonicalTrustContext,
  parseKind32009Event,
  reduceKind32009Events,
  resolveTrustStatementContext,
  sha256Hex,
  validateKind32009Event,
  type BuildKind32009Input,
} from './kind-32009'

const secretKey = generateSecretKey()
const accountSubject = {
  type: 'i' as const,
  value: 'ext:twitter_id:11348282',
}

async function signedStatement(
  overrides: Partial<BuildKind32009Input> = {},
): Promise<VerifiedEvent> {
  return finalizeEvent(
    await buildKind32009Event({
      subject: accountSubject,
      value: '1',
      context: 'identity',
      createdAt: 1_700_000_000,
      ...overrides,
    }),
    secretKey,
  )
}

function withTags(event: Event, tags: string[][]): Event {
  return { ...event, tags }
}

describe('kind 32009 protocol', () => {
  it('builds the documented SHA-256 d tag deterministically', async () => {
    expect(await sha256Hex(accountSubject.value)).toBe(
      '742691e6bbe49bee3079323165036cc809caf6b243139bc6899841ff1df9f667',
    )
    expect(await buildKind32009D(accountSubject, 'identity')).toBe(
      '742691e6bbe49bee3079323165036cc809caf6b243139bc6899841ff1df9f667:identity',
    )

    const hexSubject = {
      type: 'p' as const,
      value: 'ab'.repeat(32),
    }
    expect(await buildKind32009D(hexSubject)).toBe(hexSubject.value)
  })

  it('builds, signs, parses, and verifies complete statements', async () => {
    const event = await signedStatement({
      value: '-1',
      context: 'news:accuracy',
      activationTime: 1_699_999_999,
      expirationTime: 1_700_000_001,
      content: 'Primary sources conflict with this account.',
      extraTags: [['source', 'manual']],
    })

    const parsed = await parseKind32009Event(event)
    expect(parsed).toMatchObject({
      subject: accountSubject,
      value: '-1',
      context: 'news:accuracy',
      activationTime: 1_699_999_999,
      expirationTime: 1_700_000_001,
    })
    expect(event.tags).toContainEqual(['source', 'manual'])
  })

  it('supports general context with a missing or empty c tag', async () => {
    const withoutContext = await signedStatement({ context: undefined })
    const emptyContext = finalizeEvent(
      {
        ...(await buildKind32009Event({
          subject: accountSubject,
          value: '1',
          createdAt: 1_700_000_001,
        })),
        tags: [
          ['d', await buildKind32009D(accountSubject)],
          ['i', accountSubject.value],
          ['c', ''],
          ['v', '1'],
        ],
      },
      secretKey,
    )

    await expect(parseKind32009Event(withoutContext)).resolves.toMatchObject({
      context: '',
    })
    await expect(parseKind32009Event(emptyContext)).resolves.toMatchObject({
      context: '',
    })
  })

  it('enforces canonical context grammar, byte limits, and hierarchy', () => {
    expect(isCanonicalTrustContext('security:audit:web')).toBe(true)
    expect(isCanonicalTrustContext('Security:audit')).toBe(false)
    expect(isCanonicalTrustContext('security::audit')).toBe(false)
    expect(isCanonicalTrustContext(`a${'b'.repeat(128)}`)).toBe(false)
    expect(contextFallbackChain('security:audit:web')).toEqual([
      'security:audit:web',
      'security:audit',
      'security',
      '',
    ])
    expect(() => contextFallbackChain(':invalid')).toThrow()
  })

  it('canonicalizes web subjects and rejects noncanonical identifiers', async () => {
    expect(canonicalizeWebUrl('HTTPS://Example.COM:443/path#fragment')).toBe(
      'https://example.com/path',
    )
    await expect(
      buildKind32009D({
        type: 'i',
        value: 'web:HTTPS://Example.COM:443/path#fragment',
      }),
    ).rejects.toThrow('canonical')
    await expect(
      buildKind32009D({ type: 'i', value: 'ext:twitter_id:not-a-number' }),
    ).rejects.toThrow('decimal digits')
  })

  it('rejects malformed tags, values, times, ordering, and oversized content', async () => {
    const valid = await signedStatement()
    const fixtures: Event[] = [
      withTags(valid, [...valid.tags, ['p', 'ab'.repeat(32)]]),
      withTags(
        valid,
        valid.tags.map((tag) => (tag[0] === 'v' ? ['v', '2'] : tag)),
      ),
      withTags(valid, [...valid.tags, ['c', 'identity']]),
      withTags(valid, [...valid.tags, ['x', '-1']]),
      withTags(valid, [...valid.tags, ['x', '20'], ['y', '10']]),
      withTags(
        valid,
        valid.tags.map((tag) =>
          tag[0] === 'd' ? ['d', '0'.repeat(64)] : tag,
        ),
      ),
      { ...valid, content: '😀'.repeat(1025) },
    ]

    for (const fixture of fixtures) {
      const result = await validateKind32009Event(fixture, {
        verifyEvent: false,
      })
      expect(result.valid).toBe(false)
    }
  })

  it('rejects a mismatched event id and an invalid signature', async () => {
    const event = await signedStatement()
    const badId = { ...event, content: 'tampered' }
    const idResult = await validateKind32009Event(badId)
    expect(idResult.valid).toBe(false)
    if (!idResult.valid) {
      expect(idResult.errors).toContain(
        'Event id does not match its serialized event hash',
      )
    }

    const badSignature = { ...event, sig: '0'.repeat(128) }
    const signatureResult = await validateKind32009Event(badSignature)
    expect(signatureResult.valid).toBe(false)
    if (!signatureResult.valid) {
      expect(signatureResult.errors).toContain('Event signature is invalid')
    }
  })

  it('uses highest created_at then lexically lowest id for replacement', async () => {
    const older = await signedStatement({
      value: '-1',
      createdAt: 10,
      content: 'older',
    })
    const newestA = await signedStatement({
      value: '1',
      createdAt: 11,
      content: 'candidate a',
    })
    const newestB = await signedStatement({
      value: '0',
      createdAt: 11,
      content: 'candidate b',
    })
    const expected = [newestA, newestB].sort((left, right) =>
      left.id.localeCompare(right.id),
    )[0]

    const reduced = await reduceKind32009Events([
      expected === newestA ? newestB : newestA,
      older,
      expected,
    ])
    expect(reduced.rejected).toEqual([])
    expect(reduced.statements).toHaveLength(1)
    expect(reduced.statements[0].event.id).toBe(expected.id)
  })

  it('reports inclusive active windows and cancellation', async () => {
    const active = await parseKind32009Event(
      await signedStatement({ activationTime: 10, expirationTime: 20 }),
    )
    expect(getTrustStatementActiveStatus(active, 9)).toBe('not_yet_active')
    expect(getTrustStatementActiveStatus(active, 10)).toBe('active')
    expect(getTrustStatementActiveStatus(active, 20)).toBe('active')
    expect(getTrustStatementActiveStatus(active, 21)).toBe('expired')

    const cancelled = await parseKind32009Event(
      await signedStatement({
        value: '0',
        activationTime: 100,
        expirationTime: 200,
      }),
    )
    expect(getTrustStatementActiveStatus(cancelled, 50)).toBe('cancelled')
  })

  it('resolves exact, nearest-parent, and general context slots', async () => {
    const general = await parseKind32009Event(
      await signedStatement({ context: undefined, createdAt: 1 }),
    )
    const security = await parseKind32009Event(
      await signedStatement({ context: 'security', createdAt: 2 }),
    )
    const cancelledAudit = await parseKind32009Event(
      await signedStatement({
        context: 'security:audit',
        value: '0',
        createdAt: 3,
      }),
    )

    expect(
      resolveTrustStatementContext(
        [general, security, cancelledAudit],
        'security:audit:web',
      ),
    ).toBe(cancelledAudit)
    expect(
      resolveTrustStatementContext([general, security], 'security:review'),
    ).toBe(security)
    expect(resolveTrustStatementContext([general], 'news:accuracy')).toBe(
      general,
    )
  })
})
