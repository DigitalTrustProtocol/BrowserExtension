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
  type XIdentitySuggestFlags,
  type XBindingPublishResult,
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
import Button from '@components/Button/Button'
import WotMaxDegreeControl from '../Settings/WotMaxDegreeControl'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import BioUpdateWizard from './BioUpdateWizard'
import { IconWarning } from '../../../assets'
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

export default function AttentionXPanel() {
  const [state, setState] = useState<PublicExtensionState>()
  const [cockpit, setCockpit] = useState<CockpitState>()
  const [xUserReady, setXUserReady] = useState(false)
  const [xUserError, setXUserError] = useState<string>()
  const [proofStatus, setProofStatus] = useState<ProofStatus>('loading')
  const [proofPostId, setProofPostId] = useState<string>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [bioPanelOpen, setBioPanelOpen] = useState(false)
  const [identityPublish, setIdentityPublish] =
    useState<XIdentityPublishPreview>()
  const [activeAccount, setActiveAccount] = useState<ActiveXAccountReport>()
  const [demoWotCount, setDemoWotCount] = useState(0)
  const [appMode, setAppMode] = useState<AppMode>(DEFAULT_APP_MODE)
  const [seedingDemo, setSeedingDemo] = useState(false)
  const [wotMaxDegree, setWotMaxDegree] = useState(WOT_MAX_DEGREE_DEFAULT)
  const [resolveHint, setResolveHint] = useState<
    PublicExtensionState['resolveTimingHint']
  >()
  const [degreeSaving, setDegreeSaving] = useState(false)
  const [suggestFlags, setSuggestFlags] = useState<XIdentitySuggestFlags>({
    hasBioNpubForActive: true,
    hasMatching10011ForActive: true,
    bioNpubMismatch: false,
  })
  const [bindingPublishStatus, setBindingPublishStatus] = useState<
    'idle' | 'publishing' | 'done' | 'error'
  >('idle')
  const [bindingPublishMessage, setBindingPublishMessage] = useState('')

  const refreshSuggestFlags = useCallback(
    async (handle: string, twitterId: string) => {
      try {
        const flags = await axRequest<XIdentitySuggestFlags>({
          type: 'GET_X_IDENTITY_SUGGEST_FLAGS',
          version: BACKGROUND_API_VERSION,
          handle,
          twitterId,
        })
        setSuggestFlags(flags)
      } catch {
        /* keep previous */
      }
    },
    [],
  )

  const runPublishBinding = useCallback(() => {
    const handle = activeAccount?.handle
    const twitterId = activeAccount?.twitterId
    if (!handle || !twitterId) return
    setBindingPublishStatus('publishing')
    setBindingPublishMessage('')
    void axRequest<XBindingPublishResult>({
      type: 'PUBLISH_X_BINDING',
      version: BACKGROUND_API_VERSION,
      handle,
      twitterId,
    })
      .then(async (result) => {
        if (result.status === 'published' || result.status === 'already_published') {
          setBindingPublishStatus('done')
          setSuggestFlags((prev) => ({
            ...prev,
            hasMatching10011ForActive: true,
          }))
          await refreshSuggestFlags(result.handle, result.twitterId)
          return
        }
        setBindingPublishStatus('error')
        setBindingPublishMessage(result.reason)
      })
      .catch((error: unknown) => {
        setBindingPublishStatus('error')
        setBindingPublishMessage(
          error instanceof Error ? error.message : 'Publish Binding failed',
        )
      })
  }, [activeAccount?.handle, activeAccount?.twitterId, refreshSuggestFlags])

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

  /** Stable X-pane pipeline: load → ensure X user → identity check. */
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setXUserReady(false)
      setXUserError(undefined)
      setProofStatus('loading')
      setMessage('')
      try {
        // Step 1: extension state
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

        if (next.vaultLocked) {
          setXUserReady(true)
          setProofStatus('vault_locked')
          setMessage('Unlock vault')
          return
        }
        if (!next.hasIdentity) {
          setXUserReady(true)
          setProofStatus('missing_account')
          setMessage('Create or unlock a Nostr identity first')
          return
        }

        // Step 2: always establish X handle + numeric ID before anything else
        let ensured:
          | { status: 'ready'; account: ActiveXAccountReport }
          | { status: 'missing'; reason: string; handle?: string }
          | undefined
        for (let attempt = 0; attempt < 3; attempt += 1) {
          ensured = await axRequest<
            | { status: 'ready'; account: ActiveXAccountReport }
            | { status: 'missing'; reason: string; handle?: string }
          >({
            type: 'ENSURE_ACTIVE_X_ACCOUNT',
            version: BACKGROUND_API_VERSION,
          })
          if (cancelled) return
          if (ensured.status === 'ready' && ensured.account.twitterId) break
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400))
            if (cancelled) return
          }
        }
        if (cancelled || !ensured) return

        if (ensured.status !== 'ready' || !ensured.account.twitterId) {
          setActiveAccount(
            ensured.status === 'missing' && ensured.handle
              ? { handle: ensured.handle, detectedAt: Date.now() }
              : undefined,
          )
          setXUserError(
            ensured.status === 'missing'
              ? ensured.reason
              : 'Waiting for X numeric account ID',
          )
          setXUserReady(true)
          setProofStatus('missing_x')
          setMessage(
            ensured.status === 'missing'
              ? ensured.reason
              : 'Waiting for X numeric account ID',
          )
          return
        }

        setActiveAccount(ensured.account)
        setXUserReady(true)
        setState((prev) =>
          prev ? { ...prev, activeXAccount: ensured.account } : prev,
        )
        // Keep Status on "Checking…" until IndexedDB / relays / GraphQL finish.
        setProofStatus('loading')
        void refreshSuggestFlags(
          ensured.account.handle,
          ensured.account.twitterId,
        )

        // Step 3: IndexedDB (+ short relay refresh) → GraphQL search if missing
        const check = await axRequest<XProofCheckResult>({
          type: 'CHECK_X_PROOF',
          version: BACKGROUND_API_VERSION,
          handle: ensured.account.handle,
          twitterId: ensured.account.twitterId,
          queryRelays: true,
          scanPage: true,
        })
        if (cancelled) return
        applyProofCheck(check)
        void refreshSuggestFlags(
          ensured.account.handle,
          ensured.account.twitterId,
        )
      } catch (error: unknown) {
        if (cancelled) return
        setXUserError(
          error instanceof Error ? error.message : 'Failed to resolve X user',
        )
        setXUserReady(true)
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
  }, [applyProofCheck, refreshSuggestFlags])

  // Immediate UI refresh when backend re-derives xIdentities status.
  useEffect(() => {
    const onMessage = (message: {
      type?: string
      twitterId?: string
      state?: string
    }) => {
      if (message?.type !== 'X_IDENTITY_UPDATED') return
      const twitterId = activeAccount?.twitterId ?? state?.activeXAccount?.twitterId
      const handle = activeAccount?.handle ?? state?.activeXAccount?.handle
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
    activeAccount?.handle,
    activeAccount?.twitterId,
    applyProofCheck,
    state?.activeXAccount?.handle,
    state?.activeXAccount?.twitterId,
  ])

  const active = activeAccount ?? state?.activeXAccount
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

  if (!xUserReady) {
    return (
      <Card className={styles.panel}>
        <p className={styles.userLoading}>X User loading</p>
      </Card>
    )
  }

  return (
    <Card
      className={`${styles.panel}${appMode === 'demo' ? ` ${styles.demoPanel}` : ''}`}
    >
      {appMode === 'production' &&
      active?.handle &&
      active.twitterId &&
      (!suggestFlags.hasBioNpubForActive ||
        !suggestFlags.hasMatching10011ForActive ||
        bindingPublishStatus === 'publishing' ||
        bindingPublishStatus === 'done' ||
        bindingPublishStatus === 'error') ? (
        <div className={styles.suggestStrip}>
          {!suggestFlags.hasBioNpubForActive ? (
            <Button
              small
              className={styles.bioSuggestButton}
              disabled={
                bindingPublishStatus === 'publishing' || bioPanelOpen
              }
              onClick={() => setBioPanelOpen(true)}
            >
              <span className={styles.bioSuggestLabel}>Update Bio</span>
              {suggestFlags.bioNpubMismatch ? (
                <IconWarning
                  size={14}
                  className={styles.bioSuggestWarning}
                  aria-label="Bio has a different npub"
                />
              ) : null}
            </Button>
          ) : null}
          {!suggestFlags.hasMatching10011ForActive ||
          bindingPublishStatus === 'publishing' ||
          bindingPublishStatus === 'done' ||
          bindingPublishStatus === 'error' ? (
            <div className={styles.suggestBinding}>
              <Button
                small
                variant="secondary"
                disabled={
                  bindingPublishStatus === 'publishing' ||
                  bindingPublishStatus === 'done' ||
                  !active.handle ||
                  !active.twitterId ||
                  Boolean(state?.vaultLocked) ||
                  !state?.hasIdentity
                }
                onClick={runPublishBinding}
              >
                {bindingPublishStatus === 'publishing'
                  ? 'Publishing'
                  : bindingPublishStatus === 'done'
                    ? 'Publish done'
                    : 'Publish Binding'}
              </Button>
              {bindingPublishStatus === 'error' && bindingPublishMessage ? (
                <p className={styles.suggestError} role="alert">
                  {bindingPublishMessage}
                </p>
              ) : null}
            </div>
          ) : null}
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
          ) : (
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
          )}
        </>
      ) : (
        <>
      <SectionLabel>X identity</SectionLabel>
      <p className={styles.hint}>
        {active?.twitterId
          ? `@${active.handle} · ${active.twitterId}`
          : active?.handle
            ? `@${active.handle}`
            : xUserError ??
              'Open x.com while signed in to detect your account'}
      </p>

      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Status</span>
        <div className={styles.statusActions}>
          <span
            className={
              proofStatus === 'done'
                ? styles.statusDone
                : proofStatus === 'pending' ||
                    proofStatus === 'needs_publish' ||
                    proofStatus === 'publish_preview'
                  ? styles.statusSession
                  : styles.statusMissing
            }
          >
            {proofStatus === 'loading'
              ? 'Checking…'
              : proofStatus === 'done'
                ? 'Linked'
                : proofStatus === 'needs_publish' ||
                    proofStatus === 'publish_preview'
                  ? 'Found · publish?'
                  : proofStatus === 'pending'
                    ? 'Pending verification'
                    : proofStatus === 'vault_locked'
                      ? 'Unlock vault'
                      : proofStatus === 'missing_account'
                        ? 'No Nostr identity'
                        : proofStatus === 'missing_x'
                          ? 'No X account yet'
                          : 'Not found'}
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
        {proofStatus === 'loading' ? (
          <p className={styles.hint}>Checking identity…</p>
        ) : proofStatus === 'done' ? (
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
            void refreshSuggestFlags(active.handle, active.twitterId!)
          }}
          handle={active.handle}
          twitterId={active.twitterId}
          activeNpub={state?.npub}
        />
      ) : null}

      {appMode === 'production' ? (
        <>
          <SectionLabel>Quick sync</SectionLabel>
          <p className={styles.hint}>{syncLabel(state?.syncStatus)}</p>
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
        </>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </Card>
  )
}
