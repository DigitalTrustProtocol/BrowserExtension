import { useEffect } from 'react'
import { IconChevronLeft } from '../../assets'
import { t } from '../../lib/i18n'
import type {
  GraphFinalStatementFilter,
  GraphViewSettings,
} from './types'
import styles from './GraphOverlays.module.css'

const FINAL_STATEMENT_OPTIONS = ['trust', 'neutral', 'distrust'] as const

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

function finalStatementLabelKey(
  filter: (typeof FINAL_STATEMENT_OPTIONS)[number],
): string {
  switch (filter) {
    case 'trust':
      return 'graph.trust'
    case 'neutral':
      return 'graph.neutral'
    case 'distrust':
      return 'graph.distrust'
    default: {
      const _exhaustive: never = filter
      return _exhaustive
    }
  }
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

  const isPath = mode === 'path'

  const set = <K extends keyof GraphViewSettings>(
    key: K,
    value: GraphViewSettings[K],
  ) => {
    onChange({ ...settings, [key]: value })
  }

  const setFinalStatementFilter = (filter: GraphFinalStatementFilter) => {
    onChange({ ...settings, finalStatementFilter: filter })
  }

  const resetFinalStatements = () => {
    onChange({
      ...settings,
      finalStatementFilter: 'all',
      search: '',
    })
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
          <span>{t('graph.search')}</span>
          <input
            type="search"
            value={settings.search}
            placeholder={t('graph.searchPlaceholder')}
            onChange={(e) => set('search', e.target.value)}
          />
        </label>
        <div
          className={styles.filterLinks}
          role="group"
          aria-label={t('graph.filterFinalStatements')}
        >
          <span className={styles.filterOn}>
            {t('graph.filterFinalStatements')}
          </span>
          {FINAL_STATEMENT_OPTIONS.map((option) => {
            const selected = settings.finalStatementFilter === option
            return (
              <button
                key={option}
                type="button"
                className={
                  selected
                    ? `${styles.quickLink} ${styles.quickLinkActive}`
                    : styles.quickLink
                }
                aria-pressed={selected}
                onClick={() => setFinalStatementFilter(option)}
              >
                {t(finalStatementLabelKey(option))}
              </button>
            )
          })}
          <button
            type="button"
            className={`${styles.quickLink} ${styles.quickLinkReset}`}
            onClick={resetFinalStatements}
          >
            {t('graph.reset')}
          </button>
        </div>
        <p className={styles.hint}>{t('graph.filterFinalStatementsHint')}</p>
        {!isPath ? (
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
        ) : null}
      </section>

      <section className={styles.section}>
        <h3>{t('graph.section.display')}</h3>
        {!isPath ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={settings.colorByTrust}
              onChange={(e) => set('colorByTrust', e.target.checked)}
            />
            {t('graph.colorBy')}
          </label>
        ) : null}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={settings.showLabels}
            onChange={(e) => set('showLabels', e.target.checked)}
          />
          {t('graph.showLabels')}
        </label>
        {!isPath ? (
          <>
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
          </>
        ) : null}
      </section>
    </aside>
  )
}
