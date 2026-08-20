import { useEffect } from 'react'
import { IconChevronLeft } from '../../assets'
import { t } from '../../lib/i18n'
import type { GraphViewSettings } from './types'
import styles from './GraphOverlays.module.css'

export interface GraphSettingsOverlayProps {
  open: boolean
  settings: GraphViewSettings
  mode: 'graph' | 'path'
  canPath: boolean
  canResetFocus: boolean
  onClose: () => void
  onChange: (next: GraphViewSettings) => void
  onModeChange: (mode: 'graph' | 'path') => void
  onResetFocus: () => void
}

export default function GraphSettingsOverlay({
  open,
  settings,
  mode,
  canPath,
  canResetFocus,
  onClose,
  onChange,
  onModeChange,
  onResetFocus,
}: GraphSettingsOverlayProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  const set = <K extends keyof GraphViewSettings>(
    key: K,
    value: GraphViewSettings[K],
  ) => {
    onChange({ ...settings, [key]: value })
  }

  return (
    <aside
      className={styles.panel}
      role="complementary"
      aria-label={t('graph.settings')}
    >
      <button
        type="button"
        className={styles.panelChevron}
        aria-label={t('graph.collapseSettings')}
        onClick={onClose}
      >
        <IconChevronLeft size={18} aria-hidden="true" />
      </button>

      <div className={styles.panelHeader}>
        <h2>{t('graph.settings')}</h2>
      </div>

      <section className={styles.section}>
        <h3>{t('graph.section.mode')}</h3>
        <div className={styles.segment}>
          <button
            type="button"
            className={mode === 'graph' ? styles.segmentActive : undefined}
            onClick={() => onModeChange('graph')}
          >
            {t('graph.mode.graph')}
          </button>
          <button
            type="button"
            className={mode === 'path' ? styles.segmentActive : undefined}
            disabled={!canPath}
            onClick={() => onModeChange('path')}
          >
            {t('graph.mode.path')}
          </button>
        </div>
        {canResetFocus ? (
          <button
            type="button"
            className={styles.resetBtn}
            onClick={onResetFocus}
          >
            {t('graph.resetToMe')}
          </button>
        ) : null}
      </section>

      <section className={styles.section}>
        <h3>{t('graph.section.filters')}</h3>
        <label className={styles.field}>
          <span>{t('graph.direction')}</span>
          <select
            value={settings.direction}
            onChange={(e) =>
              set(
                'direction',
                e.target.value as GraphViewSettings['direction'],
              )
            }
          >
            <option value="both">{t('graph.both')}</option>
            <option value="out">{t('graph.outgoing')}</option>
            <option value="in">{t('graph.incoming')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('graph.trustPolarity')}</span>
          <select
            value={settings.valueFilter}
            onChange={(e) =>
              set(
                'valueFilter',
                e.target.value as GraphViewSettings['valueFilter'],
              )
            }
          >
            <option value="both">{t('graph.both')}</option>
            <option value="trust">{t('graph.trust')}</option>
            <option value="distrust">{t('graph.distrust')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('graph.maxHops')}</span>
          <input
            type="range"
            min={1}
            max={6}
            value={settings.maxHops}
            onChange={(e) => set('maxHops', Number(e.target.value))}
          />
          <em>{settings.maxHops}</em>
        </label>
        <label className={styles.field}>
          <span>{t('graph.context')}</span>
          <select
            value={settings.context}
            onChange={(e) => set('context', e.target.value)}
          >
            <option value="">{t('graph.all')}</option>
            <option value="identity">identity</option>
            <option value="news:accuracy">news:accuracy</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('graph.search')}</span>
          <input
            type="search"
            value={settings.search}
            placeholder={t('graph.searchPlaceholder')}
            onChange={(e) => set('search', e.target.value)}
          />
        </label>
      </section>

      <section className={styles.section}>
        <h3>{t('graph.section.display')}</h3>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.showLabels}
            onChange={(e) => set('showLabels', e.target.checked)}
          />
          {t('graph.showLabels')}
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.showArrows}
            onChange={(e) => set('showArrows', e.target.checked)}
          />
          {t('graph.showArrows')}
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.showUserIcons}
            onChange={(e) => set('showUserIcons', e.target.checked)}
          />
          {t('graph.showUserIcons')}
        </label>
        <p className={styles.hint}>{t('graph.showUserIconsHint')}</p>
        <label className={styles.field}>
          <span>{t('graph.layout')}</span>
          <select
            value={settings.layout}
            onChange={(e) =>
              set('layout', e.target.value as GraphViewSettings['layout'])
            }
          >
            <option value="force">{t('graph.layout.force')}</option>
            <option value="radial">{t('graph.layout.radial')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('graph.colorBy')}</span>
          <select
            value={settings.colorBy}
            onChange={(e) =>
              set('colorBy', e.target.value as GraphViewSettings['colorBy'])
            }
          >
            <option value="trust">{t('graph.color.trust')}</option>
            <option value="distance">{t('graph.color.distance')}</option>
          </select>
        </label>
      </section>
    </aside>
  )
}
