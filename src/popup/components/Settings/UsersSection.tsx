import { useState } from 'react'
import { t } from '@lib/i18n.js'
import { rpc } from '@shared/rpc.ts'
import browser from '@shared/browser.ts'
import { truncateNpub } from '@shared/format/text.ts'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import NavItem from '@components/NavItem/NavItem'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import {
  IconChevronRight,
  IconCloud,
  IconLock,
  IconPlus,
  IconUser,
} from '@assets'
import { nostrKeyKind } from '../../../accounts/x-binding.ts'
import { useAccount } from '../../context/AccountContext'
import { useVault } from '../../context/VaultContext'
import styles from './UsersSection.module.css'
import securityStyles from './SecuritySection.module.css'

function keyTypeLabel(kind: ReturnType<typeof nostrKeyKind>): string {
  switch (kind) {
    case 'nsec':
      return t('settings.keyTypeNsec')
    case 'npub':
      return t('settings.keyTypeNpub')
    case 'nip46':
      return t('settings.keyTypeNip46')
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export default function UsersSection(props: {
  onOpenAccount: (accountId: string) => void
  onAddAccount: () => void
}) {
  const { accounts, activeId, switchAccount, xTabLocked } = useAccount()
  const vault = useVault()
  const [switchError, setSwitchError] = useState('')
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  const activateIfAllowed = async (accountId: string) => {
    if (xTabLocked) return
    if (accountId === activeId) return
    try {
      await switchAccount(accountId)
    } catch (error: unknown) {
      setSwitchError(error instanceof Error ? error.message : t('common.error'))
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

      {(accounts ?? []).length === 0 ? (
        <SectionHint>{t('settings.usersEmpty')}</SectionHint>
      ) : (
        <div className={styles.cardList}>
          {(accounts ?? []).map((account) => {
            const kind = nostrKeyKind(account)
            const isActive = account.id === activeId
            return (
              <div
                key={account.id}
                className={`${styles.userCard}${
                  isActive ? ` ${styles.userCardActive}` : ''
                }`}
              >
                <button
                  type="button"
                  className={styles.userMeta}
                  onClick={() => {
                    setSwitchError('')
                    void activateIfAllowed(account.id).then(() => {
                      props.onOpenAccount(account.id)
                    })
                  }}
                >
                  <span className={styles.npub}>
                    {truncateNpub(account.pubkey)}
                  </span>
                  <span className={styles.keyType}>{keyTypeLabel(kind)}</span>
                </button>
                {!xTabLocked && !isActive ? (
                  <span className={styles.useBtn}>
                    <Button
                      small
                      variant="secondary"
                      onClick={() => {
                        setSwitchError('')
                        void activateIfAllowed(account.id)
                      }}
                    >
                      {t('settings.usersUseKey')}
                    </Button>
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.userMeta}
                  aria-label={t('settings.userHub')}
                  onClick={() => {
                    setSwitchError('')
                    void activateIfAllowed(account.id).then(() => {
                      props.onOpenAccount(account.id)
                    })
                  }}
                >
                  <IconChevronRight size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {xTabLocked ? (
        <SectionHint>{t('settings.usersUseKeyLocked')}</SectionHint>
      ) : null}
      {switchError ? <div className={styles.error}>{switchError}</div> : null}

      <Button small variant="secondary" onClick={props.onAddAccount}>
        <IconPlus size={14} /> {t('settings.usersAdd')}
      </Button>

      {vault.exists && !vault.locked ? (
        <Card>
          <SectionLabel>{t('settings.logoutTitle')}</SectionLabel>
          <SectionHint>{t('settings.logoutDesc')}</SectionHint>
          {logoutError ? (
            <div className={styles.error}>{logoutError}</div>
          ) : null}
          {logoutConfirm ? (
            <div className={securityStyles.confirmActions}>
              <Button
                small
                variant="secondary"
                disabled={logoutBusy}
                onClick={() => setLogoutConfirm(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                small
                disabled={logoutBusy}
                onClick={() => {
                  setLogoutBusy(true)
                  setLogoutError('')
                  void rpc('vault_logout')
                    .then(() => window.location.reload())
                    .catch((error: unknown) => {
                      setLogoutError(
                        error instanceof Error
                          ? error.message
                          : t('common.error'),
                      )
                      setLogoutBusy(false)
                    })
                }}
              >
                {logoutBusy ? t('common.saving') : t('settings.logoutAction')}
              </Button>
            </div>
          ) : (
            <Button
              small
              variant="secondary"
              onClick={() => setLogoutConfirm(true)}
            >
              {t('settings.logoutAction')}
            </Button>
          )}
        </Card>
      ) : null}
    </div>
  )
}

export function UserKeyHub(props: {
  accountId: string
  onOpenProfile: () => void
  onOpenSecurity: () => void
  onOpenRoaming: () => void
}) {
  const { accounts, chromeForAccount, reload } = useAccount()
  const account = (accounts ?? []).find((a) => a.id === props.accountId)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  if (!account) {
    return <SectionHint>{t('settings.usersEmpty')}</SectionHint>
  }

  const kind = nostrKeyKind(account)
  const isWriteAccount = !account.readOnly && account.type !== 'npub'

  const handleRemove = async () => {
    setRemoving(true)
    setRemoveError('')
    try {
      let loggedOut = false
      try {
        const result = await rpc<{ loggedOut?: boolean }>('vault_removeAccount', {
          accountId: account.id,
        })
        loggedOut = !!result?.loggedOut
      } catch {
        /* vault may already be empty / locked */
      }
      const data: Record<string, unknown> = await browser.storage.local.get([
        'accounts',
        'activeAccountId',
      ])
      const remaining = (
        (data.accounts as Array<{ id: string; pubkey?: string }>) || []
      ).filter((a) => a.id !== account.id)
      const updates: Record<string, unknown> = { accounts: remaining }
      if (data.activeAccountId === account.id) {
        updates.activeAccountId = remaining[0]?.id || null
      }
      if (remaining.length === 0 || loggedOut) {
        await browser.storage.sync.remove('myPubkey')
        updates.accounts = []
        updates.activeAccountId = null
      } else if (typeof updates.activeAccountId === 'string') {
        const next = remaining.find((a) => a.id === updates.activeAccountId)
        if (next?.pubkey) {
          await browser.storage.sync.set({ myPubkey: next.pubkey })
        }
      }
      await browser.storage.local.set(updates)
      setConfirmRemove(false)
      reload()
      if (loggedOut || remaining.length === 0) {
        window.location.reload()
      }
    } catch (error: unknown) {
      setRemoveError(error instanceof Error ? error.message : t('common.error'))
    }
    setRemoving(false)
  }

  return (
    <div className={styles.section}>
      <Card>
        <SectionLabel>{truncateNpub(account.pubkey)}</SectionLabel>
        <SectionHint>
          {keyTypeLabel(kind)}
          {chromeForAccount(account).displayName
            ? ` · ${chromeForAccount(account).displayName}`
            : ''}
        </SectionHint>
      </Card>
      <NavItem
        icon={<IconUser />}
        label={t('settings.userProfile')}
        desc={t('settings.userProfileDesc')}
        onClick={props.onOpenProfile}
      />
      <NavItem
        icon={<IconLock />}
        label={t('settings.security')}
        desc={t('settings.userSecurityDesc')}
        onClick={props.onOpenSecurity}
      />
      <NavItem
        icon={<IconCloud />}
        label={t('settings.browserAccountRoaming')}
        desc={t('settings.userRoamingDesc')}
        onClick={props.onOpenRoaming}
      />
      {confirmRemove ? (
        <Card>
          <SectionLabel>
            {t('account.removeTitle', {
              name: chromeForAccount(account).displayName || '',
            })}
          </SectionLabel>
          <SectionHint>{t('account.removeWarning')}</SectionHint>
          {isWriteAccount ? (
            <div className={securityStyles.warningBox}>
              <span>{t('account.removeKeyWarning')}</span>
            </div>
          ) : null}
          {removeError ? <div className={styles.error}>{removeError}</div> : null}
          <div className={securityStyles.confirmActions}>
            <Button
              variant="secondary"
              small
              onClick={() => setConfirmRemove(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              small
              disabled={removing}
              onClick={() => void handleRemove()}
            >
              {removing ? t('common.removing') : t('common.remove')}
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          small
          variant="secondary"
          onClick={() => setConfirmRemove(true)}
        >
          {t('account.remove')}
        </Button>
      )}
    </div>
  )
}
