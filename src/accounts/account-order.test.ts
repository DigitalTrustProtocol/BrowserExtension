import { describe, expect, it } from 'vitest'
import { sortAccountsByGeneration } from './account-order.ts'

describe('sortAccountsByGeneration', () => {
  it('puts earlier createdAt first', () => {
    const sorted = sortAccountsByGeneration([
      { id: 'b', name: 'Nostr Key 2', createdAt: 20 },
      { id: 'a', name: 'Nostr Key 1', createdAt: 10 },
    ])
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('uses HD index when createdAt ties', () => {
    const sorted = sortAccountsByGeneration([
      { id: 'b', name: 'Later', createdAt: 5, derivationIndex: 1 },
      { id: 'a', name: 'First', createdAt: 5, derivationIndex: 0 },
    ])
    expect(sorted.map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('puts factory and renamed Key N titles in sequence before timestamps', () => {
    const sorted = sortAccountsByGeneration([
      { id: 'b', name: 'Derivative key 2', createdAt: 1 },
      { id: 'a', name: 'Main Key 1', createdAt: 99 },
    ])
    expect(sorted.map((row) => row.name)).toEqual([
      'Main Key 1',
      'Derivative key 2',
    ])
  })

  it('keeps original order when generation fields are absent', () => {
    const sorted = sortAccountsByGeneration([
      { id: 'work', name: 'Work' },
      { id: 'home', name: 'Home' },
    ])
    expect(sorted.map((row) => row.id)).toEqual(['work', 'home'])
  })
})
