import { useEffect, useRef, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { getInitial } from '@shared/format/text.ts'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import Avatar from '@components/Avatar/Avatar'
import XUserBadges from '@components/XUserBadges/XUserBadges'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import UnlinkPanel from './UnlinkPanel'
import BioUpdateWizard from '../Home/BioUpdateWizard'
import { isWritableNostrAccount } from '../../../accounts/x-binding.ts'
import {
  buildXProfileIconUrl,
  isXProfileIconPath,
} from '../../../shared/x-profile-display.ts'
import { liveSetupIssues } from '../../../shared/operator-binding-status.ts'
import {
  BACKGROUND_API_VERSION,
  type BindingMissingIssue,
  type ExtensionRequest,
  type ExtensionResponse,
  type OperatorXBindingRow,
  type XBindingPublishResult,
} from '../../../shared/contracts'
import { nostrBindingOptionLabel } from './binding-key-label.ts'
import styles from './BindingsSection.module.css'

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
    case 'nip39':
      return t('account.bindingMissing10011')
    case 'backup':
      return t('account.bindingMissingBackup')
    default: {
      const _exhaustive: never = issue
      return _exhaustive
    }
  }
}

function missingSummary(row: OperatorXBindingRow): string {
  const issues = liveSetupIssues(row.completeness)
  if (issues.length === 0) return t('account.bindingComplete')
  return t('account.bindingMissingSummary', {
    items: issues.map(issueLabel).join(', '),
  })
}

type ChipTone = 'ok' | 'warn' | 'muted'

function StatusChip(props: { tone: ChipTone; label: string }) {
  const toneClass =
    props.tone === 'ok'
      ? styles.statusOk
      : props.tone === 'warn'
        ? styles.statusWarn
        : styles.statusMuted
  return (
    <span className={`${styles.statusChip} ${toneClass}`}>{props.label}</span>
  )
}

