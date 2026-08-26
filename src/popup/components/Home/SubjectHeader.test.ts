import { describe, expect, it } from 'vitest'
import {
  avatarFallbackLetter,
  formatAtHandle,
  formatPostAuthorName,
  formatPostSubjectHeader,
  formatUserSubjectHeader,
  nameTrustTone,
  postRoleLabel,
  subjectAvatarUrl,
  subjectHeaderKind,
  subjectHeroPictureUrl,
  unidentifiedAccountHeader,
  unboundPubkeyHeader,
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

describe('subjectAvatarUrl', () => {
  it('builds a 400x400 profile URL the way X does on a profile page', () => {
    expect(subjectAvatarUrl('profile_images/11348282/nasa')).toBe(
      'https://pbs.twimg.com/profile_images/11348282/nasa_400x400.jpg',
    )
    expect(
      subjectAvatarUrl(
        'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_normal.png',
      ),
    ).toBe(
      'https://pbs.twimg.com/profile_images/1337607516008501250/6Ggc4S5n_400x400.png',
    )
  })

  it('omits banners and empty chrome', () => {
    expect(subjectAvatarUrl('profile_banners/44196397/1774145451')).toBeUndefined()
    expect(subjectAvatarUrl(undefined)).toBeUndefined()
    expect(subjectAvatarUrl('')).toBeUndefined()
  })
})

describe('nameTrustTone', () => {
  it('maps resolutions onto timeline underline tones', () => {
    expect(nameTrustTone('trusted')).toBe('trust')
    expect(nameTrustTone('mixed')).toBe('question')
    expect(nameTrustTone('distrusted')).toBe('misleading')
    expect(nameTrustTone('none')).toBeUndefined()
    expect(nameTrustTone(undefined)).toBeUndefined()
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

describe('formatPostAuthorName', () => {
  it('prefers display name, then @handle', () => {
    expect(
      formatPostAuthorName({ displayName: 'NASA', handle: 'nasa' }),
    ).toBe('NASA')
    expect(formatPostAuthorName({ handle: 'nasa' })).toBe('@nasa')
    expect(formatPostAuthorName({})).toBeUndefined()
  })
})

describe('formatPostSubjectHeader', () => {
  it('leads with headline, then a smaller author name, then @handle', () => {
    expect(
      formatPostSubjectHeader({
        postId: '2080659774136291424',
        headline: 'We are go for launch',
        displayName: 'NASA',
        authorHandle: 'nasa',
        postNoun: 'Post',
        handleAndRole: '{handle} · {role}',
      }),
    ).toEqual({
      title: 'We are go for launch',
      authorName: 'NASA',
      subtitle: '@nasa',
    })
  })

  it('uses @handle as the author name when display name is missing', () => {
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
      authorName: '@nasa',
      subtitle: '',
    })
  })

  it('adds a non-root role beside the author handle when the name is shown', () => {
    expect(
      formatPostSubjectHeader({
        postId: '2080659774136291424',
        headline: 'We are go for launch',
        displayName: 'NASA',
        authorHandle: 'nasa',
        roleLabel: 'Reply',
        postNoun: 'Post',
        handleAndRole: '{handle} · {role}',
      }),
    ).toEqual({
      title: 'We are go for launch',
      authorName: 'NASA',
      subtitle: '@nasa · Reply',
    })
  })

  it('keeps a role under @handle when there is no display name', () => {
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
      authorName: '@nasa',
      subtitle: 'Reply',
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
      authorName: '',
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
      authorName: '@nasa',
      subtitle: '',
    })
  })
})

describe('unidentified subject headers', () => {
  it('uses Unknown copy and an i/user profile link when an X id has no chrome', () => {
    expect(
      unidentifiedAccountHeader('11348282', {
        unknownUser: 'Unknown',
        notIdentifiedYet: 'Trusted, but this X profile is not identified yet.',
      }),
    ).toEqual({
      title: 'Unknown',
      subtitle: '11348282',
      hint: 'Trusted, but this X profile is not identified yet.',
      profileHref: 'https://x.com/i/user/11348282',
    })
  })

  it('uses external-trusted copy and no X profile link for an unbound pubkey', () => {
    expect(
      unboundPubkeyHeader('npub1abc', {
        externalTrusted: 'An external trusted user, X profile not identified.',
        notIdentifiedYet: 'Trusted, but this X profile is not identified yet.',
      }),
    ).toEqual({
      title: 'An external trusted user, X profile not identified.',
      subtitle: 'npub1abc',
      hint: 'Trusted, but this X profile is not identified yet.',
      profileHref: undefined,
    })
  })
})
