import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@lib/i18n.js'
import { formatTimeAgo } from '@shared/format/time.ts'
import Button from '@components/Button/Button'
import Select from '@components/Select/Select'
import Toggle from '@components/Toggle/Toggle'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import {
  BACKGROUND_API_VERSION,
  DEFAULT_APP_MODE,
  type AppMode,
  type ExtensionRequest,
  type ExtensionResponse,
  type WotSyncStatus,
} from '../../../shared/contracts'
import {
  WOT_SYNC_INTERVAL_OPTIONS,
  WOT_SYNC_INTERVAL_PAUSED_MINUTES,
  WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
} from '../../../shared/wot-sync-interval'
import {
  DEFAULT_SYNC_STRATEGY,
  EXTERNAL_PROFILES_DEFAULT,
  type SyncStrategy,
} from '../../../shared/sync-strategy'
import styles from './Settings.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

const SYNC_POLL_MS = 2_000

const STRATEGY_OPTIONS: { value: SyncStrategy; labelKey: string }[] = [
  {
    value: 'frontier-interval',
    labelKey: 'settings.dataSync.strategy.interval',
  },
  {
    value: 'frontier-continuous',
    labelKey: 'settings.dataSync.strategy.continuous',
  },
  {
    value: 'global-continuous',
    labelKey: 'settings.dataSync.strategy.subscribeAll',
  },
]

function isLiveState(status: WotSyncStatus): boolean {
  if (status.state === 'partial') return !('result' in status)
  return (
    status.state === 'running' ||
    status.state === 'connecting' ||
    status.state === 'live' ||
    status.state === 'reconnecting'
  )
}

