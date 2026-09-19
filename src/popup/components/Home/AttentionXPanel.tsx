import { useEffect, useState } from 'react'
import {
  BACKGROUND_API_VERSION,
  type AppMode,
  type CockpitState,
  type DemoWotStatus,
  type ExtensionRequest,
  type ExtensionResponse,
  type PublicExtensionState,
  type QueryTrustBatchResult,
  APP_MODE_STORAGE_KEY,
  DEFAULT_APP_MODE,
  parseAppMode,
} from '../../../shared/contracts'
import {
  DEMO_WOT_HOME_CHAIN,
  type DemoWotChainMember,
} from '../../../shared/demo-wot'
import { t } from '@lib/i18n.js'
import { usePanelSession } from '../../context/PanelSessionContext'
import { useAccount } from '../../context/AccountContext'
import { liveSetupIssues } from '../../../shared/operator-binding-status.ts'
import Button from '@components/Button/Button'
import Card from '@components/Card/Card'
import { SectionLabel } from '@components/SectionLabel/SectionLabel'
import styles from './AttentionXPanel.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

function InlineSpinner() {
  return <span className={styles.inlineSpinner} aria-hidden="true" />
}

function demoHomeLabel(member: DemoWotChainMember): string {
  return member.handle === 'elonmusk' ? 'Elon' : member.displayName
}

function openDemoUserPanel(twitterId: string): void {
  void axRequest({
    type: 'SELECT_SUBJECT',
    version: BACKGROUND_API_VERSION,
    subject: { type: 'i', value: `user:id:${twitterId}` },
  }).catch(() => undefined)
}

