import { useState } from 'react'
import { t } from '@lib/i18n.js'
import { safeImageUrl } from '@shared/safeUrl.js'
import { IconXVerified } from '@assets'
import {
  buildXProfileIconUrl,
  isXProfileIconPath,
} from '../../shared/x-profile-display'
import {
  X_VERIFIED_COLORS,
  type XVerifiedType,
} from '../../shared/x-verified'
import styles from './XUserBadges.module.css'

export interface XUserBadgesProps {
  verifiedType?: XVerifiedType
  affiliationBadgePath?: string
  affiliationLabel?: string
  size?: number
}

function verifiedAriaLabel(verifiedType: XVerifiedType): string {
  switch (verifiedType) {
    case 'blue':
      return t('chrome.verified.blue')
    case 'business':
      return t('chrome.verified.business')
    case 'government':
      return t('chrome.verified.government')
    default: {
      const _exhaustive: never = verifiedType
      return _exhaustive
    }
  }
}

function AffiliationMark(props: {
  path: string
  label: string | undefined
  size: number
}) {
  const [failed, setFailed] = useState(false)
  const url = isXProfileIconPath(props.path)
    ? buildXProfileIconUrl(props.path, 'normal')
    : undefined
  const src = safeImageUrl(url)
  if (!src || failed) return null
  const alt = props.label
    ? t('chrome.affiliation', { label: props.label })
    : t('chrome.affiliationUnknown')
  return (
    <img
      className={styles.affiliation}
      src={src}
      alt={alt}
      width={props.size}
      height={props.size}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

export default function XUserBadges(props: XUserBadgesProps) {
  const size = props.size ?? 16
  const hasCheck = Boolean(props.verifiedType)
  const hasAffiliation = Boolean(props.affiliationBadgePath)
  if (!hasCheck && !hasAffiliation) return null

  return (
    <span className={styles.root}>
      {props.verifiedType ? (
        <span
          className={styles.check}
          style={{ color: X_VERIFIED_COLORS[props.verifiedType] }}
          title={verifiedAriaLabel(props.verifiedType)}
          aria-label={verifiedAriaLabel(props.verifiedType)}
        >
          <IconXVerified size={size} />
        </span>
      ) : null}
      {props.affiliationBadgePath ? (
        <AffiliationMark
          path={props.affiliationBadgePath}
          label={props.affiliationLabel}
          size={size}
        />
      ) : null}
    </span>
  )
}
