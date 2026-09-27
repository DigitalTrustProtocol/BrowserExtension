import { describe, expect, it } from 'vitest'
import { DEFAULT_RELAYS, RELAY_CATALOG } from './contracts'
import {
  activateRelay,
  deactivateRelay,
  forgetInactiveRelay,
  listInactiveRelays,
  rememberRelay,
  restoreCatalogRelays,
} from './relay-list'

const catalog = ['wss://nos.lol', 'wss://relay.damus.io'] as const
const custom = 'ws://127.0.0.1:7777'

describe('listInactiveRelays', () => {
  it('lists catalog relays that are not active, then custom off relays', () => {
    expect(listInactiveRelays(['wss://nos.lol'], [custom], catalog)).toEqual([
      'wss://relay.damus.io',
      custom,
    ])
  })
})

describe('forgetInactiveRelay', () => {
  it('hides a catalog relay and drops a custom relay from the off list', () => {
    const forgotten = forgetInactiveRelay([custom], [], 'wss://relay.damus.io')
    expect(forgotten).toEqual({
      storedInactive: [custom],
      dismissed: ['wss://relay.damus.io'],
    })
    expect(
      listInactiveRelays(['wss://nos.lol'], forgotten.storedInactive, catalog, forgotten.dismissed),
    ).toEqual([custom])
    const customGone = forgetInactiveRelay(forgotten.storedInactive, forgotten.dismissed, custom)
    expect(customGone.storedInactive).toEqual([])
    expect(
      listInactiveRelays(['wss://nos.lol'], customGone.storedInactive, catalog, customGone.dismissed),
    ).toEqual([])
    expect(rememberRelay(customGone.dismissed, 'wss://relay.damus.io')).toEqual([custom])
  })
})

describe('restoreCatalogRelays', () => {
  it('puts missing catalog relays back and leaves active and custom relays', () => {
    const active = ['wss://nos.lol']
    const dismissed = ['wss://relay.damus.io', custom, 'wss://nos.lol']
    const restored = restoreCatalogRelays(active, dismissed, catalog)
    expect(restored).toEqual([custom, 'wss://nos.lol'])
    expect(active).toEqual(['wss://nos.lol'])
    expect(
      listInactiveRelays(active, [], catalog, restored),
    ).toEqual(['wss://relay.damus.io'])
  })
})

describe('activateRelay', () => {
  it('prepends a relay and drops it from the off list', () => {
    expect(activateRelay(['wss://nos.lol'], [custom], custom)).toEqual({
      active: [custom, 'wss://nos.lol'],
      storedInactive: [],
    })
  })
})

describe('deactivateRelay', () => {
  it('stores a custom relay and leaves a catalog relay unstored', () => {
    expect(
      deactivateRelay(['wss://nos.lol', custom], [], custom, catalog),
    ).toEqual({
      active: ['wss://nos.lol'],
      storedInactive: [custom],
    })
    expect(
      deactivateRelay(
        ['wss://nos.lol', 'wss://relay.damus.io'],
        [],
        'wss://relay.damus.io',
        catalog,
      ),
    ).toEqual({
      active: ['wss://nos.lol'],
      storedInactive: [],
    })
  })
})

describe('RELAY_CATALOG', () => {
  it('keeps the default relays so turning one off does not drop it', () => {
    for (const url of DEFAULT_RELAYS) {
      expect(RELAY_CATALOG).toContain(url)
    }
  })
})
