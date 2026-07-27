export function officialConversationPlaceholderId(profile: string, sessionId: string): string {
  const normalizedProfile = profile.trim() || 'default';
  const normalizedSessionId = sessionId.trim();
  const checksum = officialEnvelopeChecksum(`${normalizedProfile}\u0000${normalizedSessionId}`);
  return [
    'official:v3',
    encodeURIComponent(normalizedProfile),
    encodeURIComponent(normalizedSessionId),
    checksum,
  ].join(':');
}

export function parseOfficialConversationPlaceholderId(
  value: string,
): { profile: string; sessionId: string } | null {
  if (!value.startsWith('official:')) return null;
  const encoded = value.slice('official:'.length);
  if (!encoded.startsWith('v3:')) return { profile: '', sessionId: encoded };
  const versioned = encoded.slice('v3:'.length);
  const firstSeparator = versioned.indexOf(':');
  const lastSeparator = versioned.lastIndexOf(':');
  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return { profile: '', sessionId: encoded };
  }
  const profile = decodeURIComponentSafely(versioned.slice(0, firstSeparator)).trim();
  const sessionId = decodeURIComponentSafely(
    versioned.slice(firstSeparator + 1, lastSeparator),
  ).trim();
  const checksum = versioned.slice(lastSeparator + 1);
  if (
    !profile
    || !sessionId
    || checksum !== officialEnvelopeChecksum(`${profile}\u0000${sessionId}`)
  ) {
    return { profile: '', sessionId: encoded };
  }
  return { profile, sessionId };
}

function officialEnvelopeChecksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
