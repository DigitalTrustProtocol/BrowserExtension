import { t } from '@lib/i18n.js'
import { truncateNpub } from '@shared/format/text.ts'
import Button from '@components/Button/Button'
import { IconChevronRight } from '@assets'
import {
  nostrKeyKind,
  type NostrKeyKind,
} from '../../../accounts/x-binding.ts'
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
  type?: string
  readOnly?: boolean
}

type RoamingState = 'yes' | 'no' | 'unknown'

export default function NostrKeyCard(props: {
  account: NostrKeyCardAccount
  kind0Title?: string
  roaming: RoamingState
  boundNames: string[]
  vaultLocked: boolean
  showActiveOutline?: boolean
  showChevron?: boolean
  onOpen: () => void
  onUse?: () => void
}) {
  const kind = nostrKeyKind(props.account)
  const title = !props.vaultLocked ? props.kind0Title?.trim() : undefined
  const showChevron = props.showChevron !== false
  const meta = (
        <>
        {title ? <span className={styles.keyTitle}>{title}</span> : null}
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
      {showChevron ? (
        <button type="button" className={styles.userMeta} onClick={props.onOpen}>
          {meta}
        </button>
      ) : (
        <div className={styles.userMeta}>{meta}</div>
      )}
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
