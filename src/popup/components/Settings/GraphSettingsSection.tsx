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
  type PublicExtensionState,
} from '../../../shared/contracts'
import {
  WOT_SYNC_INTERVAL_OPTIONS,
  WOT_SYNC_INTERVAL_PAUSED_MINUTES,
  WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
} from '../../../shared/wot-sync-interval'
import { WOT_MAX_DEGREE_DEFAULT } from '../../../shared/wot-max-degree'
import WotMaxDegreeControl from './WotMaxDegreeControl'
import styles from './Settings.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

interface SyncStatusView {
  state: 'idle' | 'running' | 'complete' | 'stopped' | 'error'
  finishedAt?: number
  result?: { eventsStored: number; authors: string[]; truncated: boolean }
  error?: string
}

const SYNC_POLL_MS = 2_000

export default function GraphSettingsSection() {
  const [degree, setDegree] = useState(WOT_MAX_DEGREE_DEFAULT)
  const [degreeSaving, setDegreeSaving] = useState(false)
  const [resolveHint, setResolveHint] =
    useState<PublicExtensionState['resolveTimingHint']>()
  const [intervalMinutes, setIntervalMinutes] = useState(
    WOT_SYNC_INTERVAL_DEFAULT_MINUTES,
  )
  const [autoLower, setAutoLower] = useState(true)
  const [appMode, setAppMode] = useState<AppMode>(DEFAULT_APP_MODE)
  const [syncStatus, setSyncStatus] = useState<SyncStatusView>({ state: 'idle' })
  const [message, setMessage] = useState('')
  const pollRef = useRef<number | undefined>(undefined)

  const refreshStatus = useCallback(async () => {
    try {
      const status = await axRequest<SyncStatusView>({
        type: 'GET_WOT_SYNC_STATUS',
        version: BACKGROUND_API_VERSION,
      })
      setSyncStatus(status)
      return status
    } catch {
      return undefined
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [state, interval, auto, mode] = await Promise.all([
          axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
          axRequest<{ intervalMinutes: number }>({
            type: 'GET_WOT_SYNC_INTERVAL',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<{ enabled: boolean }>({
            type: 'GET_WOT_AUTO_LOWER',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<{ mode: AppMode }>({
            type: 'GET_APP_MODE',
            version: BACKGROUND_API_VERSION,
          }),
        ])
        if (cancelled) return
        setDegree(state.wotMaxDegree)
        setResolveHint(state.resolveTimingHint)
        setIntervalMinutes(interval.intervalMinutes)
        setAutoLower(auto.enabled)
        setAppMode(mode.mode)
      } catch {
        /* keep defaults */
      }
      if (!cancelled) void refreshStatus()
    })()
    return () => {
      cancelled = true
      if (pollRef.current !== undefined) clearInterval(pollRef.current)
    }
  }, [refreshStatus])

  const commitDegree = (next: number) => {
    if (next === degree || degreeSaving) return
    setDegreeSaving(true)
    void axRequest<{ degree: number }>({
      type: 'SET_WOT_MAX_DEGREE',
      version: BACKGROUND_API_VERSION,
      degree: next,
    })
      .then((result) => {
        setDegree(result.degree)
        return axRequest<PublicExtensionState>({ type: 'GET_STATE' })
      })
      .then((state) => setResolveHint(state.resolveTimingHint))
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setDegreeSaving(false))
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

  const commitAutoLower = (enabled: boolean) => {
    setAutoLower(enabled)
    void axRequest<{ enabled: boolean }>({
      type: 'SET_WOT_AUTO_LOWER',
      version: BACKGROUND_API_VERSION,
      enabled,
    }).catch((error: unknown) => {
      setAutoLower(!enabled)
      setMessage(error instanceof Error ? error.message : String(error))
    })
  }

  const demo = appMode === 'demo'

  const syncNow = () => {
    if (demo) return
    setMessage('')
    void axRequest<SyncStatusView>({
      type: 'START_WOT_SYNC',
      version: BACKGROUND_API_VERSION,
    })
      .then((status) => {
        setSyncStatus(status)
        if (status.state !== 'running') return
        if (pollRef.current !== undefined) clearInterval(pollRef.current)
        pollRef.current = setInterval(() => {
          void refreshStatus().then((next) => {
            if (next && next.state !== 'running') {
              if (pollRef.current !== undefined) clearInterval(pollRef.current)
              pollRef.current = undefined
            }
          })
        }, SYNC_POLL_MS)
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }

  const running = syncStatus.state === 'running'

  return (
    <div className={styles.section}>
      <SectionLabel>{t('settings.graph.degree')}</SectionLabel>
      <WotMaxDegreeControl
        degree={degree}
        saving={degreeSaving}
        resolveHint={resolveHint}
        onCommit={commitDegree}
        description={t(
          demo
            ? 'settings.graph.degreeHintDemo'
            : 'settings.graph.degreeHint',
        )}
      />

      <SectionLabel>{t('settings.graph.refresh')}</SectionLabel>
      <p className={styles.hint}>{t('settings.graph.refreshDesc')}</p>
      <Select
        value={String(intervalMinutes)}
        aria-label={t('settings.graph.refresh')}
        onChange={(event) => commitInterval(event.target.value)}
        options={[
          ...WOT_SYNC_INTERVAL_OPTIONS.map((minutes) => ({
            value: String(minutes),
            label: t('settings.graph.refreshMinutes', { count: minutes }),
          })),
          {
            value: String(WOT_SYNC_INTERVAL_PAUSED_MINUTES),
            label: t('settings.graph.refreshPaused'),
          },
        ]}
      />

      <SectionLabel>{t('settings.graph.sync')}</SectionLabel>
      <p className={styles.hint}>
        {demo
          ? t('settings.graph.syncDemo')
          : running
            ? t('settings.graph.syncing')
            : syncStatus.finishedAt
              ? t('settings.graph.lastSync', {
                  time: formatTimeAgo(syncStatus.finishedAt),
                })
              : t('settings.graph.lastSyncNever')}
        {!demo && !running && syncStatus.result
          ? ` · ${t('settings.graph.syncStored', { count: syncStatus.result.eventsStored })}`
          : ''}
      </p>
      <Button onClick={syncNow} disabled={running || demo}>
        {running && !demo
          ? t('settings.graph.syncing')
          : t('settings.graph.syncNow')}
      </Button>

      <SectionLabel>{t('settings.graph.autoLower')}</SectionLabel>
      <p className={styles.hint}>{t('settings.graph.autoLowerDesc')}</p>
      <Toggle
        checked={autoLower}
        onChange={commitAutoLower}
        aria-label={t('settings.graph.autoLower')}
      />

      {message ? (
        <p className={styles.hint} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}
