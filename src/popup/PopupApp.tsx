import React, { useState } from 'react'
import browser from '@shared/browser.ts'
import { rpcNotify } from '@shared/rpc.ts'
import { BACKGROUND_API_VERSION } from '@shared/contracts.ts'
import {
  buildGraphPageUrl,
  subjectNodeId,
  type GraphPageMode,
} from '@shared/graph-deeplink.ts'
import {
  isPanelMessageOnlyRoute,
  panelNotesBodyVisible,
  type PanelRoute,
  type PanelSessionSnapshot,
} from '../shared/panel-session.ts'
import { t } from '@lib/i18n.js'
import { isWritableNostrAccount } from '../accounts/x-binding.ts'
import '@shared/theme.css'
import styles from './PopupApp.module.css'
import { AccountProvider, useAccount } from './context/AccountContext'
import { VaultProvider } from './context/VaultContext'
import { PermissionsProvider } from './context/PermissionsContext'
import { SiteConnectionProvider, useSiteConnection } from './context/SiteConnectionContext'
import { PanelSessionProvider, usePanelSession } from './context/PanelSessionContext'
import { ViewerProvider } from './context/ViewerContext'
import TopoBg from '@components/TopoBg/TopoBg'
import Splash from '@components/Splash/Splash'
import Button from '@components/Button/Button'
import TopBar from './components/TopBar/TopBar'
import HomeTab, {
  AfterKeyClearPanel,
  DemoChoicePanel,
  PanelEmpty,
  XUnboundGate,
} from './components/Home/HomeTab'
import SubjectNotes from './components/Home/SubjectNotes'
import MenuOverlay from './components/Menu/MenuOverlay'
import ApprovalOverlay from './components/Approval/ApprovalOverlay'
import WizardOverlay from './components/Wizard/WizardOverlay'
import UnlockModal from './components/Vault/UnlockModal'

type OverlayType = 'menu' | 'wizard' | null

interface WaiterInfo {
  id: string
  type: string
  origin: string
  [key: string]: unknown
}

function closePanelNotes(): void {
  void chrome.runtime.sendMessage({ type: 'CLOSE_PANEL_NOTES' }).catch(
    () => undefined,
  )
}

function MessageOnlyBody({ snapshot }: { snapshot: PanelSessionSnapshot }) {
  const route: PanelRoute = snapshot.route
  switch (route) {
    case 'unsupportedSite':
    case 'noSite':
    case 'offXHome':
      return (
        <PanelEmpty
          text={t('home.unsupportedSite')}
          hint={t('home.unsupportedSiteHint')}
        />
      )
    case 'xLoggedOut':
      return (
        <PanelEmpty
          text={t('home.xLoggedOut')}
          hint={t('home.xLoggedOutHint')}
        />
      )
    case 'xUnknown':
      return (
        <PanelEmpty
          text={t('account.resolvingXId')}
          hint={t('account.missingXId')}
        >
          <Button
            small
            onClick={() => {
              void chrome.runtime
                .sendMessage({
                  type: 'ENSURE_ACTIVE_X_ACCOUNT',
                  version: BACKGROUND_API_VERSION,
                })
                .catch(() => undefined)
            }}
          >
            {t('home.retry')}
          </Button>
        </PanelEmpty>
      )
    default:
      return (
        <PanelEmpty
          text={t('home.unsupportedSite')}
          hint={t('home.unsupportedSiteHint')}
        />
      )
  }
}

function PanelRouteBody({
  snapshot,
  onOpenWizard,
  onOpenLiveWizard,
  onOpenBindings,
}: {
  snapshot: PanelSessionSnapshot
  onOpenWizard: () => void
  onOpenLiveWizard: () => void
  onOpenBindings: (twitterId?: string) => void
}) {
  const { domain, connect } = useSiteConnection()
  const route: PanelRoute = snapshot.route
  switch (route) {
    case 'unsupportedSite':
    case 'noSite':
    case 'offXHome':
    case 'xLoggedOut':
    case 'xUnknown':
      return <MessageOnlyBody snapshot={snapshot} />
    case 'integrity':
      return (
        <PanelEmpty
          text={t('common.error')}
          hint={t('home.siteInfoError')}
        />
      )
    case 'unlock':
    case 'firstRun':
      return null
    case 'justWorks':
      return (
        <PanelEmpty
          text={t('justWorks.settingUp')}
          hint={t('justWorks.settingUpHint')}
        />
      )
    case 'demoChoice':
      return <DemoChoicePanel onOpenLive={onOpenLiveWizard} />
    case 'afterKeyClear':
      return <AfterKeyClearPanel onOpenWizard={onOpenWizard} />
    case 'siteDisconnected':
      return (
        <PanelEmpty
          text={domain ?? ''}
          hint={t('home.siteNotConnected')}
        >
          <Button small onClick={() => void connect()}>
            {t('home.connectSite')}
          </Button>
        </PanelEmpty>
      )
    case 'xUnbound':
      return (
        <XUnboundGate
          onOpenWizard={onOpenWizard}
          onOpenBindings={onOpenBindings}
        />
      )
    case 'xHome':
      return (
        <HomeTab
          onOpenIdentity={() =>
            onOpenBindings(
              snapshot.x.kind === 'identified'
                ? snapshot.x.twitterId
                : undefined,
            )
          }
          onOpenLiveWizard={onOpenLiveWizard}
        />
      )
    default: {
      const _exhaustive: never = route
      return _exhaustive
    }
  }
}

