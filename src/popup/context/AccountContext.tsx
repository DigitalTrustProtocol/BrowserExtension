import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { t } from '@lib/i18n.js';
import { truncateNpub, getInitial } from '@shared/format/text.ts';
import { rpc } from '@shared/rpc.ts';
import { isXProductHost } from '@shared/x-host-autoconnect.ts';
import type { ActiveXAccountReport } from '../../shared/proof-composer';
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type PublicExtensionState,
} from '../../shared/contracts';

interface Account {
  id: string;
  pubkey: string;
  name?: string;
  readOnly?: boolean;
  type?: string;
  boundTwitterId?: string | null;
  boundUpdatedAt?: number | null;
}

interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  banner?: string;
}

interface ProfileCache {
  [pubkey: string]: ProfileMetadata;
}

interface AccountContextValue {
  accounts: Account[] | null;
  active: Account | null;
  activeId: string | null;
  cachedProfile: ProfileMetadata | null;
  profileCache: ProfileCache;
  /** True when the focused tab is an X host and a numeric twitterId is known. */
  xTabLocked: boolean;
  activeXTwitterId: string | null;
  activeXHandle: string | null;
  needsNostrForX: string | null;
  xBoundAccountId: string | null;
  /** True while ENSURE_ACTIVE_X_ACCOUNT is in flight for an X tab. */
  xAccountResolving: boolean;
  xAccountResolveError: string | null;
  switchAccount: (accountId: string) => Promise<void>;
  reload: () => void;
  isReadOnly: boolean;
  isNip46: boolean;
  displayName: string;
  displaySub: string;
  avatarUrl: string | null;
  initial: string;
}

const AccountContext = createContext<AccountContextValue | null>(null);

interface AccountProviderProps {
  children: ReactNode;
}

type EnsuredActiveXAccount =
  | { status: 'ready'; account: ActiveXAccountReport }
  | { status: 'missing'; reason: string; handle?: string }

async function fetchPublicState(): Promise<PublicExtensionState | null> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'GET_STATE',
      version: BACKGROUND_API_VERSION,
    })) as ExtensionResponse<PublicExtensionState>
    if (!response?.ok) return null
    return response.data
  } catch {
    return null
  }
}

async function ensureActiveXAccount(): Promise<EnsuredActiveXAccount | null> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'ENSURE_ACTIVE_X_ACCOUNT',
      version: BACKGROUND_API_VERSION,
    })) as ExtensionResponse<EnsuredActiveXAccount>
    if (!response?.ok) return null
    return response.data
  } catch {
    return null
  }
}

/**
 * X-tab account lock applies only when the focused browsing tab is X.
 * Having x.com open elsewhere must not lock Nostr switching on other sites.
 * When the active tab is the extension popup itself (no http URL), fall back
 * to lastFocusedWindow's active http(s) tab — not "any X tab in the window".
 */
async function isOnXProductContext(): Promise<boolean> {
  const [active] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  })
  if (active?.url) {
    try {
      const host = new URL(active.url).hostname
      if (isXProductHost(host)) return true
      // Real non-X page is focused — free multi-account NIP-07 selection.
      if (
        !active.url.startsWith('chrome://') &&
        !active.url.startsWith('chrome-extension://') &&
        !active.url.startsWith('edge://') &&
        !active.url.startsWith('about:')
      ) {
        return false
      }
    } catch {
      // ignore invalid urls
    }
  }

  const [lastFocused] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  if (lastFocused?.url) {
    try {
      return isXProductHost(new URL(lastFocused.url).hostname)
    } catch {
      return false
    }
  }
  return false
}

