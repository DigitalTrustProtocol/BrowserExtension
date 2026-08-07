import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { AUTO_LOCK_OPTIONS } from '@shared/constants.ts';
import { t } from '@lib/i18n.js';
import { IconLock, IconCloud, IconKey, IconDownload } from '@assets';
import Card from '@components/Card/Card';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import NavItem from '@components/NavItem/NavItem';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import { useVault } from '../../context/VaultContext';
import { useAccount } from '../../context/AccountContext';
import { truncateNpub } from '@shared/format/text.ts';

import styles from './SecuritySection.module.css';

interface SecuritySectionProps {
  onChangePassword: () => void;
  onExportNsec?: () => void;
  onExportNcryptsec?: () => void;
  onExportSeed?: () => void;
  onOpenWizard?: () => void;
}

type BackupStatus = 'loading' | 'none' | 'same' | 'different' | 'unavailable';

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
  const [backupStatus, setBackupStatus] = useState<BackupStatus>('loading');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupError, setBackupError] = useState('');
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [unbindBusyId, setUnbindBusyId] = useState<string | null>(null);
  const [unbindError, setUnbindError] = useState('');
  const vault = useVault();
  const {
    accounts,
    active,
    isReadOnly,
    isNip46,
    reload: reloadAccounts,
  } = useAccount();
  const boundAccounts = (accounts || []).filter(
    (a) => typeof a.boundTwitterId === 'string' && /^[0-9]+$/.test(a.boundTwitterId),
  );
  const { checkState, exists, locked, isGenerated } = vault;
  // Security is account/vault scoped — refresh whenever the selected Nostr account changes.
  useEffect(() => {
    void checkState();
  }, [active?.id, checkState]);

  const canExportKeys =
    Boolean(active) && !isReadOnly && !isNip46 && exists && !locked;

  const refreshBackupStatus = async () => {
    if (!vault.exists || vault.locked) {
      setBackupStatus('unavailable');
      return;
    }
    try {
      const probe = await rpc<{
        conflict: 'none' | 'same' | 'different';
        syncBlob: unknown | null;
      }>('onboarding_easyProbe');
      if (!probe.syncBlob) setBackupStatus('none');
      else if (probe.conflict === 'same') setBackupStatus('same');
      else if (probe.conflict === 'different') setBackupStatus('different');
      else setBackupStatus('none');
    } catch {
      setBackupStatus('unavailable');
    }
  };

  useEffect(() => {
    rpc<number>('vault_getAutoLock').then((ms) => {
      if (typeof ms === 'number') setAutoLockMs(ms);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!vault.exists || vault.locked) {
        if (!cancelled) setBackupStatus('unavailable')
        return
      }
      try {
        const probe = await rpc<{
          conflict: 'none' | 'same' | 'different'
          syncBlob: unknown | null
        }>('onboarding_easyProbe')
        if (cancelled) return
        if (!probe.syncBlob) setBackupStatus('none')
        else if (probe.conflict === 'same') setBackupStatus('same')
        else if (probe.conflict === 'different') setBackupStatus('different')
        else setBackupStatus('none')
      } catch {
        if (!cancelled) setBackupStatus('unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [vault.exists, vault.locked, active?.id])

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

  const runBackup = async (replace: boolean) => {
    setBackupBusy(true);
    setBackupError('');
    setBackupMsg('');
    try {
      await rpc('onboarding_easyBackupActive', { replace });
      setShowReplaceConfirm(false);
      setBackupMsg(t('settings.easyBackupSuccess'));
      await refreshBackupStatus();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('EASY_BACKUP_CONFLICT')) {
        setShowReplaceConfirm(true);
        setBackupStatus('different');
      } else {
        setBackupError(msg || t('common.error'));
      }
    }
    setBackupBusy(false);
  };

  const runLogout = async () => {
    setLogoutBusy(true);
    setLogoutError('');
    try {
      await rpc('vault_logout');
      window.location.reload();
    } catch (e: unknown) {
      setLogoutError(e instanceof Error ? e.message : t('common.error'));
      setLogoutBusy(false);
    }
  };

  const displayMs = pendingMs !== null ? pendingMs : autoLockMs;
  const showSetPassword = pendingMs !== null && isNever && pendingMs !== 0;
  const showCurrentPassword = pendingMs !== null && !isNever && pendingMs === 0;

  const backupStatusLabel =
    backupStatus === 'same'
      ? t('settings.easyBackupStatusSame')
      : backupStatus === 'different'
        ? t('settings.easyBackupStatusDifferent')
        : backupStatus === 'none'
          ? t('settings.easyBackupStatusNone')
          : t('settings.easyBackupStatusUnavailable');

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

      {vault.exists && !vault.locked && (
        <Card>
          <SectionLabel>{t('settings.easyBackupTitle')}</SectionLabel>
          <SectionHint>{t('settings.easyBackupDesc')}</SectionHint>
          <p className={styles.passwordHint}>{backupStatusLabel}</p>
          <p className={styles.passwordHint}>{t('wizard.easySyncHint')}</p>
          {showReplaceConfirm && (
            <div className={styles.warningBox}>
              <IconCloud />
              <span>{t('settings.easyBackupConflict')}</span>
            </div>
          )}
          {backupMsg && <p className={styles.passwordHint}>{backupMsg}</p>}
          {backupError && <div className={styles.error}>{backupError}</div>}
          <div className={styles.confirmActions}>
            {showReplaceConfirm ? (
              <>
                <Button
                  variant="secondary"
                  small
                  onClick={() => setShowReplaceConfirm(false)}
                  disabled={backupBusy}
                >
                  {t('common.cancel')}
                </Button>
                <Button small onClick={() => void runBackup(true)} disabled={backupBusy}>
                  {backupBusy ? t('common.saving') : t('settings.easyBackupReplace')}
                </Button>
              </>
            ) : (
              <Button
                small
                onClick={() => void runBackup(false)}
                disabled={backupBusy || backupStatus === 'unavailable'}
              >
                {backupBusy
                  ? t('common.saving')
                  : backupStatus === 'same'
                    ? t('settings.easyBackupUpdate')
                    : t('settings.easyBackupAction')}
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>{t('account.bindingsTitle')}</SectionLabel>
        <SectionHint>
          {t('account.unbindFromXHint')} {t('account.bindCap')}
        </SectionHint>
        {unbindError && <div className={styles.error}>{unbindError}</div>}
        {boundAccounts.length === 0 ? (
          <SectionHint>{t('account.bindingsEmpty')}</SectionHint>
        ) : (
          <div className={styles.passwordSection}>
            {boundAccounts.map((account) => (
              <div
                key={account.id}
                className={styles.confirmActions}
                style={{ justifyContent: 'space-between', marginBottom: 8 }}
              >
                <div>
                  <div>{account.name || truncateNpub(account.pubkey)}</div>
                  <SectionHint>
                    {t('account.boundToXId', { id: account.boundTwitterId || '' })}
                  </SectionHint>
                </div>
                <Button
                  variant="secondary"
                  small
                  disabled={
                    unbindBusyId === account.id ||
                    !vault.exists ||
                    vault.locked
                  }
                  title={
                    !vault.exists || vault.locked
                      ? t('security.unbindNeedsVault')
                      : undefined
                  }
                  onClick={() => {
                    setUnbindError('')
                    setUnbindBusyId(account.id)
                    void rpc('unbindAccountFromX', { accountId: account.id })
                      .then(() => reloadAccounts())
                      .catch((err: unknown) => {
                        setUnbindError(
                          err instanceof Error ? err.message : String(err),
                        )
                      })
                      .finally(() => setUnbindBusyId(null))
                  }}
                >
                  {unbindBusyId === account.id
                    ? t('common.saving')
                    : t('account.unbindFromX')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {vault.exists && !vault.locked && (
        <Card>
          <SectionLabel>{t('settings.logoutTitle')}</SectionLabel>
          <SectionHint>{t('settings.logoutDesc')}</SectionHint>
          {logoutError && <div className={styles.error}>{logoutError}</div>}
          {logoutConfirm ? (
            <div className={styles.passwordSection}>
              <div className={styles.warningBox}>
                <span>{t('settings.logoutConfirm')}</span>
              </div>
              <div className={styles.confirmActions}>
                <Button
                  variant="secondary"
                  small
                  onClick={() => setLogoutConfirm(false)}
                  disabled={logoutBusy}
                >
                  {t('common.cancel')}
                </Button>
                <Button variant="danger" small onClick={() => void runLogout()} disabled={logoutBusy}>
                  {logoutBusy ? t('common.saving') : t('settings.logoutAction')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.confirmActions}>
              <Button variant="secondary" small onClick={() => setLogoutConfirm(true)}>
                {t('settings.logoutAction')}
              </Button>
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
