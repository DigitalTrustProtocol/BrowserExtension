/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest'
import { identitiesByHandle } from '../scanner'
import { profileTargetForHandle } from './profile-target'
import {
  CONNECT_META_ATTR,
  USER_CHROME_ATTR,
  findUserCellSlot,
  isClickableSuggestionCell,
  isUserRailCell,
  resolveUserCellHandle,
  twitterIdFromFollowTestId,
  UserCellAugmentor,
} from './connect-people'

function buildUserCell(options: {
  handle: string
  displayName: string
  twitterId?: string
  bio?: string
  unfollow?: boolean
  sidebar?: boolean
}): HTMLElement {
  const cell = document.createElement('div')
  cell.dataset.testid = 'UserCell'
  const followTestId = options.twitterId
    ? `${options.twitterId}-${options.unfollow ? 'unfollow' : 'follow'}`
    : `${options.handle}-follow`
  const bio = options.bio
    ? `<div class="bio">${options.bio}</div>`
    : ''
  cell.innerHTML = `
    <div class="row">
      <div class="name">
        <a href="/${options.handle}">${options.displayName}</a>
        <a href="/${options.handle}">@${options.handle}</a>
        ${bio}
      </div>
      <div class="follow">
        <button data-testid="${followTestId}">${options.unfollow ? 'Following' : 'Follow'}</button>
      </div>
    </div>
  `
  if (options.sidebar) {
    const aside = document.createElement('div')
    aside.dataset.testid = 'sidebarColumn'
    aside.append(cell)
    document.body.append(aside)
    return cell
  }
  document.body.append(cell)
  return cell
}

afterEach(() => {
  document.body.innerHTML = ''
  identitiesByHandle.clear()
})

describe('twitterIdFromFollowTestId', () => {
  it('parses numeric follow and unfollow testids', () => {
    expect(twitterIdFromFollowTestId('1437424567962804231-follow')).toBe(
      '1437424567962804231',
    )
    expect(twitterIdFromFollowTestId('2260407860-unfollow')).toBe('2260407860')
  })

  it('parses numeric subscribe and unsubscribe testids', () => {
    expect(twitterIdFromFollowTestId('1369570257384345607-subscribe')).toBe(
      '1369570257384345607',
    )
    expect(twitterIdFromFollowTestId('795846-unsubscribe')).toBe('795846')
  })

  it('rejects handle-shaped follow testids', () => {
    expect(twitterIdFromFollowTestId('alice-follow')).toBeUndefined()
  })
})

describe('resolveUserCellHandle', () => {
  it('reads the profile handle from cell links', () => {
    const cell = buildUserCell({ handle: 'alice', displayName: 'Alice' })
    expect(resolveUserCellHandle(cell)).toBe('alice')
  })
})

