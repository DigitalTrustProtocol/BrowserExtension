/**
 * Vault lifecycle and account-switching handlers.
 * @module lib/bg/vault-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import { assertValidAutoLockMs } from '../auto-lock-bounds.ts';
import * as signer from '../../nip07/signer.ts';
import * as signerPermissions from '../../nip07/permissions.ts';
import * as accounts from '../../accounts/accounts.ts';
import { nsecEncode } from '../crypto/bech32.ts';
import { bytesToHex } from '../crypto/utils.ts';
import { ncryptsecEncode, ncryptsecDecode } from '../crypto/nip49.ts';
// wallet stripped
import { config, type HandlerFn, type LocalAccountEntry } from '../../nip07/bg/state.ts';
import { broadcastAccountChanged } from '../../nip07/bg/domain-handlers.ts';
import type { Account, VaultPayload } from '../types.ts';
import {
  markEasyBlobDeletedForTwitterId,
  readEasyBlob,
  remirrorAccountNameIfBlobExists,
  remirrorEasyBlobForPubkey,
  removeEasyBlobForTwitterId,
  upsertEasyBlobForTwitterId,
} from '../easy-roaming.ts';
import {
  canBindAccountToX,
  findAccountByBoundTwitterId,
  normalizeBoundTwitterId,
  boundTwitterIdsOf,
  accountIsBoundTo,
  toBoundAccountView,
  type BoundAccountView,
} from '../../accounts/x-binding.ts';
import { patchLocalAccountBinding, toLocalAccountEntry, upsertLocalAccountEntry, clearLocalAccounts, readLocalAccounts, writeLocalAccounts } from '../../accounts/local-account-mirror.ts';
import {
  accountIsReadOnly,
  normalizeKeyTitle,
} from '../../accounts/key-title.ts';
import { nameForNewKey } from '../../accounts/mint-key-name.ts';
import {
  removeXNostrBinding,
  upsertXNostrBinding,
} from '../x-nostr-bindings-sync.ts';
import {
  clearAllRoamingSyncData,
  getBrowserKeyRoaming,
  setBrowserKeyRoaming,
} from '../browser-key-roaming.ts';
import { npubEncode } from '../crypto/bech32.ts';
import {
  ACTIVE_X_ACCOUNT_SESSION_KEY,
  ACTIVE_X_TAB_REGISTRY_KEY,
  activeXAccountFromUnknown,
  activeXTabRegistryFromUnknown,
  observationForTab,
} from '../../shared/active-x-session.ts';
import { FOCUSED_PRODUCT_TAB_SESSION_KEY } from '../../shared/focused-product-tab.ts';
import {
  applyKeyScenario,
  readKeyScenarioStatus,
} from '../admin-key-scenarios.ts';
import {
  assertAdminKeyScenarioOperator,
  isKeyScenarioId,
} from '../../shared/admin-key-scenarios.ts';
import {
  requestPanelSessionRecompute,
  resetJustWorksProvisionKick,
} from '../../background/panel-session-controller.ts';

async function readSessionActiveXContext(): Promise<{
  handle?: string
  twitterId: string | null
}> {
  try {
    const stored = await browser.storage.session.get([
      ACTIVE_X_ACCOUNT_SESSION_KEY,
      ACTIVE_X_TAB_REGISTRY_KEY,
      FOCUSED_PRODUCT_TAB_SESSION_KEY,
    ]);
    const focused = stored[FOCUSED_PRODUCT_TAB_SESSION_KEY] as
      | { kind?: string; isX?: boolean; tabId?: number }
      | undefined;
    let handle: string | undefined
    let twitterId: string | null = null
    if (focused?.kind === 'ok' && focused.isX && typeof focused.tabId === 'number') {
      const registry = activeXTabRegistryFromUnknown(
        stored[ACTIVE_X_TAB_REGISTRY_KEY],
      );
      const observation = observationForTab(registry, focused.tabId);
      handle = observation?.account?.handle
      twitterId = normalizeBoundTwitterId(observation?.account?.twitterId)
    }
    const report = activeXAccountFromUnknown(stored[ACTIVE_X_ACCOUNT_SESSION_KEY]);
    if (!handle) handle = report?.handle
    if (!twitterId) twitterId = normalizeBoundTwitterId(report?.twitterId) ?? null
    return { handle, twitterId };
  } catch {
    return { twitterId: null };
  }
}

async function readSessionActiveXTwitterId(): Promise<string | null> {
  const ctx = await readSessionActiveXContext();
  return ctx.twitterId;
}

function vaultAccountsAsBoundViews(): BoundAccountView[] {
  return vault.listAccounts().map((a) => toBoundAccountView(a));
}

/** Re-write sync Easy blob when it already backs up this pubkey. */
async function remirrorEasyIfMatchingActive(): Promise<void> {
    const blob = await readEasyBlob();
    if (!blob) return;
    const activeId = vault.getActiveAccountId();
    if (!activeId) return;
    const pubkey = vault.getActivePubkey();
    if (!pubkey || pubkey.toLowerCase() !== blob.pubkeyHint.toLowerCase()) return;
    const privkeyBytes = vault.getPrivkey(activeId);
    if (!privkeyBytes) return;
    try {
        const privkeyHex = bytesToHex(privkeyBytes);
        const active = vault.getActiveAccount();
        await remirrorEasyBlobForPubkey(privkeyHex, {
            accountName: active?.name,
            replace: false,
            boundTwitterId: active?.boundTwitterId ?? undefined,
        });
    } finally {
        privkeyBytes.fill(0);
    }
}

