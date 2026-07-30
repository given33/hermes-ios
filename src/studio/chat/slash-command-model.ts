export interface SlashCommandDescriptor {
  command: string;
  usage: string;
  category: string;
  requiresArgument: boolean;
  requiresConfirmation: boolean;
  en: string;
  zh: string;
  selectionContent?: string;
  keepMenuOpen?: boolean;
}

export interface SlashCommandSelection {
  content: string;
  keepMenuOpen: boolean;
}

export function selectSlashCommandDescriptor(
  descriptor: SlashCommandDescriptor,
): SlashCommandSelection {
  return {
    content: descriptor.selectionContent || `${descriptor.command} `,
    keepMenuOpen: descriptor.keepMenuOpen ?? descriptor.requiresArgument,
  };
}

export function shouldAutoOpenSlashMenu(
  content: string,
  suppressedContent: string,
): boolean {
  const normalized = content.trimStart();
  return normalized.startsWith('/') && content !== suppressedContent;
}

/** Stable fuzzy score used by the mobile command palette. Lower is better. */
export function slashCommandMatchScore(query: string, descriptor: SlashCommandDescriptor): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const candidates = [
    descriptor.command.slice(1),
    descriptor.usage,
    descriptor.en,
    descriptor.zh,
    descriptor.category,
  ].map((value) => value.toLowerCase());
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const exact = candidate.indexOf(needle);
    if (exact >= 0) best = Math.min(best, exact * 2 + candidate.length - needle.length);
    let cursor = 0;
    let gap = 0;
    for (const character of needle) {
      const found = candidate.indexOf(character, cursor);
      if (found < 0) {
        cursor = -1;
        break;
      }
      gap += found - cursor;
      cursor = found + 1;
    }
    if (cursor >= 0) best = Math.min(best, 100 + gap + candidate.length - needle.length);
  }
  return best;
}
