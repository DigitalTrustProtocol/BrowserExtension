import { describe, expect, it } from 'vitest'
import en from '../../../../public/locales/en.json'
import type { ResolvedStatement, TrustQueryResult } from '../../../graph'
import type { SerializableTrustSubject } from '../../../shared/contracts'
import {
  isAlreadySelected,
  ownDirectPolarity,
  polarityToPublishValue,
  isSelfAccountSubject,
  selfCheckIdentity,
  shouldShowDelete,
  shouldShowOpenGraph,
  trustLaunchLabelKey,
  rateLaunchLabelKey,
    ratingClaimLabelKey,
    TRUST_OVERLAY_POLARITIES,
    chromeRetractOpensTrustOverlay,
    trustOverlayNoteKeys,
} from './CurationActions'

const account: SerializableTrustSubject = {
  type: 'i',
  value: 'user:id:11348282',
}
const post: SerializableTrustSubject = {
  type: 'i',
  value: 'post:id:2080659774136291424',
}
const pubkey: SerializableTrustSubject = {
  type: 'p',
  value: 'ab'.repeat(32),
}
const event: SerializableTrustSubject = {
  type: 'e',
  value: 'cd'.repeat(32),
}

function result(overrides: Partial<TrustQueryResult> = {}): TrustQueryResult {
  return {
    subject: account,
    context: '',
    resolution: 'none',
    trust: 0,
    distrust: 0,
    trustValue: 0,
    degree: 0,
    connected: false,
    statements: [],
    paths: [],
    sourceEventIds: [],
    truncated: false,
    computedAt: 1_700_000_000,
    graphVersion: 1,
    ...overrides,
  }
}

function direct(value: 1 | 0 | -1): ResolvedStatement {
  return {
    eventId: 'e1',
    author: 'aa'.repeat(32),
    subject: account,
    context: '',
    requestedContext: '',
    contextMatch: 'exact',
    value,
    createdAt: 1_700_000_000,
    distance: 0,
  }
}

describe('polarityToPublishValue', () => {
  it('maps Trust / Neutral / Distrust to PUBLISH_TRUST_STATEMENT values', () => {
    expect(polarityToPublishValue('trust')).toBe('1')
    expect(polarityToPublishValue('neutral')).toBe('0')
    expect(polarityToPublishValue('distrust')).toBe('-1')
  })
})

describe('ownDirectPolarity', () => {
  it('reads the current own value from trust.direct', () => {
    expect(ownDirectPolarity(null)).toBeNull()
    expect(ownDirectPolarity(result())).toBeNull()
    expect(ownDirectPolarity(result({ direct: direct(1) }))).toBe('trust')
    expect(ownDirectPolarity(result({ direct: direct(0) }))).toBe('neutral')
    expect(ownDirectPolarity(result({ direct: direct(-1) }))).toBe('distrust')
  })
})

describe('shouldShowDelete', () => {
  it('shows Delete only when an own winning statement exists', () => {
    expect(shouldShowDelete(null)).toBe(false)
    expect(shouldShowDelete(result())).toBe(false)
    expect(shouldShowDelete(result({ direct: direct(1) }))).toBe(true)
    expect(shouldShowDelete(result({ direct: direct(0) }))).toBe(true)
    expect(shouldShowDelete(result({ direct: direct(-1) }))).toBe(true)
  })
})

describe('shouldShowOpenGraph', () => {
  it('shows Open Graph for identity subjects, not artifacts', () => {
    expect(shouldShowOpenGraph(account)).toBe(true)
    expect(shouldShowOpenGraph(pubkey)).toBe(true)
    expect(shouldShowOpenGraph(post)).toBe(false)
    expect(shouldShowOpenGraph(event)).toBe(false)
  })
})

describe('isAlreadySelected', () => {
  it('marks the current polarity as pressed, without blocking a reissue', () => {
    expect(isAlreadySelected('trust', 'trust')).toBe(true)
    expect(isAlreadySelected('neutral', 'trust')).toBe(false)
    expect(isAlreadySelected('distrust', null)).toBe(false)
  })
})

describe('trustLaunchLabelKey', () => {
  it('uses Re-trust when Delete is available', () => {
    expect(trustLaunchLabelKey(false)).toBe('panel.curate.trust')
    expect(trustLaunchLabelKey(true)).toBe('panel.curate.reTrust')
  })
})

