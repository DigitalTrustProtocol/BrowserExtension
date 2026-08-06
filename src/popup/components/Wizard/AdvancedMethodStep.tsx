import React from 'react';
import { t } from '@lib/i18n.js';
import { IconPlus, IconKey, IconEye, IconLink } from '@assets';
import styles from './WizardOverlay.module.css';

const METHOD_ICONS: Record<string, React.ReactNode> = {
  create: <IconPlus />,
  import: <IconKey />,
  npub: <IconEye />,
  nip46: <IconLink />,
};

interface Method {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

interface AdvancedMethodStepProps {
  onSelect: (id: string) => void;
  hasGeneratedAccount?: boolean;
}

/** Separate pane listing Advanced Nostr setup methods (create / import / watch / bunker). */
export default function AdvancedMethodStep({
  onSelect,
  hasGeneratedAccount,
}: AdvancedMethodStepProps) {
  const methods: Method[] = [
    {
      id: 'create',
      label: hasGeneratedAccount ? t('wizard.createSubAccount') : t('wizard.createNew'),
      desc: hasGeneratedAccount ? t('wizard.createSubAccountDesc') : t('wizard.createNewDesc'),
      icon: METHOD_ICONS.create,
    },
    {
      id: 'import',
      label: t('wizard.importKeyBackup'),
      desc: t('wizard.importKeyBackupDesc'),
      icon: METHOD_ICONS.import,
    },
    {
      id: 'npub',
      label: t('wizard.watchOnly'),
      desc: t('wizard.watchOnlyDesc'),
      icon: METHOD_ICONS.npub,
    },
    {
      id: 'nip46',
      label: t('wizard.nostrConnect'),
      desc: t('wizard.nostrConnectDesc'),
      icon: METHOD_ICONS.nip46,
    },
  ];

  return (
    <div className={`${styles.step} ${styles.methodStep}`}>
      <h2 className={styles.stepTitle}>{t('wizard.advancedSetup')}</h2>
      <p className={styles.stepDesc}>{t('wizard.showAdvancedSetupDesc')}</p>

      <div className={styles.methodGrid}>
        {methods.map((m) => (
          <button
            key={m.id}
            className={styles.methodCard}
            type="button"
            onClick={() => onSelect(m.id)}
          >
            <div className={styles.methodIcon}>{m.icon}</div>
            <div className={styles.methodInfo}>
              <strong>{m.label}</strong>
              <span>{m.desc}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
