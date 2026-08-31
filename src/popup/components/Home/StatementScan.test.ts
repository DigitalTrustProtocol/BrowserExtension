import { describe, expect, it } from 'vitest'
import en from '../../../../public/locales/en.json'
import type { ResolvedStatement, TrustQueryResult } from '../../../graph'
import {
  authorTitle,
  authorHandleLabel,
  formatCompactCount,
  formatGreenTrustPercent,
  formatLoadMoreLabel,
  formatPolarityChipLabel,
  formatPolarityLabel,
  hopDistance,
  isOwnStatement,
  labelProse,
  matchesAuthorFilter,
  matchesPolarityFilter,
  nextLoadCount,
  polarityCounts,
  polarityFromValue,
  polarityHintKey,
  polarityLabelKey,
  profileDisplayFromMetadata,
  xIdentityToAuthorDisplay,
  mergeAuthorDisplay,
  shortenPubkey,
  sortAuthorsByName,
  statementSubjectKind,
  uniqueStatementAuthors,
  uniqueOutgoingTwitterIds,
  statementContentLine,
  statementScanListPhase,
  windowedItems,
  STATEMENT_PAGE_SIZE,
  type Translate,
} from './StatementScan'
import { matchesStarFilter } from './SubjectRatings'
import { demoWotAuthorProfile } from '../../../shared/demo-wot'

const subject = { type: 'i' as const, value: 'user:id:11348282' }

const STRINGS: Record<string, string> = {
  'panel.statementScan.trust': en['panel.statementScan.trust'],
  'panel.statementScan.neutral': en['panel.statementScan.neutral'],
  'panel.statementScan.distrust': en['panel.statementScan.distrust'],
  'panel.statementScan.trustHint': en['panel.statementScan.trustHint'],
  'panel.statementScan.neutralHint': en['panel.statementScan.neutralHint'],
  'panel.statementScan.distrustHint': en['panel.statementScan.distrustHint'],
  'panel.statementScan.loadMore': en['panel.statementScan.loadMore'],
  'panel.statementScan.loadMoreOf': en['panel.statementScan.loadMoreOf'],
}

const translate: Translate = (key, params) => {
  let str = STRINGS[key]
  if (str === undefined) return key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      str = str.replaceAll(`{${name}}`, String(value))
    }
  }
  return str
}

function statement(
  overrides: Partial<ResolvedStatement> &
    Pick<ResolvedStatement, 'eventId' | 'author' | 'value'>,
): ResolvedStatement {
  return {
    subject,
    context: '',
    requestedContext: '',
    contextMatch: 'exact',
    createdAt: 1_700_000_000,
    distance: 1,
    ...overrides,
  }
}

describe('polarity labels', () => {
  it('maps Trust / Neutral / Distrust onto panel.statementScan keys', () => {
    expect(polarityFromValue(1)).toBe('trust')
    expect(polarityFromValue(0)).toBe('neutral')
    expect(polarityFromValue(-1)).toBe('distrust')
    expect(polarityLabelKey(1)).toBe('panel.statementScan.trust')
    expect(polarityLabelKey(0)).toBe('panel.statementScan.neutral')
    expect(polarityLabelKey(-1)).toBe('panel.statementScan.distrust')
    expect(polarityHintKey(1)).toBe('panel.statementScan.trustHint')
    expect(polarityHintKey(0)).toBe('panel.statementScan.neutralHint')
    expect(polarityHintKey(-1)).toBe('panel.statementScan.distrustHint')
  })

  it('prints the existing Trust / Neutral / Distrust meaning', () => {
    expect(formatPolarityLabel(1, translate)).toBe('Trust')
    expect(formatPolarityLabel(0, translate)).toBe('Neutral')
    expect(formatPolarityLabel(-1, translate)).toBe('Distrust')
  })
})

