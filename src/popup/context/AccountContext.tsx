import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { t } from '@lib/i18n.js';
import { truncateNpub, getInitial } from '@shared/format/text.ts';
import { rpc } from '@shared/rpc.ts';
import { boundTwitterIdsOf } from '../../accounts/x-binding.ts';
import {
  resolveAccountChrome,
  resolveOperatorChrome,
  type OperatorChrome,
  type OperatorXDisplay,
} from '../../shared/operator-chrome.ts';
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type OperatorXBindingRow,
  type XIdentityDisplay,
} from '../../shared/contracts';
import { subscribeStateTopic } from '../../shared/state-topics.ts';
import { usePanelSession } from './PanelSessionContext';
import { useViewer } from './ViewerContext';
import type { PanelSessionSnapshot } from '../../shared/panel-session.ts';
import { liveSetupIssues } from '../../shared/operator-binding-status.ts';

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
  /** True while the focused X tab is still resolving in the snapshot. */
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
  avatarBindingStatus: 'complete' | 'warning' | null;
  knownXCount: number;
  operatorBindings: OperatorXBindingRow[];
  operatorBindingsReady: boolean;
  reloadOperatorBindings: () => Promise<void>;
  /** Settings path for the header avatar. */
  identityMenuSection: string;
}

const AccountContext = createContext<AccountContextValue | null>(null);

interface AccountProviderProps {
  children: ReactNode;
}

