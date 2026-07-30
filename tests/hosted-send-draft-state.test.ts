import assert from 'node:assert/strict';
import test from 'node:test';

import {
  draftClaimForComposer,
  recoverUndurableComposer,
} from '../src/studio/chat/hosted-send-draft-state';

const sentAttachment = {
  draftPersistent: true as const,
  id: 'draft-file-1',
  kind: 'file' as const,
  name: 'draft-file.txt',
  ownedTemporary: true,
  uri: 'file:///cache/draft-file.txt',
};

test('a first-write failure restores the exact sent composer and attachment source', () => {
  const recovered = recoverUndurableComposer(
    { attachments: [sentAttachment], content: 'queued text' },
    { attachments: [], content: '' },
  );

  assert.equal(recovered.content, 'queued text');
  assert.deepEqual(recovered.attachments, [sentAttachment]);
  assert.equal(recovered.attachments[0].uri, 'file:///cache/draft-file.txt');
});

test('composer recovery preserves edits entered while the first write was pending', () => {
  const newAttachment = {
    ...sentAttachment,
    id: 'new-file-2',
    name: 'new-file.txt',
    uri: 'file:///cache/new-file.txt',
  };
  const recovered = recoverUndurableComposer(
    { attachments: [sentAttachment], content: 'queued text' },
    { attachments: [newAttachment], content: 'new text' },
  );

  assert.equal(recovered.content, 'queued text\nnew text');
  assert.deepEqual(recovered.attachments, [sentAttachment, newAttachment]);
});

test('the durable claim binds the request to only persistent draft attachments', () => {
  const claim = draftClaimForComposer('request-1', ' queued text ', [
    sentAttachment,
    {
      ...sentAttachment,
      draftPersistent: false,
      id: 'ephemeral-file',
      uri: 'file:///cache/ephemeral-file.txt',
    },
  ]);

  assert.deepEqual(claim, {
    attachments: [{ id: sentAttachment.id, uri: sentAttachment.uri }],
    content: ' queued text ',
    requestId: 'request-1',
  });
});