describe('isOwnStatement', () => {
  const direct = statement({
    eventId: 'evt-own',
    author: 'aa'.repeat(32),
    value: 1,
    distance: 0,
  })
  const trustDirect: TrustQueryResult['direct'] = direct

  it('matches the viewer statement by author and event id', () => {
    expect(isOwnStatement(direct, trustDirect)).toBe(true)
    expect(
      isOwnStatement(
        statement({
          eventId: 'evt-own',
          author: direct.author.toUpperCase(),
          value: 1,
        }),
        trustDirect,
      ),
    ).toBe(true)
  })

  it('does not treat another author or event as own', () => {
    expect(
      isOwnStatement(
        statement({ eventId: 'evt-other', author: direct.author, value: 1 }),
        trustDirect,
      ),
    ).toBe(false)
    expect(
      isOwnStatement(
        statement({ eventId: 'evt-own', author: 'bb'.repeat(32), value: 1 }),
        trustDirect,
      ),
    ).toBe(false)
    expect(isOwnStatement(direct, undefined)).toBe(false)
  })
})

describe('pubkey shortening', () => {
  it('never uses the full hex as the visual title', () => {
    const hex = 'ab'.repeat(32)
    const short = shortenPubkey(hex)
    expect(short.startsWith('npub1')).toBe(true)
    expect(short.includes(hex)).toBe(false)
    expect(short.length).toBeLessThan(hex.length)
  })

  it('passes through already-short identifiers', () => {
    expect(shortenPubkey('alice')).toBe('alice')
  })

  it('prefers a profile display name over a shortened pubkey', () => {
    const hex = 'cd'.repeat(32)
    expect(authorTitle(hex, 'Ada')).toBe('Ada')
    expect(authorTitle(hex, '  ')).toBe(shortenPubkey(hex))
    expect(authorTitle(hex, undefined)).toBe(shortenPubkey(hex))
  })
})

describe('statementScanListPhase', () => {
  it('holds the list until statements and chrome are ready', () => {
    expect(
      statementScanListPhase({
        statementsReady: false,
        chromeReady: false,
        statementCount: 0,
        visibleCount: 0,
      }),
    ).toBe('pending')
    expect(
      statementScanListPhase({
        statementsReady: true,
        chromeReady: false,
        statementCount: 4,
        visibleCount: 4,
      }),
    ).toBe('pending')
  })

  it('does not show emptyOutgoing while outgoing is still loading', () => {
    expect(
      statementScanListPhase({
        statementsReady: false,
        chromeReady: true,
        statementCount: 0,
        visibleCount: 0,
      }),
    ).toBe('pending')
  })

  it('shows rows only after chrome is ready', () => {
    expect(
      statementScanListPhase({
        statementsReady: true,
        chromeReady: true,
        statementCount: 4,
        visibleCount: 4,
      }),
    ).toBe('rows')
    expect(
      statementScanListPhase({
        statementsReady: true,
        chromeReady: true,
        statementCount: 0,
        visibleCount: 0,
      }),
    ).toBe('empty')
    expect(
      statementScanListPhase({
        statementsReady: true,
        chromeReady: true,
        statementCount: 4,
        visibleCount: 0,
      }),
    ).toBe('emptyFilter')
  })
})

describe('authorHandleLabel', () => {
  it('appends @handle after a display name, including same letters', () => {
    expect(authorHandleLabel({ name: 'NASA', handle: 'nasa' })).toBe('@nasa')
    expect(authorHandleLabel({ name: 'NASA', handle: '@NASA' })).toBe('@NASA')
    expect(authorHandleLabel({ name: 'nasa', handle: 'nasa' })).toBe('@nasa')
  })

  it('does not duplicate when the title is already @handle', () => {
    expect(authorHandleLabel({ name: '@nasa', handle: 'nasa' })).toBeUndefined()
    expect(authorHandleLabel({ name: 'NASA' })).toBeUndefined()
    expect(authorHandleLabel(undefined)).toBeUndefined()
  })

  it('keeps @handle beside a pubkey fallback with no display name', () => {
    expect(authorHandleLabel({ handle: 'nasa' })).toBe('@nasa')
  })
})

