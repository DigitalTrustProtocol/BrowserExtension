/**
 * NIP-07 signer + permission management handlers.
 * @module lib/bg/nip07-handlers
 */

import browser from '../../../../vault/browser.ts';
import * as signer from '../signer.ts';
import * as signerPermissions from '../permissions.ts';
import type { UnsignedEvent, RequestDecision } from '../../../../vault/types.ts';
import type { HandlerFn } from './state.ts';
import { isIdentityDisabled, addAllowedDomain } from './domain-handlers.ts';
import { logActivity } from './misc-handlers.ts';
import {
    assertBoundedCryptoPayload,
    assertBoundedUnsignedEvent,
} from '../sign-event-bounds.ts';
import { activityReasonFromError } from './activity-handlers.ts';

// ── Validation ──

export function validateNip07Params(method: string, params: Record<string, unknown>): void {
    if (method === 'nip07_signEvent') {
        // Normalize + enforce kind-aware size/completeness bounds before queueing.
        params.event = assertBoundedUnsignedEvent(params.event);
        return;
    }
    if (method === 'nip07_nip04Encrypt' || method === 'nip07_nip44Encrypt') {
        if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
            throw new Error('Invalid pubkey');
        params.plaintext = assertBoundedCryptoPayload('plaintext', params.plaintext);
        return;
    }
    if (method === 'nip07_nip04Decrypt' || method === 'nip07_nip44Decrypt') {
        if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
            throw new Error('Invalid pubkey');
        params.ciphertext = assertBoundedCryptoPayload('ciphertext', params.ciphertext);
    }
}

// ── Helpers ──

