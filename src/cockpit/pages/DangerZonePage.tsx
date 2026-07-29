import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import {
  BACKGROUND_API_VERSION,
  type DeleteUserDataMode,
  type DeleteUserDataResult,
  type ExtensionRequest,
  type ExtensionResponse,
} from '../../shared/contracts'
import { t } from '@lib/i18n.js'
import Card from '@components/Card/Card'
import Input from '@components/Input/Input'
import Button from '@components/Button/Button'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import styles from '../CockpitApp.module.css'
import dangerStyles from './DangerZonePage.module.css'

const DELETE_CONFIRM_PHRASE = 'DELETE ME'

const DELETE_OPTIONS: Array<{
  value: DeleteUserDataMode
  labelKey: string
  descKey: string
}> = [
  {
    value: 'all',
    labelKey: 'security.deleteAll',
    descKey: 'security.deleteAllDesc',
  },
  {
    value: 'keys',
    labelKey: 'security.deleteKeys',
    descKey: 'security.deleteKeysDesc',
  },
  {
    value: 'cache',
    labelKey: 'security.deleteCache',
    descKey: 'security.deleteCacheDesc',
  },
]

async function deleteUserData(
  mode: DeleteUserDataMode,
): Promise<DeleteUserDataResult> {
  const request: ExtensionRequest = {
    type: 'DELETE_USER_DATA',
    version: BACKGROUND_API_VERSION,
    mode,
  }
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<DeleteUserDataResult>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export default function DangerZonePage() {
  const [deleteMode, setDeleteMode] = useState<DeleteUserDataMode>('all')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteDone, setDeleteDone] = useState(false)

  const confirmMatches =
    deleteConfirm.trim().toUpperCase() === DELETE_CONFIRM_PHRASE
  const selectedDeleteOption =
    DELETE_OPTIONS.find((opt) => opt.value === deleteMode) ?? DELETE_OPTIONS[0]!

  const handleDelete = async () => {
    if (!confirmMatches || deleteLoading) return
    setDeleteLoading(true)
    setDeleteError('')
    setDeleteDone(false)
    try {
      await deleteUserData(deleteMode)
      setDeleteConfirm('')
      if (deleteMode === 'cache') {
        setDeleteDone(true)
      } else {
        window.location.reload()
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('common.error'))
    }
    setDeleteLoading(false)
  }

  return (
    <section className={styles.section}>
      <Card className={dangerStyles.dangerCard}>
        <SectionLabel>{t('security.dangerZone')}</SectionLabel>
        <SectionHint>{t('security.dangerZoneDesc')}</SectionHint>

        <div
          className={dangerStyles.deleteOptions}
          role="radiogroup"
          aria-label={t('security.dangerZone')}
        >
          {DELETE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`${dangerStyles.deleteOption} ${
                deleteMode === opt.value ? dangerStyles.deleteOptionActive : ''
              }`}
            >
              <input
                type="radio"
                name="delete-mode"
                value={opt.value}
                checked={deleteMode === opt.value}
                onChange={() => {
                  setDeleteMode(opt.value)
                  setDeleteError('')
                  setDeleteDone(false)
                }}
              />
              <span className={dangerStyles.deleteOptionBody}>
                <span className={dangerStyles.deleteOptionLabel}>
                  {t(opt.labelKey)}
                </span>
                <span className={dangerStyles.deleteOptionDesc}>
                  {t(opt.descKey)}
                </span>
              </span>
            </label>
          ))}
        </div>

        <p className={dangerStyles.deleteConfirmHint}>
          {t('security.deleteConfirmHint', { phrase: DELETE_CONFIRM_PHRASE })}
        </p>
        <Input
          type="text"
          placeholder={DELETE_CONFIRM_PHRASE}
          value={deleteConfirm}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setDeleteConfirm(e.target.value)
            setDeleteError('')
            setDeleteDone(false)
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && confirmMatches) void handleDelete()
          }}
          autoComplete="off"
        />
        {deleteError ? (
          <div className={dangerStyles.error}>{deleteError}</div>
        ) : null}
        {deleteDone ? (
          <div className={dangerStyles.deleteSuccess}>
            {t('security.deleteCacheDone')}
          </div>
        ) : null}
        <div className={dangerStyles.confirmActions}>
          <Button
            variant="danger"
            small
            onClick={() => void handleDelete()}
            disabled={!confirmMatches || deleteLoading}
          >
            {deleteLoading
              ? t('common.removing')
              : t(selectedDeleteOption.labelKey)}
          </Button>
        </div>
      </Card>
    </section>
  )
}