describe('hopDistance', () => {
  it('omits hop from the scan row so the quote is the next beat', () => {
    expect(hopDistance(0)).toBeNull()
    expect(hopDistance(1)).toBeNull()
    expect(hopDistance(2)).toBeNull()
    expect(hopDistance(3)).toBeNull()
  })
})

describe('uniqueStatementAuthors', () => {
  it('dedupes authors case-insensitively in first-seen order', () => {
    expect(
      uniqueStatementAuthors([
        statement({ eventId: '1', author: 'Alice', value: 1 }),
        statement({ eventId: '2', author: 'alice', value: -1 }),
        statement({ eventId: '3', author: 'Bob', value: 0 }),
      ]),
    ).toEqual(['Alice', 'Bob'])
  })
})

describe('sortAuthorsByName', () => {
  it('sorts by display name then handle', () => {
    expect(
      sortAuthorsByName(['bb', 'aa', 'cc'], {
        aa: { name: 'Zoe' },
        bb: { name: 'Ada' },
        cc: { handle: 'bob' },
      }),
    ).toEqual(['bb', 'cc', 'aa'])
  })
})

describe('matchesAuthorFilter', () => {
  it('matches name, handle, and X id', () => {
    const profile = {
      name: 'NASA',
      handle: 'nasa',
      twitterId: '11348282',
    }
    expect(matchesAuthorFilter('aa', profile, '')).toBe(true)
    expect(matchesAuthorFilter('aa', profile, 'nas')).toBe(true)
    expect(matchesAuthorFilter('aa', profile, '@NASA')).toBe(true)
    expect(matchesAuthorFilter('aa', profile, '11348')).toBe(true)
    expect(matchesAuthorFilter('aa', profile, 'elon')).toBe(false)
  })
})

describe('matchesPolarityFilter', () => {
  it('keeps only the selected 1 / 0 / -1 statement toward the subject', () => {
    expect(matchesPolarityFilter(1, null)).toBe(true)
    expect(matchesPolarityFilter(0, null)).toBe(true)
    expect(matchesPolarityFilter(-1, null)).toBe(true)
    expect(matchesPolarityFilter(1, 'trust')).toBe(true)
    expect(matchesPolarityFilter(0, 'trust')).toBe(false)
    expect(matchesPolarityFilter(-1, 'trust')).toBe(false)
    expect(matchesPolarityFilter(0, 'neutral')).toBe(true)
    expect(matchesPolarityFilter(1, 'neutral')).toBe(false)
    expect(matchesPolarityFilter(-1, 'distrust')).toBe(true)
    expect(matchesPolarityFilter(1, 'distrust')).toBe(false)
  })
})

describe('formatGreenTrustPercent', () => {
  it('rounds trust / (trust + distrust) for connected results', () => {
    expect(
      formatGreenTrustPercent({ connected: true, trust: 3, distrust: 1 }),
    ).toBe('75')
    expect(
      formatGreenTrustPercent({ connected: true, trust: 1, distrust: 0 }),
    ).toBe('100')
    expect(
      formatGreenTrustPercent({ connected: false, trust: 1, distrust: 0 }),
    ).toBeUndefined()
    expect(
      formatGreenTrustPercent({ connected: true, trust: 0, distrust: 0 }),
    ).toBeUndefined()
  })
})

describe('mergeAuthorDisplay', () => {
  it('fills a missing name and face from kind 0', () => {
    expect(
      mergeAuthorDisplay(
        { twitterId: '44196397', handle: 'elonmusk' },
        {
          name: 'Elon Musk',
          picture: 'https://example.com/elon.png',
        },
      ),
    ).toEqual({
      twitterId: '44196397',
      handle: 'elonmusk',
      name: 'Elon Musk',
      picture: 'https://example.com/elon.png',
    })
  })

  it('keeps X chrome when both sources have a name', () => {
    expect(
      mergeAuthorDisplay(
        { name: 'NASA', handle: 'NASA', twitterId: '11348282' },
        { name: 'National Aeronautics', picture: 'https://example.com/n.png' },
      ),
    ).toMatchObject({
      name: 'NASA',
      handle: 'NASA',
      twitterId: '11348282',
    })
  })
})

