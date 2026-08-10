import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { t, getSupportedLanguages, getLanguage, setLanguage } from '@lib/i18n.js';
import {
  IconLock,
  IconShield,
  IconGlobe,
  IconDatabase,
  IconMerge,
  IconEye,
  IconSettings,
  IconCloud,
  IconUser,
} from '@assets';
import { version as appVersion } from '../../../../package.json';
import browser from '@shared/browser.ts';
import {
  BACKGROUND_API_VERSION,
} from '@shared/contracts.ts';
import { buildGraphPageUrl } from '@shared/graph-deeplink.ts';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import ScrollWheelPicker from '@components/ScrollWheelPicker/ScrollWheelPicker';
import Button from '@components/Button/Button';
import MenuSection from './MenuSection';
import PermissionsSection from '../Settings/PermissionsSection';
import SecuritySection from '../Settings/SecuritySection';
import UserSection from '../Settings/UserSection';
import BrowserAccountRoamingSection from '../Settings/BrowserAccountRoamingSection';
import NetworkSection from '../Settings/NetworkSection';
import DisplaySettingsSection from '../Settings/DisplaySettingsSection';
import KeyActionModal from '../Vault/KeyActionModal';
import NavItem from '@components/NavItem/NavItem';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js';
import styles from './MenuOverlay.module.css';

interface MenuOverlayProps {
  visible: boolean;
  onClose: () => void;
  initialSection?: string | null;
  onOpenWizard?: () => void;
}

interface MenuItem {
  id: string;
  label: string;
  desc?: string;
  icon: ReactNode;
}

interface Language {
  code: string;
  flag: string;
  native: string;
  prompt: string;
}

const SETTINGS_SECTION_IDS = new Set([
  'display',
  'user',
  'security',
  'browser-account-roaming',
  'site-permissions',
  'network',
]);

function navStackForInitialSection(initialSection: string): string[] {
  if (initialSection === 'settings') return ['settings'];
  if (SETTINGS_SECTION_IDS.has(initialSection)) return ['settings', initialSection];
  return [initialSection];
}

