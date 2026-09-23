import React from 'react';
import styles from './PulseLogo.module.css';

interface PulseLogoProps {
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

export default function PulseLogo({
  src = '/icons/icon-base.svg',
  size = 96,
  alt = 'Attention',
  className = '',
}: PulseLogoProps) {
  return (
    <div className={`${styles.wrap} ${className}`}>
      <img
        src={src}
        width={size}
        height={size}
        alt={alt}
        className={styles.logo}
      />
    </div>
  );
}