function BindingKeySelect(props: {
  value: string
  placeholder: string
  disabled: boolean
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = props.options.find((opt) => opt.value === props.value)

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className={styles.keySelect} ref={rootRef}>
      <button
        type="button"
        className={styles.keySelectTrigger}
        disabled={props.disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={selected?.label || props.placeholder}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected?.label || props.placeholder}
      </button>
      {open && !props.disabled ? (
        <ul className={styles.keySelectMenu} role="listbox">
          {props.options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={opt.value === props.value}
                className={`${styles.keySelectOption}${
                  opt.value === props.value ? ` ${styles.keySelectOptionActive}` : ''
                }`}
                onClick={() => {
                  props.onChange(opt.value)
                  setOpen(false)
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
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
      <BindingKeySelect
        disabled={!props.vaultReady || props.writableOptions.length === 0}
        value={props.pendingId}
        placeholder={t('settings.selectNostrKey')}
        options={props.writableOptions}
        onChange={props.onPending}
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
  onOpenNostrKeys?: () => void
}) {
  const [unlinkingTid, setUnlinkingTid] = useState<string | null>(null)
  const [bioPanelTid, setBioPanelTid] = useState<string | null>(null)
  const [pendingByTid, setPendingByTid] = useState<Record<string, string>>({})
  const [bindBusyTid, setBindBusyTid] = useState<string | null>(null)
  const [publishBusyTid, setPublishBusyTid] = useState<string | null>(null)
  const [publishMessageByTid, setPublishMessageByTid] = useState<
    Record<string, string>
  >({})
  const [backupBusy, setBackupBusy] = useState(false)
  const vault = useVault()
  const {
    accounts,
    reload: reloadAccounts,
    reloadOperatorBindings,
    operatorBindings,
    operatorBindingsReady,
    activeXHandle,
    activeXTwitterId,
  } = useAccount()
  const rows = operatorBindings

  useEffect(() => {
    setPendingByTid((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        if (next[row.twitterId] === undefined) {
          next[row.twitterId] = row.accountId ?? ''
        }
      }
      return next
    })
  }, [rows])

  const writableAccounts = (accounts || []).filter((a) =>
    isWritableNostrAccount(a),
  )
  const writableOptions = writableAccounts.map((account) => ({
    value: account.id,
    label: nostrBindingOptionLabel(account, rows),
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
      await reloadOperatorBindings()
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

  const markBackupDone = async () => {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      await axRequest<{ ok: true }>({
        type: 'MARK_MASTER_BACKUP_DONE',
        version: BACKGROUND_API_VERSION,
      })
      reloadAccounts()
      await reloadOperatorBindings()
    } catch {
      /* keep previous */
    } finally {
      setBackupBusy(false)
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
      await reloadOperatorBindings()
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
            void reloadOperatorBindings()
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
          <div className={styles.bindingName}>
            {rowName(row)}
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
          </div>
          <SectionHint>
            {handle ? `@${handle.replace(/^@+/u, '')}` : row.twitterId}
            {onActiveX ? ` · ${t('account.signedInX')}` : ''}
          </SectionHint>
        </div>
      </div>
    )
  }

  const bindControlsFor = (row: OperatorXBindingRow) => (
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
        const id = pendingByTid[row.twitterId] ?? row.accountId
        if (id) void bindRow(id, row.twitterId)
      }}
      onUnbind={
        row.accountId ? () => setUnlinkingTid(row.twitterId) : undefined
      }
    />
  )

  const bioWizard =
    bioRow && bioRow.accountId && bioHandle && bioRow.pubkey ? (
      <BioUpdateWizard
        visible
        onClose={() => {
          setBioPanelTid(null)
          void reloadOperatorBindings()
        }}
        handle={bioHandle}
        twitterId={bioRow.twitterId}
        activeNpub={npubFromPubkey(bioRow.pubkey)}
      />
    ) : null

  if (props.detailTwitterId) {
    const row = detailRow
    const bioTone: ChipTone = row?.completeness.bioOk
      ? 'ok'
      : row?.completeness.bioMismatch
        ? 'warn'
        : 'muted'
    const bioChip = row?.completeness.bioOk
      ? t('account.statusOk')
      : row?.completeness.bioMismatch
        ? t('account.statusMismatch')
        : t('account.statusMissing')
    const nipTone: ChipTone = row?.completeness.nip39Ok ? 'ok' : 'warn'
    const nipChip = row?.completeness.nip39Ok
      ? t('account.statusPublished')
      : t('account.statusNotPublished')
    const backupTone: ChipTone = row?.completeness.backupOk ? 'ok' : 'warn'
    const backupChip = row?.completeness.backupOk
      ? t('account.backupDone')
      : t('account.backupMissing')

    return (
      <div className={styles.section}>
        {vault.exists && vault.locked ? (
          <Card>
            <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
            <SectionHint>{t('settings.bindingsVaultLockedHint')}</SectionHint>
          </Card>
        ) : null}
        {!row && operatorBindingsReady ? (
          <SectionHint>{t('account.bindingsEmpty')}</SectionHint>
        ) : !row ? null : (
          <Card className={styles.detailCard}>
            {renderChrome(row)}
            {bindControlsFor(row)}
            {row.accountId ? (
              <>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>
                    {t('account.statusBackup')}
                  </span>
                  <StatusChip tone={backupTone} label={backupChip} />
                  {row.completeness.backupOk ? null : (
                    <Button
                      small
                      disabled={!vaultReady || backupBusy}
                      onClick={() => void markBackupDone()}
                    >
                      {t('account.markBackedUp')}
                    </Button>
                  )}
                  {props.onOpenNostrKeys ? (
                    <Button
                      small
                      variant="secondary"
                      onClick={props.onOpenNostrKeys}
                    >
                      {t('account.openNostrKeys')}
                    </Button>
                  ) : null}
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>
                    {t('account.statusBio')}
                  </span>
                  <StatusChip tone={bioTone} label={bioChip} />
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
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>
                    {t('account.statusBinding')}
                  </span>
                  <StatusChip tone={nipTone} label={nipChip} />
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
                  {publishMessageByTid[row.twitterId] ? (
                    <p className={styles.statusError} role="status">
                      {publishMessageByTid[row.twitterId]}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </Card>
        )}
        {bioWizard}
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

      <SectionLabel>{t('settings.bindings')}</SectionLabel>
      <SectionHint>
        {t('account.unbindFromXHint')} {t('account.bindCap')}
      </SectionHint>
      {rows.length === 0 && operatorBindingsReady ? (
        <SectionHint>{t('account.bindingsEmpty')}</SectionHint>
      ) : rows.length === 0 ? null : (
        <div className={styles.cardList}>
          {rows.map((row) => {
            const onActiveX = Boolean(row.signedIn)
            return (
              <Card
                key={row.twitterId}
                className={onActiveX ? styles.bindingRowCurrent : undefined}
              >
                <button
                  type="button"
                  className={styles.bindingHeaderButton}
                  onClick={() => props.onOpenDetail?.(row.twitterId)}
                >
                  {renderChrome(row)}
                  <SectionHint>{missingSummary(row)}</SectionHint>
                </button>
                {bindControlsFor(row)}
                {publishMessageByTid[row.twitterId] ? (
                  <p className={styles.bindingPublishMsg} role="status">
                    {publishMessageByTid[row.twitterId]}
                  </p>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}
      {bioWizard}
    </div>
  )
}
