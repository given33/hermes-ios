import { normalizeOfficialSessionMessages } from '../official-session-adoption';
import {
  parseOfficialConversationPlaceholderId,
} from '../conversation-identifiers';
import { boundedUploadBody } from '../upload-body';
import type {
  CollaborationMessage,
  ConversationAttachmentUploadContext,
  ConversationCompressionResponse,
  ConversationForkResponse,
  ConversationSessionState,
  HostedTurnEnqueueInput,
  HostedTurnEnqueueResponse,
  NativeUpload,
  RouteDecision,
  SingleConversation,
} from '../HermesCloudApi';
import type { HermesCloudTransport, JsonRecord } from './transport';

const COLLABORATION = '/api/plugins/collaboration';

/** Account-scoped conversation, hosted-turn, attachment, and event endpoints. */
export class HermesConversationsCloudApi {
  constructor(private readonly transport: HermesCloudTransport) {}

  getConversations(signal?: AbortSignal) {
    return this.transport.request<{ conversations: SingleConversation[] }>(
      `${COLLABORATION}/single/conversations`,
      { signal },
    );
  }

  async getUnifiedConversations(_profile = 'default', signal?: AbortSignal) {
    // Server profile history is process-wide on older deployments. Account
    // conversations are the only safe source for this signed-in surface.
    const cloud = await this.getConversations(signal);
    return { conversations: cloud.conversations };
  }

