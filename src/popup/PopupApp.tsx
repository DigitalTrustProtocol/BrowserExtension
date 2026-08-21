import React, { useState, useEffect, useCallback } from 'react'
import browser from '@shared/browser.ts'
import { rpcNotify } from '@shared/rpc.ts'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
} from '@shared/contracts.ts'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  type SelectedSubjectSnapshot,
} from '@shared/selected-subject.ts'
import {
  buildGraphPageUrl,
  GRAPH_FOCUS_MESSAGE,
  subjectNodeId,
  type GraphPageMode,
} from '@shared/graph-deeplink.ts'
import type { TrustSubject } from '../graph'
import '@shared/theme.css'
import styles from './PopupApp.module.css'
import { AccountProvider, useAccount } from './context/AccountContext'
import { VaultProvider, useVault } from './context/VaultContext'
import { PermissionsProvider } from './context/PermissionsContext'
import { SiteConnectionProvider } from './context/SiteConnectionContext'
import TopoBg from '@components/TopoBg/TopoBg'
import Splash from '@components/Splash/Splash'
import TopBar from './components/TopBar/TopBar'
import HomeTab from './components/Home/HomeTab'
import SubjectNotes from './components/Home/SubjectNotes'
import MenuOverlay from './components/Menu/MenuOverlay'
import ApprovalOverlay from './components/Approval/ApprovalOverlay'
import WizardOverlay from './components/Wizard/WizardOverlay'
import UnlockModal from './components/Vault/UnlockModal'
import PanelFooter, {
  type PanelBodyView,
} from './components/Shell/PanelFooter'

interface WaiterInfo {
  id: string
  type: string
  origin: string
  [key: string]: unknown
}

type OverlayType = 'menu' | 'wizard' | null

function PopupInner() {
  const [splashVisible, setSplashVisible] = useState(true)
  const [unlockVisible, setUnlockVisible] = useState(false)
  const [unlockWaiters, setUnlockWaiters] = useState<WaiterInfo[]>([])
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null)
  const [bodyView, setBodyView] = useState<PanelBodyView>('home')
  const [pathEnabled, setPathEnabled] = useState(false)
  const account = useAccount()
  const vault = useVault()
  const hasAccounts = (account.accounts?.length ?? 0) > 0

  const refreshPathEnabled = useCallback(async (): Promise<void> => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_SELECTED_SUBJECT',
        version: BACKGROUND_API_VERSION,
      })) as ExtensionResponse<SelectedSubjectSnapshot>
      setPathEnabled(Boolean(response.ok && response.data.selected?.subject))
    } catch {
      setPathEnabled(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), 600)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (account.accounts !== null && account.accounts.length === 0) {
      setActiveOverlay('wizard')
    }
  }, [account.accounts])

  useEffect(() => {
    browser.storage.session
      .get('wizardState')
      .then((data: Record<string, unknown>) => {
        const saved = data.wizardState as
          | { step?: string; ts?: number }
          | undefined
        if (
          saved?.step &&
          saved?.ts &&
          Date.now() - saved.ts < 5 * 60 * 1000
        ) {
          // Resume first-run only when no accounts exist yet.
          if (account.accounts !== null && account.accounts.length === 0) {
            setActiveOverlay('wizard')
          }
        }
      })
      .catch(() => {})
  }, [account.accounts])

  useEffect(() => {
    void refreshPathEnabled()
    const onMessage = (message: { type?: string }) => {
      if (message?.type === SELECTED_SUBJECT_CHANGED_MESSAGE) {
        setBodyView('notes')
        void refreshPathEnabled()
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [refreshPathEnabled])

  const vaultLockScreen = vault.exists && vault.locked && vault.autoLockEnabled

  const handleWizardComplete = () => {
    setActiveOverlay(null)
    account.reload()
    rpcNotify('configUpdated')
  }

  const openGraphPage = (mode: GraphPageMode): void => {
    void (async () => {
      let subject: TrustSubject | undefined
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'GET_SELECTED_SUBJECT',
          version: BACKGROUND_API_VERSION,
        })) as ExtensionResponse<SelectedSubjectSnapshot>
        if (response.ok) subject = response.data.selected?.subject
      } catch {
        subject = undefined
      }
      if (mode === 'path' && !subject) return
      const focus = subject ? subjectNodeId(subject) : undefined
      if (mode === 'graph' && focus) {
        void browser.runtime.sendMessage({
          type: GRAPH_FOCUS_MESSAGE,
          focus,
        })
      }
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

  const openFirstRunWizard = () => {
    if (!hasAccounts) setActiveOverlay('wizard')
  }

  const notesOpen = bodyView === 'notes'

  return (
    <TopoBg className={`${styles.card}${notesOpen ? ` ${styles.cardNotes}` : ''}`}>
      <Splash visible={splashVisible} />
      <div className={styles.stage}>
        {notesOpen ? (
          <div className={styles.coverDock}>
            <TopBar
              onCover
              onAddAccount={openFirstRunWizard}
              onClose={() => setBodyView('home')}
            />
          </div>
        ) : (
          <TopBar />
        )}
        <div className={styles.scrollArea}>
          {notesOpen ? (
            <SubjectNotes />
          ) : (
            <HomeTab onOpenWizard={openFirstRunWizard} />
          )}
        </div>
      </div>

      <PanelFooter
        pathEnabled={pathEnabled}
        onPath={() => openGraphPage('path')}
        onGraph={() => openGraphPage('graph')}
        onMenu={() => setActiveOverlay('menu')}
      />

      <ApprovalOverlay
        onRequestUnlock={() => setUnlockVisible(true)}
        onUnlockWaitersChange={setUnlockWaiters}
      />

      <MenuOverlay
        visible={activeOverlay === 'menu'}
        onClose={() => setActiveOverlay(null)}
        onOpenWizard={hasAccounts ? undefined : openFirstRunWizard}
      />

      <WizardOverlay
        visible={activeOverlay === 'wizard'}
        canClose={hasAccounts}
        onClose={() => setActiveOverlay(null)}
        onComplete={handleWizardComplete}
      />

      <UnlockModal
        visible={vaultLockScreen || unlockVisible}
        fullScreen={vaultLockScreen}
        unlockWaiters={unlockWaiters}
        onUnlocked={() => setUnlockVisible(false)}
        onCancel={vaultLockScreen ? undefined : () => setUnlockVisible(false)}
      />
    </TopoBg>
  )
}

export default function PopupApp() {
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