export default function MenuOverlay({ visible, onClose, initialSection, onOpenWizard }: MenuOverlayProps) {
  const [navStack, setNavStack] = useState<string[]>([]);
  const [keyAction, setKeyAction] = useState<string | null>(null); // 'nsec' | 'ncryptsec' | 'changePassword'
  const [langModalOpen, setLangModalOpen] = useState<boolean>(false);
  const [langSelected, setLangSelected] = useState<Language | null>(null);
  const [permDetailDomain, setPermDetailDomain] = useState<string | null>(null);
  const permsSectionRef = useRef<any>(null);
  const { shouldRender, animating } = useAnimatedVisible(visible);
  const languages: Language[] = getSupportedLanguages();

  useEffect(() => {
    if (visible && initialSection) {
      setNavStack(navStackForInitialSection(initialSection));
    } else if (!visible) {
      setNavStack([]);
    }
  }, [visible, initialSection]);

  const rootMenuItems: MenuItem[] = [
    {
      id: 'graph',
      label: t('settings.graph'),
      desc: t('settings.graphDesc'),
      icon: <IconMerge />,
    },
    {
      id: 'settings',
      label: t('settings.title'),
      desc: t('settings.menuDesc'),
      icon: <IconSettings />,
    },
    {
      id: 'cockpit',
      label: t('settings.cockpit'),
      desc: t('settings.cockpitDesc'),
      icon: <IconDatabase />,
    },
  ];

  const settingsMenuItems: MenuItem[] = [
    {
      id: 'display',
      label: t('settings.display'),
      desc: t('settings.displayDesc'),
      icon: <IconEye />,
    },
    {
      id: 'user',
      label: t('settings.user'),
      desc: t('settings.userDesc'),
      icon: <IconUser />,
    },
    {
      id: 'security',
      label: t('settings.security'),
      desc: t('settings.securityDesc'),
      icon: <IconLock />,
    },
    {
      id: 'browser-account-roaming',
      label: t('settings.browserAccountRoaming'),
      desc: t('settings.browserAccountRoamingDesc'),
      icon: <IconCloud />,
    },
    {
      id: 'site-permissions',
      label: t('security.permissions'),
      desc: t('security.permissionsDesc'),
      icon: <IconShield />,
    },
    {
      id: 'network',
      label: t('settings.network'),
      desc: undefined,
      icon: <IconGlobe />,
    },
  ];

  const sectionTitles: Record<string, string> = {
    settings: t('settings.title'),
    display: t('settings.display'),
    user: t('settings.user'),
    security: t('settings.security'),
    'browser-account-roaming': t('settings.browserAccountRoaming'),
    network: t('settings.network'),
    'site-permissions': permDetailDomain || t('security.permissions'),
  };

  if (!shouldRender) return null;

  const currentSection = navStack[navStack.length - 1] || null;
  const title = currentSection ? (sectionTitles[currentSection] || t('settings.title')) : t('settings.title');

  const pushSection = (id: string) => setNavStack((s) => [...s, id]);
  const popSection = () => {
    // Let child sections handle back internally first
    if (currentSection === 'site-permissions' && permsSectionRef.current?.goBack()) return;
    // If we're at the initial deep-linked section, close the entire overlay
    if (initialSection && navStack.length === 1 && navStack[0] === initialSection) {
      handleClose();
      return;
    }
    setNavStack((s) => s.slice(0, -1));
  };
  const handleClose = () => { setNavStack([]); onClose(); };

  const handleMenuItem = (id: string) => {
    if (id === 'graph') {
      const url =
        buildGraphPageUrl({
          mode: 'graph',
          baseUrl: browser.runtime.getURL('src/cockpit/index.html'),
        }) || '?';
      void browser.runtime.sendMessage({
        type: 'OPEN_GRAPH_PAGE',
        version: BACKGROUND_API_VERSION,
        url,
      });
      handleClose();
      return;
    }
    if (id === 'cockpit') {
      void browser.runtime.sendMessage({
        type: 'OPEN_GRAPH_PAGE',
        version: BACKGROUND_API_VERSION,
        url: browser.runtime.getURL('src/cockpit/index.html'),
      });
      handleClose();
      return;
    }
    pushSection(id);
  };

  const openLangPicker = () => {
    const current = getLanguage();
    const idx = languages.findIndex((l: Language) => l.code === current);
    setLangSelected(languages[idx >= 0 ? idx : 0]);
    setLangModalOpen(true);
  };

  const handleLangConfirm = async () => {
    if (langSelected) {
      await setLanguage(langSelected.code);
    }
    setLangModalOpen(false);
  };

  const currentLang = languages.find((l: Language) => l.code === getLanguage()) || languages[0];

  const renderNavItems = (items: MenuItem[]): ReactNode => (
    <div className={styles.items}>
      {items.map((item) => (
        <NavItem
          key={item.id}
          icon={item.icon}
          label={item.label}
          desc={item.desc}
          onClick={() => handleMenuItem(item.id)}
        />
      ))}
    </div>
  );

  const renderSection = (): ReactNode => {
    switch (currentSection) {
      case 'settings':
        return renderNavItems(settingsMenuItems);
      case 'display':
        return <DisplaySettingsSection />;
      case 'user':
        return (
          <MenuSection>
            <UserSection />
          </MenuSection>
        );
      case 'security':
        return (
          <MenuSection>
            <SecuritySection
              onChangePassword={() => setKeyAction('changePassword')}
              onExportNsec={() => setKeyAction('nsec')}
              onExportNcryptsec={() => setKeyAction('ncryptsec')}
              onExportSeed={() => setKeyAction('seed')}
              onOpenWizard={
                onOpenWizard
                  ? () => {
                      handleClose();
                      onOpenWizard();
                    }
                  : undefined
              }
            />
          </MenuSection>
        );
      case 'browser-account-roaming':
        return (
          <MenuSection>
            <BrowserAccountRoamingSection />
          </MenuSection>
        );
      case 'site-permissions':
        return <PermissionsSection ref={permsSectionRef} onDetailChange={setPermDetailDomain} />;
      case 'network':
        return <NetworkSection />;
      default:
        return null;
    }
  };

  return (
    <OverlayPanel
      title={title}
      onClose={handleClose}
      onBack={currentSection ? popSection : null}
      animating={animating}
    >
      <div className={styles.menuContent}>
        <div key={currentSection || '_root'} className={styles.sectionContent}>
          {!currentSection ? renderNavItems(rootMenuItems) : renderSection()}
        </div>

        <div className={styles.menuFooter}>
          {!currentSection && (
            <button className={styles.langRow} onClick={openLangPicker}>
              <span className={styles.langFlag}>{currentLang.flag}</span>
              <span className={styles.langLabel}>{currentLang.native}</span>
              <svg className={styles.langChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          <div className={styles.aboutFooter}>
            <img src="/icons/icon-base.svg" className={styles.aboutLogo} alt="" />
            <span className={styles.aboutName}>AttentionX</span>
            <span className={styles.aboutVersion}>v{appVersion}</span>
          </div>
        </div>
      </div>

      {langModalOpen && (
        <div className={styles.langModal}>
          <div className={styles.langModalHeader}>
            <span className={styles.langModalTitle}>
              {langSelected?.prompt || languages[0].prompt}
            </span>
            <button
              className={styles.langModalClose}
              onClick={() => setLangModalOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className={styles.langModalWheel}>
            <ScrollWheelPicker
              items={languages}
              selectedIndex={langSelected ? languages.findIndex((l: Language) => l.code === langSelected.code) : 0}
              onChange={(i: number) => setLangSelected(languages[i])}
              renderItem={(lang: Language, _i: number, isActive: boolean) => (
                <div className={`${styles.langWheelItem} ${isActive ? styles.langWheelItemActive : ''}`}>
                  <span className={styles.langWheelFlag}>{lang.flag}</span>
                  <span className={styles.langWheelName}>{lang.native}</span>
                </div>
              )}
            />
          </div>

          <div className={styles.langModalBottom}>
            <Button onClick={handleLangConfirm}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}

      {keyAction && (
        <KeyActionModal
          action={keyAction}
          onClose={() => setKeyAction(null)}
        />
      )}
    </OverlayPanel>
  );
}
