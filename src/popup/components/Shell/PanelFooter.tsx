import { t } from '@lib/i18n.js'
import {
  IconEye,
  IconLayers,
  IconSettings,
} from '../../../assets'
import styles from './PanelFooter.module.css'

export type PanelBodyView = 'home' | 'notes'

interface PanelFooterProps {
  activeView: PanelBodyView
  onNotes: () => void
  onGraph: () => void
  onMenu: () => void
}

export default function PanelFooter({
  activeView,
  onNotes,
  onGraph,
  onMenu,
}: PanelFooterProps) {
  return (
    <nav className={styles.footer} aria-label={t('panel.footerNav')}>
      <button
        type="button"
        className={`${styles.btn} ${activeView === 'notes' ? styles.btnActive : ''}`}
        onClick={onNotes}
        title={t('panel.notes')}
      >
        <IconEye />
        <span>{t('panel.notes')}</span>
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
