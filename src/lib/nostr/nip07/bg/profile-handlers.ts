/**
 * Profile metadata and NIP-51 mute list (kind:10000) handlers.
 * @module lib/bg/profile-handlers
 */

import browser from '../../../../vault/browser.ts';
import * as vault from '../../../../vault/vault.ts';
import { randomHex } from '../../../../vault/crypto/utils.ts';
import { config, DEFAULT_RELAYS, profileCache, PROFILE_CACHE_TTL, type HandlerFn, type ProfileCacheEntry } from './state.ts';
import { fetchKind0Batch } from '../../kind-0-fetch.ts';
import { externalKind0Display } from '../../kind-0.ts';

/** Public entries of a NIP-51 mute list, grouped by tag type, plus the raw
 *  (still-encrypted) private `.content` so callers can round-trip it verbatim. */
export interface GroupedMuteList {
    people: string[];   // 'p' tags  — muted pubkeys (hex)
    hashtags: string[]; // 't' tags  — muted hashtags
    words: string[];    // 'word' tags — muted words
    events: string[];   // 'e' tags  — muted threads/events
    rawContent: string; // encrypted private entries, preserved verbatim ('' if none)
    createdAt: number;  // created_at of the newest event seen (0 if none)
}

/** Read the active user's configured relays (sync.relays CSV), falling back to config/defaults. */
async function getUserRelays(): Promise<string[]> {
    const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
    const csv = relayData.relays || '';
    const urls = csv.split(',').map(r => r.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
    return config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
}

// ── Profile Metadata ──

export const EXTERNAL_KIND0_CACHE_CAP = 200

export async function putProfileMetadata(
    pubkey: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    const entry = { metadata, fetchedAt: Date.now() };
    profileCache.set(pubkey, entry);
    await browser.storage.local.set({ [`profile_${pubkey}`]: entry });
}

export async function putExternalProfileMetadata(
    pubkey: string,
    metadata: Record<string, unknown>,
    operatorPubkeys: ReadonlySet<string>,
): Promise<void> {
    await putProfileMetadata(pubkey, externalKind0Display(metadata));
    await evictExternalKind0Cache(operatorPubkeys);
}

async function evictExternalKind0Cache(
    operatorPubkeys: ReadonlySet<string>,
): Promise<void> {
    const local = (await browser.storage.local.get(null)) as Record<
        string,
        unknown
    >;
    const rows: { key: string; pubkey: string; fetchedAt: number }[] = [];
    for (const [key, value] of Object.entries(local)) {
        if (!key.startsWith('profile_')) continue;
        const pubkey = key.slice('profile_'.length).toLowerCase();
        if (operatorPubkeys.has(pubkey)) continue;
        const fetchedAt =
            value &&
            typeof value === 'object' &&
            typeof (value as { fetchedAt?: unknown }).fetchedAt === 'number'
                ? (value as { fetchedAt: number }).fetchedAt
                : 0;
        rows.push({ key, pubkey, fetchedAt });
    }
    if (rows.length <= EXTERNAL_KIND0_CACHE_CAP) return;
    rows.sort((left, right) => left.fetchedAt - right.fetchedAt);
    const remove = rows.slice(0, rows.length - EXTERNAL_KIND0_CACHE_CAP);
    for (const row of remove) profileCache.delete(row.pubkey);
    await browser.storage.local.remove(remove.map((row) => row.key));
}

export async function forgetProfileMetadata(
    pubkeys: readonly string[],
): Promise<void> {
    if (pubkeys.length === 0) return;
    for (const pubkey of pubkeys) {
        profileCache.delete(pubkey);
    }
    await browser.storage.local.remove(
        pubkeys.map((pubkey) => `profile_${pubkey}`),
    );
}

async function refreshProfileMetadata(
    pubkey: string,
): Promise<Record<string, unknown> | null> {
    const relays = config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
    const metadata = await fetchKind0(pubkey, relays);
    if (metadata) {
        await putProfileMetadata(pubkey, metadata);
    }
    return metadata;
}

/**
 * Local-only kind 0 lookup. Never opens relay sockets.
 * Returns last-known metadata even when the TTL has expired.
 */
export async function peekProfileMetadata(
    pubkey: string,
): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null

    const cached = profileCache.get(pubkey)
    if (cached?.metadata) return cached.metadata

    const storageKey = `profile_${pubkey}`
    const stored = await browser.storage.local.get(storageKey) as Record<string, ProfileCacheEntry>
    const storedEntry = stored[storageKey]
    if (storedEntry?.metadata) {
        profileCache.set(pubkey, storedEntry)
        return storedEntry.metadata
    }
    return null
}

export async function fetchProfileMetadata(pubkey: string): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null;

    const cached = profileCache.get(pubkey);
    if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
        return cached.metadata;
    }

    const storageKey = `profile_${pubkey}`;
    const stored = await browser.storage.local.get(storageKey) as Record<string, ProfileCacheEntry>;
    const storedEntry = stored[storageKey];
    if (storedEntry && Date.now() - storedEntry.fetchedAt < PROFILE_CACHE_TTL) {
        profileCache.set(pubkey, storedEntry);
        return storedEntry.metadata;
    }

    // Keep last-known chrome if relays have nothing (demo keys, timeouts).
    if (storedEntry?.metadata) {
        profileCache.set(pubkey, storedEntry);
        void refreshProfileMetadata(pubkey);
        return storedEntry.metadata;
    }

    return refreshProfileMetadata(pubkey);
}

