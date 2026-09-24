import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './App.css'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type PublicExtensionState,
} from './shared/contracts'

function App() {
  const { t } = useTranslation()
  const [state, setState] = useState<PublicExtensionState>()
  const [nsec, setNsec] = useState('')
  const [relayText, setRelayText] = useState('')
  const [message, setMessage] = useState(() => t('popup.loading'))
  const [busy, setBusy] = useState(false)

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
