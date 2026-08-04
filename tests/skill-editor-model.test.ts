import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CUSTOM_SKILL_DOCUMENT,
  isValidSkillName,
  materializeSkillDocument,
} from '../src/skills/skill-editor-model';

test('custom skill editor validates names and materializes frontmatter', () => {
  assert.equal(isValidSkillName('research-helper'), true);
  assert.equal(isValidSkillName('Research Helper'), false);
  const document = materializeSkillDocument('research-helper', DEFAULT_CUSTOM_SKILL_DOCUMENT);
  assert.match(document, /^---\nname: research-helper\n/);
  assert.doesNotMatch(document, /\{\{name\}\}/);
  assert.match(document, /# Instructions/);
});
