import type { HermesCloudTransport } from './transport';

export type MobileConsoleStatus = 'clear' | 'confirm_required' | 'error' | 'exit' | 'ok';

export interface MobileConsoleCommand {
  command: string;
  confirmation: string;
  mutating: boolean;
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

export class HermesConsoleCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getCommands(profile = 'default') {
    const query = new URLSearchParams({ profile });
    return this.transport.request<MobileConsoleCatalog>(
      `/api/plugins/collaboration/mobile/console/commands?${query.toString()}`,
    );
  }

  execute(line: string, profile = 'default', confirmed = false) {
    return this.transport.json<MobileConsoleResult>(
      '/api/plugins/collaboration/mobile/console/execute',
      'POST',
      { confirmed, line, profile },
    );
  }
}