describe('rateLaunchLabelKey', () => {
  it('uses Re-rate when an own rating exists', () => {
    expect(rateLaunchLabelKey(false)).toBe('panel.curate.rate')
    expect(rateLaunchLabelKey(true)).toBe('panel.curate.reRate')
    expect(en['panel.curate.rate']).toBe('Rate')
    expect(en['panel.curate.reRate']).toBe('Re-rate')
    expect(en['panel.curate.deleteRatingHint']).toBe('Retract your own rating')
    expect(en['content.rating.title']).toBe('Rate this post')
    expect(en['content.rating.clear']).toBe('Retract my rating')
    expect(en['content.card.delete']).toBe('Retract my statement')
    expect(en['panel.curate.alreadySelected']).toBe(
      'This is already your statement. Retract it if you want to take it back.',
    )
    expect(en['content.rating.commentPlaceholder']).toBe(
      'Optional note (not a reply)',
    )
  })
})

describe('ratingClaimLabelKey', () => {
  it('maps timeline quick-claim ids onto shared locale keys', () => {
    expect(ratingClaimLabelKey('insightful')).toBe(
      'content.rating.labelInsightful',
    )
    expect(ratingClaimLabelKey('spam')).toBe('content.rating.labelSpam')
    expect(en['content.rating.labelInsightful']).toBe('Insightful')
    expect(en['content.rating.labelSpam']).toBe('Spam')
  })
})

describe('trust overlay polarity order', () => {
  it('uses Trust, Neutral, Distrust so adjacent clicks are farther apart', () => {
    expect([...TRUST_OVERLAY_POLARITIES]).toEqual([
      'trust',
      'neutral',
      'distrust',
    ])
  })
})

describe('chromeRetractOpensTrustOverlay', () => {
  it('opens the Trust overlay from user chrome, not post chrome', () => {
    expect(chromeRetractOpensTrustOverlay('user')).toBe(true)
    expect(chromeRetractOpensTrustOverlay('post')).toBe(false)
  })
})

describe('trustOverlayNoteKeys', () => {
  it('asks why the statement is being retracted when polarity buttons are hidden', () => {
    expect(trustOverlayNoteKeys('publish')).toEqual({
      label: 'content.dialog.noteLabel',
      placeholder: 'content.dialog.notePlaceholder',
    })
    expect(trustOverlayNoteKeys('retract')).toEqual({
      label: 'panel.curate.retractNoteLabel',
      placeholder: 'panel.curate.retractNotePlaceholder',
    })
    expect(en['panel.curate.retractNoteLabel']).toBe('Why retract?')
    expect(en['panel.curate.retractNotePlaceholder']).toBe(
      'Why are you retracting this statement? (optional)',
    )
  })
})

describe('isSelfAccountSubject', () => {
  it('matches the operator X id on an account subject', () => {
    expect(isSelfAccountSubject(account, ['11348282'])).toBe(true)
    expect(isSelfAccountSubject(account, [null, '11348282'])).toBe(true)
    expect(isSelfAccountSubject(account, ['44196397'])).toBe(false)
    expect(isSelfAccountSubject(account, [null, undefined])).toBe(false)
    expect(isSelfAccountSubject(post, ['11348282'])).toBe(false)
    expect(isSelfAccountSubject(pubkey, ['11348282'])).toBe(false)
    expect(isSelfAccountSubject(pubkey, [], 'ab'.repeat(32))).toBe(true)
    expect(isSelfAccountSubject(pubkey, [], 'cd'.repeat(32))).toBe(false)
  })
})

describe('selfCheckIdentity', () => {
  const elon = {
    type: 'i' as const,
    value: 'user:id:44196397',
  }
  const operatorPk = 'ab'.repeat(32)
  const elonPk = 'cd'.repeat(32)

  it('treats Elon as self and the operator X as not-self while impersonating Elon', () => {
    const self = selfCheckIdentity(
      { origin: 'impersonation', twitterId: '44196397', pubkey: elonPk },
      { twitterIds: ['11348282'], pubkey: operatorPk },
    )
    expect(isSelfAccountSubject(elon, self.twitterIds, self.pubkey)).toBe(true)
    expect(isSelfAccountSubject(account, self.twitterIds, self.pubkey)).toBe(
      false,
    )
  })

  it('keeps operator X ids when not impersonating (viewer.twitterId is absent)', () => {
    const self = selfCheckIdentity(
      { origin: 'operator', pubkey: operatorPk },
      { twitterIds: ['11348282'], pubkey: operatorPk },
    )
    expect(isSelfAccountSubject(account, self.twitterIds, self.pubkey)).toBe(
      true,
    )
    expect(isSelfAccountSubject(account, [undefined], operatorPk)).toBe(false)
  })
})
