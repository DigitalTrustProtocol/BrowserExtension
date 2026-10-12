import { useEffect, useState } from 'react'
import { t } from '@lib/i18n.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type GraphServerHandshake,
  type GraphServerState,
} from '../../../shared/contracts'
import {
  DEFAULT_GRAPH_SERVER_URL,
  PERSONAL_GRAPH_SERVER_URL,
  graphServerPermissionOrigin,
  isBuiltinGraphServer,
  normalizeGraphServerUrl,
} from '../../../shared/server-list'
import Button from '@components/Button/Button'
import InputRow from '@components/InputRow/InputRow'
import RemoveButton from '@components/RemoveButton/RemoveButton'
import StatusDot from '@components/StatusDot/StatusDot'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from './Settings.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

type RowHealth = { status: 'checking' } | GraphServerHandshake

function dotStatus(health: RowHealth | undefined): string {
  if (!health || health.status === 'checking') return 'checking'
  if (health.status === 'up') return 'reachable'
  return 'unreachable'
}

function serverLabel(url: string): string {
  if (url === DEFAULT_GRAPH_SERVER_URL) return t('server.publicName')
  if (url === PERSONAL_GRAPH_SERVER_URL) return t('server.personalName')
  return url
}

function healthText(health: RowHealth | undefined): string {
  if (!health || health.status === 'checking') return t('server.checking')
  if (health.status === 'up') {
    const version =
      health.graphVersion !== undefined ? ` · ${health.graphVersion}` : ''
    const readOnly = health.restrictedWrites ? ` · ${t('server.readOnly')}` : ''
    return `${t('server.up')}${version}${readOnly}`
  }
  return health.error
    ? t('network.relayDownWithError', { error: health.error })
    : t('server.down')
}

async function ensureOriginPermission(url: string): Promise<boolean> {
  if (isBuiltinGraphServer(url)) return true
  const permissions = chrome.permissions
  if (!permissions?.contains || !permissions.request) return true
  const origin = graphServerPermissionOrigin(url)
  if (await permissions.contains({ origins: [origin] })) return true
  return permissions.request({ origins: [origin] })
}

export default function ServerSection() {
  const [selected, setSelected] = useState(DEFAULT_GRAPH_SERVER_URL)
  const [servers, setServers] = useState<GraphServerState['servers']>([])
  const [health, setHealth] = useState<Record<string, RowHealth>>({})
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const check = async (url: string) => {
    setHealth((current) => ({ ...current, [url]: { status: 'checking' } }))
    try {
      const result = await axRequest<GraphServerHandshake>({
        type: 'HANDSHAKE_GRAPH_SERVER',
        version: BACKGROUND_API_VERSION,
        url,
      })
      setHealth((current) => ({ ...current, [url]: result }))
    } catch (handshakeError) {
      setHealth((current) => ({
        ...current,
        [url]: {
          url,
          status: 'down',
          error:
            handshakeError instanceof Error
              ? handshakeError.message
              : t('server.down'),
        },
      }))
    }
  }

  useEffect(() => {
    let cancelled = false
    void axRequest<GraphServerState>({
      type: 'GET_GRAPH_SERVERS',
      version: BACKGROUND_API_VERSION,
    })
      .then((state) => {
        if (cancelled) return
        setSelected(state.selected)
        setServers(state.servers)
        for (const row of state.servers) void check(row.url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const select = (url: string) => {
    if (url === selected) return
    setSelected(url)
    setError('')
    void axRequest<GraphServerState>({
      type: 'SET_GRAPH_SERVER',
      version: BACKGROUND_API_VERSION,
      url,
    })
      .then((state) => {
        setSelected(state.selected)
        setServers(state.servers)
      })
      .catch((selectError: unknown) => {
        setError(selectError instanceof Error ? selectError.message : t('server.down'))
      })
    void check(url)
  }

  const add = () => {
    const url = normalizeGraphServerUrl(draft)
    if (!url) {
      setError(t('server.invalidUrl'))
      return
    }
    void ensureOriginPermission(url).then((granted) => {
      if (!granted) {
        setError(t('server.permissionDenied'))
        return
      }
      void axRequest<GraphServerState>({
        type: 'ADD_GRAPH_SERVER',
        version: BACKGROUND_API_VERSION,
        url,
      })
        .then((state) => {
          setSelected(state.selected)
          setServers(state.servers)
          setDraft('')
          setError('')
          void check(url)
        })
        .catch((addError: unknown) => {
          setError(addError instanceof Error ? addError.message : t('server.invalidUrl'))
        })
    })
  }

  const remove = (url: string) => {
    void axRequest<GraphServerState>({
      type: 'REMOVE_GRAPH_SERVER',
      version: BACKGROUND_API_VERSION,
      url,
    })
      .then((state) => {
        setSelected(state.selected)
        setServers(state.servers)
      })
      .catch((removeError: unknown) => {
        setError(removeError instanceof Error ? removeError.message : t('server.down'))
      })
  }

  return (
    <div className={`${styles.section} ${styles.networkSection}`}>
      <SectionLabel>{t('server.title')}</SectionLabel>
      <p className={styles.hint}>{t('server.hint')}</p>
      <div className={`${styles.relayList} ${styles.relayListActive}`} role="radiogroup" aria-label={t('server.title')}>
        {servers.map((row) => {
          const active = row.url === selected
          const rowHealth = health[row.url]
          return (
            <div key={row.url} className={styles.relayRow}>
              <span className={styles.relayStatus} title={healthText(rowHealth)}>
                <StatusDot status={dotStatus(rowHealth)} />
              </span>
              <button
                type="button"
                className={styles.serverPick}
                role="radio"
                aria-checked={active}
                onClick={() => select(row.url)}
              >
                <span className={styles.relayUrl}>
                  {row.builtin ? serverLabel(row.url) : row.url}
                </span>
                <span className={styles.relayScore}>
                  {row.builtin ? row.url : healthText(rowHealth)}
                  {row.builtin ? ` · ${healthText(rowHealth)}` : ''}
                </span>
              </button>
              {active ? (
                <Button small variant="primary" disabled aria-pressed="true">
                  {t('network.relayOn')}
                </Button>
              ) : (
                <Button small variant="secondary" onClick={() => select(row.url)}>
                  {t('network.relayOff')}
                </Button>
              )}
              {!row.builtin ? (
                <RemoveButton
                  label={t('server.remove', { url: row.url })}
                  onClick={() => remove(row.url)}
                />
              ) : null}
            </div>
          )
        })}
      </div>
      <InputRow
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setError('')
        }}
        placeholder={t('server.placeholder')}
        onSubmit={add}
        buttonLabel={t('common.add')}
        error={error}
        mono
      />
    </div>
  )
}
