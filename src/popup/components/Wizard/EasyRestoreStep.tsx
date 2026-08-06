import { useState } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { npubEncode } from '@lib/crypto/bech32.js';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

interface EasyRestoreStepProps {
  pubkeyHint: string;
  accountName?: string;
  onRestored: (account: unknown) => void;
}

export default function EasyRestoreStep({
  pubkeyHint,
  accountName,
  onRestored,
}: EasyRestoreStepProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  let npubShort = pubkeyHint.slice(0, 12) + '…' + pubkeyHint.slice(-8);
  try {
    const npub = npubEncode(pubkeyHint);
    npubShort = npub.slice(0, 16) + '…' + npub.slice(-8);
  } catch {
    /* keep hex short form */
  }

  const handleRestore = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await rpc<{ account: unknown }>('onboarding_easyRestore');
      onRestored(result.account);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.error'));
      setLoading(false);
    }
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.easyRestoreTitle')}</h2>
      <p className={styles.stepDesc}>{t('wizard.easyRestoreDesc')}</p>
      <p className={styles.stepDesc}>{t('wizard.easySyncHint')}</p>

      <div className={styles.summaryCard}>
        {accountName && (
          <div className={styles.summaryField}>
            <label>{t('wizard.nameLabel')}</label>
            <span>{accountName}</span>
          </div>
        )}
        <div className={styles.summaryField}>
          <label>{t('wizard.publicKeyLabel')}</label>
          <span>{npubShort}</span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.stepActions}>
        <Button onClick={handleRestore} disabled={loading}>
          {loading ? t('wizard.easyRestoring') : t('wizard.easyRestoreAction')}
        </Button>
      </div>
    </div>
  );
}
