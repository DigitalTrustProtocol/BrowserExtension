import { useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
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
import { WOT_MAX_DEGREE_DEFAULT } from '../../../shared/wot-max-degree'
import {
  DEFAULT_FOLLOW_TRUST_BAND,
  type FollowTrustBand,
} from '../../../shared/wot-follow-trust-threshold'
import WotMaxDegreeControl from './WotMaxDegreeControl'
import WotFollowTrustThresholdControl from './WotFollowTrustThresholdControl'
import styles from './Settings.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export default function GraphSettingsSection() {
  const [degree, setDegree] = useState(WOT_MAX_DEGREE_DEFAULT)
  const [degreeSaving, setDegreeSaving] = useState(false)
  const [followTrust, setFollowTrust] = useState(DEFAULT_FOLLOW_TRUST_BAND)
  const [followTrustSaving, setFollowTrustSaving] = useState(false)
  const [resolveHint, setResolveHint] =
    useState<PublicExtensionState['resolveTimingHint']>()
  const [autoLower, setAutoLower] = useState(true)
  const [appMode, setAppMode] = useState<AppMode>(DEFAULT_APP_MODE)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [state, auto, mode] = await Promise.all([
          axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
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
        setFollowTrust({
          red: state.followTrustRed ?? DEFAULT_FOLLOW_TRUST_BAND.red,
          green: state.followTrustGreen ?? DEFAULT_FOLLOW_TRUST_BAND.green,
        })
        setResolveHint(state.resolveTimingHint)
        setAutoLower(auto.enabled)
        setAppMode(mode.mode)
      } catch {
        /* keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const commitFollowTrust = (next: FollowTrustBand) => {
    if (
      (next.red === followTrust.red && next.green === followTrust.green) ||
      followTrustSaving
    ) {
      return
    }
    setFollowTrustSaving(true)
    void axRequest<FollowTrustBand>({
      type: 'SET_WOT_FOLLOW_TRUST_BAND',
      version: BACKGROUND_API_VERSION,
      red: next.red,
      green: next.green,
    })
      .then((result) => setFollowTrust(result))
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setFollowTrustSaving(false))
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

  return (
    <div className={styles.section}>
      <SectionLabel>{t('settings.graph.degree')}</SectionLabel>
      <WotMaxDegreeControl
        degree={degree}
        saving={degreeSaving}
        resolveHint={resolveHint}
        onCommit={commitDegree}
        description={t(
          demo ? 'settings.graph.degreeHintDemo' : 'settings.graph.degreeHint',
        )}
      />

      <SectionLabel>{t('settings.graph.followTrust')}</SectionLabel>
      <WotFollowTrustThresholdControl
        band={followTrust}
        saving={followTrustSaving}
        onCommit={commitFollowTrust}
        description={t('settings.graph.followTrustHint')}
      />

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
