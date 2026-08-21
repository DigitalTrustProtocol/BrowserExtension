import { t } from '@lib/i18n.js'
import {
  IconLayers,
  IconMerge,
  IconSettings,
} from '../../../assets'
import styles from './PanelFooter.module.css'

export type PanelBodyView = 'home' | 'notes'

interface PanelFooterProps {
  pathEnabled: boolean
  onPath: () => void
  onGraph: () => void
  onMenu: () => void
}

export default function PanelFooter({
  pathEnabled,
  onPath,
  onGraph,
  onMenu,
}: PanelFooterProps) {
  return (
    <nav className={styles.footer} aria-label={t('panel.footerNav')}>
      <button
        type="button"
        className={styles.btn}
        onClick={onPath}
        disabled={!pathEnabled}
        title={t('panel.path')}
      >
        <IconMerge />
        <span>{t('panel.path')}</span>
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onGraph}
        title={t('panel.graph')}
      >
        <IconLayers />
        <span>{t('panel.graph')}</span>
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onMenu}
        title={t('panel.menu')}
      >
        <IconSettings />
        <span>{t('panel.menu')}</span>
      </button>
    </nav>
  )
}
