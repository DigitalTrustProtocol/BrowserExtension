import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type CockpitState,
  type ExtensionRequest,
  type ExtensionResponse,
  type ProofComposerPreview,
  type PublicExtensionState,
  type PublishResult,
  type XIdentityPublishPreview,
  type XIdentityPublishResult,
  type XIdentityStatusSyncResult,
  type XProofCheckResult,
} from '../../../shared/contracts'
import type { ActiveXAccountReport } from '../../../shared/proof-composer'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import Toggle from '@components/Toggle/Toggle'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import {
  DEFAULT_X_AUGMENTATION_FEATURES,
  normalizeXAugmentationFeatures,
  X_AUGMENTATION_FEATURE_KEYS,
  X_AUGMENTATION_FEATURES_KEY,
  type XAugmentationFeatureKey,
  type XAugmentationFeatures,
} from '../../../shared/x-augmentation'
import { t } from '@lib/i18n.js'
import styles from './AttentionXPanel.module.css'

type ConfirmResult =
  | { decision: 'already_proven'; result: PublishResult }
  | {
      decision: 'needs_proof'
      session: { handle: string; twitterId: string }
      intentUrl: string
    }

type ProofStatus =
  | 'loading'
  | 'missing_account'
  | 'missing_x'
  | 'vault_locked'
  | 'not_found'
  | 'needs_publish'
  | 'publish_preview'
  | 'pending'
  | 'session'
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
  const [preview, setPreview] = useState<ProofComposerPreview>()
  const [identityPublish, setIdentityPublish] =
    useState<XIdentityPublishPreview>()
  const [proofPostInput, setProofPostInput] = useState('')
  const [activeAccount, setActiveAccount] = useState<ActiveXAccountReport>()
  const [augmentationFeatures, setAugmentationFeatures] =
    useState<XAugmentationFeatures>({ ...DEFAULT_X_AUGMENTATION_FEATURES })

  useEffect(() => {
    void chrome.storage.local
      .get(X_AUGMENTATION_FEATURES_KEY)
      .then((data: Record<string, unknown>) => {
        setAugmentationFeatures(
          normalizeXAugmentationFeatures(data[X_AUGMENTATION_FEATURES_KEY]),
        )
      })

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return
      const change = changes[X_AUGMENTATION_FEATURES_KEY]
      if (change) {
        setAugmentationFeatures(
          normalizeXAugmentationFeatures(change.newValue),
        )
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const setFeature = (key: XAugmentationFeatureKey, value: boolean) => {
    const next = { ...augmentationFeatures, [key]: value }
    setAugmentationFeatures(next)
    void chrome.storage.local.set({ [X_AUGMENTATION_FEATURES_KEY]: next })
  }

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
        'Proof post found on X and saved locally. Publish a kind 10011 link to relays?',
      )
      return
    }
    if (check.status === 'pending') {
      setProofStatus('pending')
      setProofPostId(undefined)
      setMessage(`Proof check pending · ${check.reason}`)
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

  /** Stable X-pane pipeline: load → ensure X user → (session capture | proof check). */
  useEffect(() => {
    let cancelled = false

    const completeSessionCapture = async (
      handle: string,
      twitterId: string,
    ): Promise<boolean> => {
      const sessionCheck = await axRequest<XProofCheckResult>({
        type: 'CHECK_X_PROOF',
        version: BACKGROUND_API_VERSION,
        handle,
        twitterId,
        queryRelays: true,
        scanPage: true,
      })
      if (cancelled) return true
      const foundPostId =
        (sessionCheck.status === 'verified' ||
          sessionCheck.status === 'needs_publish') &&
        'proofPostId' in sessionCheck
          ? sessionCheck.proofPostId
          : undefined
      if (!foundPostId) return false
      try {
        await axRequest<PublishResult>({
          type: 'CAPTURE_X_PROOF_POST',
          version: BACKGROUND_API_VERSION,
          proofTweetId: foundPostId,
        })
        if (cancelled) return true
        setProofPostId(foundPostId)
        setProofStatus('done')
        setMessage('Proof captured')
        const refreshed = await axRequest<PublicExtensionState>({
          type: 'GET_STATE',
        })
        if (!cancelled) setState(refreshed)
        return true
      } catch {
        if (!cancelled) applyProofCheck(sessionCheck)
        return true
      }
    }

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

        // Step 3a: active proof-composer session → try to pick up posted proof
        const session = next.proofSession
        if (
          session?.handle &&
          session.twitterId &&
          session.handle === ensured.account.handle &&
          session.twitterId === ensured.account.twitterId
        ) {
          const captured = await completeSessionCapture(
            ensured.account.handle,
            ensured.account.twitterId,
          )
          if (cancelled || captured) return
          setProofStatus('session')
          setMessage(
            'Proof session active — open your profile so the post is visible, tap Look for proof, or paste the post URL',
          )
          return
        }

        // Step 3b: IndexedDB (+ short relay refresh) → GraphQL search if missing
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
      } catch (error: unknown) {
        if (cancelled) return
        setXUserError(
          error instanceof Error ? error.message : 'Failed to resolve X user',
        )
        setXUserReady(true)
        setProofStatus('not_found')
        setMessage(
          error instanceof Error ? error.message : 'Proof check failed',
        )
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [applyProofCheck])

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
        setMessage('Proof verified')
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
  const canPrepare =
    !busy &&
    proofStatus === 'not_found' &&
    Boolean(state?.hasIdentity && !state.vaultLocked) &&
    Boolean(active?.handle && active.twitterId)
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
    setMessage('Checking for proof post…')
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
            'No proof post found — open your X profile so recent posts are searchable, or create a new proof',
          )
        } else if (check.status === 'verified') {
          setMessage('Proof verified')
        } else if (check.status === 'needs_publish') {
          setMessage(
            'Proof post found on X and saved locally. Publish a kind 10011 link to relays?',
          )
        }
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Proof check failed')
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
        const blocked = result.blockedBy ? ` · ${result.blockedBy}` : ''
        const changed = result.changed ? ' · updated' : ' · unchanged'
        setMessage(
          `Status: ${result.state}${blocked}${changed}` +
            (result.identity.xProofPostId
              ? ` · xProof ${result.identity.xProofPostId}`
              : '') +
            (result.identity.nip39PostId
              ? ` · nip39 ${result.identity.nip39PostId}`
              : ''),
        )
        if (result.state === 'verified' && result.identity.xProofPostId) {
          setProofStatus('done')
          setProofPostId(result.identity.xProofPostId)
        } else if (result.blockedBy === 'missing-nip39') {
          setProofStatus('needs_publish')
          if (result.identity.xProofPostId) {
            setProofPostId(result.identity.xProofPostId)
          }
        } else if (
          result.state === 'pending' ||
          result.blockedBy === 'proof-unavailable'
        ) {
          setProofStatus('pending')
        } else if (
          result.blockedBy === 'mismatch' ||
          result.blockedBy === 'missing-x-proof'
        ) {
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
    <Card className={styles.panel}>
      <SectionLabel>X proof</SectionLabel>
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
                : proofStatus === 'session' ||
                    proofStatus === 'pending' ||
                    proofStatus === 'needs_publish' ||
                    proofStatus === 'publish_preview'
                  ? styles.statusSession
                  : styles.statusMissing
            }
          >
            {proofStatus === 'loading'
              ? 'Checking…'
              : proofStatus === 'done'
                ? 'Proof OK'
                : proofStatus === 'needs_publish' ||
                    proofStatus === 'publish_preview'
                  ? 'Proof found · publish?'
                  : proofStatus === 'session'
                    ? 'Posting…'
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
        {preview ? (
          <>
            <label className={styles.label}>
              Proof preview
              <textarea
                className={styles.textarea}
                rows={3}
                readOnly
                value={preview.proofText}
              />
            </label>
            <div className={styles.row}>
              <Button
                small
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void axRequest<ConfirmResult>({
                    type: 'CONFIRM_X_PROOF_COMPOSER',
                    version: BACKGROUND_API_VERSION,
                    handle: preview.handle,
                    twitterId: preview.twitterId,
                  })
                    .then(async (result) => {
                      if (result.decision === 'needs_proof') {
                        await chrome.tabs.create({ url: result.intentUrl })
                        setProofStatus('session')
                        setMessage('Proof session active — post on X')
                      } else {
                        setPreview(undefined)
                        setProofStatus('done')
                        setMessage('Already proven')
                      }
                    })
                    .catch((error: unknown) => {
                      setMessage(
                        error instanceof Error ? error.message : 'Error',
                      )
                    })
                    .finally(() => setBusy(false))
                }}
              >
                {preview.alreadyProven ? 'Use existing proof' : 'Confirm & post'}
              </Button>
              <Button
                small
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void axRequest({
                    type: 'CANCEL_PROOF_COMPOSER',
                    version: BACKGROUND_API_VERSION,
                  })
                    .then(() => {
                      setPreview(undefined)
                      setProofPostInput('')
                      setProofStatus('not_found')
                      setMessage('Cancelled')
                    })
                    .finally(() => setBusy(false))
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : proofStatus === 'loading' ? (
          <p className={styles.hint}>Checking proof…</p>
        ) : proofStatus === 'done' ? (
          <div className={styles.row}>
            <p className={styles.hint}>Proof OK</p>
            <Button
              small
              variant="secondary"
              disabled={!canCheckProof}
              onClick={runCheckForProof}
            >
              Check for proof
            </Button>
          </div>
        ) : proofStatus === 'session' && active?.handle && active.twitterId ? (
          <div className={styles.row}>
            <Button
              small
              disabled={busy}
              onClick={() => {
                setBusy(true)
                setMessage('Looking for proof post…')
                void axRequest<XProofCheckResult>({
                  type: 'CHECK_X_PROOF',
                  version: BACKGROUND_API_VERSION,
                  handle: active.handle,
                  twitterId: active.twitterId!,
                  queryRelays: true,
                  scanPage: true,
                })
                  .then(async (check) => {
                    const foundPostId =
                      (check.status === 'verified' ||
                        check.status === 'needs_publish') &&
                      'proofPostId' in check
                        ? check.proofPostId
                        : undefined
                    if (!foundPostId) {
                      setMessage(
                        'Proof not found yet — open your X profile so the post is visible, or paste the post URL below',
                      )
                      return
                    }
                    await axRequest<PublishResult>({
                      type: 'CAPTURE_X_PROOF_POST',
                      version: BACKGROUND_API_VERSION,
                      proofTweetId: foundPostId,
                    })
                    setProofPostId(foundPostId)
                    setProofStatus('done')
                    setMessage('Proof captured')
                    const refreshed = await axRequest<PublicExtensionState>({
                      type: 'GET_STATE',
                    })
                    setState(refreshed)
                  })
                  .catch((error: unknown) => {
                    setMessage(
                      error instanceof Error ? error.message : 'Lookup failed',
                    )
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Look for proof
            </Button>
            <Button
              small
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void axRequest({
                  type: 'CANCEL_PROOF_COMPOSER',
                  version: BACKGROUND_API_VERSION,
                })
                  .then(async () => {
                    setProofStatus('not_found')
                    setMessage('Proof session cancelled')
                    const refreshed = await axRequest<PublicExtensionState>({
                      type: 'GET_STATE',
                    })
                    setState(refreshed)
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Cancel
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
                      // Trust the publish result — a follow-up CHECK with
                      // scanPage:false used to overwrite verified/pending with
                      // not_found when local X-proof lookup was scan-gated.
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
                    'Proof post found on X and saved locally. Publish a kind 10011 link to relays?',
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
              Check for proof
            </Button>
          </div>
        ) : (
          <div className={styles.row}>
            <Button small disabled={!canCheckProof} onClick={runCheckForProof}>
              Check for proof
            </Button>
            <Button
              small
              variant="secondary"
              disabled={!canPrepare}
              onClick={() => {
                if (!active?.handle || !active.twitterId) return
                setBusy(true)
                setMessage('')
                void axRequest<ProofComposerPreview>({
                  type: 'PREPARE_X_PROOF_COMPOSER',
                  version: BACKGROUND_API_VERSION,
                  handle: active.handle,
                  twitterId: active.twitterId,
                })
                  .then((next) => {
                    setPreview(next)
                    setMessage(
                      next.alreadyProven
                        ? 'Existing proof found — confirm to publish link'
                        : 'Review proof text, then confirm to open the X composer',
                    )
                  })
                  .catch((error: unknown) => {
                    setMessage(error instanceof Error ? error.message : 'Error')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Create proof
            </Button>
          </div>
        )}

        {(state?.proofSession || preview) && (
          <>
            <input
              className={styles.input}
              value={proofPostInput}
              onChange={(event) => setProofPostInput(event.target.value)}
              placeholder="Proof post URL or ID (optional capture)"
              spellCheck={false}
            />
            <Button
              small
              disabled={busy || !proofPostInput.trim() || !state?.proofSession}
              onClick={() => {
                setBusy(true)
                void axRequest<PublishResult>({
                  type: 'CAPTURE_X_PROOF_POST',
                  version: BACKGROUND_API_VERSION,
                  proofTweetId: proofPostInput.trim(),
                })
                  .then((result) => {
                    setPreview(undefined)
                    setProofPostInput('')
                    setProofStatus('done')
                    setMessage(
                      `Published · ${result.deliveredTo}/${result.attemptedRelays}`,
                    )
                  })
                  .catch((error: unknown) => {
                    setMessage(error instanceof Error ? error.message : 'Error')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Capture proof post
            </Button>
          </>
        )}
      </div>

      <SectionLabel>{t('x.ui.featuresTitle')}</SectionLabel>
      <p className={styles.hint}>{t('x.ui.featuresHint')}</p>
      <div className={styles.featureList}>
        {X_AUGMENTATION_FEATURE_KEYS.map((key) => (
          <label key={key} className={styles.featureRow}>
            <div className={styles.featureText}>
              <span className={styles.featureLabel}>
                {t(`x.ui.feature.${key}`)}
              </span>
              <span className={styles.featureHint}>
                {t(`x.ui.featureHint.${key}`)}
              </span>
            </div>
            <Toggle
              checked={augmentationFeatures[key]}
              onChange={(checked) => setFeature(key, checked)}
            />
          </label>
        ))}
      </div>

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
                setMessage(error instanceof Error ? error.message : 'Error')
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

      {message ? <p className={styles.message}>{message}</p> : null}
    </Card>
  )
}