/** Wraps an encrypt/decrypt handler with identity-disabled check and activity logging. */
function withIdentityGuard(
    method: string,
    fn: (origin: string, params: Record<string, unknown>) => Promise<unknown>,
): HandlerFn {
    return async (params) => {
        const origin = params.origin as string;
        if (origin && await isIdentityDisabled(origin)) {
            logActivity({
                domain: origin,
                method,
                decision: 'blocked',
                reason: 'identity_disabled',
            });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await fn(origin, params);
            logActivity({ domain: origin, method, decision: 'approved' });
            return result;
        } catch (e) {
            logActivity({
                domain: origin,
                method,
                decision: 'rejected',
                reason: activityReasonFromError(e),
            });
            throw e;
        }
    };
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['nip07_getPublicKey', async (params) => {
        const origin = params.origin as string;
        if (origin && await isIdentityDisabled(origin)) {
            logActivity({
                domain: origin,
                method: 'getPublicKey',
                decision: 'blocked',
                reason: 'identity_disabled',
            });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleGetPublicKey(origin);
            logActivity({ domain: origin, method: 'getPublicKey', decision: 'approved' });
            if (origin) addAllowedDomain(origin).catch(() => {});
            return result;
        } catch (e) {
            logActivity({
                domain: origin,
                method: 'getPublicKey',
                decision: 'rejected',
                reason: activityReasonFromError(e),
            });
            throw e;
        }
    }],

    ['nip07_signEvent', async (params) => {
        const origin = params.origin as string;
        const kind = (params.event as { kind?: number } | undefined)?.kind;
        if (origin && await isIdentityDisabled(origin)) {
            logActivity({
                domain: origin,
                method: 'signEvent',
                decision: 'blocked',
                reason: 'identity_disabled',
                ...(typeof kind === 'number' ? { kind } : {}),
            });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleSignEvent(params.event as UnsignedEvent, origin);
            logActivity({
                domain: origin,
                method: 'signEvent',
                decision: 'approved',
                kind: result.kind,
                eventId: result.id,
            });
            return result;
        } catch (e) {
            console.error('[nip07] signEvent FAILED, kind:', kind, 'error:', (e as Error).message);
            logActivity({
                domain: origin,
                method: 'signEvent',
                decision: 'rejected',
                reason: activityReasonFromError(e),
                ...(typeof kind === 'number' ? { kind } : {}),
            });
            throw e;
        }
    }],

    ['nip07_getRelays', async () => {
        const data = await browser.storage.sync.get('relays') as Record<string, string>;
        const relayList = data.relays ? data.relays.split(',').map(r => r.trim()).filter(Boolean) : [];
        const relayObj: Record<string, { read: boolean; write: boolean }> = {};
        for (const r of relayList) relayObj[r] = { read: true, write: true };
        return relayObj;
    }],

    ['nip07_nip04Encrypt', withIdentityGuard('nip04Encrypt', (origin, params) =>
        signer.handleNip04Encrypt(params.pubkey as string, params.plaintext as string, origin))],

    ['nip07_nip04Decrypt', withIdentityGuard('nip04Decrypt', (origin, params) =>
        signer.handleNip04Decrypt(params.pubkey as string, params.ciphertext as string, origin))],

    ['nip07_nip44Encrypt', withIdentityGuard('nip44Encrypt', (origin, params) =>
        signer.handleNip44Encrypt(params.pubkey as string, params.plaintext as string, origin))],

    ['nip07_nip44Decrypt', withIdentityGuard('nip44Decrypt', (origin, params) =>
        signer.handleNip44Decrypt(params.pubkey as string, params.ciphertext as string, origin))],

    // ── Signer permission management ──

    ['signer_getPermissions', async (params) => signerPermissions.getAll(params.accountId as string)],
    ['signer_getPermissionsForDomain', async (params) => signerPermissions.getForDomain(params.domain as string, params.accountId as string)],

    ['signer_clearPermissions', async (params) => {
        await signerPermissions.clear(params.domain as string, params.accountId as string);
        signer.clearGetPubkeyCooldown(params.domain as string | undefined);
        return { ok: true };
    }],

    ['signer_savePermission', async (params) => {
        await signerPermissions.saveDirect(params.domain as string, params.methodName as string, params.decision as 'allow' | 'deny' | 'ask', params.accountId as string);
        if (params.methodName === 'getPublicKey') {
            signer.clearGetPubkeyCooldown(params.domain as string);
        }
        return { ok: true };
    }],

    ['signer_getPermissionsRaw', async () => signerPermissions.getAllRaw()],
    ['signer_getPermissionsForDomainRaw', async (params) => signerPermissions.getForDomainRaw(params.domain as string)],

    ['signer_copyPermissions', async (params) => {
        await signerPermissions.copyPermissions(params.fromAccountId as string, params.toAccountId as string);
        return { ok: true };
    }],

    ['signer_setupNewAccountPermissions', async (params) => {
        const newId = params.newAccountId as string;
        const copyFrom = (params.copyFromAccountId as string) || null;
        const data = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string }>>;
        const existing = (data.accounts || []).map(a => a.id).filter(id => id && id !== newId);
        await signerPermissions.setupNewAccountPermissions(newId, existing, copyFrom);
        return { ok: true };
    }],

    ['signer_getUseGlobalDefaults', async () => signerPermissions.getUseGlobalDefaults()],

    ['signer_setUseGlobalDefaults', async (params) => {
        await signerPermissions.setUseGlobalDefaults(params.enabled as boolean);
        return { ok: true };
    }],

    // ── Signer pending request management ──

    ['signer_getPending', async () => signer.getPending()],

    ['signer_resolve', async (params) => {
        signer.resolveRequest(params.id as string, params.decision as unknown as RequestDecision);
        return { ok: true };
    }],

    ['signer_resolveBatch', async (params) => {
        await signer.resolveBatch(params.origin as string, params.permKey as string, params.decision as unknown as RequestDecision);
        return { ok: true };
    }],

    ['signer_cancelNip46', async (params) => {
        await signer.cancelNip46InFlight(params.id as string);
        return { ok: true };
    }],

    ['signer_cancelUnlockWaiters', async () => {
        await signer.cancelAllUnlockWaiters();
        return { ok: true };
    }],

    ['signer_cancelUnlockWaiter', async (params) => {
        await signer.cancelUnlockWaiter(params.id as string);
        return { ok: true };
    }],
]);