describe('xIdentityToAuthorDisplay', () => {
  it('copies X display chrome including verification and affiliation', () => {
    expect(
      xIdentityToAuthorDisplay({
        displayName: 'NASA',
        handle: 'NASA',
        twitterId: '11348282',
        verifiedType: 'government',
        affiliationBadgePath: 'profile_images/1/org',
        affiliationLabel: 'United States government',
      }),
    ).toEqual({
      name: 'NASA',
      handle: 'NASA',
      twitterId: '11348282',
      verifiedType: 'government',
      affiliationBadgePath: 'profile_images/1/org',
      affiliationLabel: 'United States government',
    })
  })
})

describe('profileDisplayFromMetadata', () => {
  it('prefers display_name and keeps http(s) pictures only', () => {
    expect(
      profileDisplayFromMetadata({
        display_name: 'Ada Lovelace',
        name: 'ada',
        picture: 'https://example.com/ada.png',
      }),
    ).toEqual({
      name: 'Ada Lovelace',
      picture: 'https://example.com/ada.png',
    })
    expect(
      profileDisplayFromMetadata({
        name: 'ada',
        picture: 'javascript:alert(1)',
      }),
    ).toEqual({ name: 'ada' })
    expect(
      profileDisplayFromMetadata({
        name: 'ada',
        picture: 'data:image/png;base64,AAAA',
      }),
    ).toEqual({ name: 'ada' })
    expect(profileDisplayFromMetadata(null)).toBeUndefined()
  })

  it('turns demo kind-0 chrome into a scannable name and face', () => {
    const profile = demoWotAuthorProfile(0)
    expect(
      profileDisplayFromMetadata({
        name: profile.name,
        display_name: profile.display_name,
        picture: profile.picture,
      }),
    ).toEqual({
      name: profile.display_name,
      picture: profile.picture,
    })
    expect(profile.picture.startsWith('https://')).toBe(true)
  })
})

describe('statementSubjectKind', () => {
  it('maps p/e/i subjects onto account vs post', () => {
    expect(statementSubjectKind(subject)).toBe('account')
    expect(
      statementSubjectKind({ type: 'i', value: 'post:id:42' }),
    ).toBe('post')
    expect(statementSubjectKind({ type: 'p', value: 'aa'.repeat(32) })).toBe(
      'account',
    )
    expect(statementSubjectKind({ type: 'e', value: 'evt' })).toBe('post')
  })
})

describe('labelProse', () => {
  it('uses label hints, then bare labels, as prose', () => {
    expect(
      labelProse(['reviewer', 'identity'], {
        reviewer: 'Trusted reviewer of aerospace accounts',
      }),
    ).toBe('Trusted reviewer of aerospace accounts · identity')
    expect(labelProse(['reviewer'], undefined)).toBe('reviewer')
    expect(
      labelProse(undefined, {
        reviewer: 'Trusted reviewer of aerospace accounts',
      }),
    ).toBe('Trusted reviewer of aerospace accounts')
  })
})

describe('star and name filters', () => {
  it('stacks a 3★ filter with name/handle search', () => {
    const profile = { name: 'Ada', handle: 'ada' }
    expect(matchesStarFilter(60, 3)).toBe(true)
    expect(matchesAuthorFilter('aa', profile, 'ada')).toBe(true)
    expect(matchesStarFilter(80, 3)).toBe(false)
    expect(matchesAuthorFilter('aa', profile, 'elon')).toBe(false)
  })
})

describe('statementContentLine', () => {
  it('returns trimmed content or null, never labels', () => {
    expect(statementContentLine('  hello  ')).toBe('hello')
    expect(statementContentLine('   ')).toBeNull()
    expect(statementContentLine(undefined)).toBeNull()
  })
})

