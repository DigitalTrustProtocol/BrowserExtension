import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronLeft, IconClose } from '@assets';
import styles from './OverlayPanel.module.css';

interface OverlayPanelProps {
  title?: string;
  onClose?: () => void;
  onBack?: (() => void) | null;
  headerRight?: React.ReactNode;
  zIndex?: number;
  noPadding?: boolean;
  showHeader?: boolean;
  animating?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function OverlayPanel({
  title,
  onClose,
  onBack,
  headerRight,
  zIndex,
  noPadding = false,
  showHeader = true,
  animating = false,
  className = '',
  children,
}: OverlayPanelProps) {
  const overlayStyle = zIndex ? { '--overlay-z': zIndex } as React.CSSProperties : undefined;
  // centered layout when onBack is explicitly passed (function or null)
  const centered = onBack !== undefined;

  return (
    <div
      className={`${styles.overlay} ${noPadding ? styles.noPadding : ''} ${animating ? styles.exiting : ''} ${className}`}
      style={overlayStyle}
    >
      {showHeader && (
        <div className={`${styles.header} ${noPadding ? styles.headerNoPadding : ''}`}>
          {centered ? (
            <>
              {onBack ? (
                <button
                  type="button"
                  className={styles.backBtn}
                  aria-label={t('common.back')}
                  onClick={onBack}
                >
                  <IconChevronLeft />
                </button>
              ) : (
                <div className={styles.placeholder} />
              )}
              <span className={`${styles.title} ${noPadding ? styles.titleSmall : ''}`}>{title}</span>
              {onClose ? (
                <button
                  type="button"
                  className={styles.closeBtn}
                  aria-label={t('common.close')}
                  onClick={onClose}
                >
                  <IconClose />
                </button>
              ) : (
                <div className={styles.placeholder} />
              )}
            </>
          ) : (
            <>
              <span className={styles.title}>{title}</span>
              {headerRight ? (
                <div className={styles.headerRight}>
                  {headerRight}
                  <button
                    type="button"
                    className={styles.closeBtn}
                    aria-label={t('common.close')}
                    onClick={onClose}
                  >
                    <IconClose />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.closeBtn}
                  aria-label={t('common.close')}
                  onClick={onClose}
                >
                  <IconClose />
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className={styles.body}>
        {children}
      </div>
    </div>
  );
}