async function remirrorRenamedAccountName(
  accountId: string,
  name: string,
  pubkey: string,
): Promise<void> {
  if (!(await getBrowserKeyRoaming())) return
  const privkeyBytes = vault.getPrivkey(accountId)
  if (!privkeyBytes) return
  try {
    await remirrorAccountNameIfBlobExists(bytesToHex(privkeyBytes), {
      accountName: name,
      pubkey,
    })
  } finally {
    privkeyBytes.fill(0)
  }
}

// ── Mirror active pubkey into the background config / storage.sync ──

export async function syncActivePubkey(): Promise<void> {
    const pubkey = vault.getActivePubkey();
    if (pubkey) {
        config.myPubkey = pubkey;
        await browser.storage.sync.set({ myPubkey: pubkey });
    } else {
        config.myPubkey = '';
        await browser.storage.sync.remove('myPubkey');
    }
}

// ── Unlock brute-force guard (persisted, background-side) ──
//
// The popup's useVaultUnlock hook has its own escalating lockout, but that
// state is in-page and resets on reload. This counter lives in storage.local
// so repeated vault_unlock RPCs hit a server-side lockout regardless of how
// the caller resets its UI. Reset on successful unlock and on vault_destroy.

const UNLOCK_GUARD_KEY = 'vaultUnlockGuard';
const UNLOCK_FAILURES_PER_LOCKOUT = 5;
// Every 5 consecutive failures: 1 min, 5 min, 15 min, 30 min (cap)
const UNLOCK_LOCKOUT_STEPS_MS = [60_000, 300_000, 900_000, 1_800_000];

interface UnlockGuard { failures: number; lockedUntil: number; }

async function readUnlockGuard(): Promise<UnlockGuard> {
    const data = await browser.storage.local.get([UNLOCK_GUARD_KEY]) as Record<string, UnlockGuard | undefined>;
    return data[UNLOCK_GUARD_KEY] ?? { failures: 0, lockedUntil: 0 };
}

