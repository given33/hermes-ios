import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'hermes.apns-unregister-outbox.v1';
const MAX_ITEMS = 16;

export interface ApnsUnregisterOutboxItem {
  baseUrl: string;
  deviceId: string;
  username: string;
  queuedAt: number;
}

export async function enqueueApnsUnregister(item: Omit<ApnsUnregisterOutboxItem, 'queuedAt'>): Promise<void> {
  const baseUrl = item.baseUrl.trim();
  const deviceId = item.deviceId.trim();
  const username = item.username.trim().toLowerCase();
  if (!baseUrl || !deviceId || !username) return;
  const current = await readOutbox();
  const key = `${baseUrl}\u0000${username}\u0000${deviceId}`;
  const next = current.filter((entry) => `${entry.baseUrl}\u0000${entry.username}\u0000${entry.deviceId}` !== key);
  next.push({ baseUrl, deviceId, username, queuedAt: Date.now() });
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-MAX_ITEMS)));
}

export async function drainApnsUnregister(
  username: string,
  remove: (item: ApnsUnregisterOutboxItem) => Promise<boolean>,
): Promise<void> {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return;
  const current = await readOutbox();
  const remaining: ApnsUnregisterOutboxItem[] = [];
  for (const item of current) {
    if (item.username !== normalized) { remaining.push(item); continue; }
    try {
      if (!(await remove(item))) remaining.push(item);
    } catch { remaining.push(item); }
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(remaining.slice(-MAX_ITEMS)));
}

async function readOutbox(): Promise<ApnsUnregisterOutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch { return []; }
}

function isItem(value: unknown): value is ApnsUnregisterOutboxItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.baseUrl === 'string' && typeof item.deviceId === 'string'
    && typeof item.username === 'string' && typeof item.queuedAt === 'number';
}
