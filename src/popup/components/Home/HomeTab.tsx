import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import browser from '@shared/browser.ts'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import { BACKGROUND_API_VERSION } from '../../../shared/contracts.ts'
import { boundTwitterIdsOf, isWritableNostrAccount } from '../../../accounts/x-binding.ts'
import { useAccount } from '../../context/AccountContext'
import AttentionXPanel from './AttentionXPanel'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import EmptyState from '@components/EmptyState/EmptyState'
import { IconGlobe } from '@assets'
import styles from './HomeTab.module.css'
import type { PendingRequest } from '@lib/types.ts'

export function PanelEmpty({
  text,
  hint,
  children,
}: {
  text: string
  hint?: string
  children?: ReactNode
}) {
  return (
    <div className={styles.centerWrap}>
      <Card className={styles.emptyState}>
        <EmptyState
          icon={<IconGlobe size={32} strokeWidth="1.5" />}
          text={text}
          {...(hint ? { hint } : {})}
        >
          {children}
        </EmptyState>
      </Card>
    </div>
  )
}

export function DemoChoicePanel() {
  const [busy, setBusy] = useState(false)
  const [pendingMode, setPendingMode] = useState<'demo' | 'production' | null>(
    null,
  )
  const [error, setError] = useState('')
  const confirm = (mode: 'demo' | 'production') => {
    if (busy) return
    setBusy(true)
    setPendingMode(mode)
    setError('')
    void chrome.runtime
      .sendMessage({
        type: 'SET_APP_MODE',
        version: BACKGROUND_API_VERSION,
        mode,
      })
      .then((response: { ok?: boolean; error?: string } | undefined) => {
        if (!response?.ok) {
          setError(response?.error ?? t('common.error'))
          setBusy(false)
          setPendingMode(null)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('common.error'))
        setBusy(false)
        setPendingMode(null)
      })
  }
  return (
    <PanelEmpty text={t('justWorks.readyTitle')} hint={t('justWorks.readyHint')}>
      <div className={styles.demoQuestion}>
        <p className={styles.demoQuestionTitle}>{t('justWorks.demoTitle')}</p>
        <p className={styles.demoQuestionHint}>{t('justWorks.demoHint')}</p>
      </div>
      <div className={styles.gateActions}>
        <Button small disabled={busy} onClick={() => confirm('demo')}>
          {pendingMode === 'demo' ? t('justWorks.seeding') : t('justWorks.useDemo')}
        </Button>
        <p className={styles.gateNote}>{t('justWorks.demoLiveNote')}</p>
        <Button
          small
          variant="secondary"
          disabled={busy}
          onClick={() => confirm('production')}
        >
          {pendingMode === 'production'
            ? t('common.saving')
            : t('justWorks.useLive')}
        </Button>
      </div>
      {error ? <div>{error}</div> : null}
    </PanelEmpty>
  )
}

export function XUnboundGate({
  onOpenWizard,
  onOpenBindings,
}: {
  onOpenWizard: () => void
  onOpenBindings: (twitterId?: string) => void
}) {
  const {
    accounts,
    active,
    chromeForAccount,
    activeXTwitterId,
    activeXHandle,
    reload,
    reloadOperatorBindings,
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
    <PanelEmpty
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
        {selectedWritable && activeXTwitterId ? (
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
                .then(() =>
                  Promise.all([reload(), reloadOperatorBindings()]),
                )
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
        <Button
          small
          variant="secondary"
          onClick={() => onOpenBindings(activeXTwitterId ?? undefined)}
        >
          {t('account.openBindings')}
        </Button>
      </div>
      {bindError ? (
        <div style={{ marginTop: 8 }}>{bindError}</div>
      ) : null}
    </PanelEmpty>
  )
}

/**
 * xHome body only. Session gates (unlock, first-run, unbound, site)
 * live on snapshot.route in PopupApp.
 */
export default function HomeTab({
  onOpenIdentity,
}: {
  onOpenIdentity?: () => void
}) {
  const [pendingCount, setPendingCount] = useState(0)

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

  return (
    <>
      {pendingBanner}
      <AttentionXPanel onOpenIdentity={onOpenIdentity} />
    </>
  )
}
