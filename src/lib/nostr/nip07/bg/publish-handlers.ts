/**
 * Event broadcasting, relay publishing, event signing, NIP-46 session management,
 * and health check handlers.
 * @module lib/bg/publish-handlers
 */

import browser from '../../../../vault/browser.ts';
import { signEvent } from '../../../../vault/crypto/nip01.ts';
import * as vault from '../../../../vault/vault.ts';
import { config, type HandlerFn } from './state.ts';
import { saveKind0Event } from './profile-handlers.ts';
import type { UnsignedEvent, SignedEvent } from '../../../../vault/types.ts';
import {
    listRelayErrorLog,
    listRelayHealth,
    logRelayFailure,
    logRelaySuccess,
} from '../../../../storage/relay-health-log.ts';
import { normalizeRelayUrl } from '../../../../shared/url.ts';

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

/** Open a relay socket briefly. Scores a connect, including ws:// on localhost. */
function probeRelaySocket(url: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let socket: WebSocket | undefined;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { socket?.close(); } catch { /* ignored */ }
            if (error) reject(error);
            else resolve();
        };
        const timer = setTimeout(() => {
            finish(new Error('Timed out'));
        }, timeoutMs);
        try {
            socket = new WebSocket(url);
        } catch (error) {
            finish(error instanceof Error ? error : new Error('Relay health check failed'));
            return;
        }
        socket.onopen = () => finish();
        socket.onerror = () => finish(new Error('WebSocket error'));
    });
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
            if (signed.kind === 0) await saveKind0Event(signed);
            const result = await broadcastEvent(signed, config.relays);
            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['checkRelayHealth', async (params) => {
        const raw = (params as { url?: unknown }).url;
        const url = typeof raw === 'string' ? normalizeRelayUrl(raw) : null;
        if (!url) {
            return { reachable: false, status: 'down', error: 'Invalid relay URL' };
        }
        try {
            await probeRelaySocket(url);
            await logRelaySuccess(url);
            return { reachable: true, status: 'up' };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Relay health check failed';
            await logRelayFailure({
                relayUrl: url,
                kind: 'websocket',
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
