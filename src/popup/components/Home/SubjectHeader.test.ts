import { describe, expect, it } from 'vitest'
import {
  avatarFallbackLetter,
  formatAtHandle,
  formatPostSubjectHeader,
  formatUserSubjectHeader,
  postRoleLabel,
  subjectHeaderKind,
  subjectHeroPictureUrl,
} from './subjectHeaderFormat'

describe('subjectHeaderKind', () => {
  it('classifies canonical X subjects', () => {
    expect(subjectHeaderKind('user:id:11348282')).toBe('account')
    expect(subjectHeaderKind('post:id:2080659774136291424')).toBe('post')
    expect(subjectHeaderKind('npub1abc')).toBe('unknown')
    expect(subjectHeaderKind('i:user:id:11348282')).toBe('unknown')
  })
})

describe('formatAtHandle', () => {
  it('normalizes handles with a single leading @', () => {
    expect(formatAtHandle('nasa')).toBe('@nasa')
    expect(formatAtHandle('@nasa')).toBe('@nasa')
    expect(formatAtHandle('  @@nasa  ')).toBe('@nasa')
    expect(formatAtHandle('')).toBeUndefined()
    expect(formatAtHandle(undefined)).toBeUndefined()
  })
})

describe('subjectHeroPictureUrl', () => {
  it('builds a 1500x500 cover URL from bannerPath, never from iconPath', () => {
    expect(
      subjectHeroPictureUrl('profile_banners/44196397/1774145451'),
    ).toBe(
      'https://pbs.twimg.com/profile_banners/44196397/1774145451/1500x500',
    )
    expect(
      subjectHeroPictureUrl('profile_images/11348282/nasa'),
    ).toBeUndefined()
  })

  it('omits empty chrome', () => {
    expect(subjectHeroPictureUrl(undefined)).toBeUndefined()
    expect(subjectHeroPictureUrl('')).toBeUndefined()
    expect(subjectHeroPictureUrl('   ')).toBeUndefined()
  })
})

describe('avatarFallbackLetter', () => {
  it('uses the first letter or digit, skipping @', () => {
    expect(avatarFallbackLetter('NASA')).toBe('N')
    expect(avatarFallbackLetter('@nasa')).toBe('N')
    expect(avatarFallbackLetter('11348282')).toBe('1')
    expect(avatarFallbackLetter('User')).toBe('U')
    expect(avatarFallbackLetter('')).toBe('')
  })
})

describe('formatUserSubjectHeader', () => {
  it('leads with display name and @handle', () => {
    expect(
      formatUserSubjectHeader({
        twitterId: '11348282',
        displayName: 'NASA',
        handle: 'nasa',
        userNoun: 'User',
      }),
    ).toEqual({ title: 'NASA', subtitle: '@nasa' })
  })

  it('uses @handle when the display name is missing', () => {
    expect(
      formatUserSubjectHeader({
        twitterId: '11348282',
        handle: 'nasa',
        userNoun: 'User',
      }),
    ).toEqual({ title: '@nasa', subtitle: '' })
  })

  it('falls back to User plus the numeric id, never a protocol subject', () => {
    const lines = formatUserSubjectHeader({
      twitterId: '11348282',
      userNoun: 'User',
    })
    expect(lines).toEqual({ title: 'User', subtitle: '11348282' })
    expect(lines.title).not.toMatch(/user:id:/)
    expect(lines.subtitle).not.toMatch(/user:id:/)
    expect(`${lines.title} ${lines.subtitle}`).not.toContain('i:user:id:')
  })
})

describe('postRoleLabel', () => {
  const labels = { reply: 'Reply', quote: 'Quote', repost: 'Repost' }

  it('omits root and unknown-empty, labels the rest', () => {
    expect(postRoleLabel(undefined, labels)).toBeUndefined()
    expect(postRoleLabel('root', labels)).toBeUndefined()
    expect(postRoleLabel('reply', labels)).toBe('Reply')
    expect(postRoleLabel('quote', labels)).toBe('Quote')
    expect(postRoleLabel('repost', labels)).toBe('Repost')
  })
})

describe('formatPostSubjectHeader', () => {
  it('leads with headline and @authorHandle', () => {
    expect(
      formatPostSubjectHeader({
        postId: '2080659774136291424',
        headline: 'We are go for launch',
        authorHandle: 'nasa',
        postNoun: 'Post',
        handleAndRole: '{handle} · {role}',
      }),
    ).toEqual({
      title: 'We are go for launch',
      subtitle: '@nasa',
    })
  })

  it('adds a non-root role beside the author handle', () => {
    expect(
      formatPostSubjectHeader({
        postId: '2080659774136291424',
        headline: 'We are go for launch',
        authorHandle: 'nasa',
        roleLabel: 'Reply',
        postNoun: 'Post',
        handleAndRole: '{handle} · {role}',
      }),
    ).toEqual({
      title: 'We are go for launch',
      subtitle: '@nasa · Reply',
    })
  })

  it('falls back to Post plus the numeric id, never a protocol subject', () => {
    const lines = formatPostSubjectHeader({
      postId: '2080659774136291424',
      postNoun: 'Post',
      handleAndRole: '{handle} · {role}',
    })
    expect(lines).toEqual({
      title: 'Post',
      subtitle: '2080659774136291424',
    })
    expect(lines.title).not.toMatch(/post:id:/)
    expect(lines.subtitle).not.toMatch(/post:id:/)
    expect(`${lines.title} ${lines.subtitle}`).not.toContain('i:post:id:')
  })

  it('keeps Post as the title when only author chrome exists', () => {
    expect(
      formatPostSubjectHeader({
        postId: '2080659774136291424',
        authorHandle: 'nasa',
        postNoun: 'Post',
        handleAndRole: '{handle} · {role}',
      }),
    ).toEqual({
      title: 'Post',
      subtitle: '@nasa',
    })
  })
})
