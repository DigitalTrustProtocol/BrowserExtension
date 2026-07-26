import { useCallback, useEffect, useState } from 'react'
import browser from '@shared/browser.ts'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { useAccount } from '../../context/AccountContext'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import AttentionXPanel from './AttentionXPanel'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import EmptyState from '@components/EmptyState/EmptyState'
import { IconGlobe } from '@assets'
import styles from './HomeTab.module.css'
import type { PendingRequest } from '@lib/types.ts'

export default function HomeTab() {
  const { active } = useAccount()
  const [pendingCount, setPendingCount] = useState(0)
  const { domain, siteState, reload, connect } = useSiteConnection()

  // Soft-refresh when the active Nostr account changes (allowlist is shared).
  useEffect(() => {
    void reload({ soft: true })
  }, [active?.id, reload])

  const checkPending = useCallback(async () => {
    try {
      const pending: PendingRequest[] = (await rpc('signer_getPending')) || []
      const actionable = pending.filter(
        (r) => (r.needsPermission || r.waitingForUnlock) && !r.nip46InFlight,
      )
      setPendingCount(actionable.length)
    } catch {
      setPendingCount(0)
    }
  }, [])

  useEffect(() => {
    void checkPending()
    const listener = (message: { type?: string }) => {
      if (message.type === 'signerPendingUpdated') void checkPending()
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [checkPending])

  if (siteState === 'loading') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={t('common.loading')}
          />
        </Card>
      </div>
    )
  }

  if (siteState === 'empty') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={t('home.navigateToConnect')}
            hint={t('home.siteControlsHint')}
          />
        </Card>
      </div>
    )
  }

  if (siteState === 'error') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={domain ?? ''}
            hint={t('home.siteInfoError')}
          >
            <Button small onClick={() => void reload()}>
              {t('home.retry')}
            </Button>
          </EmptyState>
        </Card>
      </div>
    )
  }

  if (siteState === 'notConnected') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={domain!}
            hint={t('home.siteNotConnected')}
          >
            <Button small onClick={() => void connect()}>
              {t('home.connectSite')}
            </Button>
          </EmptyState>
        </Card>
      </div>
    )
  }

  return (
    <>
      {pendingCount > 0 && (
        <Card className={styles.pendingCard}>
          <div className={styles.pendingInfo}>
            <span className={styles.pendingBadge}>{pendingCount}</span>
            <span className={styles.pendingText}>
              {t('unlock.pendingCount', { count: pendingCount })}
            </span>
          </div>
        </Card>
      )}
      <AttentionXPanel />
    </>
  )
}
