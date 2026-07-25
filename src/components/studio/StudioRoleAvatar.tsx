import type { HermesChatAvatarRole } from '../../api/chat-view-model';

import { StudioOfficialAvatar } from './StudioOfficialAvatar';
import { StudioProfileAvatar } from './StudioProfileAvatar';

interface StudioRoleAvatarProps {
  role: HermesChatAvatarRole;
  size?: number;
}

const ROLE_SEEDS: Partial<Record<HermesChatAvatarRole, string>> = {
  'dbb3-worker': 'studio-role-worker-dbb3',
  'pc-worker': 'studio-role-worker-wsl',
  reporter: 'studio-role-reporter',
  reviewer: 'studio-role-reviewer',
  supervisor: 'studio-role-supervisor',
  user: 'Hermes iOS User',
};

/** One local, deterministic avatar contract shared by chat rows and member stacks. */
export function StudioRoleAvatar({ role, size = 24 }: StudioRoleAvatarProps) {
  if (role === 'dispatcher') {
    return <StudioOfficialAvatar size={size} variant="studio" />;
  }
  if (role === 'hermes') {
    return <StudioOfficialAvatar size={size} />;
  }
  return (
    <StudioProfileAvatar
      seed={ROLE_SEEDS[role] || `Hermes ${role}`}
      size={size}
    />
  );
}
