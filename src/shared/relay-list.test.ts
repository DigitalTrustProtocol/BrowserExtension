import { describe, expect, it } from 'vitest'
import { DEFAULT_RELAYS, RELAY_CATALOG } from './contracts'
import {
  activateRelay,
  deactivateRelay,
  forgetInactiveRelay,
  isCatalogRelay,
  listInactiveRelays,
} from './relay-list'

const catalog = ['wss://nos.lol', 'wss://relay.damus.io'] as const
const custom = 'ws://127.0.0.1:7777'

describe('listInactiveRelays', () => {
  it('lists custom off relays and omits the default catalog', () => {
    expect(
      listInactiveRelays(
        ['wss://nos.lol'],
        [custom, 'wss://relay.damus.io'],
        catalog,
      ),
    ).toEqual([custom])
    expect(listInactiveRelays(['wss://nos.lol'], [], catalog)).toEqual([])
  })
})

describe('forgetInactiveRelay', () => {
  it('drops a custom relay from the off list', () => {
    expect(forgetInactiveRelay([custom], custom)).toEqual([])
    expect(isCatalogRelay('wss://relay.damus.io', catalog)).toBe(true)
    expect(isCatalogRelay(custom, catalog)).toBe(false)
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
  it('includes the default relays so turning one off does not park it as inactive', () => {
    for (const url of DEFAULT_RELAYS) {
      expect(RELAY_CATALOG).toContain(url)
      expect(listInactiveRelays([], [url])).not.toContain(url)
    }
  })
})
