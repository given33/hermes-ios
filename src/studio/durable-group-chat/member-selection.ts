/**
 * Translate a catalog selection into the stable member syntax accepted by the
 * owner-mobile Group Chat API. The local gateway remains profile-only so old
 * gateways and manual entry retain their existing wire shape.
 */
export function durableGroupChatMemberToken(
  gatewayId: string,
  profile: string,
): string | null {
  const normalizedGatewayId = gatewayId.trim();
  const normalizedProfile = profile.trim();
  if (!normalizedProfile || normalizedProfile.includes('/')) return null;
  return !normalizedGatewayId || normalizedGatewayId === 'local'
    ? normalizedProfile
    : `${normalizedGatewayId}/${normalizedProfile}`;
}

/** Add one catalog member without changing hand-entered members or duplicating it. */
export function appendDurableGroupChatMember(
  current: string,
  gatewayId: string,
  profile: string,
): string {
  const candidate = durableGroupChatMemberToken(gatewayId, profile);
  const members = current.split(',').map((value) => value.trim()).filter(Boolean);
  if (!candidate || members.includes(candidate)) return members.join(', ');
  return [...members, candidate].join(', ');
}
