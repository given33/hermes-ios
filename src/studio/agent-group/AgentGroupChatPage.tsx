import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { HermesApiClient } from '../../api/HermesApiClient';
import { AgentGroupChatView } from './AgentGroupChatView';
import { useAgentGroupChatController } from './useAgentGroupChatController';

export interface AgentGroupChatPageProps {
  cacheOwner: string;
  client?: HermesApiClient;
  compact: boolean;
  fixtureMode: boolean;
  isChinese: boolean;
  notify(message: string): void;
  onOpenNavigation?(): void;
  profile: string;
}

/**
 * Standalone sidebar route for the Hermes Studio Agent rooms. The chat page
 * keeps its own embedded group surface; this page renders the same view with
 * an independent controller so the room list and live stream work as a
 * first-class navigation destination.
 */
export function AgentGroupChatPage({
  cacheOwner,
  client,
  compact,
  fixtureMode,
  isChinese,
  notify,
  onOpenNavigation,
  profile,
}: AgentGroupChatPageProps) {
  const insets = useSafeAreaInsets();
  const controller = useAgentGroupChatController({
    agentProfile: profile,
    cacheOwner,
    client,
    enabled: true,
    fixtureMode,
    isChinese,
    notify,
  });

  return (
    <AgentGroupChatView
      compact={compact}
      controller={controller}
      isChinese={isChinese}
      onOpenNavigation={onOpenNavigation}
      safeAreaBottom={insets.bottom}
      safeAreaLeft={insets.left}
      safeAreaRight={insets.right}
      safeAreaTop={insets.top}
    />
  );
}
