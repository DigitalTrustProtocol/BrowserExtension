import { useState } from 'react'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import { truncateNpub } from '@shared/format/text.ts'
import styles from './SecuritySection.module.css'

/**
 * Account-facing settings: X↔Nostr bindings and device logout.
 */
export default function UserSection() {
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [unbindBusyId, setUnbindBusyId] = useState<string | null>(null)
  const [unbindError, setUnbindError] = useState('')
  const vault = useVault()
  const { accounts, reload: reloadAccounts } = useAccount()
  const boundAccounts = (accounts || []).filter(
    (a) =>
      typeof a.boundTwitterId === 'string' && /^[0-9]+$/.test(a.boundTwitterId),
  )

  const runLogout = async () => {
    setLogoutBusy(true)
    setLogoutError('')
    try {
      await rpc('vault_logout')
      window.location.reload()
    } catch (e: unknown) {
      setLogoutError(e instanceof Error ? e.message : t('common.error'))
      setLogoutBusy(false)
    }
  }

  return (
    <div className={styles.section}>
      {vault.exists && vault.locked ? (
        <Card>
          <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
          <SectionHint>{t('settings.userVaultLockedHint')}</SectionHint>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>{t('account.bindingsTitle')}</SectionLabel>
        <SectionHint>
          {t('account.unbindFromXHint')} {t('account.bindCap')}
        </SectionHint>
        {unbindError ? <div className={styles.error}>{unbindError}</div> : null}
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
                    {t('account.boundToXId', {
                      id: account.boundTwitterId || '',
                    })}
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

      {vault.exists && !vault.locked ? (
        <Card>
          <SectionLabel>{t('settings.logoutTitle')}</SectionLabel>
          <SectionHint>{t('settings.logoutDesc')}</SectionHint>
          {logoutError ? (
            <div className={styles.error}>{logoutError}</div>
          ) : null}
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
                <Button
                  variant="danger"
                  small
                  onClick={() => void runLogout()}
                  disabled={logoutBusy}
                >
                  {logoutBusy
                    ? t('common.saving')
                    : t('settings.logoutAction')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.confirmActions}>
              <Button
                variant="secondary"
                small
                onClick={() => setLogoutConfirm(true)}
              >
                {t('settings.logoutAction')}
              </Button>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  )
}
