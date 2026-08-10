import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { AUTO_LOCK_OPTIONS } from '@shared/constants.ts';
import { t } from '@lib/i18n.js';
import { IconLock, IconKey, IconDownload } from '@assets';
import Card from '@components/Card/Card';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import NavItem from '@components/NavItem/NavItem';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import { useVault } from '../../context/VaultContext';
import { useAccount } from '../../context/AccountContext';
import styles from './SecuritySection.module.css';

interface SecuritySectionProps {
  onChangePassword: () => void;
  onExportNsec?: () => void;
  onExportNcryptsec?: () => void;
  onExportSeed?: () => void;
  onOpenWizard?: () => void;
}

export default function SecuritySection({
  onChangePassword,
  onExportNsec,
  onExportNcryptsec,
  onExportSeed,
  onOpenWizard,
}: SecuritySectionProps) {
  const [autoLockMs, setAutoLockMs] = useState<number>(900000);
  const [pendingMs, setPendingMs] = useState<number | null>(null);
  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const vault = useVault();
  const {
    active,
    isReadOnly,
    isNip46,
  } = useAccount();
  const { checkState, exists, locked, isGenerated } = vault;
  // Security is account/vault scoped — refresh whenever the selected Nostr account changes.
  useEffect(() => {
    void checkState();
  }, [active?.id, checkState]);

  const canExportKeys =
    Boolean(active) && !isReadOnly && !isNip46 && exists && !locked;

  useEffect(() => {
    rpc<number>('vault_getAutoLock').then((ms) => {
      if (typeof ms === 'number') setAutoLockMs(ms);
    }).catch(() => {});
  }, []);

  const isNever = autoLockMs === 0;

  const needsPassword = (ms: number): boolean => {
    const wasNever = autoLockMs === 0;
    const willBeNever = ms === 0;
    return wasNever !== willBeNever;
  };

  const handleChipSelect = (ms: number) => {
    setError('');
    setPassword('');
    setConfirm('');

    if (needsPassword(ms)) {
      setPendingMs(ms);
    } else {
      setPendingMs(null);
      setAutoLockMs(ms);
      rpc('vault_setAutoLock', { ms });
    }
  };

  const handleConfirm = async () => {
    if (pendingMs === null) return;
    const switchingToTimed = autoLockMs === 0 && pendingMs !== 0;
    const switchingToNever = autoLockMs !== 0 && pendingMs === 0;

    if (switchingToTimed) {
      if (password.length < 8) { setError(t('wizard.passwordMin8')); return; }
      if (password !== confirm) { setError(t('wizard.passwordsNoMatch')); return; }
    }
    if (switchingToNever && !password) {
      setError(t('security.enterCurrentPassword')); return;
    }

    setLoading(true);
    setError('');

    try {
      const params: Record<string, any> = { ms: pendingMs };
      if (switchingToTimed) params.password = password;
      if (switchingToNever) params.currentPassword = password;
      await rpc('vault_setAutoLock', params);
      setAutoLockMs(pendingMs);
      setPendingMs(null);
      setPassword('');
      setConfirm('');
      vault.checkState?.();
    } catch (e: any) {
      setError(e.message || t('common.error'));
    }
    setLoading(false);
  };

  const handleCancel = () => {
    setPendingMs(null);
    setPassword('');
    setConfirm('');
    setError('');
  };

  const displayMs = pendingMs !== null ? pendingMs : autoLockMs;
  const showSetPassword = pendingMs !== null && isNever && pendingMs !== 0;
  const showCurrentPassword = pendingMs !== null && !isNever && pendingMs === 0;

  return (
    <div className={styles.section}>
      {!vault.exists && (
        <Card>
          <SectionLabel>{t('security.noVaultTitle')}</SectionLabel>
          <SectionHint>{t('security.noVaultHint')}</SectionHint>
          {onOpenWizard ? (
            <div className={styles.confirmActions}>
              <Button small onClick={onOpenWizard}>
                {t('account.createOrImport')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      {vault.exists && vault.locked && (
        <Card>
          <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
          <SectionHint>{t('security.vaultLockedHint')}</SectionHint>
        </Card>
      )}

      {vault.exists && (
        <Card>
          <SectionLabel>{t('security.autoLock')}</SectionLabel>
          <SectionHint>{t('security.autoLockDesc')}</SectionHint>
          <ChipGroup
            options={AUTO_LOCK_OPTIONS.map((opt: any) => ({ value: opt.ms, label: t(opt.labelKey) }))}
            value={displayMs}
            onChange={handleChipSelect}
          />

          {showSetPassword && (
            <div className={styles.passwordSection}>
              <p className={styles.passwordHint}>{t('security.setPasswordHint')}</p>
              <Input
                type="password"
                showToggle
                placeholder={t('wizard.minEightChars')}
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
              />
              <Input
                type="password"
                placeholder={t('wizard.reEnterPw')}
                value={confirm}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setConfirm(e.target.value); setError(''); }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleConfirm()}
              />
              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.confirmActions}>
                <Button variant="secondary" small onClick={handleCancel}>{t('common.cancel')}</Button>
                <Button small onClick={handleConfirm} disabled={loading}>
                  {loading ? t('common.saving') : t('common.confirm')}
                </Button>
              </div>
            </div>
          )}

          {showCurrentPassword && (
            <div className={styles.passwordSection}>
              <div className={styles.warningBox}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{t('security.neverLockWarning')}</span>
              </div>
              <p className={styles.passwordHint}>{t('security.confirmPasswordHint')}</p>
              <Input
                type="password"
                showToggle
                placeholder={t('security.currentPassword')}
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleConfirm()}
              />
              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.confirmActions}>
                <Button variant="secondary" small onClick={handleCancel}>{t('common.cancel')}</Button>
                <Button small onClick={handleConfirm} disabled={loading}>
                  {loading ? t('common.saving') : t('common.confirm')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {canExportKeys && onExportNsec && (
        <NavItem
          icon={<IconKey />}
          label={t('key.exportNsec')}
          desc={t('key.exportNsecDesc')}
          onClick={onExportNsec}
        />
      )}
      {canExportKeys && onExportNcryptsec && (
        <NavItem
          icon={<IconLock />}
          label={t('key.exportNcryptsec')}
          desc={t('key.exportNcryptsecDesc')}
          onClick={onExportNcryptsec}
        />
      )}
      {canExportKeys && isGenerated && onExportSeed && (
        <NavItem
          icon={<IconDownload />}
          label={t('key.exportSeed')}
          desc={t('key.exportSeedDesc')}
          onClick={onExportSeed}
        />
      )}

      {vault.exists && !vault.locked && !isNever && (
        <NavItem
          icon={<IconLock />}
          label={t('security.changePassword')}
          desc={t('security.changePasswordDesc')}
          onClick={onChangePassword}
        />
      )}
    </div>
  );
}
