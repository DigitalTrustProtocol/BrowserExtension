import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './App.css'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type ProofComposerPreview,
  type ProofComposerSession,
  type PublicExtensionState,
  type PublishResult,
} from './shared/contracts'

type ConfirmResult =
  | { decision: 'already_proven'; result: PublishResult }
  | {
      decision: 'needs_proof'
      session: ProofComposerSession
      intentUrl: string
    }

function App() {
  const { t } = useTranslation()
  const [state, setState] = useState<PublicExtensionState>()
  const [nsec, setNsec] = useState('')
  const [relayText, setRelayText] = useState('')
  const [message, setMessage] = useState(() => t('popup.loading'))
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ProofComposerPreview>()
  const [proofPostInput, setProofPostInput] = useState('')

  async function request<T>(request: ExtensionRequest): Promise<T> {
    const response = (await chrome.runtime.sendMessage(
      request,
    )) as ExtensionResponse<T>
    if (!response.ok) throw new Error(response.error)
    return response.data
  }

  async function refreshState(): Promise<PublicExtensionState> {
    const nextState = await request<PublicExtensionState>({ type: 'GET_STATE' })
    setState(nextState)
    setRelayText(nextState.relays.join('\n'))
    return nextState
  }

  async function run(
    action: () => Promise<PublicExtensionState>,
    successMessage: string,
  ): Promise<void> {
    setBusy(true)
    try {
      const nextState = await action()
      setState(nextState)
      setRelayText(nextState.relays.join('\n'))
      setMessage(successMessage)
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t('popup.unexpectedError'),
      )
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refreshState()
      .then((loaded) => {
        setMessage(
          loaded.hasIdentity
            ? t('popup.identityReady')
            : t('popup.createIdentity'),
        )
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : t('popup.stateLoadError'),
        )
      })

    const timer = window.setInterval(() => {
      void refreshState().catch(() => undefined)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [t])

  const shortNpub = state?.npub
    ? `${state.npub.slice(0, 16)}…${state.npub.slice(-8)}`
    : undefined

  const active = state?.activeXAccount
  const activeLabel = !active
    ? t('popup.activeAccountWaiting')
    : active.twitterId
      ? t('popup.activeAccountReady', {
          handle: active.handle,
          twitterId: active.twitterId,
        })
      : t('popup.activeAccountPartial', { handle: active.handle })

  const syncLabel =
    state?.syncStatus?.state === 'running'
      ? t('popup.syncRunning')
      : state?.syncStatus?.state === 'complete'
        ? t('popup.syncComplete')
        : state?.syncStatus?.state === 'error'
          ? t('popup.syncError')
          : state?.syncStatus?.state === 'stopped'
            ? t('popup.syncStopped')
            : t('popup.syncIdle')

  const canPrepare =
    Boolean(state?.hasIdentity && active?.handle && active.twitterId) && !busy

  return (
    <main>
      <header>
        <div className="mark" aria-hidden="true">AX</div>
        <div>
          <h1>Attention</h1>
          <p>{t('popup.tagline')}</p>
        </div>
        <span className={`status-dot ${state?.hasIdentity ? 'ready' : ''}`} />
      </header>

      <section>
        <div className="section-heading">
          <h2>{t('popup.identity')}</h2>
          <span>
            {state?.hasIdentity
              ? t('popup.ready')
              : t('popup.notConfigured')}
          </span>
        </div>
        {state?.hasIdentity ? (
          <div className="identity">
            <code title={state.npub}>{shortNpub}</code>
            <button
              className="quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(t('popup.removeConfirm'))) {
                  return
                }
                void run(
                  () => request({ type: 'CLEAR_IDENTITY' }),
                  t('popup.identityRemoved'),
                )
              }}
            >
              {t('popup.remove')}
            </button>
          </div>
        ) : (
          <div className="stack">
            <button
              className="primary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => request({ type: 'GENERATE_IDENTITY' }),
                  t('popup.identityCreated'),
                )
              }
            >
              {t('popup.generate')}
            </button>
            <div className="divider"><span>{t('popup.orImport')}</span></div>
            <label>
              {t('popup.existingNsec')}
              <input
                type="password"
                value={nsec}
                onChange={(event) => setNsec(event.target.value)}
                placeholder="nsec1…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              disabled={busy || !nsec.trim()}
              onClick={() =>
                void run(
                  () => request({ type: 'IMPORT_IDENTITY', nsec }),
                  t('popup.identityImported'),
                ).then(() => setNsec(''))
              }
            >
              {t('popup.import')}
            </button>
          </div>
        )}
        <p className="warning">
          {t('popup.securityWarning')}
        </p>
      </section>

      <section>
        <div className="section-heading">
          <h2>{t('popup.linkX')}</h2>
          <span>{activeLabel}</span>
        </div>
        <p className="warning">{t('popup.linkXHelp')}</p>
        {preview ? (
          <div className="stack">
            <label>
              {t('popup.destinationAccount')}
              <code>
                @{preview.handle} · {preview.twitterId}
              </code>
            </label>
            <label>
              {t('popup.proofPreview')}
              <textarea rows={4} readOnly value={preview.proofText} />
            </label>
            {preview.alreadyProven ? (
              <>
                <p className="warning">{t('popup.alreadyProven')}</p>
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void request<ConfirmResult>({
                      type: 'CONFIRM_X_PROOF_COMPOSER',
                      version: BACKGROUND_API_VERSION,
                      handle: preview.handle,
                      twitterId: preview.twitterId,
                    })
                      .then(async (result) => {
                        setPreview(undefined)
                        await refreshState()
                        setMessage(
                          result.decision === 'already_proven'
                            ? t('popup.alreadyProven')
                            : t('popup.proofSessionActive'),
                        )
                      })
                      .catch((error: unknown) => {
                        setMessage(
                          error instanceof Error
                            ? error.message
                            : t('popup.unexpectedError'),
                        )
                      })
                      .finally(() => setBusy(false))
                  }}
                >
                  {t('popup.useExistingProof')}
                </button>
              </>
            ) : (
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void request<ConfirmResult>({
                    type: 'CONFIRM_X_PROOF_COMPOSER',
                    version: BACKGROUND_API_VERSION,
                    handle: preview.handle,
                    twitterId: preview.twitterId,
                  })
                    .then(async (result) => {
                      await refreshState()
                      if (result.decision === 'needs_proof') {
                        await chrome.tabs.create({ url: result.intentUrl })
                        setMessage(t('popup.proofSessionActive'))
                      } else {
                        setPreview(undefined)
                        setMessage(t('popup.alreadyProven'))
                      }
                    })
                    .catch((error: unknown) => {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : t('popup.unexpectedError'),
                      )
                    })
                    .finally(() => setBusy(false))
                }}
              >
                {t('popup.confirmProof')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void request({
                  type: 'CANCEL_PROOF_COMPOSER',
                  version: BACKGROUND_API_VERSION,
                })
                  .then(async () => {
                    setPreview(undefined)
                    setProofPostInput('')
                    await refreshState()
                    setMessage(t('popup.cancelProof'))
                  })
                  .catch((error: unknown) => {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : t('popup.unexpectedError'),
                    )
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {t('popup.cancelProof')}
            </button>
          </div>
        ) : (
          <button
            className="primary"
            type="button"
            disabled={!canPrepare}
            onClick={() => {
              if (!active?.handle || !active.twitterId) return
              setBusy(true)
              void request<ProofComposerPreview>({
                type: 'PREPARE_X_PROOF_COMPOSER',
                version: BACKGROUND_API_VERSION,
                handle: active.handle,
                twitterId: active.twitterId,
              })
                .then((next) => {
                  setPreview(next)
                  setMessage(t('popup.prepareProof'))
                })
                .catch((error: unknown) => {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : t('popup.unexpectedError'),
                  )
                })
                .finally(() => setBusy(false))
            }}
          >
            {t('popup.prepareProof')}
          </button>
        )}
        {(state?.proofSession || preview) && (
          <div className="stack" style={{ marginTop: 8 }}>
            <label>
              {t('popup.proofPostId')}
              <input
                value={proofPostInput}
                onChange={(event) => setProofPostInput(event.target.value)}
                placeholder="https://x.com/…/status/…"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              disabled={busy || !proofPostInput.trim() || !state?.proofSession}
              onClick={() => {
                setBusy(true)
                void request<PublishResult>({
                  type: 'CAPTURE_X_PROOF_POST',
                  version: BACKGROUND_API_VERSION,
                  proofTweetId: proofPostInput.trim(),
                })
                  .then(async (result) => {
                    setPreview(undefined)
                    setProofPostInput('')
                    await refreshState()
                    setMessage(
                      t('popup.captureProof') +
                        ` · ${result.deliveredTo}/${result.attemptedRelays}`,
                    )
                  })
                  .catch((error: unknown) => {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : t('popup.unexpectedError'),
                    )
                  })
                  .finally(() => setBusy(false))
              }}
            >
              {t('popup.captureProof')}
            </button>
          </div>
        )}
      </section>

      <section>
        <div className="section-heading">
          <h2>{t('popup.relays')}</h2>
          <span>
            {t('popup.configured', { count: state?.relays.length ?? 0 })}
          </span>
        </div>
        <label>
          {t('popup.relayHelp')}
          <textarea
            rows={3}
            value={relayText}
            onChange={(event) => setRelayText(event.target.value)}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const relays = relayText
              .split(/\s+/)
              .map((relay) => relay.trim())
              .filter(Boolean)
            void run(
              () => request({ type: 'SAVE_RELAYS', relays }),
              t('popup.relaysSaved'),
            )
          }}
        >
          {t('popup.saveRelays')}
        </button>
      </section>

      <section>
        <div className="section-heading">
          <h2>{t('popup.sync')}</h2>
          <span>{syncLabel}</span>
        </div>
        <div className="stack">
          <button
            type="button"
            disabled={busy || !state?.hasIdentity}
            onClick={() => {
              setBusy(true)
              void request({
                type: 'START_WOT_SYNC',
                version: BACKGROUND_API_VERSION,
              })
                .then(async () => {
                  await refreshState()
                  setMessage(t('popup.syncRunning'))
                })
                .catch((error: unknown) => {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : t('popup.unexpectedError'),
                  )
                })
                .finally(() => setBusy(false))
            }}
          >
            {t('popup.startSync')}
          </button>
          <button
            type="button"
            disabled={busy || state?.syncStatus?.state !== 'running'}
            onClick={() => {
              setBusy(true)
              void request({
                type: 'STOP_WOT_SYNC',
                version: BACKGROUND_API_VERSION,
              })
                .then(async () => {
                  await refreshState()
                  setMessage(t('popup.syncStopped'))
                })
                .catch((error: unknown) => {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : t('popup.unexpectedError'),
                  )
                })
                .finally(() => setBusy(false))
            }}
          >
            {t('popup.stopSync')}
          </button>
        </div>
      </section>

      <footer>
        <span>{message}</span>
        <span>
          {t('popup.cachedEvents', { count: state?.cachedEventCount ?? 0 })}
        </span>
      </footer>
    </main>
  )
}

export default App
