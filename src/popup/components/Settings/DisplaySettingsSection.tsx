import { useEffect, useState } from 'react'
import Select from '@components/Select/Select'
import Toggle from '@components/Toggle/Toggle'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import { t } from '@lib/i18n.js'
import {
  DEFAULT_X_AUGMENTATION_FEATURES,
  normalizeXAugmentationFeatures,
  TRUST_FILTER_ACTIONS,
  TRUST_FILTER_RESOLUTIONS,
  X_AUGMENTATION_FEATURES_KEY,
  X_AUGMENTATION_PANEL_KEYS,
  type TrustFilterAction,
  type TrustFilterResolution,
  type XAugmentationFeatures,
  type XAugmentationPanelKey,
} from '../../../shared/x-augmentation'
import MenuSection from '../Menu/MenuSection'
import styles from './Settings.module.css'

export default function DisplaySettingsSection() {
  const [features, setFeatures] = useState<XAugmentationFeatures>({
    ...DEFAULT_X_AUGMENTATION_FEATURES,
  })

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

  const setFeature = (key: XAugmentationPanelKey, value: boolean) => {
    const next = { ...features, [key]: value }
    setFeatures(next)
    void chrome.storage.local.set({ [X_AUGMENTATION_FEATURES_KEY]: next })
  }

  const setTrustFilter = (
    resolution: TrustFilterResolution,
    action: TrustFilterAction,
  ) => {
    const next: XAugmentationFeatures = {
      ...features,
      trustFilters: {
        ...features.trustFilters,
        [resolution]: action,
      },
    }
    setFeatures(next)
    void chrome.storage.local.set({ [X_AUGMENTATION_FEATURES_KEY]: next })
  }

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
                {t(`x.ui.filter.${resolution}`)}
              </span>
              <span className={styles.featureHint}>
                {t(`x.ui.filterHint.${resolution}`)}
              </span>
            </div>
            <Select
              small
              className={styles.filterSelect}
              value={features.trustFilters[resolution]}
              options={TRUST_FILTER_ACTIONS.map((action) => ({
                value: action,
                label: t(`x.ui.filterAction.${action}`),
              }))}
              onChange={(event) =>
                setTrustFilter(
                  resolution,
                  event.target.value as TrustFilterAction,
                )
              }
            />
          </label>
        ))}
      </div>
    </MenuSection>
  )
}
