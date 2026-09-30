import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FALLBACK_POST_ID,
  loadPlaybackCatalog,
  postsFromExport,
  subjectsFromCatalog,
  usersFromIdentityExport,
} from './catalog.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('playback catalog', () => {
  it('keeps numeric users and canonical handles', () => {
    const users = usersFromIdentityExport([
      { twitterId: '44196397', handle: '@SpaceX' },
      { twitterId: '12', handle: 'not a handle!' },
      { twitterId: '44196397', handle: 'elonmusk' },
      { twitterId: 'abc' },
      { handle: 'nasa' },
    ])
    expect(users).toEqual([
      { id: '44196397', handle: 'spacex' },
      { id: '12' },
    ])
  })

  it('keeps an nsec only on the row that has one', () => {
    const users = usersFromIdentityExport([
      { twitterId: '1', handle: 'trustprotocol', nsec: 'nsec1example' },
      { twitterId: '2', handle: 'elonmusk' },
      { twitterId: '3', handle: 'nasa', nsec: 'not-a-key' },
    ])
    expect(users.map((user) => user.nsec)).toEqual(['nsec1example', undefined, undefined])
  })

  it('reads post ids and ignores other fields', () => {
    expect(
      postsFromExport([
        { postId: '2104545486313247031', headline: 'webcast' },
        { postId: '2104545486313247031' },
        { postId: 'nope' },
      ]),
    ).toEqual(['2104545486313247031'])
  })

  it('rejects a document that is not an array', () => {
    expect(() => usersFromIdentityExport({ users: [] })).toThrow(/JSON array/)
    expect(() => postsFromExport('posts')).toThrow(/JSON array/)
  })

  it('loads both files from a directory', async () => {
    const dir = await tempDir()
    await writeFile(
      path.join(dir, 'x-identities.json'),
      JSON.stringify([{ twitterId: '44196397', handle: 'SpaceX' }]),
    )
    await writeFile(
      path.join(dir, 'x-posts.json'),
      JSON.stringify([{ postId: '99', headline: 'one' }]),
    )
    const catalog = await loadPlaybackCatalog(dir)
    expect(catalog.postFallback).toBe(false)
    expect(subjectsFromCatalog(catalog)).toEqual([
      { type: 'user', id: '44196397', handle: 'spacex' },
      { type: 'post', id: '99' },
    ])
  })

  it('uses the SpaceX post when x-posts.json is missing or empty', async () => {
    const missing = await tempDir()
    await writeFile(
      path.join(missing, 'x-identities.json'),
      JSON.stringify([{ twitterId: '1', handle: 'a' }]),
    )
    const fromMissing = await loadPlaybackCatalog(missing)
    expect(fromMissing.postFallback).toBe(true)
    expect(fromMissing.posts).toEqual([FALLBACK_POST_ID])

    const empty = await tempDir()
    await writeFile(
      path.join(empty, 'x-identities.json'),
      JSON.stringify([{ twitterId: '1', handle: 'a' }]),
    )
    await writeFile(path.join(empty, 'x-posts.json'), '[]')
    const fromEmpty = await loadPlaybackCatalog(empty)
    expect(fromEmpty.posts).toEqual([FALLBACK_POST_ID])
    expect(fromEmpty.postFallback).toBe(true)
  })

  it('throws when identities are missing or have no ids', async () => {
    const missing = await tempDir()
    await expect(loadPlaybackCatalog(missing)).rejects.toThrow(/x-identities.json/)
    const empty = await tempDir()
    await writeFile(path.join(empty, 'x-identities.json'), '[]')
    await expect(loadPlaybackCatalog(empty)).rejects.toThrow(/no numeric twitter ids/)
  })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'attentionx-catalog-'))
  dirs.push(dir)
  return dir
}