export default function AttentionXPanel(props: {
  onOpenIdentity?: () => void
}) {
  const { snapshot } = usePanelSession()
  const { operatorBindings } = useAccount()
  const [state, setState] = useState<PublicExtensionState>()
  const [cockpit, setCockpit] = useState<CockpitState>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [demoWotCount, setDemoWotCount] = useState(0)
  const [appMode, setAppMode] = useState<AppMode>(DEFAULT_APP_MODE)
  const [seedingDemo, setSeedingDemo] = useState(false)
  const [extensionStateReady, setExtensionStateReady] = useState(false)
  const [demoDegrees, setDemoDegrees] = useState<Record<string, number>>({})

  useEffect(() => {
    void axRequest<{ mode: AppMode }>({
      type: 'GET_APP_MODE',
      version: BACKGROUND_API_VERSION,
    })
      .then((result) => setAppMode(result.mode))
      .catch(() => undefined)
    void axRequest<DemoWotStatus>({
      type: 'GET_DEMO_WOT_STATUS',
      version: BACKGROUND_API_VERSION,
    })
      .then((status) => setDemoWotCount(status.eventCount))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void chrome.storage.local
      .get(APP_MODE_STORAGE_KEY)
      .then((data: Record<string, unknown>) => {
        if (data[APP_MODE_STORAGE_KEY] !== undefined) {
          setAppMode(parseAppMode(data[APP_MODE_STORAGE_KEY]))
        }
      })

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return
      const modeChange = changes[APP_MODE_STORAGE_KEY]
      if (modeChange) {
        setAppMode(parseAppMode(modeChange.newValue))
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const [next, nextCockpit] = await Promise.all([
          axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
          axRequest<CockpitState>({ type: 'GET_COCKPIT_STATE' }).catch(
            () => undefined,
          ),
        ])
        if (cancelled) return
        setState(next)
        if (nextCockpit) setCockpit(nextCockpit)
        setExtensionStateReady(true)
      } catch {
        if (cancelled) return
        setExtensionStateReady(true)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (appMode !== 'demo' || seedingDemo) return
    let cancelled = false
    void axRequest<QueryTrustBatchResult>({
      type: 'QUERY_TRUST_BATCH',
      version: BACKGROUND_API_VERSION,
      items: DEMO_WOT_HOME_CHAIN.map((member) => ({
        key: member.twitterId,
        subject: { type: 'i', value: `user:id:${member.twitterId}` },
      })),
    })
      .then((batch) => {
        if (cancelled) return
        const next: Record<string, number> = {}
        for (const member of DEMO_WOT_HOME_CHAIN) {
          const resolved = batch.results[member.twitterId]
          next[member.twitterId] =
            resolved?.connected === true ? resolved.degree : member.degree
        }
        setDemoDegrees(next)
      })
      .catch(() => {
        if (cancelled) return
        const fallback: Record<string, number> = {}
        for (const member of DEMO_WOT_HOME_CHAIN) {
          fallback[member.twitterId] = member.degree
        }
        setDemoDegrees(fallback)
      })
    return () => {
      cancelled = true
    }
  }, [appMode, seedingDemo, demoWotCount])

  const setAppModeAndRefresh = (mode: AppMode) => {
    setBusy(true)
    if (mode === 'demo') setSeedingDemo(true)
    setMessage(
      mode === 'demo' ? t('panel.switchingDemo') : t('panel.switchingLive'),
    )
    void axRequest<{ mode: AppMode; seeded: boolean }>({
      type: 'SET_APP_MODE',
      version: BACKGROUND_API_VERSION,
      mode,
    })
      .then(async (result) => {
        setAppMode(result.mode)
        const [status, next, nextCockpit] = await Promise.all([
          axRequest<DemoWotStatus>({
            type: 'GET_DEMO_WOT_STATUS',
            version: BACKGROUND_API_VERSION,
          }),
          axRequest<PublicExtensionState>({ type: 'GET_STATE' }),
          axRequest<CockpitState>({ type: 'GET_COCKPIT_STATE' }).catch(
            () => undefined,
          ),
        ])
        setDemoWotCount(status.eventCount)
        setState(next)
        if (nextCockpit) setCockpit(nextCockpit)
        if (result.mode === 'demo') {
          setMessage(
            result.seeded
              ? t('panel.demoOnSeeded', { count: status.eventCount })
              : t('panel.demoOn', { count: status.eventCount }),
          )
        } else {
          setMessage(t('panel.liveOn'))
        }
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : t('panel.modeSwitchFailed'),
        )
      })
      .finally(() => {
        setSeedingDemo(false)
        setBusy(false)
      })
  }

  const trustEvents =
    cockpit?.storage.eventsByKind['32009'] ?? state?.cachedEventCount ?? 0
  const xIdentities = cockpit?.storage.stores.xIdentities ?? 0
  const signedInBinding = operatorBindings.find((row) => row.signedIn)
  const liveSetupIncomplete =
    (snapshot?.appMode ?? appMode) === 'production' &&
    Boolean(
      signedInBinding && liveSetupIssues(signedInBinding.completeness).length > 0,
    )

  return (
    <Card
      className={`${styles.panel}${appMode === 'demo' ? ` ${styles.demoPanel}` : ''}`}
    >
      {liveSetupIncomplete && props.onOpenIdentity ? (
        <div className={styles.suggestStrip}>
          <Button
            small
            className={styles.bioSuggestButton}
            onClick={props.onOpenIdentity}
          >
            <span className={styles.bioSuggestLabel}>
              {t('account.completeSetup')}
            </span>
          </Button>
          <p className={styles.hint}>{t('account.completeSetupHint')}</p>
        </div>
      ) : null}

      <SectionLabel className={styles.modeHeadline}>
        {t('panel.mode')}
      </SectionLabel>
      {appMode === 'demo' ? (
        <p className={styles.demoBanner} role="status">
          {t('panel.demoBanner')}
        </p>
      ) : null}
      <p className={styles.hint}>
        {appMode === 'demo'
          ? t('panel.modeHintDemo')
          : t('panel.modeHintLive')}
      </p>
      <div className={styles.modeToggle} role="group" aria-label={t('panel.modeAria')}>
        <span className={styles.modeOptionWrap} title={t('panel.modeTitleLive')}>
          <button
            type="button"
            className={`${styles.modeOption}${appMode === 'production' ? ` ${styles.modeOptionActive}` : ''}`}
            disabled={busy || appMode === 'production'}
            aria-label={`${t('panel.modeLive')}. ${t('panel.modeTitleLive')}`}
            onClick={() => setAppModeAndRefresh('production')}
          >
            {t('panel.modeLive')}
          </button>
        </span>
        <span className={styles.modeOptionWrap} title={t('panel.modeTitleDemo')}>
          <button
            type="button"
            className={`${styles.modeOption}${appMode === 'demo' ? ` ${styles.modeOptionActive}` : ''}`}
            disabled={busy || appMode === 'demo'}
            aria-label={`${t('panel.modeDemo')}. ${t('panel.modeTitleDemo')}`}
            onClick={() => setAppModeAndRefresh('demo')}
          >
            {t('panel.modeDemo')}
          </button>
        </span>
      </div>

      {appMode === 'demo' ? (
        <>
          <SectionLabel>{t('panel.demoTrustData')}</SectionLabel>
          {seedingDemo ? (
            <div className={styles.seedingStatus} role="status" aria-live="polite">
              <div className={styles.spinner} aria-hidden="true" />
              <p className={styles.seedingText}>{t('justWorks.seeding')}</p>
              <p className={styles.hint}>{t('panel.seedingHint')}</p>
            </div>
          ) : extensionStateReady ? (
            <>
              <dl className={styles.stats}>
                <div>
                  <dt>{t('panel.demoEvents')}</dt>
                  <dd>{demoWotCount}</dd>
                </div>
                <div>
                  <dt>{t('panel.xIdentities')}</dt>
                  <dd>{xIdentities}</dd>
                </div>
              </dl>
              <ul className={styles.demoAccounts}>
                {DEMO_WOT_HOME_CHAIN.map((member) => {
                  const name = demoHomeLabel(member)
                  const degree = demoDegrees[member.twitterId] ?? member.degree
                  return (
                    <li key={member.twitterId}>
                      <button
                        type="button"
                        className={styles.demoAccount}
                        title={t('panel.demoOpenUser', { name })}
                        onClick={() => openDemoUserPanel(member.twitterId)}
                      >
                        <span className={styles.demoAccountName}>{name}</span>
                        <span className={styles.demoAccountDegree}>
                          {t('panel.demoDegree', { degree })}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className={`${styles.hint} ${styles.hintBusy}`} role="status">
              <InlineSpinner />
              {t('panel.loadingDemoData')}
            </p>
          )}
        </>
      ) : (
        <>
          <SectionLabel>{t('panel.liveTrustData')}</SectionLabel>
          {extensionStateReady ? (
            <dl className={styles.stats}>
              <div>
                <dt>{t('panel.trustStatements')}</dt>
                <dd>{trustEvents}</dd>
              </div>
              <div>
                <dt>{t('panel.xIdentities')}</dt>
                <dd>{xIdentities}</dd>
              </div>
            </dl>
          ) : (
            <p className={`${styles.hint} ${styles.hintBusy}`} role="status">
              <InlineSpinner />
              {t('panel.loadingLiveData')}
            </p>
          )}
        </>
      )}

      {message ? <p className={styles.message}>{message}</p> : null}
    </Card>
  )
}
