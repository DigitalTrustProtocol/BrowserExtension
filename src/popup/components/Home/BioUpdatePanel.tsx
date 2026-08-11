import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type XIdentitySuggestFlags,
  X_BIO_MAX_CHARS,
  X_EDIT_PROFILE_URL,
} from '../../../shared/contracts'
import { buildSuggestedXBio } from '../../../shared/x-bio-edit'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
import Button from '@components/Button/Button'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import styles from './BioUpdatePanel.module.css'

interface BioUpdatePanelProps {
  visible: boolean
  onClose: () => void
  handle: string
  twitterId: string
  /** Active account npub for copy suggestions (from popup state). */
  activeNpub?: string
}

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function truncateNpubDisplay(npub: string | undefined): string {
  if (!npub) return 'another npub'
  if (npub.length <= 20) return npub
  return `${npub.slice(0, 12)}…${npub.slice(-4)}`
}

function profileUrl(handle: string): string {
  const h = handle.replace(/^@/, '').trim()
  return h ? `https://x.com/${h}` : 'https://x.com/home'
}

/**
 * Soft Bio setup panel: never probes the content script. User opens their
 * profile; passive GraphQL updates vault/Sync; this panel polls flags.
 */
export default function BioUpdatePanel({
  visible,
  onClose,
  handle,
  twitterId,
  activeNpub,
}: BioUpdatePanelProps) {
  const { shouldRender, animating } = useAnimatedVisible(visible)
  const [flags, setFlags] = useState<XIdentitySuggestFlags | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshFlags = useCallback(() => {
    void axRequest<XIdentitySuggestFlags>({
      type: 'GET_X_IDENTITY_SUGGEST_FLAGS',
      version: BACKGROUND_API_VERSION,
      handle,
      twitterId,
    })
      .then((next) => {
        setFlags(next)
        if (next.hasBioNpubForActive) {
          setStatus('Your active npub is already in the bio.')
        } else if (next.bioNpubMismatch && next.otherBioNpub) {
          setStatus(
            `Your bio currently links a different npub (${truncateNpubDisplay(next.otherBioNpub)}). Copy your active npub below and replace it on Edit profile.`,
          )
        } else {
          setStatus(
            'Open your X profile so AttentionX can see the bio passively (no extra requests). If your npub is missing, copy the line below and paste it on Edit profile.',
          )
        }
      })
      .catch((error: unknown) => {
        setStatus(
          error instanceof Error ? error.message : 'Could not load bio status',
        )
      })
  }, [handle, twitterId])

  useEffect(() => {
    if (!visible) {
      setFlags(null)
      setStatus('')
      setBusy(false)
      return
    }
    refreshFlags()
    const timer = window.setInterval(refreshFlags, 1500)
    return () => window.clearInterval(timer)
  }, [visible, refreshFlags])

  if (!shouldRender) return null

  const npub = activeNpub?.trim() || ''
  const suggested =
    npub && flags?.bioNpubMismatch
      ? buildSuggestedXBio({
          currentBio: flags.otherBioNpub ?? '',
          activeNpub: npub,
          confirmReplace: true,
        }).suggestedBio
      : npub
        ? buildSuggestedXBio({
            currentBio: '',
            activeNpub: npub,
          }).suggestedBio
        : ''

  const done = flags?.hasBioNpubForActive === true

  return (
    <OverlayPanel
      title="Update Profile"
      onBack={onClose}
      onClose={onClose}
      animating={animating}
      zIndex={400}
      className={styles.overlay}
    >
      <div className={styles.body}>
        <div className={styles.copy}>
          <p className={styles.rationale}>
            Your Nostr npub on your profile travels with every post. AttentionX
            only learns it from X’s own page data — never by scraping in the
            background.
          </p>
          {status ? (
            <p
              className={
                flags?.bioNpubMismatch ? styles.warning : styles.rationale
              }
              role="status"
            >
              {status}
            </p>
          ) : null}
        </div>

        {done ? null : suggested ? (
          <>
            <label className={styles.label}>
              Suggested bio line
              <textarea
                className={styles.textarea}
                rows={4}
                readOnly
                value={suggested}
                spellCheck={false}
              />
            </label>
            <p className={styles.hint}>
              {suggested.length} / {X_BIO_MAX_CHARS}
            </p>
          </>
        ) : null}

        <div className={styles.actions}>
          <Button
            small
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void chrome.tabs
                .create({ url: profileUrl(handle) })
                .catch(() => undefined)
                .finally(() => {
                  setBusy(false)
                  refreshFlags()
                })
            }}
          >
            Open profile
          </Button>
          {done ? (
            <Button small onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              {suggested ? (
                <Button
                  small
                  disabled={busy || !suggested}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(suggested)
                      .then(() =>
                        setStatus(
                          'Copied. Open Edit profile on X and paste into Bio — AttentionX will hide this tip once your npub is seen passively.',
                        ),
                      )
                      .catch(() => setStatus('Could not copy'))
                  }}
                >
                  Copy bio
                </Button>
              ) : null}
              <Button
                small
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void chrome.tabs.create({ url: X_EDIT_PROFILE_URL })
                }}
              >
                Open Edit profile
              </Button>
            </>
          )}
        </div>
      </div>
    </OverlayPanel>
  )
}
