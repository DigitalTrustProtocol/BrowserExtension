import { describe, expect, it } from 'vitest'
import {
  isUnboundPubkeySubject,
  postIdFromSubject,
  twitterIdFromSubject,
} from './selected-ids'

describe('selected-ids', () => {
  it('extracts twitter and post ids from canonical i subjects', () => {
    expect(
      twitterIdFromSubject({ type: 'i', value: 'user:id:11348282' }),
    ).toBe('11348282')
    expect(
      postIdFromSubject({ type: 'i', value: 'post:id:99' }),
    ).toBe('99')
    expect(
      twitterIdFromSubject({ type: 'p', value: 'ab'.repeat(32) }),
    ).toBeUndefined()
  })

  it('detects unbound pubkey subjects', () => {
    expect(
      isUnboundPubkeySubject({ type: 'p', value: 'ab'.repeat(32) }),
    ).toBe(true)
    expect(
      isUnboundPubkeySubject({ type: 'i', value: 'user:id:1' }),
    ).toBe(false)
  })
})
