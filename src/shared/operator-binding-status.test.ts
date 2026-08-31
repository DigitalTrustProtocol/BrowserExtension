import { describe, expect, it } from 'vitest'
import {
  compareKind0ToX,
  liveSetupIssues,
  missingBindingIssues,
  npubsEqual,
  resolveOperatorBindingCompleteness,
} from './operator-binding-status.ts'

const NPUB_A =
  'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq5s8x3'
const NPUB_B =
  'npub1llllllllllllllllllllllllllllllllllllllllllllllllllllm2dx7h'

describe('npubsEqual', () => {
  it('matches case-insensitively and rejects mixed values', () => {
    expect(npubsEqual(NPUB_A.toUpperCase(), NPUB_A)).toBe(true)
    expect(npubsEqual(NPUB_A, NPUB_B)).toBe(false)
    expect(npubsEqual('hexkey', NPUB_A)).toBe(false)
  })
})

describe('compareKind0ToX', () => {
  it('reports missing, mismatch, and match', () => {
    expect(compareKind0ToX(null, { name: 'NASA' })).toBe('missing')
    expect(
      compareKind0ToX({ name: 'Other' }, { name: 'NASA' }),
    ).toBe('mismatch')
    expect(
      compareKind0ToX({ name: 'NASA', nip05: 'a@b.c' }, { name: 'NASA' }),
    ).toBe('match')
  })
})

describe('resolveOperatorBindingCompleteness', () => {
  it('is incomplete when unbound', () => {
    const status = resolveOperatorBindingCompleteness({
      bound: false,
      kind0Compare: 'match',
      boundNpub: NPUB_A,
      xNpub: NPUB_A,
      nip39Npub: NPUB_A,
    })
    expect(status.complete).toBe(false)
    expect(missingBindingIssues(status)).toEqual(['unbound'])
  })

  it('requires bio, kind 0, and 10011 against the bound npub', () => {
    const partial = resolveOperatorBindingCompleteness({
      bound: true,
      boundNpub: NPUB_A,
      xNpub: NPUB_B,
      nip39Npub: undefined,
      kind0Compare: 'missing',
    })
    expect(partial.bioOk).toBe(false)
    expect(partial.bioMismatch).toBe(true)
    expect(partial.kind0Ok).toBe(false)
    expect(partial.nip39Ok).toBe(false)
    expect(missingBindingIssues(partial)).toEqual(['backup', 'bio', 'kind0', 'nip39'])

    const complete = resolveOperatorBindingCompleteness({
      bound: true,
      boundNpub: NPUB_A,
      xNpub: NPUB_A,
      nip39Npub: NPUB_A,
      kind0Compare: 'match',
      backupOk: true,
    })
    expect(complete.complete).toBe(true)
    expect(complete.backupOk).toBe(true)
    expect(missingBindingIssues(complete)).toEqual([])
  })

  it('treats a matching current 10011 claim as nip39 ok', () => {
    const status = resolveOperatorBindingCompleteness({
      bound: true,
      boundNpub: NPUB_A,
      xNpub: NPUB_A,
      kind0Compare: 'match',
      current10011ClaimsTwitterId: true,
      backupOk: true,
    })
    expect(status.nip39Ok).toBe(true)
    expect(status.complete).toBe(true)
  })

  it('clears live-setup warnings without kind 0', () => {
    const status = resolveOperatorBindingCompleteness({
      bound: true,
      boundNpub: NPUB_A,
      xNpub: NPUB_A,
      nip39Npub: NPUB_A,
      kind0Compare: 'missing',
      backupOk: true,
    })
    expect(status.complete).toBe(true)
    expect(liveSetupIssues(status)).toEqual([])
    expect(missingBindingIssues(status)).toEqual(['kind0'])
  })
})
