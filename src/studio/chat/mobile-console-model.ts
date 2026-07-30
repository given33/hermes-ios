import type { MobileConsoleResult } from '../../api/HermesCloudApi';

export function isStopSlashCommand(value: string): boolean {
  return /^\/stop(?:\s|$)/i.test(value.trim());
}

export function isRemoteConsoleCommand(value: string): boolean {
  const command = value.trim();
  return command.startsWith('/') && !isStopSlashCommand(command);
}

export function consoleInvocationOwnsActiveView(
  activeConversationId: string,
  invocationConversationId: string,
  activeGeneration: number,
  invocationGeneration: number,
): boolean {
  return Boolean(invocationConversationId)
    && activeConversationId === invocationConversationId
    && activeGeneration === invocationGeneration;
}

export interface ConsoleInvocationScope {
  conversationId: string;
  generation: number;
}

export function consoleInvocationBlocksActiveView(
  scopes: Iterable<ConsoleInvocationScope>,
  activeConversationId: string,
  activeGeneration: number,
): boolean {
  for (const scope of scopes) {
    if (
      scope.generation === activeGeneration
      && scope.conversationId === activeConversationId
    ) return true;
  }
  return false;
}

export function mobileConsoleResultText(
  result: MobileConsoleResult,
  isChinese: boolean,
): string {
  const output = result.output.trim();
  if (output) return output;
  if (result.status === 'ok' || result.status === 'clear' || result.status === 'exit') {
    return isChinese ? '命令已完成。' : 'Command completed.';
  }
  return isChinese ? '命令执行失败。' : 'Command failed.';
}
