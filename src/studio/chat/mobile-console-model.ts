import type { MobileConsoleResult } from '../../api/HermesCloudApi';

export function isStopSlashCommand(value: string): boolean {
  return /^\/stop(?:\s|$)/i.test(value.trim());
}

export function isRemoteConsoleCommand(value: string): boolean {
  const command = value.trim();
  return command.startsWith('/') && !isStopSlashCommand(command);
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