function PopupInner() {
  const [unlockVisible, setUnlockVisible] = useState(false)
  const [unlockWaiters, setUnlockWaiters] = useState<WaiterInfo[]>([])
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null)
  const [wizardLiveIntent, setWizardLiveIntent] = useState(false)
  const [menuInitialSection, setMenuInitialSection] = useState<string | null>(
    null,
  )
  const account = useAccount()
  const { snapshot } = usePanelSession()
  const notesOpen = snapshot ? panelNotesBodyVisible(snapshot) : false
  const unlockFromRoute = snapshot?.route === 'unlock'
  const wizardFromRoute = snapshot?.route === 'firstRun'
  const hasRealAccounts = (account.accounts ?? []).some((row) =>
    isWritableNostrAccount(row),
  )

  const handleWizardComplete = () => {
    const goLive = wizardLiveIntent
    setWizardLiveIntent(false)
    setActiveOverlay(null)
    account.reload()
    rpcNotify('configUpdated')
    if (goLive) {
      void chrome.runtime
        .sendMessage({
          type: 'SET_APP_MODE',
          version: BACKGROUND_API_VERSION,
          mode: 'production',
        })
        .catch(() => undefined)
    }
  }

  const openGraphPage = (mode: GraphPageMode): void => {
    const subject = snapshot?.intent.selected?.subject
    if (mode === 'path' && !subject) return
    const focus = subject ? subjectNodeId(subject) : undefined
    const url =
      buildGraphPageUrl({
        mode,
        ...(subject && focus ? { subject, focus } : {}),
        baseUrl: browser.runtime.getURL('src/cockpit/index.html'),
      }) || '?'
    void browser.runtime.sendMessage({
      type: 'OPEN_GRAPH_PAGE',
      version: BACKGROUND_API_VERSION,
      url,
    })
  }

  const openWizard = () => {
    setWizardLiveIntent(false)
    setActiveOverlay('wizard')
  }

  const openLiveWizard = () => {
    setWizardLiveIntent(true)
    setActiveOverlay('wizard')
  }

  const openMenu = (section?: string) => {
    setMenuInitialSection(section ?? null)
    setActiveOverlay('menu')
  }

  const closeMenu = () => {
    setActiveOverlay(null)
    setMenuInitialSection(null)
  }

  return (
    <TopoBg className={`${styles.card}${notesOpen ? ` ${styles.cardNotes}` : ''}`}>
      <div className={styles.stage}>
        {notesOpen ? (
          <div className={styles.coverDock}>
            <TopBar
              onCover
              onClose={closePanelNotes}
              onMenu={() => openMenu()}
              onOpenIdentity={() => openMenu(account.identityMenuSection)}
            />
          </div>
        ) : (
          <TopBar
            onMenu={() => openMenu()}
            onOpenIdentity={() => openMenu(account.identityMenuSection)}
          />
        )}
        <div className={styles.scrollArea}>
          {snapshot && notesOpen ? (
            <SubjectNotes
              selected={snapshot.intent.selected}
              canGoBack={snapshot.intent.canBack}
              canGoForward={snapshot.intent.canForward}
              onPath={() => openGraphPage('path')}
              onGraph={() => openGraphPage('graph')}
            />
          ) : snapshot ? (
            <PanelRouteBody
              snapshot={snapshot}
              onOpenWizard={openWizard}
              onOpenLiveWizard={openLiveWizard}
              onOpenBindings={(twitterId) =>
                openMenu(twitterId ? `bindings/${twitterId}` : 'bindings')
              }
            />
          ) : null}
        </div>
      </div>

      <ApprovalOverlay
        onRequestUnlock={() => setUnlockVisible(true)}
        onUnlockWaitersChange={setUnlockWaiters}
      />

      <MenuOverlay
        visible={activeOverlay === 'menu'}
        onClose={closeMenu}
        initialSection={menuInitialSection}
        onOpenWizard={openWizard}
      />

      <WizardOverlay
        visible={wizardFromRoute || activeOverlay === 'wizard'}
        canClose={!wizardFromRoute}
        hasAccounts={hasRealAccounts}
        onClose={() => {
          setWizardLiveIntent(false)
          setActiveOverlay(null)
        }}
        onComplete={handleWizardComplete}
      />

      <UnlockModal
        visible={unlockFromRoute || unlockVisible}
        fullScreen={unlockFromRoute}
        unlockWaiters={unlockWaiters}
        onUnlocked={() => setUnlockVisible(false)}
        onCancel={unlockFromRoute ? undefined : () => setUnlockVisible(false)}
      />
    </TopoBg>
  )
}

function PopupDirector() {
  const { snapshot } = usePanelSession()
  if (!snapshot) {
    return (
      <TopoBg className={styles.card}>
        <Splash visible />
      </TopoBg>
    )
  }
  if (isPanelMessageOnlyRoute(snapshot.route)) {
    return (
      <TopoBg className={styles.card}>
        <div className={styles.stage}>
          <div className={styles.scrollArea}>
            <MessageOnlyBody snapshot={snapshot} />
          </div>
        </div>
      </TopoBg>
    )
  }
  return (
    <AccountProvider>
      <VaultProvider>
        <PermissionsProvider>
          <SiteConnectionProvider>
            <PopupInner />
          </SiteConnectionProvider>
        </PermissionsProvider>
      </VaultProvider>
    </AccountProvider>
  )
}

export default function PopupApp() {
  return (
    <PanelSessionProvider>
      <ViewerProvider>
        <PopupDirector />
      </ViewerProvider>
    </PanelSessionProvider>
  )
}
