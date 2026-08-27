import { useCallback, useEffect, useMemo, useState } from 'react'
import browser from '@shared/browser.ts'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { isXProductHost } from '@shared/x-host-autoconnect.ts'
import { boundTwitterIdsOf, isWritableNostrAccount } from '../../../accounts/x-binding.ts'
import { useAccount } from '../../context/AccountContext'
import { useSiteConnection } from '../../context/SiteConnectionContext'
import AttentionXPanel from './AttentionXPanel'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import EmptyState from '@components/EmptyState/EmptyState'
import { IconGlobe } from '@assets'
import styles from './HomeTab.module.css'
import type { PendingRequest } from '@lib/types.ts'

interface XHomeGateProps {
  onOpenWizard: () => void
  onOpenBindings: () => void
}

function XHomeGate({ onOpenWizard, onOpenBindings }: XHomeGateProps) {
  const {
    accounts,
    active,
    chromeForAccount,
    activeXTwitterId,
    activeXHandle,
    needsNostrForX,
    xBoundAccountId,
    xAccountResolving,
    xAccountResolveError,
    reload,
  } = useAccount()
  const [bindBusy, setBindBusy] = useState(false)
  const [bindError, setBindError] = useState('')

  const selectedWritable = useMemo(() => {
    if (!active) return null
    return isWritableNostrAccount(active) ? active : null
  }, [active])

  const selectedLabel = useMemo(() => {
    if (!selectedWritable) return ''
    return chromeForAccount(selectedWritable).displayName
  }, [selectedWritable, chromeForAccount])

  if (xAccountResolving && !activeXTwitterId) {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={t('common.loading')}
            hint={t('account.resolvingXId')}
          />
        </Card>
      </div>
    )
  }

  if (!activeXTwitterId) {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={xAccountResolveError || t('account.missingXId')}
            hint={t('account.openXToUse')}
          >
            <Button small onClick={() => void reload()}>
              {t('home.retry')}
            </Button>
          </EmptyState>
        </Card>
      </div>
    )
  }

  if (needsNostrForX || !xBoundAccountId) {
    const xLabel = activeXHandle
      ? `@${activeXHandle}`
      : t('account.thisXUser')
    const hasAnyWritable = (accounts ?? []).some((a) =>
      isWritableNostrAccount(a),
    )
    const reuseOtherX =
      Boolean(selectedWritable) &&
      boundTwitterIdsOf(selectedWritable!).length > 0

    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={t('account.unboundGateTitle', { x: xLabel })}
            hint={
              reuseOtherX
                ? t('account.reuseHint', { name: selectedLabel, x: xLabel })
                : selectedWritable
                  ? t('account.unboundGateHint', { x: xLabel })
                  : hasAnyWritable
                    ? t('account.selectExistingHint', { x: xLabel })
                    : t('account.needsCreateHint', { x: xLabel })
            }
          >
            <div className={styles.gateActions}>
              {selectedWritable ? (
                <Button
                  small
                  disabled={bindBusy}
                  onClick={() => {
                    setBindError('')
                    setBindBusy(true)
                    void rpc('bindAccountToX', {
                      accountId: selectedWritable.id,
                      twitterId: activeXTwitterId,
                    })
                      .then(() => reload())
                      .catch((err: unknown) => {
                        setBindError(
                          err instanceof Error ? err.message : String(err),
                        )
                      })
                      .finally(() => setBindBusy(false))
                  }}
                >
                  {bindBusy
                    ? t('common.saving')
                    : t('account.useExistingNostr', { name: selectedLabel })}
                </Button>
              ) : null}
              <Button small variant="secondary" onClick={onOpenWizard}>
                {t('account.createNewNostr')}
              </Button>
              <Button small variant="secondary" onClick={onOpenBindings}>
                {t('account.openBindings')}
              </Button>
            </div>
            {bindError ? (
              <div style={{ marginTop: 8 }}>{bindError}</div>
            ) : null}
          </EmptyState>
        </Card>
      </div>
    )
  }

  return <AttentionXPanel />
}

/**
 * Side panel home is site-scoped:
 * - Default: connect / disconnect for the active tab's host.
 * - Connected x.com / twitter.com: show the X-specific AttentionX tools.
 * - Other connected hosts: generic connected state only (future site pages can plug in here).
 */
export default function HomeTab({
  onOpenWizard,
  onOpenBindings,
}: {
  onOpenWizard: () => void
  onOpenBindings: () => void
}) {
  const { active } = useAccount()
  const [pendingCount, setPendingCount] = useState(0)
  const { domain, siteState, reload, connect, disconnect } = useSiteConnection()

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

  const pendingBanner =
    pendingCount > 0 ? (
      <Card className={styles.pendingCard}>
        <div className={styles.pendingInfo}>
          <span className={styles.pendingBadge}>{pendingCount}</span>
          <span className={styles.pendingText}>
            {t('unlock.pendingCount', { count: pendingCount })}
          </span>
        </div>
      </Card>
    ) : null

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

  // Connected — site-specific home pages. Only X hosts get AttentionX tools.
  if (domain && isXProductHost(domain)) {
    return (
      <>
        {pendingBanner}
        <XHomeGate onOpenWizard={onOpenWizard} onOpenBindings={onOpenBindings} />
      </>
    )
  }

  return (
    <div className={styles.centerWrap}>
      {pendingBanner}
      <Card className={styles.emptyState}>
        <EmptyState
          icon={<IconGlobe size={32} strokeWidth="1.5" />}
          text={t('home.connectedTo', { domain: domain ?? '' })}
          hint={t('home.siteConnectedHint')}
        >
          <Button
            small
            variant="danger"
            onClick={() => void disconnect()}
          >
            {t('common.disconnect')}
          </Button>
        </EmptyState>
      </Card>
    </div>
  )
}
