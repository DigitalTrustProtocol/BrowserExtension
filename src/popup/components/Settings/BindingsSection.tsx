import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { getInitial, truncateNpub } from '@shared/format/text.ts'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import Avatar from '@components/Avatar/Avatar'
import Select from '@components/Select/Select'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import { IconWarning } from '../../../assets'
import UnlinkPanel from './UnlinkPanel'
import BioUpdatePanel from '../Home/BioUpdatePanel'
import EditProfileOverlay from '../EditProfile/EditProfileOverlay'
import type { XProfilePrefill } from '../EditProfile/edit-profile-state.ts'
import { isWritableNostrAccount } from '../../../accounts/x-binding.ts'
import {
  buildXProfileBannerUrl,
  buildXProfileIconUrl,
  isXProfileBannerPath,
  isXProfileIconPath,
} from '../../../shared/x-profile-display.ts'
import { missingBindingIssues } from '../../../shared/operator-binding-status.ts'
import {
  BACKGROUND_API_VERSION,
  type BindingMissingIssue,
  type ExtensionRequest,
  type ExtensionResponse,
  type OperatorXBindingRow,
  type XBindingPublishResult,
} from '../../../shared/contracts'
import styles from './SecuritySection.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function npubFromPubkey(pubkey: string): string | undefined {
  try {
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) return undefined
    return nip19.npubEncode(pubkey.toLowerCase())
  } catch {
    return undefined
  }
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

function issueLabel(issue: BindingMissingIssue): string {
  switch (issue) {
    case 'unbound':
      return t('account.bindingMissingUnbound')
    case 'bio':
      return t('account.bindingMissingBio')
    case 'kind0':
      return t('account.bindingMissingKind0')
    case 'nip39':
      return t('account.bindingMissing10011')
    default: {
      const _exhaustive: never = issue
      return _exhaustive
    }
  }
}

function missingSummary(row: OperatorXBindingRow): string {
  const issues = missingBindingIssues(row.completeness)
  if (issues.length === 0) return t('account.bindingComplete')
  return t('account.bindingMissingSummary', {
    items: issues.map(issueLabel).join(', '),
  })
}

async function readLiveXBio(): Promise<string | undefined> {
  const tabs = await chrome.tabs.query({
    url: ['https://x.com/*', 'https://twitter.com/*'],
  })
  for (const tab of tabs) {
    if (!tab.id) continue
    try {
      const res = (await chrome.tabs.sendMessage(tab.id, {
        type: 'READ_ACTIVE_X_BIO',
      })) as { found?: boolean; bio?: string } | undefined
      if (res?.found && typeof res.bio === 'string') return res.bio
    } catch {
      /* next tab */
    }
  }
  return undefined
}