async function recordUnlockFailure(): Promise<void> {
    const guard = await readUnlockGuard();
    guard.failures += 1;
    if (guard.failures % UNLOCK_FAILURES_PER_LOCKOUT === 0) {
        const step = Math.min(
            guard.failures / UNLOCK_FAILURES_PER_LOCKOUT - 1,
            UNLOCK_LOCKOUT_STEPS_MS.length - 1
        );
        guard.lockedUntil = Date.now() + UNLOCK_LOCKOUT_STEPS_MS[step];
    }
    await browser.storage.local.set({ [UNLOCK_GUARD_KEY]: guard });
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['vault_unlock', async (params) => {
        const guard = await readUnlockGuard();
        if (guard.lockedUntil > Date.now()) {
            const secondsLeft = Math.ceil((guard.lockedUntil - Date.now()) / 1000);
            throw new Error(`Too many failed attempts. Try again in ${secondsLeft}s`);
        }
        const unlockResult = await vault.unlock(params.password as string);
        if (!unlockResult) {
            await recordUnlockFailure();
        }
        if (unlockResult) {
            await browser.storage.local.remove(UNLOCK_GUARD_KEY);
            // Re-arm the persisted auto-lock interval (not the 15-min default that
            // _autoLockMs resets to on every service-worker cold start). See bug #10.
            await vault.restoreAutoLockSetting();
            const unlockData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
            if (unlockData.activeAccountId) {
                try {
                    await vault.setActiveAccount(unlockData.activeAccountId);
                } catch {
                    vault.clearActiveAccount();
                }
            }
            await signer.onVaultUnlocked();
        }
        return unlockResult;
    }],

    ['vault_lock', async () => {
        vault.lock();
        return { ok: true };
    }],

    ['vault_isLocked', async () => vault.isLocked()],

    ['vault_exists', async () => vault.exists()],

    ['vault_setAutoLock', async (params) => {
        // Reject before password / lock-mode transitions so invalid values
        // cannot clear the timer without entering documented never-lock mode.
        assertValidAutoLockMs(params.ms);
        const ms = params.ms;

        const prevMs = ((await browser.storage.local.get(['autoLockMs'])) as Record<string, number>).autoLockMs ?? 900000;
        const wasNever = prevMs === 0;
        const willBeNever = ms === 0;

        if (wasNever !== willBeNever) {
            const payload = vault.getDecryptedPayload();
            if (wasNever) {
                if (!params.password || (params.password as string).length < 8) {
                    throw new Error('Password required (min 8 characters)');
                }
                await vault.create(params.password as string, payload!);
            } else {
                if (!params.currentPassword) {
                    throw new Error('Current password required');
                }
                const ok = await vault.unlock(params.currentPassword as string);
                if (!ok) throw new Error('Current password is incorrect');
                await vault.create('', payload!);
            }
        }

        vault.setAutoLockTimeout(ms);
        await browser.storage.local.set({ autoLockMs: ms });
        if (!vault.isLocked()) {
            await remirrorEasyIfMatchingActive();
        }
        return { result: true };
    }],

    ['vault_getAutoLock', async () => {
        const data = await browser.storage.local.get(['autoLockMs']) as Record<string, number>;
        return data.autoLockMs ?? 900000;
    }],

    ['vault_create', async (params) => {
        await vault.create(params.password as string, params.payload as VaultPayload);
        await syncActivePubkey();
        return { ok: true };
    }],

    ['vault_listAccounts', async () => vault.listAccounts()],

    ['vault_addAccount', async (params) => {
        await vault.addAccount(params.account as Account);
        await upsertLocalAccountEntry(toLocalAccountEntry(params.account as Account));
        return { ok: true };
    }],

    ['vault_renameAccount', async (params) => {
        const accountId =
          typeof params.accountId === 'string' ? params.accountId.trim() : ''
        if (!accountId) throw new Error('Account not found')
        const parsed = normalizeKeyTitle(
          typeof params.name === 'string' ? params.name : '',
        )
        if (!parsed.ok) throw new Error(parsed.error)

        const { accounts: localAccounts } = await readLocalAccounts()
        const local = localAccounts.find((row) => row.id === accountId)
        const vaultRow = vault.isLocked() ? null : vault.getAccountById(accountId)

        if (vaultRow) {
          await vault.updateAccountName(accountId, parsed.name)
          const after = vault.getAccountById(accountId)
          if (after) {
            await upsertLocalAccountEntry(
              toLocalAccountEntry({ ...after, privkey: null }),
            )
            await remirrorRenamedAccountName(
              accountId,
              parsed.name,
              after.pubkey,
            )
          }
          return { ok: true, name: parsed.name }
        }

        if (local && accountIsReadOnly(local)) {
          await upsertLocalAccountEntry({ ...local, name: parsed.name })
          return { ok: true, name: parsed.name }
        }

        if (vault.isLocked() && local) {
          throw new Error('Vault is locked')
        }
        throw new Error('Account not found')
    }],

    ['bindAccountToX', async (params) => {
        const accountId = params.accountId as string;
        const twitterId = normalizeBoundTwitterId(params.twitterId as string);
        const reassign = params.reassign === true;
        if (!twitterId) throw new Error('X binding requires a numeric twitterId');
        if (vault.isLocked()) throw new Error('Vault is locked');
        const views = vaultAccountsAsBoundViews();
        const check = canBindAccountToX(views, accountId, twitterId, { reassign });
        if (!check.ok) throw new Error(check.message);
        const now = Date.now();
        const previous = findAccountByBoundTwitterId(views, twitterId);
        if (previous && previous.id !== accountId) {
            await vault.setAccountXBinding(previous.id, null, null, {
                removeTwitterId: twitterId,
            });
            const afterPrev = vault.getAccountById(previous.id);
            await patchLocalAccountBinding(previous.id, null, afterPrev?.boundUpdatedAt ?? null, {
                boundTwitterIds: afterPrev ? boundTwitterIdsOf(afterPrev) : [],
                removeTwitterId: twitterId,
            });
        }
        await vault.setAccountXBinding(accountId, twitterId, now);
        const after = vault.getAccountById(accountId);
        await patchLocalAccountBinding(accountId, twitterId, now, {
            boundTwitterIds: after ? boundTwitterIdsOf(after) : [twitterId],
        });
        const acct = vault.getAccountById(accountId);
        if (acct?.pubkey) {
            await upsertXNostrBinding({
                twitterId,
                pubkey: acct.pubkey,
                updatedAt: now,
            });
            const privkeyBytes = vault.getPrivkey(accountId);
            if (privkeyBytes) {
                try {
                    await upsertEasyBlobForTwitterId(bytesToHex(privkeyBytes), {
                        boundTwitterId: twitterId,
                        accountName: acct.name,
                        boundUpdatedAt: now,
                        replace: true,
                    });
                } finally {
                    privkeyBytes.fill(0);
                }
            }
        }
        // Activate the bound account so publishes pass #assertActiveNostrBoundToX.
        const oldData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const oldAccountId = oldData.activeAccountId;
        try {
            await vault.setActiveAccount(accountId);
        } catch {
            /* account may be read-only edge — binding still stored */
        }
        await browser.storage.local.set({ activeAccountId: accountId });
        if (acct?.pubkey) {
            config.myPubkey = acct.pubkey;
            await browser.storage.sync.set({ myPubkey: acct.pubkey });
            broadcastAccountChanged(acct.pubkey);
        }
        await signer.onActiveAccountChanged(oldAccountId, accountId);
        return { ok: true, boundTwitterId: twitterId, boundUpdatedAt: now };
    }],

    ['unbindAccountFromX', async (params) => {
        const accountId = params.accountId as string;
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acct = vault.getAccountById(accountId);
        if (!acct) throw new Error('Account not found');
        const requested = normalizeBoundTwitterId(params.twitterId as string | undefined);
        const previousTid =
            requested && accountIsBoundTo(acct, requested)
                ? requested
                : normalizeBoundTwitterId(acct.boundTwitterId);
        if (previousTid) {
            await vault.setAccountXBinding(accountId, null, null, {
                removeTwitterId: previousTid,
            });
        } else {
            await vault.setAccountXBinding(accountId, null, null);
        }
        const after = vault.getAccountById(accountId);
        await patchLocalAccountBinding(accountId, null, after?.boundUpdatedAt ?? null, {
            boundTwitterIds: after ? boundTwitterIdsOf(after) : [],
            ...(previousTid ? { removeTwitterId: previousTid } : {}),
        });
        if (previousTid) {
            await removeXNostrBinding(previousTid);
            await removeEasyBlobForTwitterId(previousTid);
        }
        return { ok: true, previousTwitterId: previousTid };
    }],

    ['vault_removeAccount', async (params) => {
        const removedId = params.accountId as string;
        const removed = vault.getAccountById(removedId);
        const previousTids = removed ? boundTwitterIdsOf(removed) : [];
        const pubkeyHint = removed?.pubkey?.toLowerCase();
        await vault.removeAccount(removedId);
        await signerPermissions.clearForAccount(removedId);
        for (const previousTid of previousTids) {
            await removeXNostrBinding(previousTid);
            if (await getBrowserKeyRoaming()) {
                await markEasyBlobDeletedForTwitterId(previousTid, {
                    pubkeyHint,
                    npub: pubkeyHint ? npubEncode(pubkeyHint) : undefined,
                });
            } else {
                await removeEasyBlobForTwitterId(previousTid);
            }
        }

        const remainingVault = vault.listAccounts();
        if (remainingVault.length === 0) {
            await vault.destroy();
            await clearLocalAccounts({
                reason: 'lastKeyDelete',
                extraRemove: ['autoLockMs', UNLOCK_GUARD_KEY],
            });
            await browser.storage.sync.remove('myPubkey');
            config.myPubkey = '';
            await signer.onActiveAccountChanged(removedId, null);
            return { ok: true, loggedOut: true };
        }

        await syncActivePubkey();
        const { accounts: rmAccts, activeAccountId: rmActive } = await readLocalAccounts();
        const remaining = rmAccts.filter((a) => a.id !== removedId);
        const nextActive =
            rmActive === removedId
                ? vault.getActiveAccountId() || remaining[0]?.id || null
                : rmActive;
        await writeLocalAccounts({
            accounts: remaining,
            activeAccountId: nextActive,
        });
        if (rmActive === removedId) {
            await signer.onActiveAccountChanged(removedId, nextActive);
        }
        return { ok: true, loggedOut: false };
    }],

    ['switchAccount', async (params) => {
        const switchId = params.accountId as string;
        const xTabContext = params.xTabContext === true;
        if (xTabContext) {
            const twitterId = await readSessionActiveXTwitterId();
            if (twitterId) {
                const views = vaultAccountsAsBoundViews();
                const bound = findAccountByBoundTwitterId(views, twitterId);
                if (bound) {
                  // Locked to the Nostr account bound to this X user.
                  if (bound.id !== switchId) {
                    throw new Error(
                      'While on X, only the Nostr account bound to this X user can be selected. Change it in Bindings.',
                    );
                  }
                } else {
                  // No binding yet: allow selecting any writable key so the
                  // user can bind / reuse a key already used on another X.
                  const target = views.find((a) => a.id === switchId);
                  if (!target) throw new Error('Account not found');
                }
            }
        }
        const oldData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const oldAccountId = oldData.activeAccountId;
        try {
            await vault.setActiveAccount(switchId);
        } catch {
            vault.clearActiveAccount();
        }
        const switchData = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; pubkey: string }>>;
        const switchAcct = (switchData.accounts || []).find(a => a.id === switchId);
        const switchPubkey = switchAcct?.pubkey || vault.getActivePubkey();
        if (switchPubkey) {
            config.myPubkey = switchPubkey;
            await browser.storage.sync.set({ myPubkey: switchPubkey });
        }
        await browser.storage.local.set({ activeAccountId: switchId });
        await signer.onActiveAccountChanged(oldAccountId, switchId);
        if (switchPubkey) {
            broadcastAccountChanged(switchPubkey);
        }
        return { ok: true };
    }],

    ['vault_setActiveAccount', async (params) => {
        const newActiveId = params.accountId as string;
        const prevData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        await vault.setActiveAccount(newActiveId);
        await syncActivePubkey();
        // Same invalidation as switchAccount: reject the previous account's
        // pending prompts and clear the getPublicKey cooldown.
        await signer.onActiveAccountChanged(prevData.activeAccountId, newActiveId);
        return { ok: true };
    }],

    ['vault_getActivePubkey', async () => vault.getActivePubkey()],

    ['vault_exportNsec', async (params) => {
        const requested =
          typeof params.accountId === 'string' ? params.accountId : undefined
        const exportData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const accountId = requested || exportData.activeAccountId;
        const privkeyBytes = vault.getPrivkey(accountId);
        if (!privkeyBytes) throw new Error('No private key available');
        try {
            return nsecEncode(bytesToHex(privkeyBytes));
        } finally {
            // finally: a throw inside nsecEncode must not skip zeroing
            privkeyBytes.fill(0);
        }
    }],

    ['vault_exportNcryptsec', async (params) => {
        const requested =
          typeof params.accountId === 'string' ? params.accountId : undefined
        const exportData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const accountId = requested || exportData.activeAccountId;
        const privkeyBytes = vault.getPrivkey(accountId);
        if (!privkeyBytes) throw new Error('No private key available');
        try {
            return await ncryptsecEncode(bytesToHex(privkeyBytes), params.password as string);
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['vault_exportSeed', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const payload = vault.getDecryptedPayload();
        const requested =
          typeof params.accountId === 'string' ? params.accountId : undefined
        const activeId = requested || (await browser.storage.local.get(['activeAccountId']) as Record<string, string>).activeAccountId;
        const activeAcct = payload.accounts.find(a => a.id === activeId);
        if (!activeAcct || activeAcct.type !== 'generated' || !activeAcct.mnemonic) {
            throw new Error('Active account has no seed phrase');
        }
        return { mnemonic: activeAcct.mnemonic, wordCount: activeAcct.mnemonic.split(' ').length };
    }],

    ['vault_importNcryptsec', async (params) => {
        const privkeyHex = await ncryptsecDecode(params.ncryptsec as string, params.password as string);
        const name = await nameForNewKey(
          typeof params.name === 'string' ? params.name : undefined,
        )
        const acct = await accounts.importNsec(privkeyHex, name);
        const { privkey, mnemonic, ...safeAcct } = acct;
        return { account: safeAcct, pubkey: acct.pubkey };
    }],

    ['vault_changePassword', async (params) => {
        const unlocked = await vault.unlock(params.currentPassword as string);
        if (!unlocked) throw new Error('Current password is incorrect');
        await vault.reEncrypt(params.newPassword as string);
        await remirrorEasyIfMatchingActive();
        return { ok: true };
    }],

    ['vault_getActiveAccountType', async () => {
        const typeData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
        const typeAccts = (typeData.accounts as LocalAccountEntry[]) || [];
        const typeActive = typeAccts.find(a => a.id === typeData.activeAccountId);
        if (typeActive) {
            return { type: typeActive.type || 'npub', readOnly: typeActive.readOnly !== false };
        }
        return null;
    }],

    ['vault_destroy', async () => {
        await signer.cancelAllUnlockWaiters();
        await vault.destroy();
        await clearLocalAccounts({
            reason: 'destroy',
            extraRemove: ['autoLockMs', UNLOCK_GUARD_KEY],
        });
        await browser.storage.sync.remove('myPubkey');
        await clearAllRoamingSyncData();
        config.myPubkey = '';
        return { ok: true };
    }],

    /**
     * Sign out: wipe local vault + accounts and clear Sync roaming
     * (Easy blobs, bindings, credential checksums).
     */
    ['vault_logout', async () => {
        await signer.cancelAllUnlockWaiters();
        await vault.destroy();
        await clearLocalAccounts({
            reason: 'logout',
            extraRemove: ['autoLockMs', UNLOCK_GUARD_KEY],
        });
        await browser.storage.sync.remove('myPubkey');
        await clearAllRoamingSyncData();
        config.myPubkey = '';
        return { ok: true };
    }],

    ['vault_getBrowserKeyRoaming', async () => ({
        enabled: await getBrowserKeyRoaming(),
    })],

    ['vault_setBrowserKeyRoaming', async (params) => {
        const enabled = params.enabled === true;
        await setBrowserKeyRoaming(enabled);
        if (!enabled) {
            await clearAllRoamingSyncData();
        } else if (!vault.isLocked()) {
            // Push all X-bound signing accounts into Sync when turning ON.
            const payload = vault.getDecryptedPayload();
            for (const acct of payload.accounts) {
                const tids = boundTwitterIdsOf(acct);
                if (tids.length === 0 || acct.readOnly || !acct.privkey) continue;
                for (const tid of tids) {
                    const at =
                        acct.xBindingMeta?.[tid]?.boundUpdatedAt ??
                        acct.boundUpdatedAt ??
                        Date.now();
                    await upsertEasyBlobForTwitterId(acct.privkey, {
                        boundTwitterId: tid,
                        accountName: acct.name,
                        boundUpdatedAt: at,
                        replace: true,
                        mnemonic: acct.mnemonic,
                    });
                    await upsertXNostrBinding({
                        twitterId: tid,
                        pubkey: acct.pubkey,
                        updatedAt: at,
                    });
                }
            }
        }
        return { ok: true, enabled };
    }],

    ['admin_applyKeyScenario', async (params) => {
        const ctx = await readSessionActiveXContext();
        assertAdminKeyScenarioOperator(ctx.handle);
        if (!isKeyScenarioId(params.scenario)) {
            throw new Error('Unknown key scenario');
        }
        const status = await applyKeyScenario(params.scenario, {
            bindTwitterId: ctx.twitterId,
        });
        resetJustWorksProvisionKick();
        requestPanelSessionRecompute();
        await syncActivePubkey();
        const pubkey = vault.getActivePubkey();
        if (pubkey) {
            await broadcastAccountChanged(pubkey);
        }
        return status;
    }],

    ['admin_getKeyScenarioStatus', async () => {
        const ctx = await readSessionActiveXContext();
        assertAdminKeyScenarioOperator(ctx.handle);
        return readKeyScenarioStatus();
    }],
]);
