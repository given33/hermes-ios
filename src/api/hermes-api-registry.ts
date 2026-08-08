import type { HermesApiClient } from './HermesApiClient';
import { HermesCloudApi } from './HermesCloudApi';
import { ConversationLocalStore } from './conversation-local-store';
import { HermesCodingPiApi } from './hermes-coding-pi';
import { HermesStudioApi } from './hermes-studio';

// Composition root for the product API objects. Feature code asks for the
// instance bound to its transport client instead of scattering `new` calls
// across pages, so every caller shares one HermesCloudApi per client and one
// conversation cache store per process. Both classes are stateless wrappers
// (the client and AsyncStorage hold all state), which makes sharing safe.
const cloudApiByClient = new WeakMap<HermesApiClient, HermesCloudApi>();
const codingPiApiByClient = new WeakMap<HermesApiClient, HermesCodingPiApi>();
const studioApiByClient = new WeakMap<HermesApiClient, HermesStudioApi>();

export function hermesCloudApiFor(client: HermesApiClient, owner?: string): HermesCloudApi {
  const existing = cloudApiByClient.get(client);
  if (existing) {
    if (owner !== undefined) existing.bindManagedResourceOwner(owner);
    return existing;
  }
  const api = new HermesCloudApi(client);
  if (owner !== undefined) api.bindManagedResourceOwner(owner);
  cloudApiByClient.set(client, api);
  return api;
}

/** Hermes Studio APIs are intentionally separate from the hosted plugin APIs. */
export function hermesStudioApiFor(client: HermesApiClient): HermesStudioApi {
  const existing = studioApiByClient.get(client);
  if (existing) return existing;
  const api = new HermesStudioApi(client);
  studioApiByClient.set(client, api);
  return api;
}

/** Coding/Pi has its own API object so its session lifecycle cannot mutate chat state. */
export function hermesCodingPiApiFor(client: HermesApiClient): HermesCodingPiApi {
  const existing = codingPiApiByClient.get(client);
  if (existing) return existing;
  const api = new HermesCodingPiApi(client);
  codingPiApiByClient.set(client, api);
  return api;
}

let sharedConversationStore: ConversationLocalStore | null = null;

export function sharedConversationLocalStore(): ConversationLocalStore {
  sharedConversationStore ??= new ConversationLocalStore();
  return sharedConversationStore;
}
