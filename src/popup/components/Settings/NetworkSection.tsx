import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { DEFAULT_RELAYS } from '@shared/constants.ts';
import { RELAY_CATALOG } from '@shared/contracts.ts';
import { formatTimeAgo } from '@shared/format/time.ts';
import { normalizeRelayUrl } from '@shared/url.ts';
import {
  activateRelay,
  deactivateRelay,
  forgetInactiveRelay,
  listInactiveRelays,
  normalizeRelayList,
  rememberRelay,
  restoreCatalogRelays,
} from '@shared/relay-list.ts';
import Button from '@components/Button/Button';
import StatusDot from '@components/StatusDot/StatusDot';
import InputRow from '@components/InputRow/InputRow';
import RemoveButton from '@components/RemoveButton/RemoveButton';
import PublishRow from '@components/PublishRow/PublishRow';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';

interface RelayFlags {
  read: boolean;
  write: boolean;
}

type RelayUiHealth = {
  status: 'checking' | 'up' | 'down' | 'unknown';
  error?: string;
  lastSuccessAt?: number;
  consecutiveFailures: number;
};

function dotStatus(health: RelayUiHealth | undefined): string {
  if (!health || health.status === 'unknown') return 'unknown';
  if (health.status === 'checking') return 'checking';
  if (health.status === 'up') return 'reachable';
  if (health.status === 'down') return 'unreachable';
  return 'unknown';
}

function relayScoreText(health: RelayUiHealth | undefined): string {
  const count = health?.consecutiveFailures ?? 0;
  if (!health?.lastSuccessAt) {
    return count > 0
      ? t('network.scoreNeverFailed', { count })
      : t('network.neverConnected');
  }
  const time = formatTimeAgo(health.lastSuccessAt);
  return count > 0
    ? t('network.scoreConnected', { time, count })
    : t('network.scoreConnectedOk', { time });
}

function storedInactiveUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeRelayList(
    value.filter((item): item is string => typeof item === 'string'),
  );
}

