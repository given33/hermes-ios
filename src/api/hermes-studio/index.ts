import type { HermesApiClient } from '../HermesApiClient';
import { HermesStudioGroupChatApi } from './group-chat';
import { HermesStudioWorkflowsApi } from './workflows';
import { HermesStudioWorkflowSocketApi } from './workflow-socket';

export class HermesStudioApi {
  readonly groupChat: HermesStudioGroupChatApi;
  readonly workflows: HermesStudioWorkflowsApi;
  readonly workflowSocket: HermesStudioWorkflowSocketApi;

  constructor(client: HermesApiClient) {
    this.groupChat = new HermesStudioGroupChatApi(client);
    this.workflows = new HermesStudioWorkflowsApi(client);
    this.workflowSocket = new HermesStudioWorkflowSocketApi(client);
  }
}

export * from './types';
export * from './group-chat';
export * from './workflows';
export * from './workflow-socket';
