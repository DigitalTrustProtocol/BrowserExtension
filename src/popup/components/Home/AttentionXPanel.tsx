import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type CockpitState,
  type ExtensionRequest,
  type ExtensionResponse,
  type ProofComposerPreview,
  type PublicExtensionState,
  type PublishResult,
  type XProofCheckResult,
} from '../../../shared/contracts'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
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
  | 'vault_locked'
  | 'not_found'
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

export default function AttentionXPanel() {
  const [state, setState] = useState<PublicExtensionState>()
  const [cockpit, setCockpit] = useState<CockpitState>()
  const [proofStatus, setProofStatus] = useState<ProofStatus>('loading')
  const [proofPostId, setProofPostId] = useState<string>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ProofComposerPreview>()
  const [proofPostInput, setProofPostInput] = useState('')
  const lastFullCheckKey = useRef<string>('')
  const fullCheckInFlight = useRef(false)

  const applyProofCheck = useCallback((check: XProofCheckResult) => {
    if (check.status === 'verified') {
      setProofStatus('done')
      setProofPostId(check.proofPostId)
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
    setProofStatus('not_found')
    setProofPostId(undefined)
  }, [])

  const runFullCheck = useCallback(
    async (handle: string, twitterId: string): Promise<void> => {
      if (fullCheckInFlight.current) return
      fullCheckInFlight.current = true
      try {
        const check = await axRequest<XProofCheckResult>({
          type: 'CHECK_X_PROOF',
          version: BACKGROUND_API_VERSION,
          handle,
          twitterId,
          queryRelays: true,
          scanPage: true,
        })
        applyProofCheck(check)
      } catch (error: unknown) {
        // Keep local not_found so Create proof stays available.
        setProofStatus((current) =>
          current === 'done' || current === 'session' ? current : 'not_found',
        )
        setMessage(
          error instanceof Error
            ? `Relay check failed · ${error.message}`
            : 'Relay check failed',
        )
      } finally {
        fullCheckInFlight.current = false
      }
    },
    [applyProofCheck],
  )

  const refresh = useCallback(
    async (options?: {
      queryRelays?: boolean
      scanPage?: boolean
    }): Promise<PublicExtensionState> => {
      const [next, nextCockpit] = await Promise.all([
        axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
        axRequest<CockpitState>({ type: 'GET_COCKPIT_STATE' }).catch(
          () => undefined,
        ),
      ])
      setState(next)
      if (nextCockpit) setCockpit(nextCockpit)

      const active = next.activeXAccount
      if (next.proofSession) {
        setProofStatus('session')
        setProofPostId(undefined)
        return next
      }
      if (next.vaultLocked) {
        setProofStatus('vault_locked')
        setProofPostId(undefined)
        return next
      }
      if (!next.hasIdentity) {
        setProofStatus('missing_account')
        setProofPostId(undefined)
        return next
      }
      if (!active?.handle || !active.twitterId) {
        setProofStatus('missing_account')
        setProofPostId(undefined)
        return next
      }

      const accountKey = `${next.pubkey ?? ''}:${active.handle}:${active.twitterId}`
      const wantFull =
        options?.queryRelays === true ||
        options?.scanPage === true ||
        lastFullCheckKey.current !== accountKey

      // Fast local check first so Create proof can enable without waiting on relays.
      const localCheck = await axRequest<XProofCheckResult>({
        type: 'CHECK_X_PROOF',
        version: BACKGROUND_API_VERSION,
        handle: active.handle,
        twitterId: active.twitterId,
        queryRelays: false,
        scanPage: false,
      })
      applyProofCheck(localCheck)

      if (wantFull && localCheck.status !== 'verified') {
        lastFullCheckKey.current = accountKey
        void runFullCheck(active.handle, active.twitterId)
      } else if (wantFull) {
        lastFullCheckKey.current = accountKey
      }

      return next
    },
    [applyProofCheck, runFullCheck],
  )

  useEffect(() => {
    void refresh({ queryRelays: true, scanPage: true }).catch(
      (error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'Failed to load')
        setProofStatus('not_found')
      },
    )
    const timer = window.setInterval(() => {
      void refresh({ queryRelays: false, scanPage: false }).catch(() => undefined)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const active = state?.activeXAccount
  // Create proof should work as soon as we know the active X user — do not wait
  // on relays / page-scan. Only hide when already verified or mid-session.
  const canPrepare =
    !busy &&
    Boolean(state?.hasIdentity && !state.vaultLocked) &&
    Boolean(active?.handle && active.twitterId) &&
    proofStatus !== 'done' &&
    proofStatus !== 'session' &&
    proofStatus !== 'vault_locked' &&
    proofStatus !== 'missing_account'

  const trustEvents =
    cockpit?.storage.eventsByKind['32009'] ?? state?.cachedEventCount ?? 0
  const identityLinks = cockpit?.storage.eventsByKind['10011'] ?? 0
  const xIdentities = cockpit?.storage.stores.xIdentities ?? 0
  const outboxPending = cockpit?.storage.outboxByStatus.pending ?? 0

  return (
    <Card className={styles.panel}>
      <SectionLabel>X proof</SectionLabel>
      <p className={styles.hint}>
        {active?.twitterId
          ? `@${active.handle} · ${active.twitterId}`
          : active?.handle
            ? `@${active.handle} · waiting for numeric ID`
            : 'Open x.com while signed in to detect your account'}
      </p>

      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>Status</span>
        <span
          className={
            proofStatus === 'done'
              ? styles.statusDone
              : proofStatus === 'session' || proofStatus === 'pending'
                ? styles.statusSession
                : styles.statusMissing
          }
        >
          {proofStatus === 'loading'
            ? 'Checking…'
            : proofStatus === 'done'
              ? proofPostId
                ? `Done · ${proofPostId}`
                : 'Done'
              : proofStatus === 'session'
                ? 'Posting…'
                : proofStatus === 'pending'
                  ? 'Pending verification'
                  : proofStatus === 'vault_locked'
                    ? 'Unlock vault'
                    : proofStatus === 'missing_account'
                      ? active?.handle && !active.twitterId
                        ? 'Waiting for X ID'
                        : 'No X account yet'
                      : 'Not found'}
        </span>
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
                        // Popup window.open is unreliable; open composer in a tab.
                        await chrome.tabs.create({ url: result.intentUrl })
                        setMessage('Proof session active — post on X')
                        await refresh({ queryRelays: false, scanPage: false })
                      } else {
                        setPreview(undefined)
                        setMessage('Already proven')
                        await refresh({ queryRelays: false, scanPage: false })
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
                    .then(async () => {
                      setPreview(undefined)
                      setProofPostInput('')
                      await refresh({ queryRelays: false, scanPage: false })
                      setMessage('Cancelled')
                    })
                    .finally(() => setBusy(false))
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : proofStatus === 'done' ? (
          <p className={styles.hint}>NIP-39 link verified for this account.</p>
        ) : (
          <div className={styles.row}>
            <Button
              small
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
            <Button
              small
              variant="secondary"
              disabled={busy || !active?.handle || !active.twitterId}
              onClick={() => {
                lastFullCheckKey.current = ''
                setBusy(true)
                void refresh({ queryRelays: true, scanPage: true })
                  .then(() => setMessage('Proof check refreshed'))
                  .catch((error: unknown) => {
                    setMessage(error instanceof Error ? error.message : 'Error')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Recheck
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
                  .then(async (result) => {
                    setPreview(undefined)
                    setProofPostInput('')
                    lastFullCheckKey.current = ''
                    await refresh({ queryRelays: true, scanPage: false })
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
                await refresh({ queryRelays: false, scanPage: false })
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
                await refresh({ queryRelays: false, scanPage: false })
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