function applySnapshotXFields(
  snapshot: PanelSessionSnapshot,
  setters: {
    setXTabLocked: (value: boolean) => void
    setActiveXTwitterId: (value: string | null) => void
    setActiveXHandle: (value: string | null) => void
    setNeedsNostrForX: (value: string | null) => void
    setXBoundAccountId: (value: string | null) => void
    setXAccountResolving: (value: boolean) => void
    setXAccountResolveError: (value: string | null) => void
    setActiveXDisplay: (value: OperatorXDisplay | null) => void
  },
): void {
  const { x, binding, site } = snapshot
  const onX =
    (site.kind === 'connected' || site.kind === 'disconnected') && site.isX
  setters.setXTabLocked(onX && x.kind === 'identified')
  if (x.kind === 'identified') {
    setters.setActiveXTwitterId(x.twitterId)
    setters.setActiveXHandle(x.handle ?? null)
    setters.setActiveXDisplay(
      x.handle ? { handle: x.handle } : null,
    )
    setters.setXAccountResolving(false)
    setters.setXAccountResolveError(null)
  } else {
    setters.setActiveXTwitterId(null)
    setters.setActiveXHandle(null)
    setters.setActiveXDisplay(null)
    setters.setXAccountResolving(false)
    setters.setXAccountResolveError(null)
  }
  if (binding.kind === 'localBound') {
    setters.setXBoundAccountId(binding.accountId)
    setters.setNeedsNostrForX(null)
  } else if (x.kind === 'identified') {
    setters.setXBoundAccountId(null)
    setters.setNeedsNostrForX(x.twitterId)
  } else {
    setters.setXBoundAccountId(null)
    setters.setNeedsNostrForX(null)
  }
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
  const [operatorBindings, setOperatorBindings] = useState<OperatorXBindingRow[]>([]);
  const [operatorBindingsReady, setOperatorBindingsReady] = useState(false);
  const { snapshot } = usePanelSession()
  const { viewer } = useViewer()
  const fetchedRef = useRef<Set<string>>(new Set());

  const active = accounts?.find((a) => a.id === activeId) || accounts?.[0] || null;

  useEffect(() => {
    if (!snapshot) return
    applySnapshotXFields(snapshot, {
      setXTabLocked,
      setActiveXTwitterId,
      setActiveXHandle,
      setNeedsNostrForX,
      setXBoundAccountId,
      setXAccountResolving,
      setXAccountResolveError,
      setActiveXDisplay,
    })
  }, [snapshot])

  const load = useCallback(async () => {
    const data = await browser.storage.local.get(['accounts', 'activeAccountId', 'profileCache']) as Record<string, unknown>;
    const accts: Account[] = (data.accounts as Account[] | undefined) || [];
    const id: string = (data.activeAccountId as string | undefined) || '';

    setAccounts(accts);
    setActiveId(id || accts[0]?.id || null);
    setProfileCache((data.profileCache as ProfileCache | undefined) || {});
  }, []);

  useEffect(() => {
    if (!accounts || accounts.length === 0) return;

    const pubkeys = [...new Set(accounts.map((a) => a.pubkey).filter(Boolean))];
    const toFetch = pubkeys.filter((pk) => !fetchedRef.current.has(pk));
    if (toFetch.length === 0) return;
    toFetch.forEach((pk) => fetchedRef.current.add(pk));

    for (const pk of toFetch) {
      rpc<ProfileMetadata | null>('peekProfileMetadata', { pubkey: pk })
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

  const loadOperatorBindings = useCallback(async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: 'GET_OPERATOR_X_BINDINGS',
        version: BACKGROUND_API_VERSION,
      })) as ExtensionResponse<OperatorXBindingRow[]>
      if (!response?.ok) return
      setOperatorBindings(response.data)
    } catch {
      /* ignore */
    } finally {
      setOperatorBindingsReady(true)
    }
  }, [])

  useEffect(() => {
    void loadOperatorBindings()
  }, [loadOperatorBindings, accounts, activeXTwitterId])

  useEffect(() => {
    const ids: string[] = []
    if (activeXTwitterId) ids.push(activeXTwitterId)
    if (viewer?.origin === 'impersonation' && viewer.twitterId) {
      ids.push(viewer.twitterId)
    }
    for (const account of accounts ?? []) {
      for (const id of boundTwitterIdsOf(account)) ids.push(id)
    }
    void loadXDisplays(ids)
  }, [accounts, activeXTwitterId, loadXDisplays, viewer])

  useEffect(() => {
    const stopIdentity = subscribeStateTopic('identity', (message) => {
      if (/^[0-9]+$/.test(message.twitterId)) {
        void loadXDisplays([message.twitterId])
      }
      void loadOperatorBindings()
    })
    const stopProfileMetadata = subscribeStateTopic(
      'profileMetadata',
      (message) => {
        if (!/^[0-9a-f]{64}$/i.test(message.pubkey)) return
        const pk = message.pubkey.toLowerCase()
        void rpc<ProfileMetadata | null>('peekProfileMetadata', { pubkey: pk })
          .then(async (metadata) => {
            if (!metadata) return
            const data = await browser.storage.local.get('profileCache') as Record<string, unknown>
            const pc: ProfileCache = (data.profileCache as ProfileCache | undefined) || {}
            pc[pk] = metadata
            await browser.storage.local.set({ profileCache: pc })
          })
          .catch(() => {})
      },
    )
    return () => {
      stopIdentity()
      stopProfileMetadata()
    }
  }, [loadXDisplays, loadOperatorBindings])

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

  const cachedProfile = active ? profileCache[active.pubkey] : null

  const knownXCount = operatorBindings.length
  const avatarBindingStatus = useMemo((): 'complete' | 'warning' | null => {
    if (snapshot?.appMode === 'demo') return null
    const liveStatus = (
      completeness: OperatorXBindingRow['completeness'],
    ): 'complete' | 'warning' =>
      liveSetupIssues(completeness).length === 0 ? 'complete' : 'warning'
    const signedIn = operatorBindings.find((row) => row.signedIn)
    if (signedIn) return liveStatus(signedIn.completeness)
    if (activeXTwitterId) return 'warning'
    const boundIds = active ? boundTwitterIdsOf(active) : []
    if (boundIds.length === 1) {
      const sole = operatorBindings.find((row) => row.twitterId === boundIds[0])
      if (!sole) return 'warning'
      return liveStatus(sole.completeness)
    }
    return null
  }, [operatorBindings, activeXTwitterId, active, snapshot?.appMode])

  const identityMenuSection = useMemo(() => {
    if (activeXTwitterId) return `bindings/${activeXTwitterId}`
    const boundIds = active ? boundTwitterIdsOf(active) : []
    if (boundIds.length === 1) return `bindings/${boundIds[0]}`
    if (knownXCount > 0 || boundIds.length > 1) return 'bindings'
    return 'users'
  }, [activeXTwitterId, active, knownXCount])

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
    if (viewer?.origin === 'impersonation' && viewer.twitterId) {
      return resolveOperatorChrome({
        signedInTwitterId: viewer.twitterId,
        xDisplay: xDisplays[viewer.twitterId],
        boundTwitterIds: [viewer.twitterId],
        npubFallback:
          snapshot?.appMode === 'demo'
            ? t('topbar.noAccounts')
            : viewer.pubkey
              ? truncateNpub(viewer.pubkey)
              : t('topbar.noAccounts'),
        emptyFallback: t('topbar.noAccounts'),
      })
    }
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
    viewer,
    snapshot?.appMode,
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
    displaySub:
      active || viewer?.origin === 'impersonation'
        ? operatorChrome.displaySub
        : t('topbar.addToStart'),
    avatarUrl: operatorChrome.avatarUrl,
    initial: getInitial(operatorChrome.displayName),
    chromeForAccount,
    avatarBindingStatus,
    knownXCount,
    operatorBindings,
    operatorBindingsReady,
    reloadOperatorBindings: loadOperatorBindings,
    identityMenuSection,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
