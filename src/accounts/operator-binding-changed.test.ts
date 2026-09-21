import { afterEach, describe, expect, it } from 'vitest'
import {
  notifyOperatorBindingChanged,
  resetOperatorBindingChangedListenerForTests,
  setOperatorBindingChangedListener,
} from './operator-binding-changed.ts'

afterEach(() => {
  resetOperatorBindingChangedListenerForTests()
})

describe('operator-binding-changed', () => {
  it('invokes the registered listener', async () => {
    const seen: string[] = []
    setOperatorBindingChangedListener(async (twitterId) => {
      seen.push(twitterId)
    })
    await notifyOperatorBindingChanged('42')
    expect(seen).toEqual(['42'])
    resetOperatorBindingChangedListenerForTests()
    await notifyOperatorBindingChanged('99')
    expect(seen).toEqual(['42'])
  })

  it('swallows listener errors so bind still succeeds', async () => {
    setOperatorBindingChangedListener(async () => {
      throw new Error('refresh failed')
    })
    await expect(notifyOperatorBindingChanged('1')).resolves.toBeUndefined()
  })
})
