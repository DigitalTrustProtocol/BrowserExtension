import { useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type ProofComposerPreview,
  type PublicExtensionState,
  type PublishResult,
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

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export default function AttentionXPanel() {
  const [state, setState] = useState<PublicExtensionState>()
  const [relayText, setRelayText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ProofComposerPreview>()
  const [proofPostInput, setProofPostInput] = useState('')

  async function refresh(): Promise<PublicExtensionState> {
    const next = await axRequest<PublicExtensionState>({ type: 'GET_STATE' })
    setState(next)
    setRelayText(next.relays.join('\n'))
    return next
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Failed to load')
    })
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 4_000)
    return () => window.clearInterval(timer)
  }, [])

  const active = state?.activeXAccount
  const canPrepare =
    Boolean(state?.hasIdentity && active?.handle && active.twitterId) && !busy

  return (
    <Card className={styles.panel}>
      <SectionLabel>AttentionX</SectionLabel>
      <p className={styles.hint}>
        {active?.twitterId
          ? `@${active.handle} · ${active.twitterId}`
          : active?.handle
            ? `@${active.handle}`
            : 'Open x.com while signed in to link your account'}
      </p>

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
                    await refresh()
                    if (result.decision === 'needs_proof') {
                      window.open(result.intentUrl, '_blank', 'noopener')
                      setMessage('Proof session active')
                    } else {
                      setPreview(undefined)
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
                  .then(async () => {
                    setPreview(undefined)
                    setProofPostInput('')
                    await refresh()
                    setMessage('Cancelled')
                  })
                  .finally(() => setBusy(false))
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            small
            disabled={!canPrepare}
            onClick={() => {
              if (!active?.handle || !active.twitterId) return
              setBusy(true)
              void axRequest<ProofComposerPreview>({
                type: 'PREPARE_X_PROOF_COMPOSER',
                version: BACKGROUND_API_VERSION,
                handle: active.handle,
                twitterId: active.twitterId,
              })
                .then((next) => {
                  setPreview(next)
                  setMessage('Review proof text')
                })
                .catch((error: unknown) => {
                  setMessage(error instanceof Error ? error.message : 'Error')
                })
                .finally(() => setBusy(false))
            }}
          >
            Prepare X proof
          </Button>
        )}

        {(state?.proofSession || preview) && (
          <>
            <input
              className={styles.input}
              value={proofPostInput}
              onChange={(event) => setProofPostInput(event.target.value)}
              placeholder="Proof post URL or ID"
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
                    await refresh()
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

      <SectionLabel>Relays</SectionLabel>
      <textarea
        className={styles.textarea}
        rows={2}
        value={relayText}
        onChange={(event) => setRelayText(event.target.value)}
        spellCheck={false}
      />
      <Button
        small
        variant="secondary"
        disabled={busy}
        onClick={() => {
          const relays = relayText
            .split(/\s+/)
            .map((relay) => relay.trim())
            .filter(Boolean)
          setBusy(true)
          void axRequest({ type: 'SAVE_RELAYS', relays })
            .then(async () => {
              await refresh()
              setMessage('Relays saved')
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : 'Error')
            })
            .finally(() => setBusy(false))
        }}
      >
        Save relays
      </Button>

      <SectionLabel>WoT sync</SectionLabel>
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
                await refresh()
                setMessage('Sync started')
              })
              .catch((error: unknown) => {
                setMessage(error instanceof Error ? error.message : 'Error')
              })
              .finally(() => setBusy(false))
          }}
        >
          Start
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
                await refresh()
                setMessage('Sync stopped')
              })
              .finally(() => setBusy(false))
          }}
        >
          Stop
        </Button>
      </div>
      {message ? <p className={styles.message}>{message}</p> : null}
    </Card>
  )
}