function BindControls(props: {
  row: OperatorXBindingRow
  pendingId: string
  writableOptions: Array<{ value: string; label: string }>
  bindBusy: boolean
  vaultReady: boolean
  onPending: (accountId: string) => void
  onBind: () => void
  onUnbind?: () => void
}) {
  return (
    <div className={styles.bindSelectRow} onClick={(e) => e.stopPropagation()}>
      <Select
        small
        disabled={!props.vaultReady || props.writableOptions.length === 0}
        value={props.pendingId}
        onChange={(e) => props.onPending(e.target.value)}
        options={[
          { value: '', label: t('account.notBound') },
          ...props.writableOptions,
        ]}
      />
      <Button
        small
        disabled={
          !props.vaultReady ||
          !props.pendingId ||
          props.pendingId === (props.row.accountId ?? '') ||
          props.bindBusy
        }
        onClick={() => void props.onBind()}
      >
        {props.row.accountId
          ? t('account.bindChange')
          : t('account.bindAction')}
      </Button>
      {props.row.accountId && props.onUnbind ? (
        <Button
          variant="secondary"
          small
          disabled={!props.vaultReady}
          onClick={props.onUnbind}
        >
          {t('account.unbindFromX')}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Settings Bindings: known operator X users (index + roaming + signed-in).
 */
export default function BindingsSection(props: {
  detailTwitterId?: string
  onOpenDetail?: (twitterId: string) => void
}) {
  const [rows, setRows] = useState<OperatorXBindingRow[]>([])
  const [loadError, setLoadError] = useState('')
  const [unlinkingTid, setUnlinkingTid] = useState<string | null>(null)
  const [bioPanelTid, setBioPanelTid] = useState<string | null>(null)
  const [pendingByTid, setPendingByTid] = useState<Record<string, string>>({})
  const [bindBusyTid, setBindBusyTid] = useState<string | null>(null)
  const [publishBusyTid, setPublishBusyTid] = useState<string | null>(null)
  const [publishMessageByTid, setPublishMessageByTid] = useState<
    Record<string, string>
  >({})
  const [editOpen, setEditOpen] = useState(false)
  const [xPrefill, setXPrefill] = useState<XProfilePrefill | null>(null)
  const vault = useVault()
  const {
    accounts,
    activeId,
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
      setPendingByTid((prev) => {
        const next = { ...prev }
        for (const row of data) {
          if (next[row.twitterId] === undefined) {
            next[row.twitterId] = row.accountId ?? ''
          }
        }
        return next
      })
      setLoadError('')
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : t('common.error'))
    }
  }, [])

  useEffect(() => {
    void loadRows()
  }, [loadRows, accounts])

  const writableAccounts = (accounts || []).filter((a) =>
    isWritableNostrAccount(a),
  )
  const writableOptions = writableAccounts.map((account) => ({
    value: account.id,
    label: truncateNpub(account.pubkey),
  }))
  const vaultReady = Boolean(vault.exists) && !vault.locked

  const bindRow = async (accountId: string, twitterId: string) => {
    setBindBusyTid(twitterId)
    try {
      await rpc('bindAccountToX', {
        accountId,
        twitterId,
        reassign: true,
      })
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

  const runPublish = async (twitterId: string, force: boolean) => {
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
      await loadRows()
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

  const openKind0Sync = async (row: OperatorXBindingRow) => {
    const xName = row.displayName?.trim()
    const xPicture = rowAvatar(row) ?? undefined
    const xBanner =
      row.bannerPath && isXProfileBannerPath(row.bannerPath)
        ? buildXProfileBannerUrl(row.bannerPath)
        : undefined
    const about = await readLiveXBio()
    setXPrefill({
      ...(xName ? { name: xName } : {}),
      ...(xPicture ? { picture: xPicture } : {}),
      ...(xBanner ? { banner: xBanner } : {}),
      ...(about !== undefined ? { about, aboutProvided: true } : {}),
    })
    setEditOpen(true)
  }

  const unlinkingRow = rows.find((r) => r.twitterId === unlinkingTid)
  const bioRow = rows.find((r) => r.twitterId === bioPanelTid)
  const bioHandle =
    bioRow?.handle ||
    (bioRow && activeXTwitterId === bioRow.twitterId
      ? activeXHandle
      : undefined)
  const detailRow = props.detailTwitterId
    ? rows.find((r) => r.twitterId === props.detailTwitterId)
    : undefined

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

  const renderChrome = (row: OperatorXBindingRow) => {
    const onActiveX = Boolean(row.signedIn)
    const handle =
      row.handle || (onActiveX ? activeXHandle ?? undefined : undefined)
    return (
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
        </div>
      </div>
    )
  }

  if (props.detailTwitterId) {
    const row = detailRow
    return (
      <div className={styles.section}>
        {vault.exists && vault.locked ? (
          <Card>
            <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
            <SectionHint>{t('settings.bindingsVaultLockedHint')}</SectionHint>
          </Card>
        ) : null}
        {loadError ? <div className={styles.error}>{loadError}</div> : null}
        {!row ? (
          <SectionHint>{t('account.bindingsEmpty')}</SectionHint>
        ) : (
          <Card>
            {renderChrome(row)}
            <BindControls
              row={row}
              pendingId={pendingByTid[row.twitterId] ?? row.accountId ?? ''}
              writableOptions={writableOptions}
              bindBusy={bindBusyTid === row.twitterId}
              vaultReady={vaultReady}
              onPending={(id) =>
                setPendingByTid((prev) => ({ ...prev, [row.twitterId]: id }))
              }
              onBind={() => {
                const id = pendingByTid[row.twitterId]
                if (id) void bindRow(id, row.twitterId)
              }}
              onUnbind={
                row.accountId
                  ? () => setUnlinkingTid(row.twitterId)
                  : undefined
              }
            />
            {row.accountId ? (
              <>
                <div className={styles.bindingStatusRow}>
                  <span
                    className={
                      row.completeness.bioMismatch
                        ? styles.bindingStatusWarn
                        : styles.bindingStatus
                    }
                    role="status"
                  >
                    {row.completeness.bioOk
                      ? t('account.bioStatusOk')
                      : row.completeness.bioMismatch
                        ? t('account.bioStatusMismatch')
                        : t('account.bioStatusMissing')}
                    {row.completeness.bioMismatch ? (
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
                      !vaultReady ||
                      !(
                        row.handle ||
                        (activeXTwitterId === row.twitterId && activeXHandle)
                      )
                    }
                    onClick={() => setBioPanelTid(row.twitterId)}
                  >
                    {t('account.updateBio')}
                  </Button>
                </div>
                <div className={styles.bindingStatusRow}>
                  <span className={styles.bindingStatus} role="status">
                    {row.completeness.kind0Compare === 'match'
                      ? t('account.kind0Match')
                      : row.completeness.kind0Compare === 'mismatch'
                        ? t('account.kind0Mismatch')
                        : t('account.kind0Missing')}
                  </span>
                  <Button
                    small
                    disabled={
                      !vaultReady ||
                      row.accountId !== activeId ||
                      row.completeness.kind0Ok
                    }
                    onClick={() => void openKind0Sync(row)}
                  >
                    {row.completeness.kind0Compare === 'missing'
                      ? t('account.kind0Create')
                      : t('account.kind0Sync')}
                  </Button>
                </div>
                <div className={styles.bindingStatusRow}>
                  <span className={styles.bindingStatus} role="status">
                    {row.completeness.nip39Ok
                      ? t('account.bindingStatusPublished')
                      : t('account.bindingStatusMissing')}
                  </span>
                  <Button
                    small
                    variant="secondary"
                    disabled={
                      !vaultReady ||
                      !row.signedIn ||
                      publishBusyTid === row.twitterId
                    }
                    title={
                      !row.signedIn ? t('account.needActiveXTab') : undefined
                    }
                    onClick={() =>
                      void runPublish(row.twitterId, row.completeness.nip39Ok)
                    }
                  >
                    {publishBusyTid === row.twitterId
                      ? t('account.bindingPublishing')
                      : row.completeness.nip39Ok
                        ? t('account.republishBinding')
                        : t('account.publishBinding')}
                  </Button>
                </div>
              </>
            ) : null}
            {publishMessageByTid[row.twitterId] ? (
              <p className={styles.bindingPublishMsg} role="status">
                {publishMessageByTid[row.twitterId]}
              </p>
            ) : null}
          </Card>
        )}
        {bioRow && bioRow.accountId && bioHandle && bioRow.pubkey ? (
          <BioUpdatePanel
            visible
            onClose={() => {
              setBioPanelTid(null)
              void loadRows()
            }}
            handle={bioHandle}
            twitterId={bioRow.twitterId}
            activeNpub={npubFromPubkey(bioRow.pubkey)}
          />
        ) : null}
        <EditProfileOverlay
          visible={editOpen}
          onClose={() => {
            setEditOpen(false)
            setXPrefill(null)
            void loadRows()
          }}
          xPrefill={xPrefill}
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
              const onActiveX = Boolean(row.signedIn)
              return (
                <div
                  key={row.twitterId}
                  className={`${styles.bindingRow}${
                    onActiveX ? ` ${styles.bindingRowCurrent}` : ''
                  }`}
                >
                  <button
                    type="button"
                    className={styles.bindingHeaderButton}
                    onClick={() => props.onOpenDetail?.(row.twitterId)}
                  >
                    {renderChrome(row)}
                    <SectionHint>{missingSummary(row)}</SectionHint>
                  </button>
                  <BindControls
                    row={row}
                    pendingId={pendingByTid[row.twitterId] ?? row.accountId ?? ''}
                    writableOptions={writableOptions}
                    bindBusy={bindBusyTid === row.twitterId}
                    vaultReady={vaultReady}
                    onPending={(id) =>
                      setPendingByTid((prev) => ({
                        ...prev,
                        [row.twitterId]: id,
                      }))
                    }
                    onBind={() => {
                      const id = pendingByTid[row.twitterId]
                      if (id) void bindRow(id, row.twitterId)
                    }}
                    onUnbind={
                      row.accountId
                        ? () => setUnlinkingTid(row.twitterId)
                        : undefined
                    }
                  />
                  {publishMessageByTid[row.twitterId] ? (
                    <p className={styles.bindingPublishMsg} role="status">
                      {publishMessageByTid[row.twitterId]}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
