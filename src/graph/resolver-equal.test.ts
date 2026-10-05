/**
 * Extension IndexResolver is the oracle for TrustGraph/corpus/resolver/equal.json.
 * RESOLVER_CORPUS_WRITE=1 rewrites the file from this resolver.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolverEqualCases } from './resolver-equal-cases'
import { materializeCorpus, type ResolverCorpus } from './resolver-equal'

export const resolverCorpusPath = resolve(
  process.cwd(),
  '../TrustGraph/corpus/resolver/equal.json',
)

describe('resolver equality corpus', () => {
  it('matches the frozen extension scores', () => {
    const live = materializeCorpus(resolverEqualCases())
    if (process.env.RESOLVER_CORPUS_WRITE === '1' || !existsSync(resolverCorpusPath)) {
      mkdirSync(dirname(resolverCorpusPath), { recursive: true })
      writeFileSync(resolverCorpusPath, `${JSON.stringify(live, null, 2)}\n`)
    }
    const disk = JSON.parse(readFileSync(resolverCorpusPath, 'utf8')) as ResolverCorpus
    expect(live).toEqual(disk)
  })
})
