import { useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import { rpc } from '@shared/rpc.ts'
import browser from '@shared/browser.ts'
import { sortAccountsByGeneration } from '../../../accounts/account-order.ts'
import { getInitial } from '@shared/format/text.ts'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import NavItem from '@components/NavItem/NavItem'
import Avatar from '@components/Avatar/Avatar'
import XUserBadges from '@components/XUserBadges/XUserBadges'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { IconCloud, IconLock, IconPlus, IconUser } from '@assets'
import { boundTwitterIdsOf } from '../../../accounts/x-binding.ts'
import {
  buildXProfileIconUrl,
  isXProfileIconPath,
} from '../../../shared/x-profile-display.ts'
import { useAccount } from '../../context/AccountContext'
import { useVault } from '../../context/VaultContext'
import NostrKeyCard from './NostrKeyCard'
import { boundHandlesForAccount } from './binding-key-label.ts'
import styles from './UsersSection.module.css'
import securityStyles from './SecuritySection.module.css'

type RoamingState = 'yes' | 'no' | 'unknown'

function useRoamingByPubkey(vaultLocked: boolean): Record<string, RoamingState> {
  const [map, setMap] = useState<Record<string, RoamingState>>({})

  useEffect(() => {
    if (vaultLocked) {
      setMap({})
      return
    }
    let cancelled = false
    void rpc<{ roamingEnabled?: boolean; pubkeys?: string[] }>(
      'onboarding_easyRoamingHints',
    )
      .then((result) => {
        if (cancelled) return
        const enabled = result?.roamingEnabled === true
        const hints = new Set(
          (result?.pubkeys ?? []).map((p) => p.trim().toLowerCase()),
        )
        const next: Record<string, RoamingState> = { __enabled: enabled ? 'yes' : 'no' }
        for (const pubkey of hints) next[pubkey] = enabled ? 'yes' : 'no'
        setMap(next)
      })
      .catch(() => {
        if (!cancelled) setMap({})
      })
    return () => {
      cancelled = true
    }
  }, [vaultLocked])

  return map
}

function roamingFor(
  pubkey: string,
  map: Record<string, RoamingState>,
  vaultLocked: boolean,
): RoamingState {
  if (vaultLocked) return 'unknown'
  const enabled = map.__enabled
  if (!enabled) return 'unknown'
  if (enabled === 'no') return 'no'
  return map[pubkey.trim().toLowerCase()] === 'yes' ? 'yes' : 'no'
}

export default function UsersSection(props: {
  onOpenAccount: (accountId: string) => void
  onAddAccount: () => void
}) {
  const { accounts, activeId, switchAccount, xTabLocked, operatorBindings } =
    useAccount()
  const vault = useVault()
  const [switchError, setSwitchError] = useState('')
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const vaultLocked = Boolean(vault.exists && vault.locked)
  const roamingMap = useRoamingByPubkey(vaultLocked)

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
      {vaultLocked ? (
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
            const isActive = account.id === activeId
            return (
              <NostrKeyCard
                key={account.id}
                account={account}
                roaming={roamingFor(account.pubkey, roamingMap, vaultLocked)}
                boundNames={boundHandlesForAccount(account, operatorBindings)}
                vaultLocked={vaultLocked}
                showActiveOutline={!xTabLocked && isActive}
                onOpen={() => {
                  setSwitchError('')
                  void activateIfAllowed(account.id).then(() => {
                    props.onOpenAccount(account.id)
                  })
                }}
                onUse={
                  !vaultLocked && !xTabLocked && !isActive
                    ? () => {
                        setSwitchError('')
                        void activateIfAllowed(account.id)
                      }
                    : undefined
                }
              />
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
  onOpenBinding: (twitterId: string) => void
}) {
  const { accounts, chromeForAccount, reload, operatorBindings } =
    useAccount()
  const vault = useVault()
  const account = (accounts ?? []).find((a) => a.id === props.accountId)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const vaultLocked = Boolean(vault.exists && vault.locked)
  const roamingMap = useRoamingByPubkey(vaultLocked)

  if (!account) {
    return <SectionHint>{t('settings.usersEmpty')}</SectionHint>
  }

  const isWriteAccount = !account.readOnly && account.type !== 'npub'
  const boundIds = boundTwitterIdsOf(account)
  const boundRows = operatorBindings.filter((row) => boundIds.includes(row.twitterId))

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
      const remaining = sortAccountsByGeneration(
        (
          (data.accounts as Array<{
            id: string
            pubkey?: string
            name?: string
            createdAt?: number
            derivationIndex?: number
          }>) || []
        ).filter((a) => a.id !== account.id),
      )
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
      <NostrKeyCard
        account={account}
        roaming={roamingFor(account.pubkey, roamingMap, vaultLocked)}
        boundNames={boundHandlesForAccount(account, operatorBindings)}
        vaultLocked={vaultLocked}
        showChevron={false}
        onOpen={() => undefined}
      />
      {boundRows.map((row) => {
        const handle = row.handle
          ? `@${row.handle.replace(/^@+/u, '')}`
          : undefined
        const name = row.displayName?.trim() || handle || row.twitterId
        const path = row.iconPath?.trim()
        const avatar =
          path && isXProfileIconPath(path) ? buildXProfileIconUrl(path) : null
        return (
          <NavItem
            key={row.twitterId}
            icon={
              <Avatar
                src={avatar}
                fallback={getInitial(name)}
                imgClassName={securityStyles.bindingAvatar}
                fallbackClassName={securityStyles.bindingAvatarFallback}
              />
            }
            label={
              <>
                {name}
                <XUserBadges
                  size={14}
                  {...(row.verifiedType ? { verifiedType: row.verifiedType } : {})}
                  {...(row.affiliationBadgePath
                    ? { affiliationBadgePath: row.affiliationBadgePath }
                    : {})}
                  {...(row.affiliationLabel
                    ? { affiliationLabel: row.affiliationLabel }
                    : {})}
                />
              </>
            }
            desc={handle && handle !== name ? handle : row.twitterId}
            onClick={() => props.onOpenBinding(row.twitterId)}
          />
        )
      })}
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
        <Button small variant="secondary" onClick={() => setConfirmRemove(true)}>
          {t('account.remove')}
        </Button>
      )}
    </div>
  )
}
