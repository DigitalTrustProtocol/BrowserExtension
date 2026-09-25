import { t } from '@lib/i18n.js';
import { IconCloud, IconKey, IconLock } from '@assets';
import styles from './WizardOverlay.module.css';

interface MethodStepProps {
  onSelect: (id: string) => void;
  /** When true (add-account flow), Easy create/restore is hidden. */
  hasAccounts?: boolean;
}

export default function MethodStep({ onSelect, hasAccounts }: MethodStepProps) {
  return (
    <div className={`${styles.step} ${styles.methodStep}`}>
      <h2 className={styles.stepTitle}>
        {hasAccounts ? t('wizard.addAccount') : t('wizard.chooseSetup')}
      </h2>

      <div className={styles.methodGrid}>
        {!hasAccounts && (
          <>
            <button
              className={`${styles.methodCard} ${styles.methodPrimary}`}
              onClick={() => onSelect('easy')}
              type="button"
            >
              <div className={styles.methodIcon}>
                <IconCloud />
              </div>
              <div className={styles.methodInfo}>
                <strong>{t('wizard.useBrowserAccount')}</strong>
                <span>{t('wizard.useBrowserAccountDesc')}</span>
              </div>
            </button>
            <p className={styles.methodHint}>{t('wizard.easySyncHint')}</p>
          </>
        )}

        {hasAccounts && (
          <p className={styles.methodHint}>{t('wizard.easyBackupInSettingsHint')}</p>
        )}

        <div className={styles.methodDivider}>
          <div className={styles.methodDividerLine} />
          <span className={styles.methodDividerText}>{t('common.or')}</span>
          <div className={styles.methodDividerLine} />
        </div>

        <button
          className={styles.methodCard}
          type="button"
          onClick={() => onSelect('credential')}
        >
          <div className={styles.methodIcon}>
            <IconLock />
          </div>
          <div className={styles.methodInfo}>
            <strong>{t('wizard.credentialMethod')}</strong>
            <span>{t('wizard.credentialMethodDesc')}</span>
          </div>
        </button>

        <div className={styles.methodDivider}>
          <div className={styles.methodDividerLine} />
          <span className={styles.methodDividerText}>{t('common.or')}</span>
          <div className={styles.methodDividerLine} />
        </div>

        <button
          className={styles.methodCard}
          type="button"
          onClick={() => onSelect('advanced')}
        >
          <div className={styles.methodIcon}>
            <IconKey />
          </div>
          <div className={styles.methodInfo}>
            <strong>{t('wizard.showAdvancedSetup')}</strong>
            <span>{t('wizard.showAdvancedSetupDesc')}</span>
          </div>
        </button>
      </div>
    </div>
  );
}
