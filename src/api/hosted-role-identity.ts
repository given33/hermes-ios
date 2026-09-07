export function hostedRoleIdentity(rawStage: string | undefined, stage = 'chat'): string {
  return (rawStage || stage).replace(/\.(?:opening|progress|milestone|handoff|completed)(?:[.:].*)?$/i, '');
}
