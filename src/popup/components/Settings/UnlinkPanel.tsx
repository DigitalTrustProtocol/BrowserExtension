import { useCallback, useEffect, useState } from 'react'
import { rpc } from '@shared/rpc.ts'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type PublicExtensionState,
  type XIdentityClearPreview,
  type XIdentityClearResult,
  X_EDIT_PROFILE_URL,
} from '../../../shared/contracts'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionHint, SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from './SecuritySection.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

type UnlinkStep = 'bio' | 'clear10011' | 'local' | 'done'

interface UnlinkPanelProps {
  accountId: string
  accountLabel: string
  twitterId: string
  handle?: string | null
  onDone: () => void
  onCancel: () => void
}

/**
 * Staged Unlink: clear kind 10011 → suggest Bio strip → clear local sides → unbind.
 * Publish clear-10011 happens while still bound (assert requires binding).
 * Bio step never scrapes the content script — user removes npub on X manually.
 */
export default function UnlinkPanel({
  accountId,
  accountLabel,
  twitterId,
  handle,
  onDone,
  onCancel,
}: UnlinkPanelProps) {
  const [step, setStep] = useState<UnlinkStep>('clear10011')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clearPreview, setClearPreview] = useState<XIdentityClearPreview | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [activeNpub, setActiveNpub] = useState('')

  const resolvedHandle = handle?.replace(/^@/, '') || ''

  const loadClearPreview = useCallback(async () => {
    if (!resolvedHandle) {
      setStep('bio')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await axRequest<
        XIdentityClearPreview | { status: 'nothing-to-clear'; reason: string }
      >({
        type: 'PREPARE_X_IDENTITY_CLEAR',
        version: BACKGROUND_API_VERSION,
        handle: resolvedHandle,
        twitterId,
      })
      if ('status' in result && result.status === 'nothing-to-clear') {
        setClearPreview(null)
        setStep('bio')
        return
      }
      setClearPreview(result as XIdentityClearPreview)
      setStep('clear10011')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('bio')
    } finally {
      setBusy(false)
    }
  }, [resolvedHandle, twitterId])

  const goBioStep = useCallback(() => {
    setStep('bio')
    void axRequest<PublicExtensionState>({
      type: 'GET_STATE',
    })
      .then((s) => {
        if (typeof s.npub === 'string') setActiveNpub(s.npub)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void loadClearPreview()
  }, [loadClearPreview])

  const publishClear = async () => {
    if (!clearPreview || !resolvedHandle) return
    setBusy(true)
    setError('')
    try {
      const result = await axRequest<XIdentityClearResult>({
        type: 'CONFIRM_X_IDENTITY_CLEAR',
        version: BACKGROUND_API_VERSION,
        handle: resolvedHandle,
        twitterId,
        existingEventId: clearPreview.existingEventId,
      })
      if (result.status === 'stale-preview') {
        setClearPreview(result.preview)
        setError(result.reason)
        return
      }
      if (result.status === 'nothing-to-clear') {
        setClearPreview(null)
      }
      goBioStep()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const skipClear = () => {
    goBioStep()
  }

  const copyNpubAndOpen = async () => {
    setBusy(true)
    setError('')
    try {
      if (activeNpub) {
        await navigator.clipboard.writeText(activeNpub)
        setCopied(true)
      }
      window.open(X_EDIT_PROFILE_URL, '_blank', 'noopener,noreferrer')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const finishLocalUnlink = async () => {
    setBusy(true)
    setError('')
    try {
      await axRequest({
        type: 'CLEAR_X_IDENTITY_SIDES',
        version: BACKGROUND_API_VERSION,
        twitterId,
        bio: true,
        post: true,
        nip39: true,
      })
      await rpc('unbindAccountFromX', { accountId })
      setStep('done')
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <SectionLabel>
        {t('account.unlinkTitle', { name: accountLabel })}
      </SectionLabel>
      <SectionHint>{t('account.unlinkHint')}</SectionHint>
      {error ? <div className={styles.error}>{error}</div> : null}

      {step === 'clear10011' && clearPreview ? (
        <div className={styles.passwordSection}>
          <SectionHint>{t('account.unlinkClear10011Hint')}</SectionHint>
          <label className={styles.fieldLabel}>
            Kind 10011 clear preview
            <textarea
              className={styles.fieldTextarea}
              rows={5}
              readOnly
              value={JSON.stringify(clearPreview.eventPreview, null, 2)}
            />
          </label>
          <div className={styles.confirmActions}>
            <Button small disabled={busy} onClick={() => void publishClear()}>
              {busy ? t('common.saving') : t('account.unlinkPublishClear')}
            </Button>
            <Button
              small
              variant="secondary"
              disabled={busy}
              onClick={skipClear}
            >
              {t('account.unlinkSkip')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'bio' ? (
        <div className={styles.passwordSection}>
          <SectionHint>
            If your X bio still contains this account&apos;s npub, open Edit
            profile and remove it. AttentionX does not read or write the bio
            here.
          </SectionHint>
          {activeNpub ? (
            <label className={styles.fieldLabel}>
              Active npub (search in bio to remove)
              <textarea
                className={styles.fieldTextarea}
                rows={2}
                readOnly
                value={activeNpub}
              />
            </label>
          ) : null}
          <div className={styles.confirmActions}>
            <Button small disabled={busy} onClick={() => void copyNpubAndOpen()}>
              {copied
                ? t('account.unlinkBioCopied')
                : t('account.unlinkCopyBio')}
            </Button>
            <Button
              small
              variant="secondary"
              disabled={busy}
              onClick={() => setStep('local')}
            >
              {t('account.unlinkSkip')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'local' ? (
        <div className={styles.passwordSection}>
          <SectionHint>{t('account.unlinkLocalHint')}</SectionHint>
          <div className={styles.confirmActions}>
            <Button
              small
              disabled={busy}
              onClick={() => void finishLocalUnlink()}
            >
              {busy ? t('common.saving') : t('account.unlinkConfirm')}
            </Button>
            <Button
              small
              variant="secondary"
              disabled={busy}
              onClick={onCancel}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'clear10011' && !clearPreview && busy ? (
        <SectionHint>{t('common.loading')}</SectionHint>
      ) : null}
    </Card>
  )
}
