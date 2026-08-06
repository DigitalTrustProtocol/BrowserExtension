import React, { useCallback, useEffect, useState } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconCloud, IconKey } from '@assets';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

interface MethodStepProps {
  onSelect: (id: string) => void;
  /** When true (add-account flow), Easy create/restore is hidden. */
  hasAccounts?: boolean;
}

type ChromeSignInState = 'loading' | 'signedIn' | 'signedOut';

export default function MethodStep({ onSelect, hasAccounts }: MethodStepProps) {
  const [chromeState, setChromeState] = useState<ChromeSignInState>('loading');

  const refreshChromeSignIn = useCallback(() => {
    rpc<{ signedIn: boolean }>('onboarding_chromeSignedIn')
      .then((r) => setChromeState(r?.signedIn ? 'signedIn' : 'signedOut'))
      .catch(() => setChromeState('signedOut'));
  }, []);

  useEffect(() => {
    refreshChromeSignIn();

    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshChromeSignIn();
    };
    const onFocus = () => refreshChromeSignIn();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshChromeSignIn]);

  const showEasyCta = !hasAccounts && chromeState === 'signedIn';
  const showSignInPrompt = !hasAccounts && chromeState !== 'signedIn';

  const openChromeSignIn = () => {
    void rpc('onboarding_openChromeSignIn')
      .catch(() => {})
      .finally(() => {
        // Re-check shortly after opening settings (user may sign in and return).
        window.setTimeout(refreshChromeSignIn, 1500);
      });
  };

  return (
    <div className={`${styles.step} ${styles.methodStep}`}>
      <h2 className={styles.stepTitle}>
        {hasAccounts ? t('wizard.addAccount') : t('wizard.chooseSetup')}
      </h2>

      <div className={styles.methodGrid}>
        {showEasyCta && (
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

        {showSignInPrompt && !hasAccounts && (
          <div className={styles.signInPrompt}>
            <div className={styles.signInPromptHeader}>
              <div className={styles.methodIcon}>
                <IconCloud />
              </div>
              <div className={styles.methodInfo}>
                <strong>{t('wizard.easySignInRequired')}</strong>
                <span>{t('wizard.easySignInRequiredDesc')}</span>
              </div>
            </div>
            <div className={styles.signInPromptActions}>
              <Button small variant="secondary" onClick={openChromeSignIn}>
                {t('wizard.openChromeSignIn')}
              </Button>
              <Button small variant="secondary" onClick={refreshChromeSignIn}>
                {t('wizard.easySignInRecheck')}
              </Button>
            </div>
          </div>
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
