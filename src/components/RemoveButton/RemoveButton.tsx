import React from 'react';
import { IconClose } from '@assets';
import styles from './RemoveButton.module.css';

interface RemoveButtonProps {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  label?: string;
}

export default function RemoveButton({ onClick, label }: RemoveButtonProps) {
  return (
    <button type="button" className={styles.removeBtn} onClick={onClick} aria-label={label}>
      <IconClose size={14} />
    </button>
  );
}
