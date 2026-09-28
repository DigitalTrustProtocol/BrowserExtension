/**
 * Profile metadata handlers.
 * Kind 0 lives in the events store. This module only remembers a fresh copy
 * in memory so a relay is not asked again on every lookup.
 * @module lib/bg/profile-handlers
 */

import type { Event } from 'nostr-tools'
import browser from '../../../../vault/browser.ts'
import { parseKind0Content } from '../../kind-0.ts'
import { fetchKind0Batch } from '../../kind-0-fetch.ts'
import {
    config,
    DEFAULT_RELAYS,
    profileCache,
    PROFILE_CACHE_TTL,
    type HandlerFn,
} from './state.ts'

const OBSOLETE_PROFILE_KEY = /^profile_[0-9a-f]{64}$/i
const OBSOLETE_CACHE_KEY = 'kind0DisplayCache'

export interface Kind0RecordStore {
    read(pubkey: string): Promise<Record<string, unknown> | null>
    save(event: Event): Promise<void>
}

const emptyStore: Kind0RecordStore = {
    async read() {
        return null
    },
    async save() {},
}

let records: Kind0RecordStore = emptyStore

export function setKind0RecordStore(store: Kind0RecordStore): void {
    records = store
}

export function resetKind0DisplayCacheForTests(): void {
    profileCache.clear()
    records = emptyStore
}

/** Drop leftover per-pubkey Chrome keys. Does not copy them anywhere. */
export async function dropObsoleteKind0StorageKeys(): Promise<void> {
    const local = (await browser.storage.local.get(null)) as Record<string, unknown>
    const keys = Object.keys(local).filter(
        (key) => key === OBSOLETE_CACHE_KEY || OBSOLETE_PROFILE_KEY.test(key),
    )
    const size = 100
    for (let index = 0; index < keys.length; index += size) {
        await browser.storage.local.remove(keys.slice(index, index + size))
    }
}

async function getUserRelays(): Promise<string[]> {
    const relayData = (await browser.storage.sync.get(['relays'])) as Record<
        string,
        string
    >
    const csv = relayData.relays || ''
    const urls = csv
        .split(',')
        .map((relay) => relay.trim())
        .filter(Boolean)
    if (urls.length > 0) return urls
    return config.relays.length > 0 ? config.relays : DEFAULT_RELAYS
}

function remember(pubkey: string, metadata: Record<string, unknown>): void {
    profileCache.set(pubkey, { metadata, fetchedAt: Date.now() })
}

export async function saveKind0Event(
    event: Event,
): Promise<Record<string, unknown> | null> {
    const metadata = parseKind0Content(event.content)
    if (!metadata) return null
    await records.save(event)
    remember(event.pubkey.trim().toLowerCase(), metadata)
    return metadata
}

export async function forgetProfileMetadata(
    pubkeys: readonly string[],
): Promise<void> {
    for (const pubkey of pubkeys) profileCache.delete(pubkey.trim().toLowerCase())
}

async function refreshProfileMetadata(
    pubkey: string,
): Promise<Record<string, unknown> | null> {
    const relays = config.relays.length > 0 ? config.relays : DEFAULT_RELAYS
    const event = await fetchKind0Event(pubkey, relays)
    if (!event) return null
    return saveKind0Event(event)
}

/**
 * Local-only kind 0 lookup. Never opens relay sockets.
 * Returns the stored event even when it is due for a refresh.
 */
export async function peekProfileMetadata(
    pubkey: string,
): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null
    const hex = pubkey.trim().toLowerCase()
    const memory = profileCache.get(hex)
    if (memory?.metadata) return memory.metadata
    const stored = await records.read(hex)
    if (!stored) return null
    remember(hex, stored)
    return stored
}

export async function fetchProfileMetadata(
    pubkey: string,
): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null
    const hex = pubkey.trim().toLowerCase()
    const cached = profileCache.get(hex)
    if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
        return cached.metadata
    }
    const stored = await records.read(hex)
    if (stored) {
        if (!cached) void refreshProfileMetadata(hex)
        return stored
    }
    return refreshProfileMetadata(hex)
}

export async function fetchKind0Event(
    pubkey: string,
    relayUrls: string[],
): Promise<Event | null> {
    const hex = pubkey.trim().toLowerCase()
    const winners = await fetchKind0Batch({
        pubkeys: [hex],
        relayUrls,
    })
    return winners.get(hex)?.event ?? null
}

export const handlers = new Map<string, HandlerFn>([
    ['getProfileMetadata', async (params) => fetchProfileMetadata(params.pubkey as string)],

    ['peekProfileMetadata', async (params) => peekProfileMetadata(params.pubkey as string)],

    ['getProfileMetadataBatch', async (params) => {
        const pubkeys = params.pubkeys as string[]
        if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array')
        const unique = [
            ...new Set(
                pubkeys
                    .filter((pk): pk is string => typeof pk === 'string')
                    .map((pk) => pk.trim().toLowerCase())
                    .filter((pk) => /^[0-9a-f]{64}$/.test(pk)),
            ),
        ]
        const results: Record<string, Record<string, unknown> | null> = {}
        const missing: string[] = []
        for (const pk of unique) {
            const memory = profileCache.get(pk)
            if (memory && Date.now() - memory.fetchedAt < PROFILE_CACHE_TTL) {
                results[pk] = memory.metadata
                continue
            }
            const cached = await peekProfileMetadata(pk)
            if (cached) results[pk] = cached
            missing.push(pk)
        }
        if (missing.length > 0) {
            const relays = await getUserRelays()
            const winners = await fetchKind0Batch({
                pubkeys: missing,
                relayUrls: relays,
            })
            await Promise.all(
                missing.map(async (pk) => {
                    const winner = winners.get(pk)
                    if (!winner) {
                        if (!(pk in results)) results[pk] = null
                        return
                    }
                    const metadata = await saveKind0Event(winner.event)
                    results[pk] = metadata
                }),
            )
        }
        for (const original of pubkeys) {
            if (typeof original !== 'string') continue
            const hex = original.trim().toLowerCase()
            if (!(original in results) && hex in results) {
                results[original] = results[hex]
            }
        }
        return results
    }],

    ['updateProfileCache', async (params) => {
        const { pubkey, metadata } = params as {
            pubkey: string
            metadata: Record<string, unknown>
        }
        if (!pubkey || !metadata) throw new Error('Missing pubkey or metadata')
        remember(pubkey.trim().toLowerCase(), metadata)
        return { ok: true }
    }],
])
