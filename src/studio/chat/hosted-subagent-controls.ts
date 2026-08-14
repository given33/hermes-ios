import type { HermesCloudApi } from '../../api/HermesCloudApi';

type HostedSubagentControlApi = Pick<
  HermesCloudApi,
  'steerHostedSubagent' | 'stopHostedSubagent'
>;

export function createHostedSubagentControlActions({
  cloudApi,
  conversationId,
  isChinese,
  notify,
  turnId,
}: {
  cloudApi: HostedSubagentControlApi | null;
  conversationId: string;
  isChinese: boolean;
  notify(message: string): void;
  turnId: string;
}) {
  return {
    onSteerSubagent: (subagentId: string, message: string) => {
      if (!cloudApi || !conversationId || !turnId) return;
      void cloudApi.steerHostedSubagent(
        conversationId,
        turnId,
        subagentId,
        message,
        `ios-steer-${turnId}-${subagentId}-${Date.now()}`,
      ).catch((error) => {
        notify(error instanceof Error ? error.message : (isChinese ? '无法引导子代理' : 'Unable to steer worker'));
      });
    },
    onStopSubagent: (subagentId: string) => {
      if (!cloudApi || !conversationId || !turnId) return;
      void cloudApi.stopHostedSubagent(
        conversationId,
        turnId,
        subagentId,
        isChinese ? '用户停止子代理' : 'User stopped worker',
        `ios-stop-${turnId}-${subagentId}-${Date.now()}`,
      ).catch((error) => {
        notify(error instanceof Error ? error.message : (isChinese ? '无法停止子代理' : 'Unable to stop worker'));
      });
    },
  };
}