  getConversation(id: string, signal?: AbortSignal) {
    return this.transport.request<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
      { signal },
    );
  }

  openHostedConversationEvents(
    conversationId: string,
    cursor: number,
    signal: AbortSignal,
  ) {
    return this.transport.openEventStream(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/hosted-events`,
      { query: { cursor: Math.max(0, Math.floor(cursor)) }, signal },
    );
  }

  getConversationSessionState(conversationId: string, profile = '') {
    return this.transport.request<ConversationSessionState>(
      `${COLLABORATION}/mobile/conversations/${encodeURIComponent(conversationId)}/session-state`,
      { query: { profile: profile || undefined } },
    );
  }

  forkConversationFromMessage(
    conversationId: string,
    messageId: string,
    input: { idempotencyKey: string; profile?: string; title?: string },
  ) {
    return this.transport.json<ConversationForkResponse>(
      `${COLLABORATION}/mobile/conversations/${encodeURIComponent(conversationId)}`
      + `/messages/${encodeURIComponent(messageId)}/fork`,
      'POST',
      {
        idempotency_key: input.idempotencyKey,
        profile: input.profile || '',
        title: input.title || '',
      },
    );
  }

  compressConversation(
    conversationId: string,
    input: { focusTopic?: string; idempotencyKey: string; profile?: string },
  ) {
    return this.transport.json<ConversationCompressionResponse>(
      `${COLLABORATION}/mobile/conversations/${encodeURIComponent(conversationId)}/compress`,
      'POST',
      {
        focus_topic: input.focusTopic || '',
        idempotency_key: input.idempotencyKey,
        profile: input.profile || '',
      },
    );
  }

  createConversation(
    profile = 'default',
    title = '新对话',
    clientId = '',
    signal?: AbortSignal,
  ) {
    return this.transport.json<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations`,
      'POST',
      { client_id: clientId || undefined, profile, title },
      { signal },
    );
  }

  async adoptOfficialConversation(sessionId: string, profile = 'default', title = '') {
    const placeholder = parseOfficialConversationPlaceholderId(sessionId);
    const normalizedSessionId = (
      placeholder?.sessionId || sessionId.replace(/^official:/, '')
    ).trim();
    if (!normalizedSessionId) throw new Error('Official Hermes session id is required');
    const adoptionProfile = placeholder?.profile || profile.trim() || 'default';
    const encodedSessionId = encodeURIComponent(normalizedSessionId);
    const [detail, messageData] = await Promise.all([
      this.transport.request<JsonRecord>(`/api/sessions/${encodedSessionId}`, {
        profile: adoptionProfile,
      }),
      this.transport.request<{ session_id: string; messages: JsonRecord[] }>(
        `/api/sessions/${encodedSessionId}/messages`,
        { profile: adoptionProfile },
      ),
    ]);
    const messages = normalizeOfficialSessionMessages(
      messageData.messages,
      adoptionProfile,
      normalizedSessionId,
    );
    const firstUser = messages.find((message) => message.role === 'user' && message.content);
    return this.transport.json<{ conversation: SingleConversation; created: boolean }>(
      `${COLLABORATION}/single/conversations/adopt`,
      'POST',
      {
        messages,
        profile: adoptionProfile,
        session_id: normalizedSessionId,
        title: stringValue(detail.title) || title || firstUser?.content.slice(0, 36) || '历史会话',
      },
    );
  }

  deleteConversation(id: string) {
    return this.transport.request<{ ok: boolean }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
  }

  renameConversation(id: string, title: string) {
    return this.transport.json<{ conversation: SingleConversation }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}`,
      'PATCH',
      { title },
    );
  }

  recordConversationMessage(id: string, message: CollaborationMessage) {
    return this.transport.json<{ message: CollaborationMessage }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(id)}/record`,
      'POST',
      message as unknown as JsonRecord,
    );
  }

  saveRuntimeSession(
    conversationId: string,
    profile: string,
    sessionId: string,
    turnId: string,
    status: 'completed' | 'failed' | 'running',
  ) {
    return this.transport.json<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/runtime-session`,
      'POST',
      { profile, session_id: sessionId, turn_id: turnId, status },
    );
  }

  createHostedTurn(
    conversationId: string,
    input: {
      turnId: string;
      content: string;
      title: string;
      profiles: string[];
      artifactRequired: boolean;
      attachmentIds?: string[];
      attachmentContext?: string;
      deliveryContext?: string;
      mode: RouteDecision['mode'];
      routeMetadata: JsonRecord;
    },
  ) {
    return this.transport.json<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/hosted-turns`,
      'POST',
      {
        turn_id: input.turnId,
        content: input.content,
        title: input.title,
        profiles: input.profiles,
        artifact_required: input.artifactRequired,
        attachment_ids: input.attachmentIds || [],
        attachment_context: input.attachmentContext || '',
        delivery_context: input.deliveryContext || '',
        mode: input.mode,
        route_metadata: input.routeMetadata,
      },
    );
  }

  enqueueHostedTurn(
    conversationId: string,
    input: HostedTurnEnqueueInput,
    signal?: AbortSignal,
  ) {
    return this.transport.json<HostedTurnEnqueueResponse>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/enqueue`,
      'POST',
      {
        request_id: input.requestId,
        turn_id: input.turnId,
        message: input.message as unknown as JsonRecord,
        profiles: input.profiles,
        recent_messages: input.recentMessages,
        attachment_ids: input.attachmentIds || [],
        attachment_context: input.attachmentContext || '',
        delivery_context: input.deliveryContext || '',
      },
      { signal },
    );
  }

  cancelHostedTurn(
    conversationId: string,
    turnId: string,
    reason: string,
    signal?: AbortSignal,
  ) {
    return this.transport.json<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}`
      + `/hosted-turns/${encodeURIComponent(turnId)}/cancel`,
      'POST',
      { reason },
      { signal },
    );
  }

  interveneHostedTurn(
    conversationId: string,
    turnId: string,
    content: string,
    messageId: string,
    signal?: AbortSignal,
  ) {
    return this.transport.json<{
      accepted: boolean;
      hosted_turn: JsonRecord;
      message: CollaborationMessage;
      targets: string[];
    }>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}`
      + `/hosted-turns/${encodeURIComponent(turnId)}/interventions`,
      'POST',
      { content, message_id: messageId },
      { signal },
    );
  }

  async uploadConversationAttachment(
    conversationId: string,
    upload: NativeUpload,
    context: ConversationAttachmentUploadContext,
    signal?: AbortSignal,
  ) {
    const body = await boundedUploadBody(upload.uri, upload.name);
    return this.transport.request<JsonRecord>(
      `${COLLABORATION}/single/conversations/${encodeURIComponent(conversationId)}/attachments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': upload.mimeType || 'application/octet-stream',
          'X-Filename': encodeURIComponent(upload.name),
          'X-Message-ID': context.messageId || '',
          'X-Profile': context.profile || '',
          'X-Turn-ID': context.turnId || '',
          'X-Upload-ID': context.uploadId,
        },
        signal,
        body,
      },
    );
  }

  downloadConversationAttachment(downloadUrl: string) {
    if (!downloadUrl.startsWith(`${COLLABORATION}/single/conversations/`)) {
      throw new Error('Invalid conversation attachment URL');
    }
    return this.transport.download(downloadUrl);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