describe('findUserCellSlot', () => {
  it('locates the name and follow columns inside a UserCell', () => {
    const cell = buildUserCell({ handle: 'bob', displayName: 'Bob' })

    const slot = findUserCellSlot(cell)
    expect(slot).toBeDefined()
    expect(slot?.handle).toBe('bob')
    expect(slot?.nameColumn.textContent).toContain('Bob')
    expect(slot?.followColumn.querySelector('[data-testid="bob-follow"]')).toBeTruthy()
  })

  it('reads twitterId from a numeric follow testid', () => {
    const cell = buildUserCell({
      handle: 'alby',
      displayName: 'Alby',
      twitterId: '1437424567962804231',
    })
    expect(findUserCellSlot(cell)?.twitterId).toBe('1437424567962804231')
  })

  it('locates creator Connect People rows that use Subscribe', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'UserCell'
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/creator">Creator</a>
          <a href="/creator">@creator</a>
          <div class="bio">Makes videos.</div>
        </div>
        <div class="follow">
          <button data-testid="1369570257384345607-subscribe">Subscribe</button>
        </div>
      </div>
    `
    document.body.append(cell)
    const slot = findUserCellSlot(cell)
    expect(slot?.twitterId).toBe('1369570257384345607')
    expect(slot?.handle).toBe('creator')
    expect(isUserRailCell(cell, slot!)).toBe(false)
  })

  it('treats button-hosted Connect People rows with bio as UserRow', () => {
    const cell = document.createElement('button')
    cell.dataset.testid = 'UserCell'
    cell.setAttribute('aria-label', 'Click to Follow boscolochris')
    cell.setAttribute('role', 'button')
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/boscolochris">chrisb (boscolo.eth)</a>
          <a href="/boscolochris">@boscolochris</a>
          <div class="bio">Currently building bitcoin tools.</div>
        </div>
        <div class="follow">
          <span data-testid="237634557-follow">Follow</span>
        </div>
      </div>
    `
    document.body.append(cell)
    const slot = findUserCellSlot(cell)
    expect(isClickableSuggestionCell(cell)).toBe(true)
    expect(isUserRailCell(cell, slot!)).toBe(false)
  })

  it('locates button-hosted You might like cells', () => {
    const cell = document.createElement('button')
    cell.dataset.testid = 'UserCell'
    cell.setAttribute('aria-label', 'Click to Follow blacksquad_22')
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/blacksquad_22">Black Squad</a>
          <a href="/blacksquad_22">@blacksquad_22</a>
        </div>
        <div class="follow">
          <span data-testid="1508083414510956549-follow">Follow</span>
        </div>
      </div>
    `
    document.body.append(cell)
    const slot = findUserCellSlot(cell)
    expect(slot?.handle).toBe('blacksquad_22')
    expect(slot?.twitterId).toBe('1508083414510956549')
    expect(isClickableSuggestionCell(cell)).toBe(true)
    expect(isUserRailCell(cell, slot!)).toBe(true)
  })
})

describe('isUserRailCell', () => {
  it('treats sidebar Who to follow cells as rail', () => {
    const cell = buildUserCell({
      handle: 'getAlby',
      displayName: 'Alby',
      twitterId: '1437424567962804231',
      sidebar: true,
    })
    const slot = findUserCellSlot(cell)
    expect(slot).toBeDefined()
    expect(isUserRailCell(cell, slot!)).toBe(true)
  })

  it('treats name+handle suggestion cards as rail', () => {
    const cell = buildUserCell({
      handle: 'getAlby',
      displayName: 'Alby',
      twitterId: '1437424567962804231',
    })
    const slot = findUserCellSlot(cell)
    expect(isUserRailCell(cell, slot!)).toBe(true)
  })

  it('treats list rows with bio as UserRow', () => {
    const cell = buildUserCell({
      handle: 'BitcoinErrorLog',
      displayName: 'John Carvalho',
      twitterId: '2260407860',
      unfollow: true,
      bio: 'Building the Atomic Economy at synonym_to.',
    })
    const slot = findUserCellSlot(cell)
    expect(isUserRailCell(cell, slot!)).toBe(false)
  })

  it('treats bio below the name/Follow row as UserRow', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'UserCell'
    cell.innerHTML = `
      <div>
        <div class="row">
          <div class="name">
            <a href="/Bitcoin">Bitcoin</a>
            <a href="/Bitcoin">@Bitcoin</a>
          </div>
          <div class="follow">
            <button data-testid="1-follow">Follow</button>
          </div>
        </div>
        <div class="bio">Bitcoin is an open source censorship-resistant peer-to-peer network.</div>
      </div>
    `
    document.body.append(cell)
    const slot = findUserCellSlot(cell)
    expect(slot).toBeDefined()
    expect(isUserRailCell(cell, slot!)).toBe(false)
  })
})

describe('UserCellAugmentor', () => {
  it('mounts UserRail without a chip on a Who to follow cell', () => {
    const cell = buildUserCell({
      handle: 'getAlby',
      displayName: 'Alby',
      twitterId: '1437424567962804231',
      sidebar: true,
    })
    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('rail')
    expect(cell.querySelector('[data-attentionx-chip]')).toBeNull()
    expect(
      cell.querySelector(`[${CONNECT_META_ATTR}] [data-attentionx-score]`),
    ).toBeTruthy()

    augmentor.stop()
  })

  it('mounts UserRow chip on a wide list cell', () => {
    const cell = buildUserCell({
      handle: 'BitcoinErrorLog',
      displayName: 'John Carvalho',
      twitterId: '2260407860',
      bio: 'Building the Atomic Economy at synonym_to.',
    })
    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('row')
    expect(cell.querySelector('[data-attentionx-chip]')).toBeTruthy()
    expect(cell.querySelector('[data-attentionx-score]')).toBeTruthy()

    augmentor.stop()
  })

  it('records Who to follow twitterId so hover can trust unknown users', () => {
    const cell = buildUserCell({
      handle: 'newbie',
      displayName: 'Newbie',
      twitterId: '424242',
      sidebar: true,
    })
    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('rail')
    expect(identitiesByHandle.get('newbie')?.twitterId).toBe('424242')
    expect(profileTargetForHandle('newbie').twitterId).toBe('424242')

    augmentor.stop()
  })

  it('places UserRail degree after verified icons on the name line', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'UserCell'
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/NASA">
            <div class="name-line">
              <div class="name-text"><span><span>NASA</span></span></div>
              <div class="badge">
                <svg data-testid="icon-verified" aria-label="Verified account"></svg>
              </div>
            </div>
          </a>
          <a href="/NASA">@NASA</a>
        </div>
        <div class="follow">
          <button data-testid="11348282-follow">Follow</button>
        </div>
      </div>
    `
    const aside = document.createElement('div')
    aside.dataset.testid = 'sidebarColumn'
    aside.append(cell)
    document.body.append(aside)

    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    const line = cell.querySelector('.name-line')
    const kids = [...(line?.children ?? [])]
    expect(kids[0]?.className).toBe('name-text')
    expect(kids[1]?.className).toBe('badge')
    expect(kids[2]?.hasAttribute(CONNECT_META_ATTR)).toBe(true)
    expect(kids[2]?.querySelector('[data-attentionx-score]')).toBeTruthy()
    expect(cell.querySelector('[data-attentionx-chip]')).toBeNull()

    augmentor.stop()
  })

  it('places UserRow score and chip after verified icons on the name line', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'UserCell'
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/NASA">
            <div class="name-line">
              <div class="name-text"><span><span>NASA</span></span></div>
              <div class="badge">
                <svg data-testid="icon-verified" aria-label="Verified account"></svg>
              </div>
            </div>
          </a>
          <a href="/NASA">@NASA</a>
          <div class="bio">Official NASA account.</div>
        </div>
        <div class="follow">
          <button data-testid="11348282-follow">Follow</button>
        </div>
      </div>
    `
    document.body.append(cell)

    const augmentor = new UserCellAugmentor()
    augmentor.start({
      chip: true,
      ambient: true,
      detailText: true,
      detailDegree: true,
    })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('row')
    const line = cell.querySelector('.name-line')
    const kids = [...(line?.children ?? [])]
    expect(kids[0]?.className).toBe('name-text')
    expect(kids[1]?.className).toBe('badge')
    expect(kids[2]?.hasAttribute(CONNECT_META_ATTR)).toBe(true)
    expect(kids[2]?.querySelector('[data-attentionx-score]')).toBeTruthy()
    expect(kids[2]?.querySelector('[data-attentionx-chip]')).toBeTruthy()

    augmentor.stop()
  })

  it('mounts UserRow on a creator Connect People Subscribe cell', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'UserCell'
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/creator">Creator</a>
          <a href="/creator">@creator</a>
          <div class="bio">Makes videos.</div>
        </div>
        <div class="follow">
          <button data-testid="1369570257384345607-subscribe">Subscribe</button>
        </div>
      </div>
    `
    document.body.append(cell)

    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('row')
    expect(cell.querySelector('[data-attentionx-chip]')).toBeTruthy()
    expect(cell.querySelector('[data-attentionx-score]')).toBeTruthy()
    expect(identitiesByHandle.get('creator')?.twitterId).toBe(
      '1369570257384345607',
    )

    augmentor.stop()
  })

  it('mounts UserRail on a button-hosted You might like cell', () => {
    const cell = document.createElement('button')
    cell.dataset.testid = 'UserCell'
    cell.setAttribute('aria-label', 'Click to Follow blacksquad_22')
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/blacksquad_22"><span><span>Black Squad</span></span></a>
          <a href="/blacksquad_22">@blacksquad_22</a>
        </div>
        <div class="follow">
          <span data-testid="1508083414510956549-follow">Follow</span>
        </div>
      </div>
    `
    document.body.append(cell)

    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('rail')
    expect(cell.querySelector('[data-attentionx-chip]')).toBeNull()
    expect(cell.querySelector('[data-attentionx-score]')).toBeTruthy()

    augmentor.stop()
  })

  it('mounts UserRow chip on a button-hosted Connect People cell with bio', () => {
    const cell = document.createElement('button')
    cell.dataset.testid = 'UserCell'
    cell.setAttribute('role', 'button')
    cell.setAttribute('aria-label', 'Click to Follow boscolochris')
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/boscolochris"><span><span>chrisb</span></span></a>
          <a href="/boscolochris">@boscolochris</a>
          <div class="bio">Currently building bitcoin tools.</div>
        </div>
        <div class="follow">
          <span data-testid="237634557-follow">Follow</span>
        </div>
      </div>
    `
    document.body.append(cell)

    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('row')
    expect(cell.querySelector('[data-attentionx-chip]')).toBeTruthy()
    expect(cell.querySelector('[data-attentionx-score]')).toBeTruthy()

    augmentor.stop()
  })

  it('mounts chrome after a late Follow testid', () => {
    const cell = document.createElement('div')
    cell.dataset.testid = 'UserCell'
    cell.innerHTML = `
      <div class="row">
        <div class="name">
          <a href="/late">Late</a>
          <a href="/late">@late</a>
        </div>
        <div class="follow"></div>
      </div>
    `
    document.body.append(cell)

    const augmentor = new UserCellAugmentor()
    augmentor.start({ chip: true, ambient: true, detailDegree: true })
    expect(cell.getAttribute(USER_CHROME_ATTR)).toBeNull()

    const follow = document.createElement('span')
    follow.dataset.testid = '424242-follow'
    follow.textContent = 'Follow'
    cell.querySelector('.follow')?.append(follow)
    augmentor.sync()

    expect(cell.getAttribute(USER_CHROME_ATTR)).toBe('rail')

    augmentor.stop()
  })
})
