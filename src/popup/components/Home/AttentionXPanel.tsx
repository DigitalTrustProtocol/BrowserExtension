import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type AppMode,
  type CockpitState,
  type DemoWotStatus,
  type ExtensionRequest,
  type ExtensionResponse,
  type PublicExtensionState,
  type XIdentityPublishPreview,
  type XIdentityPublishResult,
  type XIdentityStatusSyncResult,
  type XProofCheckResult,
  APP_MODE_STORAGE_KEY,
  DEFAULT_APP_MODE,
  parseAppMode,
} from '../../../shared/contracts'
import {
  WOT_MAX_DEGREE_CHANGED_MESSAGE,
  WOT_MAX_DEGREE_DEFAULT,
} from '../../../shared/wot-max-degree'
import type { ActiveXAccountReport } from '../../../shared/proof-composer'
import { t } from '@lib/i18n.js'
import { usePanelSession } from '../../context/PanelSessionContext'
import { useAccount } from '../../context/AccountContext'
import { liveSetupIssues } from '../../../shared/operator-binding-status.ts'
import {
  operatorXAccountFromSnapshot,
  operatorXIdentityLine,
} from './operator-x-account'
import Button from '@components/Button/Button'
import WotMaxDegreeControl from '../Settings/WotMaxDegreeControl'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import BioUpdateWizard from './BioUpdateWizard'
import styles from './AttentionXPanel.module.css'

type ProofStatus =
  | 'loading'
  | 'missing_account'
  | 'missing_x'
  | 'vault_locked'
  | 'not_found'
  | 'needs_publish'
  | 'publish_preview'
  | 'pending'
  | 'done'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function syncLabel(state: PublicExtensionState['syncStatus']): string {
  if (!state) return 'Idle'
  if (state.state === 'running') return 'Running…'
  if (state.state === 'complete') return 'Complete'
  if (state.state === 'stopped') return 'Stopped'
  if (state.state === 'error') return state.error ? `Error · ${state.error}` : 'Error'
  return 'Idle'
}

function publishChangeMessage(preview: XIdentityPublishPreview): string {
  if (preview.change === 'add') {
    return 'Twitter identity tags will be added. Existing tags and content are kept.'
  }
  if (preview.change === 'refresh') {
    const oldPost = preview.existingTwitter?.proofPostId
    return oldPost && oldPost !== preview.proofPostId
      ? `Same X account — proof post ${oldPost} → ${preview.proofPostId}. Other tags are kept.`
      : 'Same X account — proof post ID will be updated. Other tags are kept.'
  }
  if (preview.change === 'clear') {
    return 'Twitter identity tags will be removed from your kind 10011. Other tags and content are kept.'
  }
  if (preview.existingTwitter) {
    return `This will replace @${preview.existingTwitter.handle} (${preview.existingTwitter.twitterId}) with @${preview.handle} (${preview.twitterId}) on your kind 10011.`
  }
  if (preview.existingTwitterTags?.length) {
    return `Existing Twitter tags are malformed and will be replaced: ${preview.existingTwitterTags.join(', ')}`
  }
  return `This will replace the existing X identity with @${preview.handle} (${preview.twitterId}).`
}

function publishedStatusMessage(result: Extract<
  XIdentityPublishResult,
  { status: 'published' }
>): string {
  const identity =
    result.identityState === 'verified'
      ? 'Identity verified locally'
      : result.identityState === 'pending'
        ? 'Identity saved locally · verification pending'
        : 'Identity saved locally · not fully verified'
  const delivery =
    result.attemptedRelays > 0
      ? `delivered to ${result.deliveredTo}/${result.attemptedRelays} relays`
      : 'relay delivery pending'
  return `${identity}; ${delivery}`
}

