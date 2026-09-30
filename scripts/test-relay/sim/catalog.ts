import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  isCanonicalTwitterHandle,
  isTwitterNumericId,
  normalizeTwitterHandle,
} from '../../../src/shared/x-identity.ts'
import type { SimSubject } from './world.ts'

/** Cockpit Users / Posts downloads used by `play`. */
export const CATALOG_DIR = path.join(process.cwd(), 'scripts', 'data')

/**
 * Starship flight 14 webcast post. Used only when `x-posts.json` is missing
 * or has no numeric post ids.
 */
export const FALLBACK_POST_ID = '2104545486313247031'

export interface CatalogUser {
  id: string
  handle?: string
  displayName?: string
  /** Present only when the export row includes an nsec. Local signing secret. */
  nsec?: string
}

export interface PlaybackCatalog {
  users: CatalogUser[]
  posts: string[]
  /** True when posts came from {@link FALLBACK_POST_ID} instead of the file. */
  postFallback: boolean
}

export async function loadPlaybackCatalog(
  dir = CATALOG_DIR,
): Promise<PlaybackCatalog> {
  const identitiesPath = path.join(dir, 'x-identities.json')
  let identitiesText: string
  try {
    identitiesText = await readFile(identitiesPath, 'utf8')
  } catch (error) {
    if (isEnoent(error)) {
      throw new Error(
        `Missing ${identitiesPath}. Export Users to scripts/data/x-identities.json`,
      )
    }
    throw error
  }
  const users = usersFromIdentityExport(parseJson(identitiesText, 'x-identities.json'))
  if (users.length === 0) {
    throw new Error('x-identities.json has no numeric twitter ids')
  }

  const postsPath = path.join(dir, 'x-posts.json')
  let posts: string[] = []
  let missingPosts = false
  try {
    const postsText = await readFile(postsPath, 'utf8')
    posts = postsFromExport(parseJson(postsText, 'x-posts.json'))
  } catch (error) {
    if (!isEnoent(error)) throw error
    missingPosts = true
  }
  const postFallback = missingPosts || posts.length === 0
  if (postFallback) posts = [FALLBACK_POST_ID]
  return { users, posts, postFallback }
}

export function usersFromIdentityExport(value: unknown): CatalogUser[] {
  const users: CatalogUser[] = []
  const seen = new Set<string>()
  for (const row of asRecords(value, 'x-identities.json')) {
    if (typeof row !== 'object' || row === null) continue
    const record = row as {
      twitterId?: unknown
      handle?: unknown
      displayName?: unknown
      nsec?: unknown
    }
    if (typeof record.twitterId !== 'string' || !isTwitterNumericId(record.twitterId)) {
      continue
    }
    if (seen.has(record.twitterId)) continue
    seen.add(record.twitterId)
    const handle = canonicalHandle(record.handle)
    const displayName = displayNameOf(record)
    const nsec = nsecOf(record.nsec)
    users.push({
      id: record.twitterId,
      ...(handle ? { handle } : {}),
      ...(displayName ? { displayName } : {}),
      ...(nsec ? { nsec } : {}),
    })
  }
  return users
}

export function postsFromExport(value: unknown): string[] {
  const posts: string[] = []
  const seen = new Set<string>()
  for (const row of asRecords(value, 'x-posts.json')) {
    if (typeof row !== 'object' || row === null) continue
    const postId = (row as { postId?: unknown }).postId
    if (typeof postId !== 'string' || !isTwitterNumericId(postId)) continue
    if (seen.has(postId)) continue
    seen.add(postId)
    posts.push(postId)
  }
  return posts
}

export function subjectsFromCatalog(catalog: PlaybackCatalog): SimSubject[] {
  return [
    ...catalog.users.map((user) =>
      user.handle
        ? { type: 'user' as const, id: user.id, handle: user.handle }
        : { type: 'user' as const, id: user.id },
    ),
    ...catalog.posts.map((id) => ({ type: 'post' as const, id })),
  ]
}

function nsecOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const nsec = value.trim()
  return nsec.startsWith('nsec1') ? nsec : undefined
}

function displayNameOf(record: { displayName?: unknown }): string | undefined {
  if (typeof record.displayName !== 'string') return undefined
  const name = record.displayName.trim()
  return name.length > 0 ? name : undefined
}

function canonicalHandle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const handle = normalizeTwitterHandle(value)
  return isCanonicalTwitterHandle(handle) ? handle : undefined
}

function asRecords(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array`)
  }
  return value
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${label} must be JSON`)
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
