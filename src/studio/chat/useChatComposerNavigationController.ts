import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { Keyboard, Platform, type TextInput } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import type { HermesCloudApi, MobileConsoleCommand } from '../../api/HermesCloudApi';

export interface SlashCommandDescriptor {
  command: string;
  en: string;
  zh: string;
}

const LOCAL_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
  { command: '/stop', en: 'Stop the active run', zh: '停止当前运行任务' },
] as const;

const COMMAND_TRANSLATIONS: Readonly<Record<string, string>> = {
  '/commands': '显示可用的 Hermes 命令',
  '/help': '显示可用的 Hermes 命令',
  '/memory status': '查看记忆状态',
  '/sessions list': '列出可以恢复的会话',
  '/skills list': '列出已安装技能',
  '/status': '检查 Hermes 与工作节点状态',
};

function commandDescriptor(command: MobileConsoleCommand): SlashCommandDescriptor {
  return {
    command: command.command,
    en: command.summary,
    zh: COMMAND_TRANSLATIONS[command.command] || command.summary,
  };
}

interface ChatComposerNavigationOptions {
  cloudApi?: HermesCloudApi | null;
  composerInputRef: RefObject<TextInput | null>;
  content: string;
  contentRef: MutableRefObject<string>;
  keyboardAvoidanceEnabled: SharedValue<number>;
  openNavigation?(): void;
  profile: string;
  setContent: Dispatch<SetStateAction<string>>;
}

export function useChatComposerNavigationController({
  cloudApi,
  composerInputRef,
  content,
  contentRef,
  keyboardAvoidanceEnabled,
  openNavigation,
  profile,
  setContent,
}: ChatComposerNavigationOptions) {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [remoteSlashCommands, setRemoteSlashCommands] = useState<SlashCommandDescriptor[]>([]);
  const pendingNavigationCleanup = useRef<(() => void) | null>(null);
  const slashCommands = useMemo(() => {
    const byCommand = new Map<string, SlashCommandDescriptor>();
    for (const item of [...remoteSlashCommands, ...LOCAL_SLASH_COMMANDS]) {
      byCommand.set(item.command, item);
    }
    return [...byCommand.values()];
  }, [remoteSlashCommands]);
  const filteredSlashCommands = useMemo(() => {
    const query = content.trimStart().replace(/^\//, '').split(/\s/, 1)[0].toLowerCase();
    return slashCommands.filter(({ command, en, zh }) => (
      !query || command.slice(1).includes(query) || en.toLowerCase().includes(query) || zh.includes(query)
    ));
  }, [content, slashCommands]);

  useEffect(() => {
    let active = true;
    if (!cloudApi) {
      setRemoteSlashCommands([]);
      return () => { active = false; };
    }
    void cloudApi.getMobileConsoleCommands(profile).then(({ commands }) => {
      if (active) setRemoteSlashCommands(commands.map(commandDescriptor));
    }).catch(() => {
      if (active) setRemoteSlashCommands([]);
    });
    return () => { active = false; };
  }, [cloudApi, profile]);

  const openSlashCommand = () => {
    if (slashMenuOpen) {
      setSlashMenuOpen(false);
      return;
    }
    const current = contentRef.current.trimStart();
    const next = current.startsWith('/') ? current : '/';
    if (next !== contentRef.current) {
      contentRef.current = next;
      setContent(next);
    }
    setSlashMenuOpen(true);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const selectSlashCommand = (command: string) => {
    const next = `${command} `;
    contentRef.current = next;
    setContent(next);
    setSlashMenuOpen(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const openNavigationAfterKeyboard = () => {
    if (!openNavigation) return;
    pendingNavigationCleanup.current?.();
    if (Platform.OS !== 'ios' || !Keyboard.isVisible()) {
      openNavigation();
      return;
    }
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      pendingNavigationCleanup.current?.();
      openNavigation();
    };
    const subscription = Keyboard.addListener('keyboardDidHide', finish);
    const fallback = setTimeout(finish, 650);
    pendingNavigationCleanup.current = () => {
      subscription.remove();
      clearTimeout(fallback);
      pendingNavigationCleanup.current = null;
    };
    keyboardAvoidanceEnabled.value = 0;
    composerInputRef.current?.blur();
    Keyboard.dismiss();
  };

  useEffect(() => () => pendingNavigationCleanup.current?.(), []);

  return {
    filteredSlashCommands,
    openNavigationAfterKeyboard,
    openSlashCommand,
    selectSlashCommand,
    setSlashMenuOpen,
    slashMenuOpen,
  };
}
