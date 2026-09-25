/**
 * Event broadcasting, relay publishing, event signing, NIP-46 session management,
 * and health check handlers.
 * @module lib/bg/publish-handlers
 */

import browser from '../../../../vault/browser.ts';
import { signEvent } from '../../../../vault/crypto/nip01.ts';
import * as vault from '../../../../vault/vault.ts';
import { config, type HandlerFn } from './state.ts';
import type { UnsignedEvent, SignedEvent } from '../../../../vault/types.ts';
import {
    listRelayErrorLog,
    listRelayHealth,
    logRelayFailure,
    logRelaySuccess,
} from '../../../../storage/relay-health-log.ts';

// ── Event Broadcasting ──

export async function broadcastEvent(signedEvent: SignedEvent, relayUrls: string[]): Promise<{ sent: number; failed: number }> {
    const results = { sent: 0, failed: 0 };

    const promises = relayUrls.map(url => new Promise<void>((resolve) => {
        try {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                try { ws.close(); } catch { /* ignored */ }
                results.failed++;
                resolve();
            }, 5000);

            ws.onopen = () => {
                try {
                    ws.send(JSON.stringify(['EVENT', signedEvent]));
                } catch {
                    clearTimeout(timeout);
                    results.failed++;
                    resolve();
                    return;
                }
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg[0] === 'OK' && msg[1] === signedEvent.id) {
                        clearTimeout(timeout);
                        if (msg[2] === true) results.sent++;
                        else results.failed++;
                        try { ws.close(); } catch { /* ignored */ }
                        resolve();
                    }
                } catch { /* ignored */ }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                results.failed++;
                void logRelayFailure({
                    relayUrl: url,
                    kind: 'websocket',
                    message: 'WebSocket error while publishing',
                });
                resolve();
            };
        } catch {
            results.failed++;
            resolve();
        }
    }));

    await Promise.all(promises);
    return results;
}

// ── Relay health check helpers ──

/**
 * Rejects private/loopback/link-local hosts so checkRelayHealth can't be used
 * as an SSRF probe against the local machine or internal network.
 */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;

    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 0 ||                          // 0.0.0.0/8
        a === 127 ||                           // 127.0.0.0/8 loopback
        a === 10 ||                            // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12
        (a === 192 && b === 168) ||            // 192.168.0.0/16
        (a === 169 && b === 254);              // 169.254.0.0/16 link-local
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['publishRelayList', async () => {
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked or no private key');

        try {
            const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
            const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
            const relaysCsv = relayData.relays || '';
            const relayUrls = relaysCsv.split(',').map(r => r.trim()).filter(Boolean);
            const flags = flagData.relayFlags || {};

            const tags: string[][] = [];
            for (const url of relayUrls) {
                const f = flags[url] || { read: true, write: true };
                if (f.read && f.write) {
                    tags.push(['r', url]);
                } else if (f.read) {
                    tags.push(['r', url, 'read']);
                } else if (f.write) {
                    tags.push(['r', url, 'write']);
                }
            }

            const event: UnsignedEvent = {
                created_at: Math.floor(Date.now() / 1000),
                kind: 10002,
                tags,
                content: ''
            };

            const signed = await signEvent(event, privkeyBytes);
            const broadcastUrls = relayUrls.length > 0 ? relayUrls : config.relays;
            const result = await broadcastEvent(signed, broadcastUrls);

            await browser.storage.local.set({
                lastRelayPublish: Date.now(),
                lastPublishedRelays: relaysCsv
            });

            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['signEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked');
        try {
            return await signEvent(params.event as UnsignedEvent, privkeyBytes);
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['signAndPublishEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked');
        try {
            const signed = await signEvent(params.event as UnsignedEvent, privkeyBytes);
            const result = await broadcastEvent(signed, config.relays);
            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['checkRelayHealth', async (params) => {
        const { url } = params as { url: string };
        try {
            // Only probe genuine relay URLs (ws:// or wss://) — never let the
            // caller point this fetch at arbitrary schemes or internal hosts.
            if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) {
                return { reachable: false, status: 'down', error: 'Invalid relay URL' };
            }
            const parsed = new URL(url);
            if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
                return { reachable: false, status: 'down', error: 'Invalid relay URL' };
            }
            if (isPrivateHost(parsed.hostname)) {
                return { reachable: false, status: 'down', error: 'Private host blocked' };
            }
            const scheme = parsed.protocol === 'wss:' ? 'https:' : 'http:';
            const httpUrl = `${scheme}//${parsed.host}${parsed.pathname}${parsed.search}`;
            const res = await fetch(httpUrl, {
                headers: { 'Accept': 'application/nostr+json' },
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) {
                const error = `HTTP ${res.status}`;
                await logRelayFailure({
                    relayUrl: url,
                    kind: res.status === 503 || res.status === 502 || res.status === 504
                        ? 'handshake'
                        : 'health',
                    message: error,
                });
                return { reachable: false, status: 'down', error };
            }
            await logRelaySuccess(url);
            return { reachable: true, status: 'up' };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Relay health check failed';
            await logRelayFailure({
                relayUrl: url,
                kind: 'health',
                message,
            });
            return { reachable: false, status: 'down', error: message };
        }
    }],

    ['getRelayHealth', async () => listRelayHealth()],

    ['getRelayErrorLog', async (params) => {
        const limit =
            typeof params.limit === 'number' && Number.isFinite(params.limit)
                ? Math.min(200, Math.max(1, params.limit))
                : 50;
        return listRelayErrorLog(limit);
    }],
]);
