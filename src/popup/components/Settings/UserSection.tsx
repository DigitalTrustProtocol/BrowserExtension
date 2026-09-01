import { useCallback, useMemo, useState } from 'react'
import { t } from '@lib/i18n.js'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { useVault } from '../../context/VaultContext'
import { useAccount } from '../../context/AccountContext'
import { boundTwitterIdsOf } from '../../../accounts/x-binding.ts'
import {
  buildXProfileBannerUrl,
  buildXProfileIconUrl,
  isXProfileBannerPath,
  isXProfileIconPath,
} from '../../../shared/x-profile-display.ts'
import EditProfileOverlay from '../EditProfile/EditProfileOverlay'
import {
  compareKind0ToX,
  type XProfilePrefill,
} from '../EditProfile/edit-profile-state.ts'
import styles from './SecuritySection.module.css'

type IdentityChromeRow = {
  displayName?: string
  handle?: string
  iconPath?: string
  bannerPath?: string
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

/**
 * Kind 0 create/sync vs the X this Nostr key is bound to.
 */
export default function UserSection(props: { accountId: string }) {
  const [editOpen, setEditOpen] = useState(false)
  const [xPrefill, setXPrefill] = useState<XProfilePrefill | null>(null)
  const vault = useVault()
  const {
    accounts,
    activeId,
    profileCache,
    operatorBindings,
    activeXTwitterId,
    activeXHandle,
    displayName,
  } = useAccount()

  const account = (accounts ?? []).find((a) => a.id === props.accountId) ?? null
  const cachedProfile = account ? profileCache[account.pubkey] : null
  const boundIds = account ? boundTwitterIdsOf(account) : []
  const compareTwitterId =
    activeXTwitterId && boundIds.includes(activeXTwitterId)
      ? activeXTwitterId
      : boundIds.length === 1
        ? boundIds[0]
        : null
  const canPublish =
    Boolean(account) &&
    account?.id === activeId &&
    account?.readOnly !== true &&
    account?.type !== 'npub'

  const identity: IdentityChromeRow | null = compareTwitterId
    ? (operatorBindings.find((row) => row.twitterId === compareTwitterId) ??
      null)
    : null

  const xPicture = useMemo(() => {
    const path = identity?.iconPath
    return path && isXProfileIconPath(path) ? buildXProfileIconUrl(path) : undefined
  }, [identity])
  const xBanner = useMemo(() => {
    const path = identity?.bannerPath
    return path && isXProfileBannerPath(path)
      ? buildXProfileBannerUrl(path)
      : undefined
  }, [identity])
  const xName = identity?.displayName?.trim() || displayName

  const compare = useMemo(
    () =>
      compareKind0ToX(cachedProfile, {
        name: xName,
        picture: xPicture,
        banner: xBanner,
      }),
    [cachedProfile, xName, xPicture, xBanner],
  )

  const openSync = useCallback(async () => {
    const about = await readLiveXBio()
    setXPrefill({
      ...(xName ? { name: xName } : {}),
      ...(xPicture ? { picture: xPicture } : {}),
      ...(xBanner ? { banner: xBanner } : {}),
      ...(about !== undefined ? { about, aboutProvided: true } : {}),
    })
    setEditOpen(true)
  }, [xName, xPicture, xBanner])

  return (
    <div className={styles.section}>
      {vault.exists && vault.locked ? (
        <Card>
          <SectionLabel>{t('security.vaultLockedTitle')}</SectionLabel>
          <SectionHint>{t('settings.userVaultLockedHint')}</SectionHint>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>{t('account.kind0Title')}</SectionLabel>
        {!compareTwitterId ? (
          <SectionHint>{t('account.kind0NeedBoundX')}</SectionHint>
        ) : (
          <>
            <SectionHint>
              {compare === 'missing'
                ? t('account.kind0Missing')
                : compare === 'mismatch'
                  ? t('account.kind0Mismatch')
                  : t('account.kind0Match')}
            </SectionHint>
            {boundIds.length > 1 ? (
              <SectionHint>{t('account.kind0SharedKeyHint')}</SectionHint>
            ) : null}
            {compare !== 'match' ? (
              <div className={styles.compareRow}>
                <div className={styles.compareCol}>
                  <div className={styles.compareLabel}>X</div>
                  <div>{xName}</div>
                </div>
                <div className={styles.compareCol}>
                  <div className={styles.compareLabel}>Nostr</div>
                  <div>
                    {cachedProfile?.name ||
                      cachedProfile?.display_name ||
                      t('account.kind0Missing')}
                  </div>
                </div>
              </div>
            ) : null}
            {compare === 'missing' ? (
              <Button
                small
                disabled={!vault.exists || vault.locked || !canPublish}
                onClick={() => void openSync()}
              >
                {t('account.kind0Create')}
              </Button>
            ) : compare === 'mismatch' ? (
              <Button
                small
                disabled={!vault.exists || vault.locked || !canPublish}
                onClick={() => void openSync()}
              >
                {t('account.kind0Sync')}
              </Button>
            ) : null}
          </>
        )}
        {boundIds.length > 0 ? (
          <SectionHint>
            {t('account.kind0BoundList', {
              ids: boundIds.join(', '),
              handle: activeXHandle ? `@${activeXHandle}` : '',
            })}
          </SectionHint>
        ) : null}
      </Card>

      <EditProfileOverlay
        visible={editOpen}
        onClose={() => {
          setEditOpen(false)
          setXPrefill(null)
        }}
        xPrefill={xPrefill}
      />
    </div>
  )
}
