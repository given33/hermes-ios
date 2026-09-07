import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFileFailureNotice } from '../src/api/chat-file-failure-notice';

test('a failed file write remains explicit without presenting shell verifier instructions as chat copy', () => {
  const original = 'Report\n\n⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn.\n  • `/opt/report.md` — [write_file] Failed to write file: /opt/.hermes-tmp: Permission denied';
  const display = chatFileFailureNotice(original, true);
  assert.match(display, /文件保存失败/);
  assert.match(display, /`\/opt\/report.md`：没有写入权限，文件未保存/);
  assert.doesNotMatch(display, /File-mutation verifier|hermes-tmp/);
  assert.equal(chatFileFailureNotice(original, false), original);
});
