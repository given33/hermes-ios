import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceStreamText, followStreamOffset, shouldResumeStreamFollow } from '../src/studio/chat/stream-motion-model';

test('append bursts advance monotonically and converge to the exact Unicode text', () => {
  const target = 'Checking \u{1F680} \u{20000} results\n'.repeat(30);
  let visible = '';
  for (let frame = 0; frame < 100 && visible !== target; frame += 1) {
    const next = advanceStreamText(visible, target, 32);
    assert.ok(target.startsWith(next));
    assert.ok(next.length > visible.length);
    assert.ok(!/[\uD800-\uDBFF]$/.test(next));
    visible = next;
  }
  assert.equal(visible, target);
});

test('authoritative correction and retraction immediately replace buffered content', () => {
  assert.equal(advanceStreamText('old content', 'corrected', 16), 'corrected');
  assert.equal(advanceStreamText('too much content', 'too', 16), 'too');
  assert.equal(advanceStreamText('content', '', 16), '');
});

test('follow damping tracks a moving target without overshoot and settles exactly', () => {
  let current = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    const target = frame < 30 ? (frame + 1) * 20 : 600;
    const next = followStreamOffset(current, target, 1000 / 60);
    assert.ok(next >= current && next <= target);
    current = next;
  }
  assert.equal(current, 600);
  for (let frame = 0; frame < 90; frame += 1) current = followStreamOffset(current, 120, 1000 / 60);
  assert.equal(current, 120);
});

test('follow speed is independent of refresh rate', () => {
  let sixty = 0;
  let oneTwenty = 0;
  for (let frame = 0; frame < 12; frame += 1) sixty = followStreamOffset(sixty, 1000, 1000 / 60);
  for (let frame = 0; frame < 24; frame += 1) oneTwenty = followStreamOffset(oneTwenty, 1000, 1000 / 120);
  assert.ok(Math.abs(sixty - oneTwenty) < 0.01);
});

test('upward flicks retain momentum near the bottom while downward arrivals resume following', () => {
  assert.equal(shouldResumeStreamFollow(10, -0.8), false);
  assert.equal(shouldResumeStreamFollow(10, 0.8), true);
  assert.equal(shouldResumeStreamFollow(80, 0.8), false);
  assert.equal(shouldResumeStreamFollow(0), true);
  assert.equal(shouldResumeStreamFollow(-12), true);
});
