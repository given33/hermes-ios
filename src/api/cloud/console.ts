import type { HermesCloudTransport } from './transport';

export type MobileConsoleStatus = 'clear' | 'confirm_required' | 'error' | 'exit' | 'ok';

export interface MobileConsoleCommand {
  name: string;
  command: string;
  display_name: string;
  description: string;
  category: string;
  arguments: Array<{
    name: string;
    display_name: string;
    required: boolean;
    values: string[];
  }>;
  confirmation: string;
  mutating: boolean;
  mutates_state: boolean;
  requires_confirmation: boolean;
  available_when: string[];
  autocomplete_endpoint: string;
  examples: string[];
  summary: string;
  usage: string;
}

export interface MobileConsoleCatalog {
  commands: MobileConsoleCommand[];
  profile: string;
}

export interface MobileConsoleResult {
  command: string;
  confirmation_message: string;
  output: string;
  profile: string;
  status: MobileConsoleStatus;
}

export type MobileHostedCommand = 'bg' | 'btw' | 'busy';

export interface MobileHostedCommandResult {
  accepted: boolean;
  command: MobileHostedCommand;
  conversation_id?: string;
  event_type?: string;
  task_id?: string;
  value?: string;
}

export interface MobileConsoleCompletionSuggestion {
  value: string;
  display_name: string;
  description: string;
  replacement: string;
  complete: boolean;
}

export interface MobileConsoleCompletions {
  profile: string;
  line: string;
  suggestions: MobileConsoleCompletionSuggestion[];
}

export class HermesConsoleCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getCommands(profile = 'default', signal?: AbortSignal) {
    const query = new URLSearchParams({ profile });
    return this.transport.request<MobileConsoleCatalog>(
      `/api/plugins/collaboration/mobile/console/commands?${query.toString()}`,
      { signal },
    );
  }

  complete(line: string, profile = 'default', signal?: AbortSignal) {
    return this.transport.json<MobileConsoleCompletions>(
      '/api/plugins/collaboration/mobile/console/completions',
      'POST',
      { line, profile, limit: 30 },
      { signal },
    );
  }

  execute(line: string, profile = 'default', confirmed = false) {
    return this.transport.json<MobileConsoleResult>(
      '/api/plugins/collaboration/mobile/console/execute',
      'POST',
      { confirmed, line, profile },
    );
  }

  executeHostedCommand(
    conversationId: string,
    command: MobileHostedCommand,
    text = '',
    value = '',
  ) {
    return this.transport.json<MobileHostedCommandResult>(
      `/api/plugins/collaboration/mobile/conversations/${encodeURIComponent(conversationId)}/commands`,
      'POST',
      { command, text, value },
    );
  }
}