export async function fetchKind0(
    pubkey: string,
    relayUrls: string[],
): Promise<Record<string, unknown> | null> {
    const hex = pubkey.trim().toLowerCase();
    const winners = await fetchKind0Batch({
        pubkeys: [hex],
        relayUrls,
    });
    return winners.get(hex)?.metadata ?? null;
}

/**
 * Fetch a pubkey's newest kind:10000 mute list and return its PUBLIC entries
 * grouped by tag type. The private entries (NIP-44 encrypted in `.content`) are
 * NOT decrypted here — the raw string is returned verbatim as `rawContent` so a
 * later publish can round-trip them without destroying the user's private mutes.
 * Returns a zeroed GroupedMuteList (createdAt 0) if no list is found.
 */
export function fetchMuteList(pubkey: string, relayUrls: string[]): Promise<GroupedMuteList> {
    return new Promise((resolve) => {
        const best: GroupedMuteList = { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(best); }
        };
        const timer = setTimeout(done, 8000);
        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'm' + randomHex(6);
                let closed = false;
                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [10000], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey === pubkey && event.kind === 10000 && event.created_at > best.createdAt) {
                                best.createdAt = event.created_at;
                                best.rawContent = typeof event.content === 'string' ? event.content : '';
                                best.people = [];
                                best.hashtags = [];
                                best.words = [];
                                best.events = [];
                                for (const tag of (event.tags || [])) {
                                    if (!Array.isArray(tag) || !tag[1]) continue;
                                    if (tag[0] === 'p') best.people.push(tag[1]);
                                    else if (tag[0] === 't') best.hashtags.push(tag[1]);
                                    else if (tag[0] === 'word') best.words.push(tag[1]);
                                    else if (tag[0] === 'e') best.events.push(tag[1]);
                                }
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignored */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 6000);
            } catch {
                checkRemaining();
            }
        }
    });
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getProfileMetadata', async (params) => fetchProfileMetadata(params.pubkey as string)],

    ['peekProfileMetadata', async (params) => peekProfileMetadata(params.pubkey as string)],

    ['getProfileMetadataBatch', async (params) => {
        const pubkeys = params.pubkeys as string[];
        if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');
        const unique = [
            ...new Set(
                pubkeys
                    .filter((pk): pk is string => typeof pk === 'string')
                    .map((pk) => pk.trim().toLowerCase())
                    .filter((pk) => /^[0-9a-f]{64}$/.test(pk)),
            ),
        ];
        const results: Record<string, Record<string, unknown> | null> = {};
        const missing: string[] = [];
        for (const pk of unique) {
            const cached = await peekProfileMetadata(pk);
            const memory = profileCache.get(pk);
            if (memory && Date.now() - memory.fetchedAt < PROFILE_CACHE_TTL) {
                results[pk] = memory.metadata;
                continue;
            }
            if (cached) results[pk] = cached;
            missing.push(pk);
        }
        if (missing.length > 0) {
            const relays = await getUserRelays();
            const winners = await fetchKind0Batch({
                pubkeys: missing,
                relayUrls: relays,
            });
            await Promise.all(
                missing.map(async (pk) => {
                    const winner = winners.get(pk);
                    if (!winner) {
                        if (!(pk in results)) results[pk] = null;
                        return;
                    }
                    await putProfileMetadata(pk, winner.metadata);
                    results[pk] = winner.metadata;
                }),
            );
        }
        for (const original of pubkeys) {
            if (typeof original !== 'string') continue;
            const hex = original.trim().toLowerCase();
            if (!(original in results) && hex in results) {
                results[original] = results[hex];
            }
        }
        return results;
    }],

    ['updateProfileCache', async (params) => {
        const { pubkey, metadata } = params as { pubkey: string; metadata: Record<string, unknown> };
        if (!pubkey || !metadata) throw new Error('Missing pubkey or metadata');
        await putProfileMetadata(pubkey, metadata);
        return { ok: true };
    }],

    // Fetch ANOTHER pubkey's public mute list (for "import public list" feature).
    // `params.pubkey` is normalized npub→hex by background.ts before dispatch.
    ['fetchMuteList', async (params) => {
        const pubkey = params.pubkey as string;
        if (!pubkey) return { ok: false, error: 'Missing pubkey' };
        const relays = await getUserRelays();
        const list = await fetchMuteList(pubkey, relays);
        return { ok: true, ...list };
    }],

    // Fetch the ACTIVE account's OWN kind:10000 mute list, grouped by type.
    ['getMyMuteList', async () => {
        const myPubkey = vault.getActivePubkey();
        if (!myPubkey) {
            return { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
        }
        const relays = await getUserRelays();
        return await fetchMuteList(myPubkey, relays);
    }],
]);
