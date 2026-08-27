import React from 'react';
import { t } from '@lib/i18n.js';
import NavRow from '@components/NavRow/NavRow';
import { IconUser } from '@assets';

/**
 * "Edit profile" row in the Account group — opens User settings kind 0
 * create/sync toward the current X, not kind 0 as the presented identity.
 */
export default function ProfileCard({ onEdit }: { onEdit: () => void }) {
  return (
    <NavRow
      icon={<IconUser size={16} />}
      title={t('home.editProfile')}
      subtitle={t('home.profileSummary')}
      onClick={onEdit}
    />
  );
}
