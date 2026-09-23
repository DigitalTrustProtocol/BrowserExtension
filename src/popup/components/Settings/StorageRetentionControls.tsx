import { useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import Button from '@components/Button/Button'
import Input from '@components/Input/Input'
import Toggle from '@components/Toggle/Toggle'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import { formatBytes } from '@shared/format/bytes.ts'
import { formatTimeAgo } from '@shared/format/time.ts'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type StorageRetentionState,
} from '../../../shared/contracts'
import {
  STORAGE_RETENTION_DEFAULTS,
  type StorageRetentionSettings,
} from '../../../shared/storage-retention'
import styles from './Settings.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

const MB = 1024 * 1024

type NumericKey = 'softBudgetMb' | 'hardBudgetMb' | 'postIdleDays'
type ToggleKey = 'prunePostEvents' | 'pruneUserEvents'

const FIELDS: { key: NumericKey; labelKey: string }[] = [
  { key: 'softBudgetMb', labelKey: 'settings.storage.softBudget' },
  { key: 'hardBudgetMb', labelKey: 'settings.storage.hardBudget' },
  { key: 'postIdleDays', labelKey: 'settings.storage.postIdle' },
]

const TOGGLES: { key: ToggleKey; labelKey: string; hintKey: string }[] = [
  {
    key: 'prunePostEvents',
    labelKey: 'settings.storage.prunePosts',
    hintKey: 'settings.storage.prunePostsDesc',
  },
  {
    key: 'pruneUserEvents',
    labelKey: 'settings.storage.pruneUsers',
    hintKey: 'settings.storage.pruneUsersDesc',
  },
]

type Drafts = Record<NumericKey, string>

function draftsFrom(settings: StorageRetentionSettings): Drafts {
  return {
    softBudgetMb: String(settings.softBudgetMb),
    hardBudgetMb: String(settings.hardBudgetMb),
    postIdleDays: String(settings.postIdleDays),
  }
}

function summary(state: StorageRetentionState): string {
  const { settings, stats } = state
  const idle = formatBytes(
    stats.idlePosts.estimatedBytes + stats.outsideWot.estimatedBytes,
  )
  const budget = formatBytes(settings.softBudgetMb * MB)
  if (stats.usageBytes === undefined) {
    return t('settings.storage.summaryUnknown', { budget, idle })
  }
  return t('settings.storage.summary', {
    used: formatBytes(stats.usageBytes),
    budget,
    idle,
  })
}

export default function StorageRetentionControls() {
  const [state, setState] = useState<StorageRetentionState>()
  const [drafts, setDrafts] = useState<Drafts>()
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void axRequest<StorageRetentionState>({
      type: 'GET_STORAGE_RETENTION',
      version: BACKGROUND_API_VERSION,
    })
      .then((next) => {
        if (cancelled) return
        setState(next)
        setDrafts(draftsFrom(next.settings))
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = (settings: StorageRetentionSettings) => {
    if (!state) return
    const previous = state.settings
    setMessage('')
    void axRequest<StorageRetentionState>({
      type: 'SET_STORAGE_RETENTION',
      version: BACKGROUND_API_VERSION,
      settings,
    })
      .then((next) => {
        setState(next)
        setDrafts(draftsFrom(next.settings))
      })
      .catch((error: unknown) => {
        setDrafts(draftsFrom(previous))
        setMessage(error instanceof Error ? error.message : String(error))
      })
  }

  const commit = (key: NumericKey) => {
    if (!state || !drafts) return
    const value = Number(drafts[key])
    if (!Number.isFinite(value) || value === state.settings[key]) {
      setDrafts(draftsFrom(state.settings))
      return
    }
    save({ ...state.settings, [key]: value })
  }

  const isDefault =
    state !== undefined &&
    (Object.keys(STORAGE_RETENTION_DEFAULTS) as (keyof StorageRetentionSettings)[])
      .every((key) => state.settings[key] === STORAGE_RETENTION_DEFAULTS[key])

  const prune = state?.stats.prune

  return (
    <>
      <div className={styles.group}>
        <SectionLabel>{t('settings.storage.title')}</SectionLabel>
        <p className={styles.hint}>
          {state ? summary(state) : t('settings.storage.loading')}
        </p>
        {state?.stats.budgetStatus === 'overHard' ? (
          <p className={styles.hint} role="alert">
            {t('settings.storage.overHard')}
          </p>
        ) : state?.stats.budgetStatus === 'overSoft' ? (
          <p className={styles.hint} role="note">
            {t('settings.storage.overSoft')}
          </p>
        ) : null}
        {state?.stats.persisted === false ? (
          <p className={styles.hint} role="note">
            {t('settings.storage.notPersisted')}
          </p>
        ) : null}
        <p className={styles.hint}>{t('settings.storage.desc')}</p>
        {drafts ? (
          <div className={styles.retentionGrid}>
            {FIELDS.map((field) => (
              <Input
                key={field.key}
                type="number"
                small
                min={1}
                label={t(field.labelKey)}
                aria-label={t(field.labelKey)}
                value={drafts[field.key]}
                onChange={(event) =>
                  setDrafts({ ...drafts, [field.key]: event.target.value })
                }
                onBlur={() => commit(field.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      {state ? (
        <div className={styles.group}>
          <SectionLabel>{t('settings.storage.pruneTitle')}</SectionLabel>
          <p className={styles.hint}>{t('settings.storage.pruneDesc')}</p>
          <div className={styles.featureList}>
            {TOGGLES.map((toggle) => (
              <label key={toggle.key} className={styles.featureRow}>
                <div className={styles.featureText}>
                  <span className={styles.featureLabel}>
                    {t(toggle.labelKey)}
                  </span>
                  <span className={styles.featureHint}>
                    {t(toggle.hintKey)}
                  </span>
                </div>
                <Toggle
                  checked={state.settings[toggle.key]}
                  onChange={(enabled) =>
                    save({ ...state.settings, [toggle.key]: enabled })
                  }
                  aria-label={t(toggle.labelKey)}
                />
              </label>
            ))}
          </div>
          {prune?.lastRunAt !== undefined ? (
            <p className={styles.hint}>
              {t('settings.storage.pruneLastRun', {
                count: prune.lastDeleted,
                time: formatTimeAgo(prune.lastRunAt),
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {drafts ? (
        <div className={styles.groupActions}>
          <Button
            small
            variant="secondary"
            disabled={isDefault}
            onClick={() => save({ ...STORAGE_RETENTION_DEFAULTS })}
          >
            {t('settings.storage.resetDefaults')}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p className={styles.hint} role="alert">
          {message}
        </p>
      ) : null}
    </>
  )
}
