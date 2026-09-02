import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendDurableGroupChatMember,
  durableGroupChatMemberToken,
} from '../src/studio/durable-group-chat/member-selection';

test('catalog member selection keeps local profiles compatible and scopes peers', () => {
  assert.equal(durableGroupChatMemberToken('local', 'default'), 'default');
  assert.equal(durableGroupChatMemberToken('', 'reviewer'), 'reviewer');
  assert.equal(durableGroupChatMemberToken('second-server', 'reviewer'), 'second-server/reviewer');
  assert.equal(durableGroupChatMemberToken('second-server', 'nested/profile'), null);
});

test('catalog member selection preserves manual entries and never duplicates a selected profile', () => {
  assert.equal(
    appendDurableGroupChatMember('default, reviewer', 'second-server', 'reviewer'),
    'default, reviewer, second-server/reviewer',
  );
  assert.equal(
    appendDurableGroupChatMember('default, second-server/reviewer', 'second-server', 'reviewer'),
    'default, second-server/reviewer',
  );
  assert.equal(
    appendDurableGroupChatMember('default', 'local', 'default'),
    'default',
  );
});
