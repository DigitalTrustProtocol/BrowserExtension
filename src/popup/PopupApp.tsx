import React, { useState } from 'react'
import browser from '@shared/browser.ts'
import { rpcNotify } from '@shared/rpc.ts'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
} from '@shared/contracts.ts'
import type { SelectedSubjectSnapshot } from '@shared/selected-subject.ts'
import {
  buildGraphPageUrl,
  subjectNodeId,
  type GraphPageMode,
} from '@shared/graph-deeplink.ts'
import type { TrustSubject } from '../graph'
import {
  panelNotesBodyVisible,
  type PanelRoute,
  type PanelSessionSnapshot,
} from '../shared/panel-session.ts'
import { t } from '@lib/i18n.js'
import '@shared/theme.css'
import styles from './PopupApp.module.css'
import { AccountProvider, useAccount } from './context/AccountContext'
import { VaultProvider } from './context/VaultContext'
import { PermissionsProvider } from './context/PermissionsContext'
import { SiteConnectionProvider, useSiteConnection } from './context/SiteConnectionContext'
import { PanelSessionProvider, usePanelSession } from './context/PanelSessionContext'
import TopoBg from '@components/TopoBg/TopoBg'
import Splash from '@components/Splash/Splash'
import Button from '@components/Button/Button'
import TopBar from './components/TopBar/TopBar'
import HomeTab, {
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

function PanelRouteBody({
  snapshot,
  onOpenWizard,
  onOpenBindings,
}: {
  snapshot: PanelSessionSnapshot
  onOpenWizard: () => void
  onOpenBindings: (twitterId?: string) => void
}) {
  const { domain, connect } = useSiteConnection()
  const route: PanelRoute = snapshot.route
  switch (route) {
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
    case 'afterKeyClear':
      return (
        <PanelEmpty
          text={t('topbar.addToStart')}
          hint={t('wizard.chooseSetup')}
        >
          <Button small onClick={onOpenWizard}>
            {t('wizard.addAccount')}
          </Button>
        </PanelEmpty>
      )
    case 'noSite':
      return (
        <PanelEmpty
          text={t('home.navigateToConnect')}
          hint={t('home.siteControlsHint')}
        />
      )
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
    case 'offXHome':
      return <HomeTab surface="offXHome" />
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
                .then(() =>
                  chrome.runtime.sendMessage({ type: 'GET_PANEL_SESSION' }),
                )
                .catch(() => undefined)
            }}
          >
            {t('home.retry')}
          </Button>
        </PanelEmpty>
      )
    case 'xLoggedOut':
      return (
        <PanelEmpty
          text={t('account.openXToUse')}
          hint={t('account.missingXId')}
        />
      )
    case 'xUnbound':
      return (
        <XUnboundGate
          onOpenWizard={onOpenWizard}
          onOpenBindings={onOpenBindings}
        />
      )
    case 'xHome':
      return <HomeTab surface="xHome" />
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
  const [menuInitialSection, setMenuInitialSection] = useState<string | null>(
    null,
  )
  const account = useAccount()
  const { snapshot } = usePanelSession()
  const notesOpen = snapshot ? panelNotesBodyVisible(snapshot) : false
  const unlockFromRoute = snapshot?.route === 'unlock'
  const wizardFromRoute = snapshot?.route === 'firstRun'

  const handleWizardComplete = () => {
    setActiveOverlay(null)
    account.reload()
    rpcNotify('configUpdated')
  }

  const openGraphPage = (mode: GraphPageMode): void => {
    void (async () => {
      let subject: TrustSubject | undefined =
        snapshot?.intent.selected?.subject
      if (!subject) {
        try {
          const response = (await chrome.runtime.sendMessage({
            type: 'GET_SELECTED_SUBJECT',
            version: BACKGROUND_API_VERSION,
          })) as ExtensionResponse<SelectedSubjectSnapshot>
          if (response.ok) subject = response.data.selected?.subject
        } catch {
          subject = undefined
        }
      }
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
    })()
  }

  const openWizard = () => {
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
      <Splash visible={!snapshot} />
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
        onClose={() => setActiveOverlay(null)}
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

export default function PopupApp() {
  return (
    <PanelSessionProvider>
      <AccountProvider>
        <VaultProvider>
          <PermissionsProvider>
            <SiteConnectionProvider>
              <PopupInner />
            </SiteConnectionProvider>
          </PermissionsProvider>
        </VaultProvider>
      </AccountProvider>
    </PanelSessionProvider>
  )
}
