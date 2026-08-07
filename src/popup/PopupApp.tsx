import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { rpcNotify } from '@shared/rpc.ts';
import '@shared/theme.css';
import styles from './PopupApp.module.css';
import { AccountProvider, useAccount } from './context/AccountContext';
import { VaultProvider, useVault } from './context/VaultContext';
import { PermissionsProvider } from './context/PermissionsContext';
import { SiteConnectionProvider } from './context/SiteConnectionContext';
import TopoBg from '@components/TopoBg/TopoBg';
import Splash from '@components/Splash/Splash';
import TopBar from './components/TopBar/TopBar';
import HomeTab from './components/Home/HomeTab';
import MenuOverlay from './components/Menu/MenuOverlay';
import ApprovalOverlay from './components/Approval/ApprovalOverlay';
import WizardOverlay from './components/Wizard/WizardOverlay';
import EditProfileOverlay from './components/EditProfile/EditProfileOverlay';
import UnlockModal from './components/Vault/UnlockModal';

interface WaiterInfo {
  id: string;
  type: string;
  origin: string;
  [key: string]: unknown;
}

type OverlayType = 'menu' | 'wizard' | 'editProfile' | null;

function PopupInner() {
  const [splashVisible, setSplashVisible] = useState<boolean>(true);
  const [unlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [unlockWaiters, setUnlockWaiters] = useState<WaiterInfo[]>([]);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const account = useAccount();
  const vault = useVault();

  useEffect(() => {
    browser.tabs.captureVisibleTab({ format: 'jpeg', quality: 20 })
      .then((dataUrl: string) => setScreenshot(dataUrl))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (account.accounts !== null && account.accounts.length === 0) {
      setActiveOverlay('wizard');
    }
  }, [account.accounts]);

  useEffect(() => {
    browser.storage.session.get('wizardState')
      .then((data: Record<string, unknown>) => {
        const saved = data.wizardState as { step?: string; ts?: number } | undefined;
        if (saved?.step && saved?.ts && Date.now() - saved.ts < 5 * 60 * 1000) {
          setActiveOverlay('wizard');
        }
      })
      .catch(() => {});
  }, []);

  const vaultLockScreen = vault.exists && vault.locked && vault.autoLockEnabled;

  const handleWizardComplete = () => {
    setActiveOverlay(null);
    account.reload();
    rpcNotify('configUpdated');
  };

  return (
    <>
      {screenshot && (
        <div
          className={styles.backdrop}
          style={{ backgroundImage: `url(${screenshot})` }}
        />
      )}
      <TopoBg className={styles.card}>
        <Splash visible={splashVisible} />
        <TopBar
          onMenuOpen={() => setActiveOverlay('menu')}
          onAddAccount={() => setActiveOverlay('wizard')}
          onEditProfile={() => setActiveOverlay('editProfile')}
        />

        <div className={styles.scrollArea}>
          <HomeTab onOpenWizard={() => setActiveOverlay('wizard')} />
        </div>

        <ApprovalOverlay
          onRequestUnlock={() => setUnlockVisible(true)}
          onUnlockWaitersChange={setUnlockWaiters}
        />

        <MenuOverlay
          visible={activeOverlay === 'menu'}
          onClose={() => setActiveOverlay(null)}
          onOpenWizard={() => setActiveOverlay('wizard')}
        />

        <WizardOverlay
          visible={activeOverlay === 'wizard'}
          canClose={(account.accounts?.length ?? 0) > 0}
          onClose={() => setActiveOverlay(null)}
          onComplete={handleWizardComplete}
        />

        <EditProfileOverlay
          visible={activeOverlay === 'editProfile'}
          onClose={() => setActiveOverlay(null)}
        />

        <UnlockModal
          visible={vaultLockScreen || unlockVisible}
          fullScreen={vaultLockScreen}
          unlockWaiters={unlockWaiters}
          onUnlocked={() => setUnlockVisible(false)}
          onCancel={vaultLockScreen ? undefined : () => setUnlockVisible(false)}
        />
      </TopoBg>
    </>
  );
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
  );
}
