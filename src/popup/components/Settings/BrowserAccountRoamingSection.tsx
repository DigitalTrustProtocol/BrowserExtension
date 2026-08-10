import { useEffect, useState } from 'react'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { IconCloud } from '@assets'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import Toggle from '@components/Toggle/Toggle'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import styles from './SecuritySection.module.css'

type BackupStatus = 'loading' | 'none' | 'same' | 'different' | 'unavailable'

/**
 * Chrome Sync / browser-profile roaming: key roaming toggle and easy account backup.
 */
export default function BrowserAccountRoamingSection() {
  const [backupStatus, setBackupStatus] = useState<BackupStatus>('loading')
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState('')
  const [backupError, setBackupError] = useState('')
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false)
  const [roaming, setRoaming] = useState(true)
  const [roamingBusy, setRoamingBusy] = useState(false)
  const [chromeSignedIn, setChromeSignedIn] = useState(true)
  const vault = useVault()
  const { active } = useAccount()
  const { checkState, exists, locked } = vault

  useEffect(() => {
    void checkState()
  }, [active?.id, checkState])

  const refreshBackupStatus = async () => {
    if (!vault.exists || vault.locked) {
      setBackupStatus('unavailable')
      return
    }
    try {
      const probe = await rpc<{
        conflict: 'none' | 'same' | 'different'
        syncBlob: unknown | null
      }>('onboarding_easyProbe')
      if (!probe.syncBlob) setBackupStatus('none')
      else if (probe.conflict === 'same') setBackupStatus('same')
      else if (probe.conflict === 'different') setBackupStatus('different')
      else setBackupStatus('none')
    } catch {
      setBackupStatus('unavailable')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [roam, signed] = await Promise.all([
          rpc<{ enabled: boolean }>('vault_getBrowserKeyRoaming'),
          rpc<{ signedIn: boolean }>('onboarding_chromeSignedIn'),
        ])
        if (cancelled) return
        setRoaming(roam?.enabled !== false)
        setChromeSignedIn(signed?.signedIn === true)
      } catch {
        if (!cancelled) setRoaming(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const setRoamingEnabled = async (enabled: boolean) => {
    setRoamingBusy(true)
    try {
      await rpc('vault_setBrowserKeyRoaming', { enabled })
      setRoaming(enabled)
      if (enabled) {
        const signed = await rpc<{ signedIn: boolean }>(
          'onboarding_chromeSignedIn',
        )
        setChromeSignedIn(signed?.signedIn === true)
      }
    } catch {
      /* keep previous */
    }
    setRoamingBusy(false)
  }

  const runBackup = async (replace: boolean) => {
    setBackupBusy(true)
    setBackupError('')
    setBackupMsg('')
    try {
      await rpc('onboarding_easyBackupActive', { replace })
      setShowReplaceConfirm(false)
      setBackupMsg(t('settings.easyBackupSuccess'))
      await refreshBackupStatus()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('EASY_BACKUP_CONFLICT')) {
        setShowReplaceConfirm(true)
        setBackupStatus('different')
      } else {
        setBackupError(msg || t('common.error'))
      }
    }
    setBackupBusy(false)
  }

  const backupStatusLabel =
    backupStatus === 'same'
      ? t('settings.easyBackupStatusSame')
      : backupStatus === 'different'
        ? t('settings.easyBackupStatusDifferent')
        : backupStatus === 'none'
          ? t('settings.easyBackupStatusNone')
          : t('settings.easyBackupStatusUnavailable')

  if (!exists || locked) {
    return (
      <div className={styles.section}>
        <Card>
          <SectionLabel>{t('settings.browserAccountRoaming')}</SectionLabel>
          <SectionHint>
            {t('settings.easyBackupStatusUnavailable')}
          </SectionHint>
        </Card>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <Card>
        <SectionLabel>{t('security.roamingTitle')}</SectionLabel>
        <SectionHint>{t('security.roamingDesc')}</SectionHint>
        <div className={styles.roamingRow}>
          <span className={styles.passwordHint}>{t('security.roamingLabel')}</span>
          <Toggle
            checked={roaming}
            disabled={roamingBusy}
            onChange={(checked) => void setRoamingEnabled(checked)}
          />
        </div>
        {roaming && !chromeSignedIn ? (
          <p className={styles.passwordHint}>{t('security.roamingSignInHint')}</p>
        ) : null}
      </Card>

      <Card>
        <SectionLabel>{t('settings.easyBackupTitle')}</SectionLabel>
        <SectionHint>{t('settings.easyBackupDesc')}</SectionHint>
        <p className={styles.passwordHint}>{backupStatusLabel}</p>
        <p className={styles.passwordHint}>{t('wizard.easySyncHint')}</p>
        {showReplaceConfirm ? (
          <div className={styles.warningBox}>
            <IconCloud />
            <span>{t('settings.easyBackupConflict')}</span>
          </div>
        ) : null}
        {backupMsg ? <p className={styles.passwordHint}>{backupMsg}</p> : null}
        {backupError ? <div className={styles.error}>{backupError}</div> : null}
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
              <Button
                small
                onClick={() => void runBackup(true)}
                disabled={backupBusy}
              >
                {backupBusy
                  ? t('common.saving')
                  : t('settings.easyBackupReplace')}
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
    </div>
  )
}
