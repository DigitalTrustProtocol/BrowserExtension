import { useEffect, useState, type ReactNode } from 'react'
import { t } from '@lib/i18n.js'
import OverlayPanel from '@components/OverlayPanel/OverlayPanel'
import Button from '@components/Button/Button'
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type IngestSavedXBioResult,
  type OpenXProfileEditResult,
  type XBioEditPreview,
  X_BIO_MAX_CHARS,
} from '../../../shared/contracts'
import {
  bioWizardStep3,
  type BioWizardStep3Kind,
} from './bio-wizard-status'
import styles from './BioUpdateWizard.module.css'

interface BioUpdateWizardProps {
  visible: boolean
  onClose: () => void
  handle: string
  twitterId: string
  /** Binding completeness: saved bio already has this Nostr key. */
  bioOk: boolean
  /** Binding completeness: saved bio has a different npub. */
  bioMismatch: boolean
  activeNpub?: string
  /** Reload bindings after a user-kick ingest so step 3 can follow xNpub. */
  onRecheck: () => Promise<void>
}

const X_TAB_PATTERNS = [
  'https://x.com/*',
  'https://www.x.com/*',
  'https://twitter.com/*',
  'https://www.twitter.com/*',
]

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

async function openProfileTab(handle: string): Promise<number | undefined> {
  const url = profileUrl(handle)
  const handlePath = `/${handle.replace(/^@/, '').trim().toLowerCase()}`
  const tabs = await chrome.tabs.query({ url: X_TAB_PATTERNS })
  const onProfile = tabs.find((tab) =>
    (tab.url ?? '').toLowerCase().includes(handlePath),
  )
  const tab = onProfile ?? tabs.find((item) => item.active) ?? tabs[0]
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { url, active: true })
    return tab.id
  }
  const created = await chrome.tabs.create({ url, active: true })
  return created.id
}

function step3Body(
  kind: BioWizardStep3Kind,
  otherNpub: string | undefined,
): ReactNode {
  switch (kind) {
    case 'ok':
      return (
        <>
          <p className={styles.statusRow} role="status">
            <span className={styles.stepCheck} aria-hidden="true">
              ✓
            </span>
            <span className={styles.statusText}>{t('bio.allGood')}</span>
          </p>
          <p className={styles.rationale}>{t('bio.alreadyDone')}</p>
        </>
      )
    case 'mismatch':
      return (
        <p className={styles.warning} role="status">
          {t('bio.mismatch', {
            npub: truncateNpubDisplay(otherNpub),
          })}
        </p>
      )
    case 'tooLong':
      return (
        <p className={styles.warning} role="status">
          {t('bio.tooLong')}
        </p>
      )
    case 'waiting':
      return (
        <p className={styles.hint} role="status">
          {t('bio.stepVerifyHint')}
        </p>
      )
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

export default function BioUpdateWizard({
  visible,
  onClose,
  handle,
  twitterId,
  bioOk,
  bioMismatch,
  activeNpub,
  onRecheck,
}: BioUpdateWizardProps) {
  const { shouldRender, animating } = useAnimatedVisible(visible)
  const [suggestion, setSuggestion] = useState<XBioEditPreview | null>(null)
  const [copied, setCopied] = useState(false)
  const [editMissing, setEditMissing] = useState(false)
  const [profileRequested, setProfileRequested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) {
      setSuggestion(null)
      setCopied(false)
      setEditMissing(false)
      setProfileRequested(false)
      setBusy(false)
      setError('')
      return
    }
    let cancelled = false
    void axRequest<XBioEditPreview>({
      type: 'PREPARE_X_BIO_EDIT',
      version: BACKGROUND_API_VERSION,
      handle,
      twitterId,
      confirmReplace: true,
      savedBioOnly: true,
    })
      .then((next) => {
        if (cancelled) return
        setSuggestion(next)
        setError('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('common.error'))
      })
    return () => {
      cancelled = true
    }
  }, [visible, handle, twitterId])

  if (!shouldRender) return null

  const suggested = suggestion?.suggestedBio || activeNpub?.trim() || ''
  const kind = bioWizardStep3({
    bioOk,
    bioMismatch,
    tooLong: suggestion?.tooLong === true,
  })

  const openProfile = () => {
    setBusy(true)
    setError('')
    setEditMissing(false)
    setProfileRequested(true)
    void openProfileTab(handle)
      .then(async (tabId) => {
        if (tabId == null) {
          setEditMissing(true)
          return
        }
        const result = await axRequest<OpenXProfileEditResult>({
          type: 'OPEN_X_PROFILE_EDIT',
          version: BACKGROUND_API_VERSION,
          tabId,
          handle,
        })
        if (result.status === 'not-found') setEditMissing(true)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('common.error'))
      })
      .finally(() => setBusy(false))
  }

  const checkAgain = () => {
    setBusy(true)
    setError('')
    void axRequest<IngestSavedXBioResult>({
      type: 'INGEST_SAVED_X_BIO',
      version: BACKGROUND_API_VERSION,
      handle,
      twitterId,
    })
      .then(() => onRecheck())
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('common.error'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <OverlayPanel
      title={t('bio.wizardTitle')}
      onBack={null}
      onClose={onClose}
      animating={animating}
      zIndex={400}
      className={styles.overlay}
    >
      <div className={styles.body}>
        {error ? (
          <p className={styles.warning} role="status">
            {error}
          </p>
        ) : null}

        <ol className={styles.steps}>
          <li className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber} aria-hidden="true">
                1
              </span>
              <span className={styles.stepTitle}>{t('bio.stepExplain')}</span>
            </div>
            <p className={styles.rationale}>{t('bio.stepExplainHint')}</p>
            {profileRequested && busy ? (
              <p className={styles.hint} role="status">
                {t('bio.opening')}
              </p>
            ) : null}
            {editMissing ? (
              <p className={styles.hint}>{t('bio.editMissing')}</p>
            ) : null}
            <div className={styles.actions}>
              <Button small disabled={busy} onClick={openProfile}>
                {t('bio.openProfile')}
              </Button>
            </div>
          </li>

          <li className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber} aria-hidden="true">
                2
              </span>
              <span className={styles.stepTitle}>{t('bio.stepSuggest')}</span>
            </div>
            <p className={styles.rationale}>{t('bio.stepSuggestHint')}</p>
            <label className={styles.label}>
              {t('bio.stepSuggest')}
              <textarea
                className={styles.textarea}
                rows={5}
                readOnly
                value={suggested}
                spellCheck={false}
              />
            </label>
            {suggested ? (
              <p className={styles.hint}>
                {suggested.length} / {X_BIO_MAX_CHARS}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button
                small
                disabled={!suggested}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(suggested)
                    .then(() => setCopied(true))
                    .catch(() => setError(t('bio.copyFailed')))
                }}
              >
                {copied ? t('bio.copied') : t('bio.copyText')}
              </Button>
            </div>
          </li>

          <li className={kind === 'ok' ? styles.stepOpen : styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber} aria-hidden="true">
                3
              </span>
              <span className={styles.stepTitle}>{t('bio.stepVerify')}</span>
            </div>
            {step3Body(kind, suggestion?.otherNpub)}
            <div className={styles.actions}>
              {kind !== 'ok' ? (
                <Button small disabled={busy} onClick={checkAgain}>
                  {t('bio.checkAgain')}
                </Button>
              ) : null}
              <Button small variant="secondary" onClick={onClose}>
                {t('bio.close')}
              </Button>
            </div>
          </li>
        </ol>
      </div>
    </OverlayPanel>
  )
}
