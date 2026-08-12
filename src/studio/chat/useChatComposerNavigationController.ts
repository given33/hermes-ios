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

import type {
  HermesCloudApi,
  MobileConsoleCommand,
  MobileConsoleCompletionSuggestion,
} from '../../api/HermesCloudApi';
import {
  selectSlashCommandDescriptor,
  shouldAutoOpenSlashMenu,
  slashCommandMatchScore,
  type SlashCommandDescriptor,
} from './slash-command-model';
export type { SlashCommandDescriptor } from './slash-command-model';

const LOCAL_SLASH_COMMANDS: readonly SlashCommandDescriptor[] = [
  {
    command: '/stop',
    usage: 'stop',
    category: 'task',
    requiresArgument: false,
    requiresConfirmation: false,
    en: 'Stop the active run',
    zh: '停止当前运行任务',
  },
  {
    command: '/plan',
    usage: 'plan',
    category: 'task',
    requiresArgument: true,
    requiresConfirmation: false,
    en: 'Investigate and produce a plan without dispatching workers',
    zh: '只调查并制定方案（不派发执行）',
  },
  {
    command: '/goal',
    usage: 'goal',
    category: 'task',
    requiresArgument: true,
    requiresConfirmation: false,
    en: 'Set the goal for this task as the highest priority',
    zh: '明确任务目标（最高优先级）',
  },
] as const;

const COMMAND_TRANSLATIONS: Readonly<Record<string, string>> = {
  '/commands': '显示可用的 Hermes 命令',
  '/help': '显示可用的 Hermes 命令',
  '/memory status': '查看记忆状态',
  '/sessions list': '列出可以恢复的会话',
  '/skills list': '列出已安装技能',
  '/status': '检查 Hermes 与工作节点状态',
  '/plan': '只调查并制定方案（不派发执行）',
  '/goal': '明确任务目标（最高优先级）',
};

function commandDescriptor(command: MobileConsoleCommand): SlashCommandDescriptor {
  return {
    command: command.command,
    usage: command.usage || command.command.slice(1),
    category: command.category || 'general',
    requiresArgument: (command.arguments || []).some((argument) => argument.required),
    requiresConfirmation: command.requires_confirmation || command.mutating,
    en: command.summary,
    zh: COMMAND_TRANSLATIONS[command.command] || command.summary,
  };
}

function argumentDescriptor(
  suggestion: MobileConsoleCompletionSuggestion,
): SlashCommandDescriptor {
  return {
    command: suggestion.display_name || suggestion.value,
    usage: suggestion.value,
    category: 'argument',
    requiresArgument: !suggestion.complete,
    requiresConfirmation: false,
    en: suggestion.description,
    zh: suggestion.description,
    selectionContent: suggestion.replacement,
    keepMenuOpen: !suggestion.complete,
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
  const [remoteArgumentSuggestions, setRemoteArgumentSuggestions] = useState<SlashCommandDescriptor[]>([]);
  const pendingNavigationCleanup = useRef<(() => void) | null>(null);
  const suppressedAutoOpenContent = useRef('');
  const slashCommands = useMemo(() => {
    const byCommand = new Map<string, SlashCommandDescriptor>();
    for (const item of [...remoteSlashCommands, ...LOCAL_SLASH_COMMANDS]) {
      byCommand.set(item.command, item);
    }
    return [...byCommand.values()];
  }, [remoteSlashCommands]);
  const activeArgumentCommand = useMemo(() => remoteSlashCommands
    .filter((descriptor) => (
      descriptor.requiresArgument
      && content.trimStart().startsWith(`${descriptor.command} `)
    ))
    .sort((left, right) => right.command.length - left.command.length)[0], [content, remoteSlashCommands]);
  const filteredSlashCommands = useMemo(() => {
    if (activeArgumentCommand) return remoteArgumentSuggestions;
    const query = content.trimStart().replace(/^\//, '').toLowerCase();
    return slashCommands
      .map((descriptor, sourceIndex) => ({
        descriptor,
        score: slashCommandMatchScore(query, descriptor),
        sourceIndex,
      }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score || left.sourceIndex - right.sourceIndex)
      .map(({ descriptor }) => descriptor);
  }, [activeArgumentCommand, content, remoteArgumentSuggestions, slashCommands]);

  useEffect(() => {
    let active = true;
    if (!cloudApi) {
      setRemoteSlashCommands([]);
      return () => { active = false; };
    }
    const controller = new AbortController();
    void cloudApi.getMobileConsoleCommands(profile, controller.signal).then(({ commands }) => {
      if (active) setRemoteSlashCommands(commands.map(commandDescriptor));
    }).catch(() => {
      if (active) setRemoteSlashCommands([]);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [cloudApi, profile]);

  useEffect(() => {
    setRemoteArgumentSuggestions([]);
    if (!cloudApi || !slashMenuOpen || !activeArgumentCommand) return undefined;
    const controller = new AbortController();
    const requestedLine = content;
    const timer = setTimeout(() => {
      void cloudApi.getMobileConsoleCompletions(
        requestedLine,
        profile,
        controller.signal,
      ).then((result) => {
        if (!controller.signal.aborted && result.line === requestedLine) {
          setRemoteArgumentSuggestions(result.suggestions.map(argumentDescriptor));
        }
      }).catch(() => {
        if (!controller.signal.aborted) setRemoteArgumentSuggestions([]);
      });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeArgumentCommand, cloudApi, content, profile, slashMenuOpen]);

  useEffect(() => {
    if (!content.trimStart().startsWith('/')) {
      suppressedAutoOpenContent.current = '';
      return;
    }
    if (shouldAutoOpenSlashMenu(content, suppressedAutoOpenContent.current)) {
      setSlashMenuOpen(true);
    }
  }, [content]);

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

  const selectSlashCommand = (descriptor: SlashCommandDescriptor) => {
    const selection = selectSlashCommandDescriptor(descriptor);
    const next = selection.content;
    contentRef.current = next;
    setContent(next);
    suppressedAutoOpenContent.current = selection.keepMenuOpen ? '' : next;
    setSlashMenuOpen(selection.keepMenuOpen);
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
