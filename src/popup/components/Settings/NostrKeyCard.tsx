import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { t } from '@lib/i18n.js'
import { rpc } from '@shared/rpc.ts'
import { truncateNpub } from '@shared/format/text.ts'
import Button from '@components/Button/Button'
import { IconChevronRight, IconPencil } from '@assets'
import {
  nostrKeyKind,
  type NostrKeyKind,
} from '../../../accounts/x-binding.ts'
import {
  KEY_TITLE_MAX_LENGTH,
  accountIsReadOnly,
  formatKeyTitle,
} from '../../../accounts/key-title.ts'
import styles from './UsersSection.module.css'

export function keyTypeLabel(kind: NostrKeyKind): string {
  switch (kind) {
    case 'nsec':
      return t('settings.keyTypeNsec')
    case 'readonly':
      return t('settings.keyTypeReadonly')
    case 'derivative':
      return t('settings.keyTypeDerivative')
    case 'nip46':
      return t('settings.keyTypeNip46')
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export type NostrKeyCardAccount = {
  id: string
  pubkey: string
  name?: string
  type?: string
  readOnly?: boolean
}

type RoamingState = 'yes' | 'no' | 'unknown'

function renameErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'empty') return t('settings.keyRenameEmpty')
  if (message === 'tooLong') return t('settings.keyRenameTooLong')
  if (message === 'Vault is locked') return t('settings.userVaultLockedHint')
  return message || t('common.error')
}

export default function NostrKeyCard(props: {
  account: NostrKeyCardAccount
  roaming: RoamingState
  boundNames: string[]
  vaultLocked: boolean
  showActiveOutline?: boolean
  showChevron?: boolean
  onOpen: () => void
  onUse?: () => void
}) {
  const kind = nostrKeyKind(props.account)
  const readOnly = accountIsReadOnly(props.account)
  const canRename = !props.vaultLocked || readOnly
  const storedName = props.account.name?.trim()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(storedName ?? '')
  const [renameError, setRenameError] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const showChevron = props.showChevron !== false
  const suffix = t('settings.keyReadOnlySuffix')

  const startEdit = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDraft(storedName ?? '')
    setRenameError('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(storedName ?? '')
    setRenameError('')
  }

  const saveEdit = async () => {
    if (renameBusy) return
    setRenameBusy(true)
    setRenameError('')
    try {
      await rpc('vault_renameAccount', {
        accountId: props.account.id,
        name: draft,
      })
      setEditing(false)
    } catch (error: unknown) {
      setRenameError(renameErrorMessage(error))
    }
    setRenameBusy(false)
  }

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }
  }

  const meta = (
        <>
        <span className={styles.npub}>{truncateNpub(props.account.pubkey)}</span>
        <span className={styles.keyType}>{keyTypeLabel(kind)}</span>
        {!props.vaultLocked ? (
          <span className={styles.keyType}>
            {props.roaming === 'yes'
              ? t('settings.keyRoamingYes')
              : props.roaming === 'no'
                ? t('settings.keyRoamingNo')
                : t('settings.keyRoamingUnknown')}
          </span>
        ) : null}
        <span className={styles.keyType}>
          {props.boundNames.length > 0
            ? t('settings.keyBoundX', { names: props.boundNames.join(', ') })
            : t('settings.keyNotBound')}
        </span>
        </>
  )

  return (
    <div
      className={`${styles.userCard}${
        props.showActiveOutline ? ` ${styles.userCardActive}` : ''
      }`}
    >
      <div className={styles.userMetaWrap}>
        <div
          className={styles.titleRow}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {editing ? (
            <input
              className={styles.titleInput}
              value={draft}
              maxLength={KEY_TITLE_MAX_LENGTH}
              autoFocus
              disabled={renameBusy}
              aria-label={t('settings.keyRename')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onTitleKeyDown}
            />
          ) : (
            <span className={styles.keyTitle}>
              {formatKeyTitle(
                storedName,
                readOnly,
                suffix,
                truncateNpub(props.account.pubkey),
              )}
            </span>
          )}
          {editing && readOnly ? (
            <span className={styles.keyType}> - ({suffix})</span>
          ) : null}
          {canRename && !editing ? (
                <button
                  type="button"
                  className={styles.renameBtn}
                  aria-label={t('settings.keyRename')}
                  onClick={startEdit}
                >
                  <IconPencil size={14} />
                </button>
              ) : null}
        </div>
        {renameError ? <div className={styles.error}>{renameError}</div> : null}
        {showChevron ? (
          <button type="button" className={styles.userMeta} onClick={props.onOpen}>
            {meta}
          </button>
        ) : (
          <div className={styles.userMeta}>{meta}</div>
        )}
      </div>
      {props.onUse ? (
        <span className={styles.useBtn}>
          <Button small variant="secondary" onClick={props.onUse}>
            {t('settings.usersUseKey')}
          </Button>
        </span>
      ) : null}
      {showChevron ? (
        <button
          type="button"
          className={styles.chevronBtn}
          aria-label={t('settings.userHub')}
          onClick={props.onOpen}
        >
          <IconChevronRight size={16} />
        </button>
      ) : null}
    </div>
  )
}
