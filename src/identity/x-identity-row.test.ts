import { describe, expect, it } from 'vitest'
import { evaluateXIdentityRow } from './x-identity-row'

const NPUB_A = 'npub1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NPUB_B = 'npub1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('evaluateXIdentityRow', () => {
  it('returns unverified when neither side is present', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
      }),
    ).toEqual({ state: 'unverified', columnsAligned: false })
  })

  it('returns missing-nip39 when only the X proof side is present', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xProofNpub: NPUB_A,
        xProofPostId: 'post-1',
        xProofHandle: 'nasa',
      }),
    ).toEqual({
      state: 'unverified',
      blockedBy: 'missing-nip39',
      columnsAligned: false,
    })
  })

  it('returns missing-x-proof when only the nip39 side is present', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        nip39Npub: NPUB_A,
        nip39XId: '11348282',
        nip39PostId: 'post-1',
        nip39Handle: 'nasa',
      }),
    ).toEqual({
      state: 'unverified',
      blockedBy: 'missing-x-proof',
      columnsAligned: false,
    })
  })

  it('returns pending when both sides are aligned', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xProofNpub: NPUB_A,
        xProofPostId: 'post-1',
        xProofHandle: 'NASA',
        nip39Npub: NPUB_A,
        nip39XId: '11348282',
        nip39PostId: 'post-1',
        nip39Handle: 'nasa',
      }),
    ).toEqual({ state: 'pending', columnsAligned: true })
  })

  it('mismatches when npubs differ', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xProofNpub: NPUB_A,
        xProofPostId: 'post-1',
        nip39Npub: NPUB_B,
        nip39XId: '11348282',
        nip39PostId: 'post-1',
      }),
    ).toEqual({
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    })
  })

  it('mismatches when nip39XId differs from twitterId', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xProofNpub: NPUB_A,
        xProofPostId: 'post-1',
        nip39Npub: NPUB_A,
        nip39XId: '999',
        nip39PostId: 'post-1',
      }),
    ).toEqual({
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    })
  })

  it('mismatches when proof post ids differ', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xProofNpub: NPUB_A,
        xProofPostId: 'post-1',
        nip39Npub: NPUB_A,
        nip39XId: '11348282',
        nip39PostId: 'post-2',
      }),
    ).toEqual({
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    })
  })

  it('mismatches when handles differ', () => {
    expect(
      evaluateXIdentityRow({
        twitterId: '11348282',
        xProofNpub: NPUB_A,
        xProofPostId: 'post-1',
        xProofHandle: 'nasa',
        nip39Npub: NPUB_A,
        nip39XId: '11348282',
        nip39PostId: 'post-1',
        nip39Handle: 'spacex',
      }),
    ).toEqual({
      state: 'unverified',
      blockedBy: 'mismatch',
      columnsAligned: false,
    })
  })

  it('returns pending with proof-unavailable when nip39-only and proofUnavailable', () => {
    expect(
      evaluateXIdentityRow(
        {
          twitterId: '11348282',
          nip39Npub: NPUB_A,
          nip39XId: '11348282',
          nip39PostId: 'post-1',
        },
        { proofUnavailable: true },
      ),
    ).toEqual({
      state: 'pending',
      blockedBy: 'proof-unavailable',
      columnsAligned: false,
    })
  })
})
