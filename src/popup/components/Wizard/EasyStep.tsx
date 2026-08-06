import { useEffect, useState } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import styles from './WizardOverlay.module.css';

interface EasyProbeResult {
  hasLocalVault: boolean;
  syncBlob: {
    pubkeyHint: string;
    accountName?: string;
    updatedAt: number;
  } | null;
  conflict: 'none' | 'same' | 'different';
}

interface EasyStepProps {
  onCreated: (account: unknown) => void;
  onNeedRestore: (hint: { pubkeyHint: string; accountName?: string }) => void;
}

export default function EasyStep({ onCreated, onNeedRestore }: EasyStepProps) {
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'probing' | 'creating' | 'error'>('probing');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const probe = await rpc<EasyProbeResult>('onboarding_easyProbe');
        if (cancelled) return;

        if (probe.hasLocalVault) {
          setError(t('wizard.easyLocalVaultExists'));
          setStatus('error');
          return;
        }

        if (probe.syncBlob?.pubkeyHint) {
          onNeedRestore({
            pubkeyHint: probe.syncBlob.pubkeyHint,
            accountName: probe.syncBlob.accountName,
          });
          return;
        }

        setStatus('creating');
        const result = await rpc<{ account: unknown }>('onboarding_easyCreate');
        if (cancelled) return;
        onCreated(result.account);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t('common.error'));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // Probe once on mount; parent send() wrappers are stable enough for one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.useBrowserAccount')}</h2>
      <p className={styles.stepDesc}>{t('wizard.easySyncHint')}</p>
      {status !== 'error' && (
        <p className={styles.stepDesc}>
          {status === 'probing' ? t('wizard.easyChecking') : t('wizard.easyCreating')}
        </p>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
