import type { IOSContextEvent } from './IOSIntelligenceApi';

type CollectionKind = 'calendar' | 'reminder';

export function snapshotEvent(
  kind: string,
  timestamp: number,
  payload: Record<string, unknown>,
  stableId = '',
  sourceDeviceId = '',
): IOSContextEvent {
  const eventPayload = sourceDeviceId ? { ...payload, source_device_id: sourceDeviceId } : payload;
  const rawID = `${kind}:${stableId || timestamp}`;
  const eventID = rawID.length <= 256
    ? rawID
    : `${rawID.slice(0, 240)}:${shortHash(rawID)}`;
  return {
    id: eventID,
    kind,
    ...(sourceDeviceId ? { source_device_id: sourceDeviceId } : {}),
    timestamp,
    payload: eventPayload,
  };
}

export function buildCollectionSnapshotEvents<T extends object>(
  kind: CollectionKind,
  items: T[],
  capturedAt: number,
  sourceDeviceId: string,
): IOSContextEvent[] {
  const versions: Record<string, string> = {};
  const itemEvents = items.map((item) => {
    const itemID = stableItemID(item);
    const payload: Record<string, unknown> = { ...(item as Record<string, unknown>), id: itemID };
    const timestampKey = kind === 'calendar' ? 'start' : 'due';
    const timestamp = typeof payload[timestampKey] === 'number'
      ? payload[timestampKey] as number
      : capturedAt;
    const event = snapshotEvent(
      kind,
      timestamp,
      payload,
      stableRecordID(itemID, payload),
      sourceDeviceId,
    );
    versions[itemID] = event.id;
    return event;
  });
  const ids = Object.keys(versions).sort();
  const orderedVersions = Object.fromEntries(ids.map((id) => [id, versions[id]]));

  return [
    ...itemEvents,
    snapshotEvent(`${kind}-index`, capturedAt, {
      captured_at: capturedAt,
      ids,
      versions: orderedVersions,
    }, '', sourceDeviceId),
  ];
}

function stableItemID(item: object): string {
  const id = (item as { id?: unknown }).id;
  if (typeof id === 'string' && id.trim()) return id.trim();
  return `content:${shortHash(stableStringify(item))}`;
}

function stableRecordID(id: string, value: object): string {
  return `${id}:${shortHash(stableStringify(value))}`;
}

function stableStringify(value: object): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