describe('uniqueOutgoingTwitterIds', () => {
  it('keeps user:id targets and drops posts', () => {
    const author = 'aa'.repeat(32)
    expect(
      uniqueOutgoingTwitterIds([
        statement({
          eventId: 'a',
          author,
          value: 1,
          subject: { type: 'i', value: 'user:id:1' },
        }),
        statement({
          eventId: 'b',
          author,
          value: 0,
          subject: { type: 'i', value: 'user:id:1' },
        }),
        statement({
          eventId: 'c',
          author,
          value: -1,
          subject: { type: 'i', value: 'post:id:9' },
        }),
      ]),
    ).toEqual(['1'])
  })
})

describe('formatCompactCount', () => {
  it('keeps exact values below 1000 and caps remainder with +', () => {
    expect(formatCompactCount(0)).toBe('0')
    expect(formatCompactCount(1)).toBe('1')
    expect(formatCompactCount(100)).toBe('100')
    expect(formatCompactCount(999)).toBe('999')
    expect(formatCompactCount(1_000)).toBe('1k')
    expect(formatCompactCount(1_001)).toBe('1k+')
    expect(formatCompactCount(147_000)).toBe('147k')
    expect(formatCompactCount(147_001)).toBe('147k+')
    expect(formatCompactCount(1_000_000)).toBe('1m')
    expect(formatCompactCount(1_000_001)).toBe('1m+')
  })
})

describe('formatPolarityChipLabel', () => {
  it('omits a zero count and compact-formats nonzero counts', () => {
    expect(formatPolarityChipLabel('trust', 0, translate)).toBe('Trust')
    expect(formatPolarityChipLabel('neutral', 0, translate)).toBe('Neutral')
    expect(formatPolarityChipLabel('distrust', 0, translate)).toBe('Distrust')
    expect(formatPolarityChipLabel('trust', 47, translate)).toBe('Trust 47')
    expect(formatPolarityChipLabel('neutral', 1_000, translate)).toBe(
      'Neutral 1k',
    )
    expect(formatPolarityChipLabel('distrust', 1_001, translate)).toBe(
      'Distrust 1k+',
    )
  })
})

describe('polarityCounts', () => {
  it('counts name-filtered values without applying the polarity selection', () => {
    const rows = [
      { author: 'aa', value: 1 as const, name: 'Ada' },
      { author: 'bb', value: 1 as const, name: 'Ada Two' },
      { author: 'cc', value: 0 as const, name: 'Casey' },
      { author: 'dd', value: -1 as const, name: 'Dee' },
    ]
    const named = rows.filter((row) =>
      matchesAuthorFilter(row.author, { name: row.name }, 'ada'),
    )
    expect(polarityCounts(named.map((row) => row.value))).toEqual({
      trust: 2,
      neutral: 0,
      distrust: 0,
    })
    expect(
      named.filter((row) => matchesPolarityFilter(row.value, 'trust')),
    ).toHaveLength(2)
    expect(polarityCounts([])).toEqual({
      trust: 0,
      neutral: 0,
      distrust: 0,
    })
  })
})

describe('statement window', () => {
  it('shows 50, then a remaining partial batch', () => {
    const keys = Array.from({ length: 120 }, (_, i) => `k${i}`)
    expect(windowedItems(keys, STATEMENT_PAGE_SIZE)).toHaveLength(50)
    expect(windowedItems(keys, 100)).toHaveLength(100)
    expect(windowedItems(keys, 200)).toHaveLength(120)
    expect(nextLoadCount(50, 120)).toBe(50)
    expect(nextLoadCount(100, 120)).toBe(20)
    expect(nextLoadCount(120, 120)).toBe(0)
    expect(nextLoadCount(50, 12)).toBe(0)
  })
})

describe('formatLoadMoreLabel', () => {
  it('uses a compact known total, otherwise Load next', () => {
    expect(formatLoadMoreLabel(50, 147, translate)).toBe('Load next 50 of 147')
    expect(formatLoadMoreLabel(50, 147_000, translate)).toBe(
      'Load next 50 of 147k',
    )
    expect(formatLoadMoreLabel(47, 147, translate)).toBe('Load next 47 of 147')
    expect(formatLoadMoreLabel(50, undefined, translate)).toBe('Load next')
  })
})
