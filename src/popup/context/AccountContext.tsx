import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { t } from '@lib/i18n.js';
import { truncateNpub, getInitial } from '@shared/format/text.ts';
import { rpc } from '@shared/rpc.ts';
import { isXProductHost } from '@shared/x-host-autoconnect.ts';
import { boundTwitterIdsOf } from '../../accounts/x-binding.ts';
import {
  resolveAccountChrome,
  resolveOperatorChrome,
  type OperatorChrome,
  type OperatorXDisplay,
} from '../../shared/operator-chrome.ts';
import type { ActiveXAccountReport } from '../../shared/proof-composer';
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type PublicExtensionState,
  type XIdentityDisplay,
} from '../../shared/contracts';

interface Account {
  id: string;
  pubkey: string;
  name?: string;
  readOnly?: boolean;
  type?: string;
  boundTwitterIds?: string[];
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
  chromeForAccount: (account: Account) => OperatorChrome;
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
  const [xDisplays, setXDisplays] = useState<Record<string, XIdentityDisplay>>({});
  const [activeXDisplay, setActiveXDisplay] = useState<OperatorXDisplay | null>(null);
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
          setActiveXDisplay({
            ...(ensured.account.displayName
              ? { displayName: ensured.account.displayName }
              : {}),
            ...(ensured.account.handle ? { handle: ensured.account.handle } : {}),
            ...(ensured.account.iconPath
              ? { iconPath: ensured.account.iconPath }
              : {}),
          })
          setXTabLocked(true)
          setXAccountResolveError(null)
        } else {
          setActiveXTwitterId(null)
          setActiveXHandle(
            ensured?.status === 'missing' ? (ensured.handle ?? null) : null,
          )
          setActiveXDisplay(null)
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
        setActiveXDisplay(null)
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
        setActiveXDisplay((prev) => prev ?? {
          ...(ext?.activeXAccount?.displayName
            ? { displayName: ext.activeXAccount.displayName }
            : {}),
          ...(ext?.activeXAccount?.handle
            ? { handle: ext.activeXAccount.handle }
            : {}),
          ...(ext?.activeXAccount?.iconPath
            ? { iconPath: ext.activeXAccount.iconPath }
            : {}),
        })
        setXTabLocked(true)
        setXAccountResolveError(null)
      }
    } catch {
      setXTabLocked(false)
      setActiveXTwitterId(null)
      setActiveXHandle(null)
      setActiveXDisplay(null)
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

  const loadXDisplays = useCallback(async (twitterIds: string[]) => {
    const unique = [...new Set(twitterIds.filter((id) => /^[0-9]+$/.test(id)))]
    if (unique.length === 0) return
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_X_IDENTITY_DISPLAYS',
        version: BACKGROUND_API_VERSION,
        twitterIds: unique,
      })) as ExtensionResponse<Record<string, XIdentityDisplay>>
      if (!response?.ok) return
      setXDisplays((prev) => ({ ...prev, ...response.data }))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    const ids: string[] = []
    if (activeXTwitterId) ids.push(activeXTwitterId)
    for (const account of accounts ?? []) {
      for (const id of boundTwitterIdsOf(account)) ids.push(id)
    }
    void loadXDisplays(ids)
  }, [accounts, activeXTwitterId, loadXDisplays])

  useEffect(() => {
    function onMessage(message: { type?: string; twitterId?: string }) {
      if (message?.type !== 'X_IDENTITY_UPDATED') return
      if (typeof message.twitterId === 'string' && /^[0-9]+$/.test(message.twitterId)) {
        void loadXDisplays([message.twitterId])
      }
    }
    browser.runtime.onMessage.addListener(onMessage)
    return () => browser.runtime.onMessage.removeListener(onMessage)
  }, [loadXDisplays])

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

  const chromeForAccount = useCallback(
    (account: Account): OperatorChrome => {
      const cached = profileCache[account.pubkey]
      return resolveAccountChrome({
        signedInTwitterId: activeXTwitterId,
        boundTwitterIds: boundTwitterIdsOf(account),
        xDisplays,
        kind0Name: cached?.name || cached?.display_name,
        kind0Picture: cached?.picture,
        accountName: account.name,
        npubFallback: truncateNpub(account.pubkey),
        emptyFallback: t('topbar.noAccounts'),
      })
    },
    [profileCache, activeXTwitterId, xDisplays],
  )

  const operatorChrome = useMemo((): OperatorChrome => {
    if (!active) {
      return {
        displayName: t('topbar.noAccounts'),
        displaySub: t('topbar.addToStart'),
        avatarUrl: null,
      }
    }
    const boundIds = boundTwitterIdsOf(active)
    const signedDisplay: OperatorXDisplay | undefined = activeXTwitterId
      ? {
          ...xDisplays[activeXTwitterId],
          ...activeXDisplay,
          ...(activeXHandle ? { handle: activeXHandle } : {}),
        }
      : undefined
    const soleId = boundIds.length === 1 ? boundIds[0] : undefined
    return resolveOperatorChrome({
      signedInTwitterId: activeXTwitterId,
      xDisplay: signedDisplay,
      boundTwitterIds: boundIds,
      soleBoundDisplay: soleId ? xDisplays[soleId] : undefined,
      kind0Name: cachedProfile?.name || cachedProfile?.display_name,
      kind0Picture: cachedProfile?.picture,
      accountName: active.name,
      npubFallback: truncateNpub(active.pubkey),
      emptyFallback: t('topbar.noAccounts'),
    })
  }, [
    active,
    activeXTwitterId,
    activeXHandle,
    activeXDisplay,
    xDisplays,
    cachedProfile,
  ])

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
    displayName: operatorChrome.displayName,
    displaySub: active ? operatorChrome.displaySub : t('topbar.addToStart'),
    avatarUrl: operatorChrome.avatarUrl,
    initial: getInitial(operatorChrome.displayName),
    chromeForAccount,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