export default function DataSynchronizationSettingsSection() {
  const [strategy, setStrategy] = useState<SyncStrategy>(DEFAULT_SYNC_STRATEGY)
  const [intervalMinutes, setIntervalMinutes] = useState(
    WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
  )
  const [externalProfiles, setExternalProfiles] = useState(
    EXTERNAL_PROFILES_DEFAULT,
  )
  const [appMode, setAppMode] = useState<AppMode>(DEFAULT_APP_MODE)
  const [syncStatus, setSyncStatus] = useState<WotSyncStatus>({ state: 'idle' })
  const [message, setMessage] = useState('')
  const pollRef = useRef<number | undefined>(undefined)

  const refreshStatus = useCallback(async () => {
    try {
      const status = await axRequest<WotSyncStatus>({
        type: 'GET_WOT_SYNC_STATUS',
        version: BACKGROUND_API_VERSION,
      })
      setSyncStatus(status)
      return status
    } catch {
      return undefined
    }
  }, [])

  const startPoll = useCallback(() => {
    if (pollRef.current !== undefined) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      void refreshStatus().then((next) => {
        if (next && !isLiveState(next)) {
          if (pollRef.current !== undefined) clearInterval(pollRef.current)
          pollRef.current = undefined
        }
      })
    }, SYNC_POLL_MS)
  }, [refreshStatus])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [interval, mode, nextStrategy, profiles] = await Promise.all([
          axRequest<{ intervalMinutes: number }>({
            type: 'GET_WOT_SYNC_INTERVAL',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<{ mode: AppMode }>({
            type: 'GET_APP_MODE',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<{ strategy: SyncStrategy }>({
            type: 'GET_SYNC_STRATEGY',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<{ enabled: boolean }>({
            type: 'GET_EXTERNAL_PROFILES',
            version: BACKGROUND_API_VERSION,
          }),
        ])
        if (cancelled) return
        setIntervalMinutes(interval.intervalMinutes)
        setAppMode(mode.mode)
        setStrategy(nextStrategy.strategy)
        setExternalProfiles(profiles.enabled)
      } catch {
        /* keep defaults */
      }
      if (cancelled) return
      const status = await refreshStatus()
      if (!cancelled && status && isLiveState(status)) startPoll()
    })()
    return () => {
      cancelled = true
      if (pollRef.current !== undefined) clearInterval(pollRef.current)
    }
  }, [refreshStatus, startPoll])

  const commitStrategy = (value: string) => {
    const prev = strategy
    const next = value as SyncStrategy
    setStrategy(next)
    void axRequest<{ strategy: SyncStrategy }>({
      type: 'SET_SYNC_STRATEGY',
      version: BACKGROUND_API_VERSION,
      strategy: next,
    })
      .then((result) => {
        setStrategy(result.strategy)
        return refreshStatus()
      })
      .then((status) => {
        if (status && isLiveState(status)) startPoll()
      })
      .catch((error: unknown) => {
        setStrategy(prev)
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }

  const commitInterval = (value: string) => {
    const next = Number(value)
    const prev = intervalMinutes
    setIntervalMinutes(next)
    void axRequest<{ intervalMinutes: number }>({
      type: 'SET_WOT_SYNC_INTERVAL',
      version: BACKGROUND_API_VERSION,
      intervalMinutes: next,
    })
      .then((result) => setIntervalMinutes(result.intervalMinutes))
      .catch((error: unknown) => {
        setIntervalMinutes(prev)
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }

  const commitExternalProfiles = (enabled: boolean) => {
    setExternalProfiles(enabled)
    void axRequest<{ enabled: boolean }>({
      type: 'SET_EXTERNAL_PROFILES',
      version: BACKGROUND_API_VERSION,
      enabled,
    }).catch((error: unknown) => {
      setExternalProfiles(!enabled)
      setMessage(error instanceof Error ? error.message : String(error))
    })
  }

  const demo = appMode === 'demo'
  const busy = isLiveState(syncStatus)

  const syncNow = () => {
    if (demo) return
    setMessage('')
    void axRequest<WotSyncStatus>({
      type: 'START_WOT_SYNC',
      version: BACKGROUND_API_VERSION,
    })
      .then((status) => {
        setSyncStatus(status)
        if (isLiveState(status)) startPoll()
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }

  const stopSync = () => {
    if (demo) return
    void axRequest<WotSyncStatus>({
      type: 'STOP_WOT_SYNC',
      version: BACKGROUND_API_VERSION,
    })
      .then((status) => {
        setSyncStatus(status)
        if (pollRef.current !== undefined) {
          clearInterval(pollRef.current)
          pollRef.current = undefined
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }

  const statusHint = (): string => {
    if (demo) return t('settings.dataSync.syncDemo')
    switch (syncStatus.state) {
      case 'running':
        return t('settings.dataSync.syncing')
      case 'connecting':
        return t('settings.dataSync.connecting')
      case 'live':
        return t('settings.dataSync.live')
      case 'reconnecting':
        return t('settings.dataSync.reconnecting')
      case 'partial':
        if ('result' in syncStatus && syncStatus.finishedAt) {
          return t('settings.dataSync.partial', {
            time: formatTimeAgo(syncStatus.finishedAt),
          })
        }
        return t('settings.dataSync.livePartial')
      case 'error':
        return syncStatus.error
      case 'complete':
      case 'stopped':
      case 'idle':
        return syncStatus.state === 'complete' && syncStatus.finishedAt
          ? t('settings.dataSync.lastSync', {
              time: formatTimeAgo(syncStatus.finishedAt),
            })
          : t('settings.dataSync.lastSyncNever')
      default: {
        const _exhaustive: never = syncStatus
        return _exhaustive
      }
    }
  }

  const storedCount =
    !demo && !busy && 'result' in syncStatus
      ? syncStatus.result.eventsStored
      : undefined

  return (
    <div className={styles.section}>
      <SectionLabel>{t('settings.dataSync.strategy')}</SectionLabel>
      <p className={styles.hint}>{t('settings.dataSync.strategyDesc')}</p>
      <Select
        value={strategy}
        aria-label={t('settings.dataSync.strategy')}
        onChange={(event) => commitStrategy(event.target.value)}
        options={STRATEGY_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.labelKey),
        }))}
      />
      {strategy !== 'frontier-interval' ? (
        <p className={styles.hint} role="note">
          {t('settings.dataSync.strategy.continuousHint')}
        </p>
      ) : null}
      {strategy === 'global-continuous' ? (
        <p className={styles.hint} role="note">
          {t('settings.dataSync.strategy.subscribeAllHint')}
        </p>
      ) : null}
      {'kinds' in syncStatus && Array.isArray(syncStatus.kinds) ? (
        <ul className={styles.hint}>
          {syncStatus.kinds.map((row) => (
            <li key={row.kind}>
              {t('settings.dataSync.kindStat', {
                kind: row.kind,
                received: row.received,
                stored: row.stored,
              })}
            </li>
          ))}
        </ul>
      ) : null}

      {strategy === 'frontier-interval' ? (
        <>
          <SectionLabel>{t('settings.dataSync.refresh')}</SectionLabel>
          <p className={styles.hint}>{t('settings.dataSync.refreshDesc')}</p>
          <Select
            value={String(intervalMinutes)}
            aria-label={t('settings.dataSync.refresh')}
            onChange={(event) => commitInterval(event.target.value)}
            options={[
              ...WOT_SYNC_INTERVAL_OPTIONS.map((minutes) => ({
                value: String(minutes),
                label: t('settings.dataSync.refreshMinutes', { count: minutes }),
              })),
              {
                value: String(WOT_SYNC_INTERVAL_PAUSED_MINUTES),
                label: t('settings.dataSync.refreshPaused'),
              },
            ]}
          />
        </>
      ) : null}

      <SectionLabel>{t('settings.dataSync.sync')}</SectionLabel>
      <p className={styles.hint}>
        {statusHint()}
        {storedCount !== undefined
          ? ` · ${t('settings.dataSync.syncStored', { count: storedCount })}`
          : ''}
      </p>
      <div className={styles.relayChips}>
        <Button onClick={syncNow} disabled={busy || demo}>
          {busy && !demo
            ? t('settings.dataSync.syncing')
            : t('settings.dataSync.syncNow')}
        </Button>
        {busy && !demo ? (
          <Button onClick={stopSync}>{t('settings.dataSync.stop')}</Button>
        ) : null}
      </div>

      <SectionLabel>{t('settings.dataSync.externalProfiles')}</SectionLabel>
      <p className={styles.hint}>
        {t('settings.dataSync.externalProfilesDesc')}
      </p>
      <Toggle
        checked={externalProfiles}
        onChange={commitExternalProfiles}
        aria-label={t('settings.dataSync.externalProfiles')}
      />

      {message ? (
        <p className={styles.hint} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}
