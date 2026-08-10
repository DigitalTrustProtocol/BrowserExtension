import { useCallback, useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type XBioEditPreview,
  X_BIO_MAX_CHARS,
  X_EDIT_PROFILE_URL,
} from '../../../shared/contracts'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
import Button from '@components/Button/Button'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import styles from './BioUpdatePanel.module.css'

interface BioUpdatePanelProps {
  visible: boolean
  onClose: () => void
  handle: string
  twitterId: string
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

function statusLine(preview: XBioEditPreview): string {
  if (preview.mode === 'replace') {
    return `Your bio or saved identity currently links ${truncateNpubDisplay(preview.otherNpub)}. Confirm replace to use your active npub instead.`
  }
  if (preview.mode === 'same') {
    return 'Your active npub is already present. You can tidy the wording below if you like.'
  }
  if (!preview.bioRead) {
    return 'We could not read your current bio from the open X tab. Open your profile or Edit profile, then refresh — or copy the suggested line below and merge it manually.'
  }
  return 'Review the suggested bio below, copy it, and paste it into X Edit profile.'
}

/**
 * Dedicated panel for placing the active Nostr npub in the X profile bio.
 * AttentionX never writes the bio; the user copies and pastes on X.
 */
export default function BioUpdatePanel({
  visible,
  onClose,
  handle,
  twitterId,
}: BioUpdatePanelProps) {
  const { shouldRender, animating } = useAnimatedVisible(visible)
  const [preview, setPreview] = useState<XBioEditPreview>()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const loadPreview = useCallback(
    (confirmReplace = false) => {
      setBusy(true)
      setStatus('')
      void axRequest<XBioEditPreview>({
        type: 'PREPARE_X_BIO_EDIT',
        version: BACKGROUND_API_VERSION,
        handle,
        twitterId,
        confirmReplace,
      })
        .then((next) => {
          setPreview(next)
          setStatus(statusLine(next))
        })
        .catch((error: unknown) => {
          setPreview(undefined)
          setStatus(
            error instanceof Error ? error.message : 'Could not prepare bio',
          )
        })
        .finally(() => setBusy(false))
    },
    [handle, twitterId],
  )

  useEffect(() => {
    if (!visible) {
      setPreview(undefined)
      setStatus('')
      setBusy(false)
      return
    }
    loadPreview(false)
  }, [visible, loadPreview])

  if (!shouldRender) return null

  const showCopy =
    preview &&
    !(preview.mode === 'replace' && preview.suffixUsed === 'none')

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
            Your Nostr npub key on your profile travels with every post, so it
            remains visible at all times for anyone to see. Adding your Nostr
            npub there creates a durable, self-attested link—more reliable than
            a proof post that can scroll out of view.
          </p>
          {status ? (
            <p
              className={
                preview?.mode === 'replace' || preview?.tooLong
                  ? styles.warning
                  : styles.rationale
              }
              role="status"
            >
              {status}
            </p>
          ) : null}
        </div>

        {busy && !preview ? (
          <p className={styles.hint}>Preparing suggested bio…</p>
        ) : null}

        {preview ? (
          <>
            <label className={styles.label}>
              Suggested bio
              <textarea
                className={styles.textarea}
                rows={5}
                readOnly
                value={preview.suggestedBio}
                spellCheck={false}
              />
            </label>
            <p
              className={
                preview.tooLong || preview.length > X_BIO_MAX_CHARS
                  ? styles.warning
                  : styles.hint
              }
            >
              {preview.length} / {X_BIO_MAX_CHARS}
              {preview.tooLong
                ? ' — Bio is too long; shorten it to 160 characters'
                : ''}
            </p>

            <div className={styles.actions}>
              {preview.mode === 'replace' &&
              preview.suffixUsed === 'none' ? (
                <Button
                  small
                  disabled={busy}
                  onClick={() => loadPreview(true)}
                >
                  Replace npub in bio
                </Button>
              ) : null}
              {showCopy ? (
                <Button
                  small
                  disabled={busy || !preview.suggestedBio}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(preview.suggestedBio)
                      .then(() =>
                        setStatus(
                          'Bio copied. Open Edit profile on X and paste it into the Bio field.',
                        ),
                      )
                      .catch(() =>
                        setStatus('Could not copy bio'),
                      )
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
                  void chrome.tabs.create({
                    url: preview.editProfileUrl || X_EDIT_PROFILE_URL,
                  })
                }}
              >
                Open Edit profile
              </Button>
              <Button
                small
                variant="secondary"
                disabled={busy}
                onClick={() => loadPreview(false)}
              >
                Refresh
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </OverlayPanel>
  )
}
