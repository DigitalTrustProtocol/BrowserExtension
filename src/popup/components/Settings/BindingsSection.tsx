import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { getInitial } from '@shared/format/text.ts'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import Avatar from '@components/Avatar/Avatar'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import { truncateNpub } from '@shared/format/text.ts'
import { IconWarning } from '../../../assets'
import UnlinkPanel from './UnlinkPanel'
import BioUpdatePanel from '../Home/BioUpdatePanel'
import { isWritableNostrAccount } from '../../../accounts/x-binding.ts'
import { buildXProfileIconUrl, isXProfileIconPath } from '../../../shared/x-profile-display.ts'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type OperatorXBindingRow,
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

function rowAvatar(row: OperatorXBindingRow): string | null {
  const path = row.iconPath?.trim()
  return path && isXProfileIconPath(path) ? buildXProfileIconUrl(path) : null
}

function rowName(row: OperatorXBindingRow): string {
  return (
    row.displayName?.trim() ||
    (row.handle ? `@${row.handle.replace(/^@+/u, '')}` : row.twitterId)
  )
}

/**
 * Settings Bindings: known operator X users (index + roaming + signed-in),
 * not the timeline xIdentities catalog.
 */
export default function BindingsSection() {
  const [rows, setRows] = useState<OperatorXBindingRow[]>([])
  const [loadError, setLoadError] = useState('')
  const [unlinkingTid, setUnlinkingTid] = useState<string | null>(null)
  const [bioPanelTid, setBioPanelTid] = useState<string | null>(null)
  const [changingTid, setChangingTid] = useState<string | null>(null)
  const [bindBusyTid, setBindBusyTid] = useState<string | null>(null)
  const [flagsByTid, setFlagsByTid] = useState<Record<string, BoundRowFlags>>(
    {},
  )
  const [publishBusyTid, setPublishBusyTid] = useState<string | null>(null)
  const [publishMessageByTid, setPublishMessageByTid] = useState<
    Record<string, string>
  >({})
  const vault = useVault()
  const {
    accounts,
    chromeForAccount,
    reload: reloadAccounts,
    activeXHandle,
    activeXTwitterId,
  } = useAccount()

  const loadRows = useCallback(async () => {
    try {
      const data = await axRequest<OperatorXBindingRow[]>({
        type: 'GET_OPERATOR_X_BINDINGS',
        version: BACKGROUND_API_VERSION,
      })
      setRows(data)
      setLoadError('')
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : t('common.error'))
    }
  }, [])

  useEffect(() => {
    void loadRows()
  }, [loadRows, accounts])

  const refreshFlagsForRow = useCallback(
    async (twitterId: string, handle?: string | null) => {
      try {
        const flags = await axRequest<XIdentitySuggestFlags>({
          type: 'GET_X_IDENTITY_SUGGEST_FLAGS',
          version: BACKGROUND_API_VERSION,
          twitterId,
          ...(handle ? { handle } : {}),
        })
        setFlagsByTid((prev) => ({
          ...prev,
          [twitterId]: {
            ...flags,
            handle: flags.resolvedHandle ?? handle ?? undefined,
          },
        }))
      } catch (error: unknown) {
        setFlagsByTid((prev) => ({
          ...prev,
          [twitterId]: {
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
    for (const row of rows) {
      if (!row.accountId) continue
      const handle =
        row.handle ||
        (activeXTwitterId === row.twitterId ? activeXHandle : undefined)
      void refreshFlagsForRow(row.twitterId, handle)
    }
  }, [
    vault.locked,
    rows,
    activeXTwitterId,
    activeXHandle,
    refreshFlagsForRow,
  ])

  const writableAccounts = (accounts || []).filter((a) =>
    isWritableNostrAccount(a),
  )

  const runPublish = async (
    accountId: string,
    twitterId: string,
    force: boolean,
  ) => {
    setPublishBusyTid(twitterId)
    setPublishMessageByTid((prev) => ({ ...prev, [twitterId]: '' }))
    try {
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
        setPublishMessageByTid((prev) => ({
          ...prev,
          [twitterId]: result.reason,
        }))
      } else if (
        result.status === 'published' ||
        result.status === 'already_published'
      ) {
        setPublishMessageByTid((prev) => ({
          ...prev,
          [twitterId]: t('account.bindingPublishDone'),
        }))
      }
      await refreshFlagsForRow(twitterId, handle)
    } catch (error: unknown) {
      setPublishMessageByTid((prev) => ({
        ...prev,
        [twitterId]:
          error instanceof Error ? error.message : t('common.error'),
      }))
    } finally {
      setPublishBusyTid(null)
    }
  }

  const bindRow = async (accountId: string, twitterId: string) => {
    setBindBusyTid(twitterId)
    try {
      await rpc('bindAccountToX', {
        accountId,
        twitterId,
        reassign: true,
      })
      setChangingTid(null)
      await reloadAccounts()
      await loadRows()
    } catch (error: unknown) {
      setPublishMessageByTid((prev) => ({
        ...prev,
        [twitterId]:
          error instanceof Error ? error.message : t('common.error'),
      }))
    } finally {
      setBindBusyTid(null)
    }
  }

  const unlinkingRow = rows.find((r) => r.twitterId === unlinkingTid)
  const bioRow = rows.find((r) => r.twitterId === bioPanelTid)
  const bioHandle =
    bioRow?.handle ||
    (bioRow && activeXTwitterId === bioRow.twitterId
      ? activeXHandle
      : flagsByTid[bioPanelTid ?? '']?.handle)

  if (unlinkingRow && unlinkingRow.accountId) {
    return (
      <div className={styles.section}>
        <UnlinkPanel
          accountId={unlinkingRow.accountId}
          accountLabel={rowName(unlinkingRow)}
          twitterId={unlinkingRow.twitterId}
          handle={
            activeXTwitterId === unlinkingRow.twitterId
              ? activeXHandle
              : unlinkingRow.handle ?? null
          }
          onDone={() => {
            setUnlinkingTid(null)
            void reloadAccounts()
            void loadRows()
          }}
          onCancel={() => setUnlinkingTid(null)}
        />
      </div>
    )
  }

  return (
    <div className={styles.section}>
      {vault.exists && vault.locked ? (
        <Card>
          <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
          <SectionHint>{t('settings.bindingsVaultLockedHint')}</SectionHint>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>{t('settings.bindings')}</SectionLabel>
        <SectionHint>
          {t('account.unbindFromXHint')} {t('account.bindCap')}
        </SectionHint>
        {loadError ? <div className={styles.error}>{loadError}</div> : null}
        {rows.length === 0 ? (
          <SectionHint>{t('account.bindingsEmpty')}</SectionHint>
        ) : (
          <div className={styles.passwordSection}>
            {rows.map((row) => {
              const flags = flagsByTid[row.twitterId]
              const onActiveX = Boolean(row.signedIn)
              const handle =
                row.handle ||
                (onActiveX ? activeXHandle ?? flags?.handle : flags?.handle)
              const canManageBio = Boolean(handle) && Boolean(row.accountId)
              const published = flags?.hasMatching10011ForActive === true
              const publishBusy = publishBusyTid === row.twitterId
              const publishMsg = publishMessageByTid[row.twitterId]
              const npub = row.pubkey
                ? npubFromPubkey(row.pubkey)
                : undefined
              const boundLabel = npub
                ? truncateNpub(npub)
                : t('account.notBound')

              return (
                <div
                  key={row.twitterId}
                  className={`${styles.bindingRow}${
                    onActiveX ? ` ${styles.bindingRowCurrent}` : ''
                  }`}
                >
                  <div className={styles.bindingHeader}>
                    <div className={styles.bindingChrome}>
                      <Avatar
                        src={rowAvatar(row)}
                        fallback={getInitial(rowName(row))}
                        imgClassName={styles.bindingAvatar}
                        fallbackClassName={styles.bindingAvatarFallback}
                      />
                      <div>
                        <div>{rowName(row)}</div>
                        <SectionHint>
                          {handle ? `@${handle.replace(/^@+/u, '')}` : row.twitterId}
                          {onActiveX ? ` · ${t('account.signedInX')}` : ''}
                        </SectionHint>
                        <SectionHint>{boundLabel}</SectionHint>
                      </div>
                    </div>
                    <div className={styles.confirmActions}>
                      <Button
                        variant="secondary"
                        small
                        disabled={!vault.exists || vault.locked}
                        onClick={() =>
                          setChangingTid((prev) =>
                            prev === row.twitterId ? null : row.twitterId,
                          )
                        }
                      >
                        {row.accountId
                          ? t('account.bindChange')
                          : t('account.bindAction')}
                      </Button>
                      {row.accountId ? (
                        <Button
                          variant="secondary"
                          small
                          disabled={!vault.exists || vault.locked}
                          title={
                            !vault.exists || vault.locked
                              ? t('security.unbindNeedsVault')
                              : undefined
                          }
                          onClick={() => setUnlinkingTid(row.twitterId)}
                        >
                          {t('account.unbindFromX')}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {changingTid === row.twitterId ? (
                    <div className={styles.bindingChangeList}>
                      {writableAccounts.length === 0 ? (
                        <SectionHint>{t('account.needsCreateHint', {
                          x: handle ? `@${handle}` : t('account.thisXUser'),
                        })}</SectionHint>
                      ) : (
                        writableAccounts.map((account) => (
                          <Button
                            key={account.id}
                            small
                            variant={
                              account.id === row.accountId
                                ? 'secondary'
                                : undefined
                            }
                            disabled={
                              bindBusyTid === row.twitterId ||
                              account.id === row.accountId
                            }
                            onClick={() =>
                              void bindRow(account.id, row.twitterId)
                            }
                          >
                            {chromeForAccount(account).displayName}
                          </Button>
                        ))
                      )}
                    </div>
                  ) : null}

                  {row.accountId ? (
                    <>
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
                            bioPanelTid === row.twitterId
                          }
                          title={
                            !canManageBio ? t('account.needXHandle') : undefined
                          }
                          onClick={() => setBioPanelTid(row.twitterId)}
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
                            void runPublish(row.accountId!, row.twitterId, published)
                          }
                        >
                          {publishBusy
                            ? t('account.bindingPublishing')
                            : published
                              ? t('account.republishBinding')
                              : t('account.publishBinding')}
                        </Button>
                      </div>
                    </>
                  ) : null}
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

      {bioRow && bioRow.accountId && bioHandle && bioRow.pubkey ? (
        <BioUpdatePanel
          visible
          onClose={() => {
            setBioPanelTid(null)
            void refreshFlagsForRow(bioRow.twitterId, bioHandle)
          }}
          handle={bioHandle}
          twitterId={bioRow.twitterId}
          activeNpub={npubFromPubkey(bioRow.pubkey)}
        />
      ) : null}
    </div>
  )
}
