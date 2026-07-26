import React, { useState, useEffect, useRef } from 'react';
import { t } from '@lib/i18n.js';
import { getClientIconUrl } from '@shared/clientIcons.ts';
import { IconGlobe } from '@assets';
import Button from '@components/Button/Button';
import { useSiteConnection } from '../../context/SiteConnectionContext';
import styles from './TopBar.module.css';

export default function GlobeButton() {
  const { domain, connected, connect, disconnect } = useSiteConnection();
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      await connect();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const iconUrl = domain ? getClientIconUrl(domain) : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={styles.globeBtn}
        title={t('topbar.siteConnection')}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe size={16} />
        {/* Neutral/blank dot while loading (connected === null) so we never
            flash a misleading "connected" or "not connected" state. */}
        {connected !== null && (
          <span className={`${styles.globeDot} ${connected ? styles.globeConnected : styles.globeDisconnected}`} />
        )}
      </button>

      {open && (
        <div className={styles.globePopover}>
          {iconUrl && (
            <img src={iconUrl} alt={domain!} className={styles.clientIconLarge} />
          )}
          <div className={styles.globeDomain}>{domain || '—'}</div>
          <div className={styles.globeStatus}>
            {connected === null
              ? t('common.loading')
              : connected
                ? t('globe.connected')
                : t('globe.notConnected')}
          </div>
          {connected && domain && (
            <Button
              variant="danger"
              small
              onClick={() => void handleDisconnect()}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? t('common.loading') : t('common.disconnect')}
            </Button>
          )}
          {connected === false && domain && (
            <Button
              small
              onClick={() => void handleConnect()}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? t('common.loading') : t('common.connect')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
