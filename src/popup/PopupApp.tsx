import React, { useState, useEffect } from 'react'
import browser from '@shared/browser.ts'
import { rpcNotify } from '@shared/rpc.ts'
import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
} from '@shared/contracts.ts'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  OPEN_NOTES_ON_LAUNCH_KEY,
  type SelectedSubjectSnapshot,
} from '@shared/selected-subject.ts'
import {
  buildGraphPageUrl,
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

type OverlayType = 'menu' | 'wizard' | null
type PanelBodyView = 'home' | 'notes'

interface WaiterInfo {
  id: string
  type: string
  origin: string
  [key: string]: unknown
}

function PopupInner() {
  const [splashVisible, setSplashVisible] = useState(true)
  const [unlockVisible, setUnlockVisible] = useState(false)
  const [unlockWaiters, setUnlockWaiters] = useState<WaiterInfo[]>([])
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null)
  const [menuInitialSection, setMenuInitialSection] = useState<string | null>(
    null,
  )
  const [bodyView, setBodyView] = useState<PanelBodyView>('home')
  const account = useAccount()
  const vault = useVault()
  const hasAccounts = (account.accounts?.length ?? 0) > 0

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
    const openNotes = (): void => {
      setBodyView('notes')
      void chrome.storage.session
        .remove(OPEN_NOTES_ON_LAUNCH_KEY)
        .catch(() => undefined)
    }

    void chrome.storage.session
      .get(OPEN_NOTES_ON_LAUNCH_KEY)
      .then((data: Record<string, unknown>) => {
        if (data[OPEN_NOTES_ON_LAUNCH_KEY]) openNotes()
      })
      .catch(() => undefined)

    const onMessage = (message: { type?: string }) => {
      if (message?.type === SELECTED_SUBJECT_CHANGED_MESSAGE) {
        openNotes()
      }
    }
    chrome.runtime.onMessage.addListener(onMessage)

    const onStorage = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== 'session') return
      if (changes[OPEN_NOTES_ON_LAUNCH_KEY]?.newValue) {
        openNotes()
      }
    }
    chrome.storage.onChanged.addListener(onStorage)

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      chrome.storage.onChanged.removeListener(onStorage)
    }
  }, [])

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

  const notesOpen = bodyView === 'notes'

  return (
    <TopoBg className={`${styles.card}${notesOpen ? ` ${styles.cardNotes}` : ''}`}>
      <Splash visible={splashVisible} />
      <div className={styles.stage}>
        {notesOpen ? (
          <div className={styles.coverDock}>
            <TopBar
              onCover
              onClose={() => setBodyView('home')}
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
          {notesOpen ? (
            <SubjectNotes
              onPath={() => openGraphPage('path')}
              onGraph={() => openGraphPage('graph')}
            />
          ) : (
            <HomeTab
              onOpenWizard={openWizard}
              onOpenBindings={(twitterId) =>
                openMenu(twitterId ? `bindings/${twitterId}` : 'bindings')
              }
            />
          )}
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
