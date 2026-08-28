import { useCallback, useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
import Button from '@components/Button/Button'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type XBioEditPreview,
  type XIdentitySuggestFlags,
  X_BIO_MAX_CHARS,
  X_EDIT_PROFILE_URL,
} from '../../../shared/contracts'
import styles from './BioUpdateWizard.module.css'

type BioStep = 'copy' | 'open' | 'wait'

interface BioUpdateWizardProps {
  visible: boolean
  onClose: () => void
  handle: string
  twitterId: string
  activeNpub?: string
}

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function profileUrl(handle: string): string {
  const h = handle.replace(/^@/, '').trim()
  return h ? `https://x.com/${h}` : 'https://x.com/home'
}

function truncateNpubDisplay(npub: string | undefined): string {
  if (!npub) return ''
  if (npub.length <= 20) return npub
  return `${npub.slice(0, 12)}…${npub.slice(-4)}`
}

const STEP_INDEX: Record<BioStep, number> = { copy: 1, open: 2, wait: 3 }

export default function BioUpdateWizard({
  visible,
  onClose,
  handle,
  twitterId,
  activeNpub,
}: BioUpdateWizardProps) {
  const { shouldRender, animating } = useAnimatedVisible(visible)
  const [step, setStep] = useState<BioStep>('copy')
  const [preview, setPreview] = useState<XBioEditPreview | null>(null)
  const [flags, setFlags] = useState<XIdentitySuggestFlags | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const loadPreview = useCallback(
    (replace: boolean) => {
      setBusy(true)
      void Promise.all([
        axRequest<XBioEditPreview>({
          type: 'PREPARE_X_BIO_EDIT',
          version: BACKGROUND_API_VERSION,
          handle,
          twitterId,
          confirmReplace: replace,
        }),
        axRequest<XIdentitySuggestFlags>({
          type: 'GET_X_IDENTITY_SUGGEST_FLAGS',
          version: BACKGROUND_API_VERSION,
          handle,
          twitterId,
        }),
      ])
        .then(([next, nextFlags]) => {
          setPreview(next)
          setFlags(nextFlags)
          if (nextFlags.hasBioNpubForActive) {
            setStatus(t('bio.alreadyDone'))
          } else if (!next.tabMatch) {
            setStatus(
              t('bio.wrongTab', { handle: handle.replace(/^@/, '') }),
            )
          } else if (!next.bioRead) {
            setStatus(t('bio.needProfile'))
          } else if (next.mode === 'replace' && !replace) {
            setStatus(
              t('bio.mismatch', {
                npub: truncateNpubDisplay(next.otherNpub),
              }),
            )
          } else if (next.tooLong) {
            setStatus(t('bio.tooLong'))
          } else {
            setStatus(t('bio.stepCopyHint'))
          }
        })
        .catch((error: unknown) => {
          setStatus(
            error instanceof Error ? error.message : t('common.error'),
          )
        })
        .finally(() => setBusy(false))
    },
    [handle, twitterId],
  )

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
          setStatus(t('bio.alreadyDone'))
        } else if (next.bioNpubMismatch) {
          setConfirmReplace(true)
          setStep('copy')
          loadPreview(true)
        }
      })
      .catch(() => undefined)
  }, [handle, twitterId, loadPreview])

  useEffect(() => {
    if (!visible) {
      setStep('copy')
      setPreview(null)
      setFlags(null)
      setStatus('')
      setBusy(false)
      setCopied(false)
      setConfirmReplace(false)
      return
    }
    loadPreview(false)
  }, [visible, loadPreview])

  useEffect(() => {
    if (!visible || step !== 'wait') return
    const timer = window.setInterval(refreshFlags, 1500)
    return () => window.clearInterval(timer)
  }, [visible, step, refreshFlags])

  if (!shouldRender) return null

  const suggested = preview?.suggestedBio ?? (activeNpub?.trim() || '')
  const done = flags?.hasBioNpubForActive === true
  const canAdvanceCopy =
    copied || done || (preview?.mode === 'same' && preview.bioRead)
  const stepTitle =
    step === 'copy'
      ? t('bio.stepCopy')
      : step === 'open'
        ? t('bio.stepOpen')
        : t('bio.stepWait')

  const goBack = () => {
    if (step === 'copy') onClose()
    else if (step === 'open') setStep('copy')
    else setStep('open')
  }

  return (
    <OverlayPanel
      title={t('bio.wizardTitle')}
      onBack={goBack}
      onClose={onClose}
      animating={animating}
      zIndex={400}
      className={styles.overlay}
    >
      <div className={styles.body}>
        <p className={styles.progress}>
          {STEP_INDEX[step]} / 3 · {stepTitle}
        </p>

        {status ? (
          <p
            className={
              preview?.mode === 'replace' || !preview?.tabMatch
                ? styles.warning
                : styles.rationale
            }
            role="status"
          >
            {status}
          </p>
        ) : null}

        {step === 'copy' ? (
          <>
            {suggested ? (
              <>
                <label className={styles.label}>
                  {t('bio.stepCopy')}
                  <textarea
                    className={styles.textarea}
                    rows={5}
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
              {!preview?.tabMatch || !preview.bioRead ? (
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
                        loadPreview(confirmReplace)
                      })
                  }}
                >
                  {t('bio.openProfile')}
                </Button>
              ) : null}
              {preview?.mode === 'replace' && !confirmReplace ? (
                <Button
                  small
                  disabled={busy}
                  onClick={() => {
                    setConfirmReplace(true)
                    loadPreview(true)
                  }}
                >
                  {t('bio.copy')}
                </Button>
              ) : (
                <Button
                  small
                  disabled={busy || !suggested}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(suggested)
                      .then(() => {
                        setCopied(true)
                        setStatus(t('bio.copied'))
                      })
                      .catch(() => setStatus(t('bio.copyFailed')))
                  }}
                >
                  {copied ? t('bio.copied') : t('bio.copy')}
                </Button>
              )}
              {done ? (
                <Button small onClick={onClose}>
                  {t('bio.done')}
                </Button>
              ) : (
                <Button
                  small
                  disabled={!canAdvanceCopy}
                  onClick={() => setStep('open')}
                >
                  {t('bio.next')}
                </Button>
              )}
            </div>
          </>
        ) : null}

        {step === 'open' ? (
          <>
            <p className={styles.rationale}>{t('bio.stepOpenHint')}</p>
            <div className={styles.actions}>
              <Button
                small
                onClick={() => {
                  void chrome.tabs.create({ url: X_EDIT_PROFILE_URL })
                }}
              >
                {t('bio.openEdit')}
              </Button>
              <Button small onClick={() => setStep('wait')}>
                {t('bio.next')}
              </Button>
            </div>
          </>
        ) : null}

        {step === 'wait' ? (
          <>
            <p className={styles.rationale}>{t('bio.stepWaitHint')}</p>
            <p className={styles.hint} role="status">
              {done ? t('bio.alreadyDone') : t('bio.waiting')}
            </p>
            <div className={styles.actions}>
              <Button
                small
                variant="secondary"
                onClick={() => {
                  void chrome.tabs.create({ url: profileUrl(handle) })
                }}
              >
                {t('bio.openProfile')}
              </Button>
              {done ? (
                <Button small onClick={onClose}>
                  {t('bio.done')}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </OverlayPanel>
  )
}
