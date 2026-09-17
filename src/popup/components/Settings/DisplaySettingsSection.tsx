import { useEffect, useState } from 'react'
import Toggle from '@components/Toggle/Toggle'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import { t } from '@lib/i18n.js'
import {
  type ExtensionRequest,
  type ExtensionResponse,
  type PublicExtensionState,
} from '../../../shared/contracts'
import { subscribeStateTopic } from '../../../shared/state-topics'
import {
  DEFAULT_FOLLOW_TRUST_BAND,
  type FollowTrustBand,
} from '../../../shared/wot-follow-trust-threshold'
import {
  DEFAULT_X_AUGMENTATION_FEATURES,
  normalizeXAugmentationFeatures,
  TRUST_FILTER_RESOLUTIONS,
  X_AUGMENTATION_FEATURES_KEY,
  X_AUGMENTATION_PANEL_KEYS,
  type TrustFilterResolution,
  type XAugmentationFeatures,
  type XAugmentationPanelKey,
} from '../../../shared/x-augmentation'
import MenuSection from '../Menu/MenuSection'
import styles from './Settings.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function bandParams(band: FollowTrustBand): { red: number; green: number } {
  return { red: band.red, green: band.green }
}

export default function DisplaySettingsSection() {
  const [features, setFeatures] = useState<XAugmentationFeatures>({
    ...DEFAULT_X_AUGMENTATION_FEATURES,
  })
  const [followTrust, setFollowTrust] = useState(DEFAULT_FOLLOW_TRUST_BAND)

  useEffect(() => {
    void chrome.storage.local
      .get(X_AUGMENTATION_FEATURES_KEY)
      .then((data: Record<string, unknown>) => {
        setFeatures(
          normalizeXAugmentationFeatures(data[X_AUGMENTATION_FEATURES_KEY]),
        )
      })

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return
      const change = changes[X_AUGMENTATION_FEATURES_KEY]
      if (!change) return
      setFeatures(normalizeXAugmentationFeatures(change.newValue))
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  useEffect(() => {
    let cancelled = false
    void axRequest<PublicExtensionState>({ type: 'GET_STATE' })
      .then((state) => {
        if (cancelled) return
        setFollowTrust({
          red: state.followTrustRed ?? DEFAULT_FOLLOW_TRUST_BAND.red,
          green: state.followTrustGreen ?? DEFAULT_FOLLOW_TRUST_BAND.green,
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return subscribeStateTopic('followTrustThreshold', (message) => {
      setFollowTrust({ red: message.red, green: message.green })
    })
  }, [])

  const setFeature = (key: XAugmentationPanelKey, value: boolean) => {
    const next = { ...features, [key]: value }
    setFeatures(next)
    void chrome.storage.local.set({ [X_AUGMENTATION_FEATURES_KEY]: next })
  }

  const setTrustFilter = (resolution: TrustFilterResolution, hide: boolean) => {
    const next: XAugmentationFeatures = {
      ...features,
      trustFilters: {
        ...features.trustFilters,
        [resolution]: hide,
      },
    }
    setFeatures(next)
    void chrome.storage.local.set({ [X_AUGMENTATION_FEATURES_KEY]: next })
  }

  const cuts = bandParams(followTrust)

  return (
    <MenuSection>
      <p className={styles.hint}>{t('x.ui.featuresHint')}</p>
      <SectionLabel>{t('x.ui.featuresTitle')}</SectionLabel>
      <div className={styles.featureList}>
        {X_AUGMENTATION_PANEL_KEYS.map((key) => (
          <label key={key} className={styles.featureRow}>
            <div className={styles.featureText}>
              <span className={styles.featureLabel}>
                {t(`x.ui.feature.${key}`)}
              </span>
              <span className={styles.featureHint}>
                {t(`x.ui.featureHint.${key}`)}
              </span>
            </div>
            <Toggle
              checked={features[key]}
              onChange={(checked) => setFeature(key, checked)}
            />
          </label>
        ))}
      </div>

      <SectionLabel>{t('x.ui.filtersTitle')}</SectionLabel>
      <p className={styles.hint}>{t('x.ui.filtersHint')}</p>
      <div className={styles.featureList}>
        {TRUST_FILTER_RESOLUTIONS.map((resolution) => (
          <label key={resolution} className={styles.featureRow}>
            <div className={styles.featureText}>
              <span className={styles.featureLabel}>
                {t(`x.ui.filter.${resolution}`, cuts)}
              </span>
              <span className={styles.featureHint}>
                {t(`x.ui.filterHint.${resolution}`, cuts)}
              </span>
            </div>
            <Toggle
              checked={features.trustFilters[resolution]}
              onChange={(checked) => setTrustFilter(resolution, checked)}
            />
          </label>
        ))}
      </div>
    </MenuSection>
  )
}