function proofStatusCopy(
  status: ProofStatus,
  identityPending: boolean,
): string {
  switch (status) {
    case 'loading':
      return identityPending ? 'Waiting for X…' : 'Checking…'
    case 'done':
      return 'Linked'
    case 'needs_publish':
    case 'publish_preview':
      return 'Found · publish?'
    case 'pending':
      return 'Pending verification'
    case 'vault_locked':
      return 'Unlock vault'
    case 'missing_account':
      return 'No Nostr identity'
    case 'missing_x':
      return 'No X account yet'
    case 'not_found':
      return 'Not found'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

function InlineSpinner() {
  return <span className={styles.inlineSpinner} aria-hidden="true" />
}

export default function AttentionXPanel(props: {
  onOpenIdentity?: () => void
}) {
  const { snapshot } = usePanelSession()
  const { operatorBindings } = useAccount()
  const snapshotAccount = operatorXAccountFromSnapshot(snapshot)
  const [state, setState] = useState<PublicExtensionState>()
  const [cockpit, setCockpit] = useState<CockpitState>()
  const [xUserError, setXUserError] = useState<string>()
  const [proofStatus, setProofStatus] = useState<ProofStatus>('loading')
  const [proofPostId, setProofPostId] = useState<string>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [bioPanelOpen, setBioPanelOpen] = useState(false)
  const [identityPublish, setIdentityPublish] =
    useState<XIdentityPublishPreview>()
  const [demoWotCount, setDemoWotCount] = useState(0)
  const [appMode, setAppMode] = useState<AppMode>(DEFAULT_APP_MODE)
  const [seedingDemo, setSeedingDemo] = useState(false)
  const [wotMaxDegree, setWotMaxDegree] = useState(WOT_MAX_DEGREE_DEFAULT)
  const [resolveHint, setResolveHint] = useState<
    PublicExtensionState['resolveTimingHint']
  >()
  const [degreeSaving, setDegreeSaving] = useState(false)
  const [extensionStateReady, setExtensionStateReady] = useState(false)
  useEffect(() => {
    void axRequest<{ mode: AppMode }>({
      type: 'GET_APP_MODE',
      version: BACKGROUND_API_VERSION,
    })
      .then((result) => setAppMode(result.mode))
      .catch(() => undefined)
    void axRequest<{ degree: number }>({
      type: 'GET_WOT_MAX_DEGREE',
      version: BACKGROUND_API_VERSION,
    })
      .then((result) => {
        setWotMaxDegree(result.degree)
      })
      .catch(() => undefined)
    void axRequest<DemoWotStatus>({
      type: 'GET_DEMO_WOT_STATUS',
      version: BACKGROUND_API_VERSION,
    })
      .then((status) => setDemoWotCount(status.eventCount))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onMessage = (message: { type?: string; degree?: number }) => {
      if (
        message?.type === WOT_MAX_DEGREE_CHANGED_MESSAGE &&
        typeof message.degree === 'number'
      ) {
        setWotMaxDegree(message.degree)
        void axRequest<PublicExtensionState>({ type: 'GET_STATE' })
          .then((next) => {
            setState(next)
            setResolveHint(next.resolveTimingHint)
          })
          .catch(() => undefined)
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [])

  useEffect(() => {
    void chrome.storage.local
      .get(APP_MODE_STORAGE_KEY)
      .then((data: Record<string, unknown>) => {
        if (data[APP_MODE_STORAGE_KEY] !== undefined) {
          setAppMode(parseAppMode(data[APP_MODE_STORAGE_KEY]))
        }
      })

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return
      const modeChange = changes[APP_MODE_STORAGE_KEY]
      if (modeChange) {
        setAppMode(parseAppMode(modeChange.newValue))
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const applyProofCheck = useCallback((check: XProofCheckResult) => {
    if (check.status === 'verified') {
      setProofStatus('done')
      setProofPostId(check.proofPostId)
      setMessage('')
      return
    }
    if (check.status === 'needs_publish') {
      setProofStatus('needs_publish')
      setProofPostId(check.proofPostId)
      setMessage(
        'Identity found on X and saved locally. Publish a kind 10011 link to relays?',
      )
      return
    }
    if (check.status === 'pending') {
      setProofStatus('pending')
      setProofPostId(undefined)
      setMessage(`Identity check pending · ${check.reason}`)
      return
    }
    if (check.status === 'missing_account') {
      setProofStatus('vault_locked')
      setProofPostId(undefined)
      setMessage(check.reason)
      return
    }
    if (check.status === 'missing_x_account') {
      setProofStatus('missing_x')
      setProofPostId(undefined)
      setMessage(check.reason)
      return
    }
    setProofStatus('not_found')
    setProofPostId(undefined)
    setMessage('')
  }, [])

  /** Snapshot paints X chrome immediately; GET_STATE / CHECK_X_PROOF fill the rest. */
  useEffect(() => {
    let cancelled = false
    const twitterId = snapshotAccount?.twitterId
    const handle = snapshotAccount?.handle ?? ''

    const run = async () => {
      setXUserError(undefined)
      setProofStatus('loading')
      setMessage('')
      try {
        const [next, nextCockpit] = await Promise.all([
          axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
          axRequest<CockpitState>({ type: 'GET_COCKPIT_STATE' }).catch(
            () => undefined,
          ),
        ])
        if (cancelled) return
        setState(next)
        if (nextCockpit) setCockpit(nextCockpit)
        setWotMaxDegree(next.wotMaxDegree)
        setResolveHint(next.resolveTimingHint)
        setExtensionStateReady(true)

        if (next.vaultLocked) {
          setProofStatus('vault_locked')
          setMessage('Unlock vault')
          return
        }
        if (!next.hasIdentity) {
          setProofStatus('missing_account')
          setMessage('Create or unlock a Nostr identity first')
          return
        }

        if (!twitterId) {
          setXUserError('Waiting for X numeric account ID')
          setProofStatus('missing_x')
          setMessage('Waiting for X numeric account ID')
          return
        }
        const account: ActiveXAccountReport = {
          handle,
          twitterId,
          detectedAt: Date.now(),
        }
        setState((prev) =>
          prev ? { ...prev, activeXAccount: account } : prev,
        )
        setProofStatus('loading')

        const check = await axRequest<XProofCheckResult>({
          type: 'CHECK_X_PROOF',
          version: BACKGROUND_API_VERSION,
          handle,
          twitterId,
          queryRelays: true,
          scanPage: true,
        })
        if (cancelled) return
        applyProofCheck(check)
      } catch (error: unknown) {
        if (cancelled) return
        setExtensionStateReady(true)
        setXUserError(
          error instanceof Error ? error.message : 'Failed to resolve X user',
        )
        setProofStatus('not_found')
        setMessage(
          error instanceof Error ? error.message : 'Identity check failed',
        )
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    applyProofCheck,
    snapshotAccount?.handle,
    snapshotAccount?.twitterId,
  ])

  // Immediate UI refresh when backend re-derives xIdentities status.
  useEffect(() => {
    const onMessage = (message: {
      type?: string
      twitterId?: string
      state?: string
    }) => {
      if (message?.type !== 'X_IDENTITY_UPDATED') return
      const twitterId =
        snapshotAccount?.twitterId ?? state?.activeXAccount?.twitterId
      const handle = snapshotAccount?.handle ?? state?.activeXAccount?.handle
      if (!twitterId || !handle || message.twitterId !== twitterId) return
      if (message.state === 'verified') {
        setProofStatus('done')
        setMessage('Identity verified')
      }
      void axRequest<XProofCheckResult>({
        type: 'CHECK_X_PROOF',
        version: BACKGROUND_API_VERSION,
        handle,
        twitterId,
        queryRelays: false,
        scanPage: false,
      })
        .then(applyProofCheck)
        .catch(() => undefined)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
    }
  }, [
    snapshotAccount?.handle,
    snapshotAccount?.twitterId,
    applyProofCheck,
    state?.activeXAccount?.handle,
    state?.activeXAccount?.twitterId,
  ])

  const active = snapshotAccount
  const canUpdateBio =
    !busy &&
    Boolean(state?.hasIdentity && !state.vaultLocked) &&
    Boolean(active?.handle && active.twitterId) &&
    (proofStatus === 'not_found' ||
      proofStatus === 'pending' ||
      proofStatus === 'done' ||
      proofStatus === 'needs_publish')
  const canCheckProof =
    !busy &&
    (proofStatus === 'not_found' ||
      proofStatus === 'pending' ||
      proofStatus === 'done' ||
      proofStatus === 'needs_publish') &&
    Boolean(state?.hasIdentity && !state.vaultLocked) &&
    Boolean(active?.handle && active.twitterId)

  const runCheckForProof = () => {
    if (!active?.handle || !active.twitterId) return
    setBusy(true)
    setMessage('Checking for npub in bio / identity…')
    void axRequest<XProofCheckResult>({
      type: 'SEARCH_X_PROOF',
      version: BACKGROUND_API_VERSION,
      handle: active.handle,
      twitterId: active.twitterId,
      forceRescan: true,
    })
      .then((check) => {
        applyProofCheck(check)
        if (check.status === 'not_found') {
          setMessage(
            'No linked npub found yet — add it to your X bio, then check again',
          )
        } else if (check.status === 'verified') {
          setMessage('Identity verified')
        } else if (check.status === 'needs_publish') {
          setMessage(
            'Identity found on X and saved locally. Publish a kind 10011 link to relays?',
          )
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Identity check failed')
      })
      .finally(() => setBusy(false))
  }

  const runUpdateStatus = () => {
    if (!active?.twitterId) return
    setBusy(true)
    setMessage('Updating status…')
    void axRequest<XIdentityStatusSyncResult>({
      type: 'SYNC_X_IDENTITY_STATUS',
      version: BACKGROUND_API_VERSION,
      twitterId: active.twitterId,
    })
      .then((result) => {
        const source = result.proofSource ? ` · ${result.proofSource}` : ''
        const changed = result.changed ? ' · updated' : ' · unchanged'
        setMessage(
          `Status: ${result.state}${source}${changed}` +
            (result.identity.postId
              ? ` · post ${result.identity.postId}`
              : '') +
            (result.identity.nip39PostId
              ? ` · nip39 ${result.identity.nip39PostId}`
              : ''),
        )
        if (result.state === 'verified') {
          setProofStatus('done')
          if (result.identity.postId) {
            setProofPostId(result.identity.postId)
          }
        } else if (result.state === 'pending') {
          setProofStatus('pending')
        } else {
          setProofStatus('not_found')
        }
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : 'Status update failed',
        )
      })
      .finally(() => setBusy(false))
  }

  const commitWotMaxDegree = (degree: number) => {
    if (degree === wotMaxDegree || degreeSaving) return
    setDegreeSaving(true)
    void axRequest<{ degree: number }>({
      type: 'SET_WOT_MAX_DEGREE',
      version: BACKGROUND_API_VERSION,
      degree,
    })
      .then((result) => {
        setWotMaxDegree(result.degree)
        return axRequest<PublicExtensionState>({ type: 'GET_STATE' })
      })
      .then((next) => {
        setState(next)
        setResolveHint(next.resolveTimingHint)
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setDegreeSaving(false))
  }

  const setAppModeAndRefresh = (mode: AppMode) => {
    setBusy(true)
    if (mode === 'demo') setSeedingDemo(true)
    setMessage(mode === 'demo' ? 'Switching to Demo…' : 'Switching to Production…')
    void axRequest<{ mode: AppMode; seeded: boolean }>({
      type: 'SET_APP_MODE',
      version: BACKGROUND_API_VERSION,
      mode,
    })
      .then(async (result) => {
        setAppMode(result.mode)
        const [status, next, nextCockpit] = await Promise.all([
          axRequest<DemoWotStatus>({
            type: 'GET_DEMO_WOT_STATUS',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
          axRequest<CockpitState>({ type: 'GET_COCKPIT_STATE' }).catch(
            () => undefined,
          ),
        ])
        setDemoWotCount(status.eventCount)
        setState(next)
        setWotMaxDegree(next.wotMaxDegree)
        setResolveHint(next.resolveTimingHint)
        if (nextCockpit) setCockpit(nextCockpit)
        if (result.mode === 'demo') {
          setMessage(
            result.seeded
              ? `Demo mode on · seeded ${status.eventCount} local trust events`
              : `Demo mode on · ${status.eventCount} local trust events (nothing published)`,
          )
        } else {
          setMessage('Production mode · demo data deleted · live relays enabled')
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Mode switch failed')
      })
      .finally(() => {
        setSeedingDemo(false)
        setBusy(false)
      })
  }

  const canUpdateStatus =
    !busy &&
    Boolean(state?.hasIdentity && !state.vaultLocked) &&
    Boolean(active?.twitterId)

  const trustEvents =
    cockpit?.storage.eventsByKind['32009'] ?? state?.cachedEventCount ?? 0
  const identityLinks = cockpit?.storage.eventsByKind['10011'] ?? 0
  const xIdentities = cockpit?.storage.stores.xIdentities ?? 0
  const outboxPending = cockpit?.storage.outboxByStatus.pending ?? 0
  const identityView = operatorXIdentityLine(snapshot, xUserError)
  const identityPending = identityView.kind === 'pending'
  const signedInBinding = operatorBindings.find((row) => row.signedIn)
  const liveSetupIncomplete =
    (snapshot?.appMode ?? appMode) === 'production' &&
    Boolean(
      signedInBinding && liveSetupIssues(signedInBinding.completeness).length > 0,
    )

  return (
    <Card
      className={`${styles.panel}${appMode === 'demo' ? ` ${styles.demoPanel}` : ''}`}
    >
      {liveSetupIncomplete && props.onOpenIdentity ? (
        <div className={styles.suggestStrip}>
          <Button
            small
            className={styles.bioSuggestButton}
            onClick={props.onOpenIdentity}
          >
            <span className={styles.bioSuggestLabel}>
              {t('account.completeSetup')}
            </span>
          </Button>
          <p className={styles.hint}>{t('account.completeSetupHint')}</p>
        </div>
      ) : null}

      <div className={styles.degreeSection}>
        <h2 className={styles.degreeHeadline}>Synchronization and Resolution</h2>
        <WotMaxDegreeControl
          degree={wotMaxDegree}
          saving={degreeSaving}
          resolveHint={resolveHint}
          onCommit={commitWotMaxDegree}
          description={t(
            appMode === 'demo'
              ? 'settings.graph.degreeHintDemo'
              : 'settings.graph.degreeHint',
          )}
        />
      </div>

      <SectionLabel className={styles.modeHeadline}>Mode</SectionLabel>
      {appMode === 'demo' ? (
        <p className={styles.demoBanner} role="status">
          Demo mode — local only. Trust actions are never published to relays.
        </p>
      ) : null}
      <p className={styles.hint}>
        {appMode === 'demo'
          ? 'Demo trust data is generated automatically when you enter Demo mode. Events are not synced with relays. Switching to Production deletes all trust events you made in Demo mode. Events made in Production mode are not removed.'
          : 'Live data: your trust statements sync to relays. Demo data is not used.'}
      </p>
      <div className={styles.modeToggle} role="group" aria-label="App mode">
        <button
          type="button"
          className={`${styles.modeOption}${appMode === 'production' ? ` ${styles.modeOptionActive}` : ''}`}
          disabled={busy || appMode === 'production'}
          onClick={() => setAppModeAndRefresh('production')}
        >
          Production
        </button>
        <button
          type="button"
          className={`${styles.modeOption}${appMode === 'demo' ? ` ${styles.modeOptionActive}` : ''}`}
          disabled={busy || appMode === 'demo'}
          onClick={() => setAppModeAndRefresh('demo')}
        >
          Demo
        </button>
      </div>

      {appMode === 'demo' ? (
        <>
          <SectionLabel>Demo trust data</SectionLabel>
          {seedingDemo ? (
            <div className={styles.seedingStatus} role="status" aria-live="polite">
              <div className={styles.spinner} aria-hidden="true" />
              <p className={styles.seedingText}>Generating demo trust events…</p>
              <p className={styles.hint}>
                Building local demo trust from accounts you have seen on X.
                Production removes it.
              </p>
            </div>
          ) : extensionStateReady ? (
            <dl className={styles.stats}>
              <div>
                <dt>Demo events</dt>
                <dd>{demoWotCount}</dd>
              </div>
              <div>
                <dt>X identities</dt>
                <dd>{xIdentities}</dd>
              </div>
            </dl>
          ) : (
            <p className={`${styles.hint} ${styles.hintBusy}`} role="status">
              <InlineSpinner />
              Loading demo trust data…
            </p>
          )}
        </>
      ) : (
        <>
      <SectionLabel>X identity</SectionLabel>
      <p
        className={
          identityView.kind === 'pending'
            ? `${styles.hint} ${styles.hintBusy}`
            : styles.hint
        }
        role={identityView.kind === 'pending' ? 'status' : undefined}
      >
        {identityView.kind === 'pending' ? (
          <>
            <InlineSpinner />
            Waiting for X account…
          </>
        ) : (
          identityView.text
        )}
      </p>

      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Status</span>
        <div className={styles.statusActions}>
          <span
            className={
              proofStatus === 'loading'
                ? `${styles.statusMissing} ${styles.hintBusy}`
                : proofStatus === 'done'
                ? styles.statusDone
                : proofStatus === 'pending' ||
                    proofStatus === 'needs_publish' ||
                    proofStatus === 'publish_preview'
                  ? styles.statusSession
                  : styles.statusMissing
            }
            role={proofStatus === 'loading' ? 'status' : undefined}
          >
            {proofStatus === 'loading' ? <InlineSpinner /> : null}
            {proofStatusCopy(proofStatus, identityPending)}
          </span>
          <Button
            small
            variant="secondary"
            disabled={!canUpdateStatus}
            onClick={runUpdateStatus}
          >
            Update status
          </Button>
        </div>
      </div>

      <div className={styles.stack}>
        {proofStatus === 'loading' ? null : proofStatus === 'done' ? (
          <div className={styles.row}>
            <p className={styles.hint}>Linked</p>
            <Button
              small
              variant="secondary"
              disabled={!canCheckProof}
              onClick={runCheckForProof}
            >
              Check for bio
            </Button>
            <Button
              small
              variant="secondary"
              disabled={!canUpdateBio}
              onClick={() => setBioPanelOpen(true)}
            >
              Update Profile
            </Button>
          </div>
        ) : proofStatus === 'publish_preview' &&
          identityPublish &&
          active?.handle &&
          active.twitterId ? (
          <>
            <p
              className={
                identityPublish.change === 'replace'
                  ? styles.warning
                  : styles.hint
              }
            >
              {publishChangeMessage(identityPublish)}
            </p>
            <p className={styles.hint}>
              {identityPublish.preservedTagCount} other tag(s) preserved
              {identityPublish.preservesContent ? ' · prior content kept' : ''}
            </p>
            <label className={styles.label}>
              Kind 10011 preview
              <textarea
                className={styles.textarea}
                rows={6}
                readOnly
                value={JSON.stringify(identityPublish.eventPreview, null, 2)}
              />
            </label>
            <div className={styles.row}>
              <Button
                small
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void axRequest<XIdentityPublishResult>({
                    type: 'CONFIRM_X_IDENTITY_PUBLISH',
                    version: BACKGROUND_API_VERSION,
                    handle: active.handle,
                    twitterId: active.twitterId!,
                    proofTweetId: identityPublish.proofPostId,
                    existingEventId: identityPublish.existingEventId,
                    confirmReplacement:
                      identityPublish.change === 'replace',
                  })
                    .then(async (result) => {
                      if (result.status === 'stale-preview') {
                        setIdentityPublish(result.preview)
                        setProofStatus('publish_preview')
                        setMessage(result.reason)
                        return
                      }
                      if (result.status === 'replacement-required') {
                        setIdentityPublish(result.preview)
                        setProofStatus('publish_preview')
                        setMessage(result.reason)
                        return
                      }
                      setIdentityPublish(undefined)
                      setProofPostId(result.proofPostId)
                      setProofStatus(
                        result.identityState === 'verified'
                          ? 'done'
                          : result.identityState === 'pending'
                            ? 'pending'
                            : 'needs_publish',
                      )
                      setMessage(publishedStatusMessage(result))
                      const refreshed = await axRequest<PublicExtensionState>({
                        type: 'GET_STATE',
                      })
                      setState(refreshed)
                    })
                    .catch((error: unknown) => {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Publish failed',
                      )
                    })
                    .finally(() => setBusy(false))
                }}
              >
                {identityPublish.change === 'replace'
                  ? 'Replace X identity and publish'
                  : 'Publish to relays'}
              </Button>
              <Button
                small
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setIdentityPublish(undefined)
                  setProofStatus('needs_publish')
                  setMessage(
                    'Identity found on X and saved locally. Publish a kind 10011 link to relays?',
                  )
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : proofStatus === 'needs_publish' &&
          active?.handle &&
          active.twitterId &&
          proofPostId ? (
          <div className={styles.row}>
            <Button
              small
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void axRequest<XIdentityPublishPreview>({
                  type: 'PREPARE_X_IDENTITY_PUBLISH',
                  version: BACKGROUND_API_VERSION,
                  handle: active.handle,
                  twitterId: active.twitterId!,
                  proofTweetId: proofPostId,
                })
                  .then((next) => {
                    setIdentityPublish(next)
                    setProofStatus('publish_preview')
                    setMessage(publishChangeMessage(next))
                  })
                  .catch((error: unknown) => {
                    setMessage(
                      error instanceof Error ? error.message : 'Publish failed',
                    )
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Review kind 10011
            </Button>
            <Button
              small
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setProofStatus('done')
                setMessage('Kept local only — not published to relays')
              }}
            >
              Keep local only
            </Button>
            <Button
              small
              variant="secondary"
              disabled={!canCheckProof}
              onClick={runCheckForProof}
            >
              Check for bio
            </Button>
            <Button
              small
              variant="secondary"
              disabled={!canUpdateBio}
              onClick={() => setBioPanelOpen(true)}
            >
              Update Profile
            </Button>
          </div>
        ) : (
          <div className={styles.row}>
            <Button small disabled={!canCheckProof} onClick={runCheckForProof}>
              Check for bio
            </Button>
            <Button
              small
              variant="secondary"
              disabled={!canUpdateBio}
              onClick={() => setBioPanelOpen(true)}
            >
              Update Profile
            </Button>
          </div>
        )}
      </div>
        </>
      )}

      {active?.handle && active.twitterId ? (
        <BioUpdateWizard
          visible={bioPanelOpen}
          onClose={() => {
            setBioPanelOpen(false)
          }}
          handle={active.handle}
          twitterId={active.twitterId}
          activeNpub={state?.npub}
        />
      ) : null}

      {appMode === 'production' ? (
        <>
          <SectionLabel>Quick sync</SectionLabel>
          <p className={extensionStateReady ? styles.hint : `${styles.hint} ${styles.hintBusy}`} role={extensionStateReady ? undefined : 'status'}>
            {extensionStateReady ? (
              syncLabel(state?.syncStatus)
            ) : (
              <>
                <InlineSpinner />
                Loading sync…
              </>
            )}
          </p>
          <div className={styles.row}>
            <Button
              small
              disabled={busy || !state?.hasIdentity}
              onClick={() => {
                setBusy(true)
                void axRequest({
                  type: 'START_WOT_SYNC',
                  version: BACKGROUND_API_VERSION,
                })
                  .then(async () => {
                    const next = await axRequest<PublicExtensionState>({
                      type: 'GET_STATE',
                    })
                    setState(next)
                    setMessage('Sync started')
                  })
                  .catch((error: unknown) => {
                    setMessage(
                      error instanceof Error ? error.message : 'Error',
                    )
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Sync relays
            </Button>
            <Button
              small
              variant="secondary"
              disabled={busy || state?.syncStatus?.state !== 'running'}
              onClick={() => {
                setBusy(true)
                void axRequest({
                  type: 'STOP_WOT_SYNC',
                  version: BACKGROUND_API_VERSION,
                })
                  .then(async () => {
                    const next = await axRequest<PublicExtensionState>({
                      type: 'GET_STATE',
                    })
                    setState(next)
                    setMessage('Sync stopped')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Stop
            </Button>
          </div>

          <SectionLabel>Local trust data</SectionLabel>
          {extensionStateReady ? (
          <dl className={styles.stats}>
            <div>
              <dt>Trust statements</dt>
              <dd>{trustEvents}</dd>
            </div>
            <div>
              <dt>Identity links</dt>
              <dd>{identityLinks}</dd>
            </div>
            <div>
              <dt>X identities</dt>
              <dd>{xIdentities}</dd>
            </div>
            <div>
              <dt>Outbox pending</dt>
              <dd>{outboxPending}</dd>
            </div>
          </dl>
          ) : (
            <p className={`${styles.hint} ${styles.hintBusy}`} role="status">
              <InlineSpinner />
              Loading local trust data…
            </p>
          )}
        </>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </Card>
  )
}
