import { describe, expect, it } from 'vitest'
import { createInitialState, reducer } from './wizardMachine.ts'

describe('wizardMachine easy path', () => {
  it('SELECT easy moves to easy step', () => {
    const start = createInitialState({ skipLang: true })
    const next = reducer(start, { type: 'SELECT', payload: { method: 'easy' } })
    expect(next.step).toBe('easy')
    expect(next.ctx.method).toBe('easy')
  })

  it('easy CREATED goes to followSuggestions', () => {
    let state = createInitialState({ skipLang: true })
    state = reducer(state, { type: 'SELECT', payload: { method: 'easy' } })
    state = reducer(state, {
      type: 'CREATED',
      payload: { account: { id: '1', type: 'generated', pubkey: 'aa' } },
    })
    expect(state.step).toBe('followSuggestions')
  })

  it('easy NEED_RESTORE then RESTORED goes to done', () => {
    let state = createInitialState({ skipLang: true })
    state = reducer(state, { type: 'SELECT', payload: { method: 'easy' } })
    state = reducer(state, {
      type: 'NEED_RESTORE',
      payload: { account: { pubkey: 'aa'.repeat(32), type: 'generated' } },
    })
    expect(state.step).toBe('easyRestore')
    state = reducer(state, {
      type: 'RESTORED',
      payload: { account: { id: '1', type: 'generated', pubkey: 'aa'.repeat(32) } },
    })
    expect(state.step).toBe('done')
  })

  it('Advanced create path goes through advanced pane', () => {
    let state = createInitialState({ skipLang: true })
    state = reducer(state, { type: 'SELECT', payload: { method: 'advanced' } })
    expect(state.step).toBe('advanced')
    state = reducer(state, { type: 'SELECT', payload: { method: 'create' } })
    expect(state.step).toBe('create')
    state = reducer(state, {
      type: 'CREATED',
      payload: { account: { id: '1' }, mnemonic: 'alpha beta' },
    })
    expect(state.step).toBe('verify')
    state = reducer(state, { type: 'BACK' })
    // verify BACK → create; create BACK → advanced
    expect(state.step).toBe('create')
    state = reducer(state, { type: 'BACK' })
    expect(state.step).toBe('advanced')
  })
})