export function AccountProvider({ children }: AccountProviderProps) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [profileCache, setProfileCache] = useState<ProfileCache>({});
  const [xTabLocked, setXTabLocked] = useState(false);
  const [activeXTwitterId, setActiveXTwitterId] = useState<string | null>(null);
  const [activeXHandle, setActiveXHandle] = useState<string | null>(null);
  const [needsNostrForX, setNeedsNostrForX] = useState<string | null>(null);
  const [xBoundAccountId, setXBoundAccountId] = useState<string | null>(null);
  const [xAccountResolving, setXAccountResolving] = useState(false);
  const [xAccountResolveError, setXAccountResolveError] = useState<string | null>(null);
  const fetchedRef = useRef<Set<string>>(new Set());

  const active = accounts?.find((a) => a.id === activeId) || accounts?.[0] || null;

  const refreshXContext = useCallback(async () => {
    try {
      const onX = await isOnXProductContext()

      if (onX) {
        setXAccountResolving(true)
        setXAccountResolveError(null)
        let ensured: EnsuredActiveXAccount | null = null
        for (let attempt = 0; attempt < 3; attempt += 1) {
          ensured = await ensureActiveXAccount()
          if (ensured?.status === 'ready' && ensured.account.twitterId) break
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400))
          }
        }
        if (ensured?.status === 'ready' && ensured.account.twitterId) {
          setActiveXTwitterId(ensured.account.twitterId)
          setActiveXHandle(ensured.account.handle)
          setXTabLocked(true)
          setXAccountResolveError(null)
        } else {
          setActiveXTwitterId(null)
          setActiveXHandle(
            ensured?.status === 'missing' ? (ensured.handle ?? null) : null,
          )
          setXTabLocked(false)
          setXAccountResolveError(
            ensured?.status === 'missing'
              ? ensured.reason
              : 'Waiting for X numeric account ID',
          )
        }
        setXAccountResolving(false)
      } else {
        setXAccountResolving(false)
        setXAccountResolveError(null)
        setActiveXTwitterId(null)
        setActiveXHandle(null)
        setXTabLocked(false)
        // Off X: binding lock must not linger from a background x.com tab.
        setNeedsNostrForX(null)
        setXBoundAccountId(null)
        return
      }

      const ext = await fetchPublicState()
      setNeedsNostrForX(
        typeof ext?.needsNostrForX === 'string' ? ext.needsNostrForX : null,
      )
      setXBoundAccountId(
        typeof ext?.xBoundAccountId === 'string' ? ext.xBoundAccountId : null,
      )
      // Prefer ENSURE result; fall back to GET_STATE if ENSURE missed.
      const stateId =
        typeof ext?.activeXAccount?.twitterId === 'string' &&
        /^[0-9]+$/.test(ext.activeXAccount.twitterId)
          ? ext.activeXAccount.twitterId
          : null
      if (stateId) {
        setActiveXTwitterId((prev) => prev ?? stateId)
        setActiveXHandle((prev) => prev ?? ext?.activeXAccount?.handle ?? null)
        setXTabLocked(true)
        setXAccountResolveError(null)
      }
    } catch {
      setXTabLocked(false)
      setActiveXTwitterId(null)
      setActiveXHandle(null)
      setNeedsNostrForX(null)
      setXBoundAccountId(null)
      setXAccountResolving(false)
      setXAccountResolveError(null)
    }
  }, [])

  const load = useCallback(async () => {
    const data = await browser.storage.local.get(['accounts', 'activeAccountId', 'profileCache']) as Record<string, unknown>;
    const accts: Account[] = (data.accounts as Account[] | undefined) || [];
    const id: string = (data.activeAccountId as string | undefined) || '';

    setAccounts(accts);
    setActiveId(id || accts[0]?.id || null);
    setProfileCache((data.profileCache as ProfileCache | undefined) || {});
    await refreshXContext();
  }, [refreshXContext]);

  useEffect(() => {
    if (!accounts || accounts.length === 0) return;

    const pubkeys = [...new Set(accounts.map((a) => a.pubkey).filter(Boolean))];
    const toFetch = pubkeys.filter((pk) => !fetchedRef.current.has(pk));
    if (toFetch.length === 0) return;
    toFetch.forEach((pk) => fetchedRef.current.add(pk));

    for (const pk of toFetch) {
      rpc<ProfileMetadata | null>('getProfileMetadata', { pubkey: pk })
        .then(async (metadata) => {
          if (!metadata) return;
          const data = await browser.storage.local.get('profileCache') as Record<string, unknown>;
          const pc: ProfileCache = (data.profileCache as ProfileCache | undefined) || {};
          pc[pk] = metadata;
          await browser.storage.local.set({ profileCache: pc });
        })
        .catch(() => {});
    }
  }, [accounts]);

  const switchAccount = useCallback(async (accountId: string) => {
    const account = accounts?.find((a) => a.id === accountId);
    if (!account) return;
    if (accountId === activeId) return;
    const previousId = activeId;
    setActiveId(accountId);
    try {
      await rpc('switchAccount', {
        accountId,
        // Only hard-lock switching once this X user already has a binding.
        xTabContext: Boolean(xBoundAccountId),
      });
    } catch (error) {
      setActiveId(previousId);
      throw error;
    }
  }, [accounts, activeId, xBoundAccountId]);

  const reload = useCallback(() => load(), [load]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onChange(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) {
      if (area === 'local' && (changes.accounts || changes.activeAccountId || changes.profileCache)) {
        load();
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [load]);

  const cachedProfile = active ? profileCache[active.pubkey] : null;

  const value: AccountContextValue = {
    accounts,
    active,
    activeId,
    cachedProfile,
    profileCache,
    xTabLocked,
    activeXTwitterId,
    activeXHandle,
    needsNostrForX,
    xBoundAccountId,
    xAccountResolving,
    xAccountResolveError,
    switchAccount,
    reload,
    isReadOnly: active?.readOnly === true || active?.type === 'npub',
    isNip46: active?.type === 'nip46',
    displayName: cachedProfile?.name || active?.name || t('topbar.noAccounts'),
    displaySub: active
      ? (active.boundTwitterId && activeXHandle
          ? `@${activeXHandle}`
          : cachedProfile?.nip05 || truncateNpub(active.pubkey))
      : t('topbar.addToStart'),
    avatarUrl: cachedProfile?.picture || null,
    initial: getInitial(cachedProfile?.name || active?.name),
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
