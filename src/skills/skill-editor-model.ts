export const DEFAULT_CUSTOM_SKILL_DOCUMENT = `---
name: {{name}}
description: Describe when Hermes should use this skill.
---

# Instructions

Describe the workflow, constraints, and expected result.
`;

export function isValidSkillName(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(value.trim());
}

export function materializeSkillDocument(name: string, content: string): string {
  return content.trim().replaceAll('{{name}}', name.trim());
}
