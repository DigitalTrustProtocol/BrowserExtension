import { describe, expect, it } from 'vitest'
import { impersonateControlState } from './impersonateControl'

const ELON = '44196397'
const OPERATOR = '11348282'

describe('impersonateControlState', () => {
  it('shows Impersonate on a demo User panel that is not the signed-in X', () => {
    expect(
      impersonateControlState({
        demoMode: true,
        panelKind: 'user',
        subjectTwitterId: ELON,
        operatorTwitterId: OPERATOR,
        impersonating: false,
      }),
    ).toBe('impersonate')
  })

  it('hides Impersonate on the signed-in X', () => {
    expect(
      impersonateControlState({
        demoMode: true,
        panelKind: 'user',
        subjectTwitterId: OPERATOR,
        operatorTwitterId: OPERATOR,
        impersonating: false,
      }),
    ).toBe('hidden')
  })

  it('hides Impersonate on Post panel while idle', () => {
    expect(
      impersonateControlState({
        demoMode: true,
        panelKind: 'post',
        subjectTwitterId: ELON,
        operatorTwitterId: OPERATOR,
        impersonating: false,
      }),
    ).toBe('hidden')
  })

  it('hides Impersonate on a pubkey User panel with no twitterId', () => {
    expect(
      impersonateControlState({
        demoMode: true,
        panelKind: 'user',
        subjectTwitterId: null,
        operatorTwitterId: OPERATOR,
        impersonating: false,
      }),
    ).toBe('hidden')
  })

  it('hides Impersonate in live mode while idle', () => {
    expect(
      impersonateControlState({
        demoMode: false,
        panelKind: 'user',
        subjectTwitterId: ELON,
        operatorTwitterId: OPERATOR,
        impersonating: false,
      }),
    ).toBe('hidden')
  })

  it('shows Revert on User and Post while impersonating, including live', () => {
    expect(
      impersonateControlState({
        demoMode: true,
        panelKind: 'user',
        subjectTwitterId: ELON,
        operatorTwitterId: OPERATOR,
        impersonating: true,
      }),
    ).toBe('revert')
    expect(
      impersonateControlState({
        demoMode: true,
        panelKind: 'post',
        subjectTwitterId: null,
        operatorTwitterId: OPERATOR,
        impersonating: true,
      }),
    ).toBe('revert')
    expect(
      impersonateControlState({
        demoMode: false,
        panelKind: 'user',
        subjectTwitterId: ELON,
        operatorTwitterId: OPERATOR,
        impersonating: true,
      }),
    ).toBe('revert')
  })
})