export default function NetworkSection() {
  const [relays, setRelays] = useState<string[]>([]);
  const [storedInactive, setStoredInactive] = useState<string[]>([]);
  const [dismissedRelays, setDismissedRelays] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [relayFlags, setRelayFlags] = useState<Record<string, RelayFlags>>({});
  const [relayHealth, setRelayHealth] = useState<Record<string, RelayUiHealth>>({});
  const [newRelay, setNewRelay] = useState<string>('');
  const [relayError, setRelayError] = useState<string>('');

  const [lastPublish, setLastPublish] = useState<number | null>(null);
  const [publishUnsaved, setPublishUnsaved] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishResult, setPublishResult] = useState<'success' | 'error' | null>(null);

  const mounted = useRef<boolean>(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    (async () => {
      const syncData: any = await browser.storage.sync.get(['relays']);
      const localData: any = await browser.storage.local.get([
        'relayFlags',
        'lastRelayPublish',
        'lastPublishedRelays',
        'inactiveRelays',
        'dismissedRelays',
      ]);

      const relayStr: string = syncData.relays || DEFAULT_RELAYS;
      const relayList = normalizeRelayList(relayStr.split(','));
      const activeList = relayList.length > 0
        ? relayList
        : normalizeRelayList(DEFAULT_RELAYS.split(','));
      const inactiveStored = storedInactiveUrls(localData.inactiveRelays)
        .filter((url) => !activeList.includes(url));
      setRelays(activeList);
      setStoredInactive(inactiveStored);
      setDismissedRelays(
        storedInactiveUrls(localData.dismissedRelays).filter((url) => !activeList.includes(url)),
      );
      setRelayFlags(localData.relayFlags || {});

      if (localData.lastRelayPublish) {
        setLastPublish(localData.lastRelayPublish);
      }
      if (localData.lastPublishedRelays && localData.lastPublishedRelays !== activeList.join(',')) {
        setPublishUnsaved(true);
      }

      try {
        const stored = await rpc<Array<{
          relayUrl: string;
          status: string;
          lastError?: string;
          lastSuccessAt?: number;
          consecutiveFailures?: number;
        }>>('getRelayHealth');
        if (mounted.current && Array.isArray(stored)) {
          const seeded: Record<string, RelayUiHealth> = {};
          for (const row of stored) {
            seeded[row.relayUrl] = {
              status: row.status === 'up' || row.status === 'down' ? row.status : 'unknown',
              ...(row.lastError ? { error: row.lastError } : {}),
              ...(typeof row.lastSuccessAt === 'number'
                ? { lastSuccessAt: row.lastSuccessAt }
                : {}),
              consecutiveFailures: row.consecutiveFailures ?? 0,
            };
          }
          setRelayHealth(seeded);
        }
      } catch {
        /* ignore */
      }

      for (const url of activeList) void checkRelay(url);
    })();
  }, []);

  const checkRelay = async (url: string) => {
    setRelayHealth((h) => ({
      ...h,
      [url]: {
        status: 'checking',
        error: h[url]?.error,
        lastSuccessAt: h[url]?.lastSuccessAt,
        consecutiveFailures: h[url]?.consecutiveFailures ?? 0,
      },
    }));
    try {
      const result = await rpc<{
        reachable?: boolean;
        status?: string;
        error?: string;
      }>('checkRelayHealth', { url });
      if (!mounted.current) return;
      if (result?.reachable || result?.status === 'up') {
        setRelayHealth((h) => ({
          ...h,
          [url]: {
            status: 'up',
            lastSuccessAt: Date.now(),
            consecutiveFailures: 0,
          },
        }));
      } else {
        setRelayHealth((h) => ({
          ...h,
          [url]: {
            status: 'down',
            ...(result?.error ? { error: result.error } : {}),
            lastSuccessAt: h[url]?.lastSuccessAt,
            consecutiveFailures: (h[url]?.consecutiveFailures ?? 0) + 1,
          },
        }));
      }
    } catch (error) {
      if (!mounted.current) return;
      setRelayHealth((h) => ({
        ...h,
        [url]: {
          status: 'down',
          error: error instanceof Error ? error.message : t('network.relayDown'),
          lastSuccessAt: h[url]?.lastSuccessAt,
          consecutiveFailures: (h[url]?.consecutiveFailures ?? 0) + 1,
        },
      }));
    }
  };

  const saveRelays = async (
    list: string[],
    inactive: string[],
    flags: Record<string, RelayFlags>,
    dismissed: string[],
  ) => {
    await browser.storage.sync.set({ relays: list.join(',') });
    await browser.storage.local.set({
      relayFlags: flags,
      inactiveRelays: inactive,
      dismissedRelays: dismissed,
    });
    rpcNotify('configUpdated');
  };

  const addRelay = () => {
    const url = normalizeRelayUrl(newRelay);
    if (!url) { setRelayError(t('network.mustBeWss')); return; }
    if (relays.includes(url)) { setRelayError(t('network.relayAlreadyAdded')); return; }
    const next = activateRelay(relays, storedInactive, url);
    const dismissed = rememberRelay(dismissedRelays, url);
    setRelays(next.active);
    setStoredInactive(next.storedInactive);
    setDismissedRelays(dismissed);
    setPendingDelete(null);
    setNewRelay('');
    setRelayError('');
    saveRelays(next.active, next.storedInactive, relayFlags, dismissed);
    void checkRelay(url);
  };

  const turnOn = (url: string) => {
    const next = activateRelay(relays, storedInactive, url);
    const dismissed = rememberRelay(dismissedRelays, url);
    setRelays(next.active);
    setStoredInactive(next.storedInactive);
    setDismissedRelays(dismissed);
    setPendingDelete((current) => (current === url ? null : current));
    setRelayError('');
    saveRelays(next.active, next.storedInactive, relayFlags, dismissed);
    void checkRelay(url);
  };

  const turnOff = (url: string) => {
    if (relays.length <= 1) {
      setRelayError(t('network.keepOneRelay'));
      return;
    }
    const next = deactivateRelay(relays, storedInactive, url);
    const dismissed = rememberRelay(dismissedRelays, url);
    setRelays(next.active);
    setStoredInactive(next.storedInactive);
    setDismissedRelays(dismissed);
    setRelayError('');
    saveRelays(next.active, next.storedInactive, relayFlags, dismissed);
  };

  const restoreDefaults = () => {
    const dismissed = restoreCatalogRelays(relays, dismissedRelays);
    if (
      dismissed.length === dismissedRelays.length
      && dismissed.every((url, index) => url === dismissedRelays[index])
    ) return;
    setDismissedRelays(dismissed);
    saveRelays(relays, storedInactive, relayFlags, dismissed);
  };

  const confirmDelete = (url: string) => {
    const next = forgetInactiveRelay(storedInactive, dismissedRelays, url);
    const flags = { ...relayFlags };
    delete flags[url];
    setStoredInactive(next.storedInactive);
    setDismissedRelays(next.dismissed);
    setRelayFlags(flags);
    setPendingDelete(null);
    saveRelays(relays, next.storedInactive, flags, next.dismissed);
  };

  const toggleRelayFlag = (url: string, flag: 'read' | 'write') => {
    const current = relayFlags[url] || { read: true, write: true };
    const newFlags = { ...relayFlags, [url]: { ...current, [flag]: !current[flag] } };
    setRelayFlags(newFlags);
    saveRelays(relays, storedInactive, newFlags, dismissedRelays);
  };

  const publishRelayList = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await rpc<{ sent?: boolean }>('publishRelayList');
      if (result?.sent) {
        setLastPublish(Date.now());
        setPublishUnsaved(false);
        setPublishResult('success');
      } else {
        setPublishResult('error');
      }
    } catch {
      setPublishResult('error');
    }
    setPublishing(false);
    setTimeout(() => setPublishResult(null), 3000);
  };

  const inactive = listInactiveRelays(
    relays,
    storedInactive,
    RELAY_CATALOG,
    dismissedRelays,
  );

  const renderRelay = (url: string, enabled: boolean) => {
    const health = relayHealth[url];
    const title = health?.status === 'down'
      ? (health.error
        ? t('network.relayDownWithError', { error: health.error })
        : t('network.relayDown'))
      : health?.status === 'up'
        ? t('network.relayUp')
        : health?.status === 'checking'
          ? t('network.relayChecking')
          : relayScoreText(health);
    const flags = relayFlags[url] || { read: true, write: true };
    return (
      <div key={url} className={styles.relayRow}>
        <span className={styles.relayStatus} title={title}>
          <StatusDot
            status={dotStatus(health)}
            className={dotStatus(health) === 'unknown' ? styles.relayIdleDot : ''}
          />
          {health?.status === 'down' ? (
            <span className={styles.relayDownBadge}>{t('network.relayDown')}</span>
          ) : null}
        </span>
        <span className={styles.relayBody}>
          <span className={styles.relayUrl} title={url}>{url}</span>
          <span className={styles.relayScore}>{relayScoreText(health)}</span>
        </span>
        {enabled ? (
          <div className={styles.relayChips}>
            <button
              type="button"
              className={`${styles.relayChip} ${flags.read ? styles.relayChipActive : ''}`}
              onClick={() => toggleRelayFlag(url, 'read')}
            >R</button>
            <button
              type="button"
              className={`${styles.relayChip} ${flags.write ? styles.relayChipActive : ''}`}
              onClick={() => toggleRelayFlag(url, 'write')}
            >W</button>
          </div>
        ) : null}
        {pendingDelete === url ? (
          <>
            <span className={styles.relayConfirm}>{t('network.confirmDeleteRelay')}</span>
            <button
              type="button"
              className={styles.relayChip}
              onClick={() => setPendingDelete(null)}
            >{t('common.cancel')}</button>
            <button
              type="button"
              className={styles.relayChip}
              onClick={() => confirmDelete(url)}
            >{t('common.delete')}</button>
          </>
        ) : (
          <Button
            small
            variant={enabled ? 'primary' : 'secondary'}
            aria-pressed={enabled}
            title={t(enabled ? 'network.deactivateRelay' : 'network.activateRelay', { url })}
            aria-label={t(enabled ? 'network.deactivateRelay' : 'network.activateRelay', { url })}
            onClick={() => { if (enabled) turnOff(url); else turnOn(url); }}
          >{enabled ? t('network.relayOn') : t('network.relayOff')}</Button>
        )}
        {!enabled && pendingDelete !== url ? (
          <RemoveButton
            label={t('network.deleteRelay', { url })}
            onClick={() => setPendingDelete(url)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div className={`${styles.section} ${styles.networkSection}`}>
      <SectionLabel>{t('network.activeRelays')}</SectionLabel>
      <div className={`${styles.relayList} ${styles.relayListActive}`}>
        {relays.map((url) => renderRelay(url, true))}
      </div>

      <InputRow
        value={newRelay}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setNewRelay(e.target.value); setRelayError(''); }}
        placeholder={t('network.relayPlaceholder')}
        onSubmit={addRelay}
        buttonLabel={t('common.add')}
        error={relayError}
        mono
      />

      <PublishRow
        publishing={publishing}
        status={publishResult}
        dirty={publishUnsaved}
        buttonLabel={t('network.publishList')}
        buttonTitle={t('network.publishListHint')}
        extra={(
          <Button
            small
            variant="secondary"
            title={t('network.restoreDefaultHint')}
            onClick={restoreDefaults}
          >{t('network.restoreDefault')}</Button>
        )}
        labels={{
          idle: lastPublish
            ? t('network.lastPublished', { time: formatTimeAgo(lastPublish) })
            : t('network.notPublishedYet'),
          unsaved: t('network.relayListChanged'),
          success: t('network.relayListPublished'),
          error: t('network.relayListFailed'),
          publishing: t('common.publishing'),
        }}
        onPublish={publishRelayList}
      />

      <SectionLabel>{t('network.inactiveRelays')}</SectionLabel>
      {inactive.length === 0 ? (
        <p className={styles.hint}>{t('network.noInactiveRelays')}</p>
      ) : (
        <div className={`${styles.relayList} ${styles.relayListInactive}`}>
          {inactive.map((url) => renderRelay(url, false))}
        </div>
      )}
    </div>
  );
}
