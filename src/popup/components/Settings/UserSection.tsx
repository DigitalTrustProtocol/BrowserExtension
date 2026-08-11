import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import { truncateNpub } from '@shared/format/text.ts'
import { IconWarning } from '../../../assets'
import UnlinkPanel from './UnlinkPanel'
import BioUpdatePanel from '../Home/BioUpdatePanel'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type XBindingPublishResult,
  type XIdentitySuggestFlags,
} from '../../../shared/contracts'
import styles from './SecuritySection.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

type BoundRowFlags = XIdentitySuggestFlags & {
  handle?: string
  error?: string
}

function npubFromPubkey(pubkey: string): string | undefined {
  try {
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) return undefined
    return nip19.npubEncode(pubkey.toLowerCase())
  } catch {
    return undefined
  }
}

function bioStatusLabel(flags: BoundRowFlags | undefined): string {
  if (!flags || flags.error) return t('account.bioStatusUnknown')
  if (flags.hasBioNpubForActive) return t('account.bioStatusOk')
  if (flags.bioNpubMismatch) return t('account.bioStatusMismatch')
  return t('account.bioStatusMissing')
}

/**
 * Account-facing settings: X↔Nostr bindings and device logout.
 */
export default function UserSection() {
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const [bioPanelAccountId, setBioPanelAccountId] = useState<string | null>(
    null,
  )
  const [flagsByAccountId, setFlagsByAccountId] = useState<
    Record<string, BoundRowFlags>
  >({})
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)
  const [publishMessageById, setPublishMessageById] = useState<
    Record<string, string>
  >({})
  const vault = useVault()
  const {
    accounts,
    activeId,
    reload: reloadAccounts,
    switchAccount,
    activeXHandle,
    activeXTwitterId,
  } = useAccount()
  const boundAccounts = (accounts || []).filter(
    (a) =>
      typeof a.boundTwitterId === 'string' && /^[0-9]+$/.test(a.boundTwitterId),
  )

  const refreshFlagsForAccount = useCallback(
    async (accountId: string, twitterId: string, handle?: string | null) => {
      try {
        const flags = await axRequest<XIdentitySuggestFlags>({
          type: 'GET_X_IDENTITY_SUGGEST_FLAGS',
          version: BACKGROUND_API_VERSION,
          twitterId,
          ...(handle ? { handle } : {}),
        })
        setFlagsByAccountId((prev) => ({
          ...prev,
          [accountId]: {
            ...flags,
            handle: flags.resolvedHandle ?? handle ?? undefined,
          },
        }))
      } catch (error: unknown) {
        setFlagsByAccountId((prev) => ({
          ...prev,
          [accountId]: {
            hasBioNpubForActive: false,
            hasMatching10011ForActive: false,
            bioNpubMismatch: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }))
      }
    },
    [],
  )

  useEffect(() => {
    if (vault.locked) return
    const list = (accounts || []).filter(
      (a) =>
        typeof a.boundTwitterId === 'string' &&
        /^[0-9]+$/.test(a.boundTwitterId),
    )
    for (const account of list) {
      const tid = account.boundTwitterId
      if (!tid) continue
      const handle =
        activeXTwitterId === tid ? activeXHandle ?? undefined : undefined
      void refreshFlagsForAccount(account.id, tid, handle)
    }
  }, [
    vault.locked,
    accounts,
    activeXTwitterId,
    activeXHandle,
    refreshFlagsForAccount,
  ])

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

  const runPublish = async (
    accountId: string,
    twitterId: string,
    force: boolean,
  ) => {
    setPublishBusyId(accountId)
    setPublishMessageById((prev) => ({ ...prev, [accountId]: '' }))
    try {
      if (activeId !== accountId) {
        await switchAccount(accountId)
      }
      const handle =
        activeXTwitterId === twitterId ? activeXHandle : undefined
      const result = await axRequest<XBindingPublishResult>({
        type: 'PUBLISH_X_BINDING',
        version: BACKGROUND_API_VERSION,
        twitterId,
        force,
        ...(handle ? { handle } : {}),
      })
      if (result.status === 'needs_proof_post') {
        setPublishMessageById((prev) => ({
          ...prev,
          [accountId]: result.reason,
        }))
      } else if (
        result.status === 'published' ||
        result.status === 'already_published'
      ) {
        setPublishMessageById((prev) => ({
          ...prev,
          [accountId]: t('account.bindingPublishDone'),
        }))
      }
      await refreshFlagsForAccount(accountId, twitterId, handle)
    } catch (error: unknown) {
      setPublishMessageById((prev) => ({
        ...prev,
        [accountId]:
          error instanceof Error ? error.message : t('common.error'),
      }))
    } finally {
      setPublishBusyId(null)
    }
  }

  const unlinkingAccount = boundAccounts.find((a) => a.id === unlinkingId)
  const bioPanelAccount = boundAccounts.find((a) => a.id === bioPanelAccountId)
  const bioPanelTid = bioPanelAccount?.boundTwitterId
  const bioPanelHandle =
    bioPanelTid && activeXTwitterId === bioPanelTid
      ? activeXHandle ?? flagsByAccountId[bioPanelAccountId ?? '']?.handle
      : flagsByAccountId[bioPanelAccountId ?? '']?.handle

  return (
    <div className={styles.section}>
      {vault.exists && vault.locked ? (
        <Card>
          <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
          <SectionHint>{t('settings.userVaultLockedHint')}</SectionHint>
        </Card>
      ) : null}

      {unlinkingAccount && unlinkingAccount.boundTwitterId ? (
        <UnlinkPanel
          accountId={unlinkingAccount.id}
          accountLabel={
            unlinkingAccount.name || truncateNpub(unlinkingAccount.pubkey)
          }
          twitterId={unlinkingAccount.boundTwitterId}
          handle={
            activeXTwitterId === unlinkingAccount.boundTwitterId
              ? activeXHandle
              : null
          }
          onDone={() => {
            setUnlinkingId(null)
            void reloadAccounts()
          }}
          onCancel={() => setUnlinkingId(null)}
        />
      ) : (
        <Card>
          <SectionLabel>{t('account.bindingsTitle')}</SectionLabel>
          <SectionHint>
            {t('account.unbindFromXHint')} {t('account.bindCap')}
          </SectionHint>
          {boundAccounts.length === 0 ? (
            <SectionHint>{t('account.bindingsEmpty')}</SectionHint>
          ) : (
            <div className={styles.passwordSection}>
              {boundAccounts.map((account) => {
                const tid = account.boundTwitterId!
                const flags = flagsByAccountId[account.id]
                const onActiveX = activeXTwitterId === tid
                const handle = onActiveX
                  ? activeXHandle ?? flags?.handle
                  : flags?.handle
                const canManageBio = Boolean(handle)
                const published = flags?.hasMatching10011ForActive === true
                const publishBusy = publishBusyId === account.id
                const publishMsg = publishMessageById[account.id]

                return (
                  <div key={account.id} className={styles.bindingRow}>
                    <div className={styles.bindingHeader}>
                      <div>
                        <div>
                          {account.name || truncateNpub(account.pubkey)}
                        </div>
                        <SectionHint>
                          {t('account.boundToXId', { id: tid })}
                          {handle ? ` · @${handle}` : ''}
                        </SectionHint>
                      </div>
                      <Button
                        variant="secondary"
                        small
                        disabled={!vault.exists || vault.locked}
                        title={
                          !vault.exists || vault.locked
                            ? t('security.unbindNeedsVault')
                            : undefined
                        }
                        onClick={() => setUnlinkingId(account.id)}
                      >
                        {t('account.unbindFromX')}
                      </Button>
                    </div>

                    <div className={styles.bindingStatusRow}>
                      <span
                        className={
                          flags?.bioNpubMismatch
                            ? styles.bindingStatusWarn
                            : styles.bindingStatus
                        }
                        role="status"
                      >
                        {bioStatusLabel(flags)}
                        {flags?.bioNpubMismatch ? (
                          <IconWarning
                            size={14}
                            className={styles.bindingWarnIcon}
                            aria-hidden
                          />
                        ) : null}
                      </span>
                      <Button
                        small
                        disabled={
                          !vault.exists ||
                          vault.locked ||
                          !canManageBio ||
                          bioPanelAccountId === account.id
                        }
                        title={
                          !canManageBio ? t('account.needXHandle') : undefined
                        }
                        onClick={() => {
                          void (async () => {
                            try {
                              if (activeId !== account.id) {
                                await switchAccount(account.id)
                              }
                              setBioPanelAccountId(account.id)
                            } catch (error: unknown) {
                              setPublishMessageById((prev) => ({
                                ...prev,
                                [account.id]:
                                  error instanceof Error
                                    ? error.message
                                    : t('common.error'),
                              }))
                            }
                          })()
                        }}
                      >
                        {t('account.updateBio')}
                      </Button>
                    </div>

                    <div className={styles.bindingStatusRow}>
                      <span className={styles.bindingStatus} role="status">
                        {published
                          ? t('account.bindingStatusPublished')
                          : t('account.bindingStatusMissing')}
                      </span>
                      <Button
                        small
                        variant="secondary"
                        disabled={
                          !vault.exists ||
                          vault.locked ||
                          !onActiveX ||
                          publishBusy
                        }
                        title={
                          !onActiveX ? t('account.needActiveXTab') : undefined
                        }
                        onClick={() =>
                          void runPublish(account.id, tid, published)
                        }
                      >
                        {publishBusy
                          ? t('account.bindingPublishing')
                          : published
                            ? t('account.republishBinding')
                            : t('account.publishBinding')}
                      </Button>
                    </div>
                    {publishMsg ? (
                      <p className={styles.bindingPublishMsg} role="status">
                        {publishMsg}
                      </p>
                    ) : null}
                    {flags?.error ? (
                      <p className={styles.error} role="alert">
                        {flags.error}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {bioPanelAccount && bioPanelTid && bioPanelHandle ? (
        <BioUpdatePanel
          visible
          onClose={() => {
            setBioPanelAccountId(null)
            void refreshFlagsForAccount(
              bioPanelAccount.id,
              bioPanelTid,
              bioPanelHandle,
            )
          }}
          handle={bioPanelHandle}
          twitterId={bioPanelTid}
          activeNpub={npubFromPubkey(bioPanelAccount.pubkey)}
        />
      ) : null}

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
                  onClick={() => void runLogout()}
                >
                  {logoutBusy
                    ? t('common.saving')
                    : t('settings.logoutAction')}
                </Button>
              </div>
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
