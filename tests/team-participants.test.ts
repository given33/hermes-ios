import assert from 'node:assert/strict';
import test from 'node:test';

import { previewTurnMessages } from '../src/preview/chat-fixture-simulator';
import { PREVIEW_TEAM_PARTICIPANTS } from '../src/preview/preview-fixtures';
import {
  eventReworkBadge,
  eventReworkRound,
  formatTeamElapsed,
  isHostedTeamEvent,
  teamMemberIdForEvent,
  teamMemberStateLabel,
  teamRoster,
} from '../src/studio/team-participants-model';

const STARTED_AT = 100_000;

function teamPlayback() {
  return previewTurnMessages({
    collaborative: true,
    isChinese: true,
    startedAt: STARTED_AT,
    turnId: 'turn-team',
  });
}

test('hosted stage events map to canonical member ids without hardcoding', () => {
  assert.equal(
    teamMemberIdForEvent({ memberId: 'pc-worker', roleStage: 'worker' }),
    'pc-worker',
  );
  // Fallbacks mirror the server hosted_member_id when member_id is absent.
  assert.equal(
    teamMemberIdForEvent({ profile: 'pc-worker', rawRoleStage: 'worker:pc-worker' }),
    'pc-worker',
  );
  assert.equal(
    teamMemberIdForEvent({ profile: 'dispatcher', roleStage: 'dispatcher' }),
    'dbb3-manager',
  );
  assert.equal(
    teamMemberIdForEvent({ rawRoleStage: 'manager_handoff' }),
    'dbb3-manager',
  );
  assert.equal(
    teamMemberIdForEvent({ profile: 'default', rawRoleStage: 'reporter' }),
    'default',
  );
  assert.equal(isHostedTeamEvent({ role: 'user', roleStage: 'chat' }), false);
  assert.equal(isHostedTeamEvent({ profile: 'default', roleStage: 'chat' }), false);
  assert.equal(isHostedTeamEvent({ rawRoleStage: 'worker:dbb3-worker:rework:1' }), true);
});

test('a completed team run yields a full roster with elapsed and rework badges', () => {
  const roster = teamRoster({
    events: teamPlayback(),
    isChinese: true,
    now: STARTED_AT + 60_000,
    participants: PREVIEW_TEAM_PARTICIPANTS,
  });

  // Server participants[] order (dispatch order) is authoritative.
  assert.deepEqual(
    roster.map(({ id }) => id),
    ['dbb3-manager', 'dbb3-worker', 'pc-worker', 'reviewer', 'default'],
  );
  assert.deepEqual(
    roster.map(({ role }) => role),
    ['manager', 'worker', 'worker', 'reviewer', 'reporter'],
  );
  assert.deepEqual(
    roster.map(({ node }) => node),
    ['dbb3', 'dbb3', 'wsl', 'dbb3', 'main'],
  );
  assert.deepEqual(
    roster.map(({ displayName }) => displayName),
    ['Hermes 调度员', 'DBB3 执行员', 'PC/WSL 执行员', 'Hermes 审阅员', 'Hermes 汇报员'],
  );
  assert.ok(roster.every(({ state }) => state === 'done'));
  assert.ok(roster.every(({ avatarSeed }) => avatarSeed.startsWith('hermes-member-')));

  // Rework badges: both workers and the reviewer went through round 1.
  assert.deepEqual(
    roster.map(({ reworkRounds }) => reworkRounds),
    [0, 1, 1, 1, 0],
  );

  // Per-member elapsed sums stage segments and skips waiting gaps:
  // manager 720ms plan + 400ms handoff, workers first pass + rework, etc.
  assert.deepEqual(
    roster.map(({ elapsedMs }) => elapsedMs),
    [1_120, 2_080, 2_280, 1_320, 710],
  );
  assert.equal(formatTeamElapsed(2_080), '2s');
  assert.equal(formatTeamElapsed(125_000), '2m 05s');
  assert.equal(formatTeamElapsed(3_725_000), '1h 02m');
});

test('live states follow persisted events through the whole lifecycle', () => {
  const playback = teamPlayback();
  const stateAt = (upto: number, memberId: string, now: number) => {
    const roster = teamRoster({
      events: playback.slice(0, upto),
      isChinese: true,
      now,
      participants: PREVIEW_TEAM_PARTICIPANTS,
    });
    return roster.find(({ id }) => id === memberId)?.state;
  };

  // Manager planning silently: thinking. Members not yet active: idle.
  assert.equal(stateAt(1, 'dbb3-manager', STARTED_AT + 300), 'thinking');
  assert.equal(stateAt(1, 'dbb3-worker', STARTED_AT + 300), 'idle');
  // Both workers running in parallel while the manager is done.
  assert.equal(stateAt(4, 'dbb3-worker', STARTED_AT + 1_500), 'executing');
  assert.equal(stateAt(4, 'pc-worker', STARTED_AT + 1_500), 'executing');
  assert.equal(stateAt(4, 'dbb3-manager', STARTED_AT + 1_500), 'done');
  // Reviewer reviewing, then the rejection makes the rework round visible.
  assert.equal(stateAt(7, 'reviewer', STARTED_AT + 2_600), 'reviewing');
  const afterRejection = teamRoster({
    events: playback.slice(0, 8),
    isChinese: true,
    now: STARTED_AT + 3_200,
    participants: PREVIEW_TEAM_PARTICIPANTS,
  });
  assert.equal(afterRejection.find(({ id }) => id === 'reviewer')?.reworkRounds, 1);
  // Workers executing again during rework.
  assert.equal(stateAt(10, 'pc-worker', STARTED_AT + 3_500), 'executing');
  // Manager streams the handoff text: typing. Reporter publishes: reporting.
  assert.equal(stateAt(14, 'dbb3-manager', STARTED_AT + 4_800), 'typing');
  assert.equal(stateAt(16, 'default', STARTED_AT + 5_400), 'reporting');
  // Failed terminal events surface as failed.
  const failed = teamRoster({
    events: [{
      id: 'evt-fail',
      memberId: 'dbb3-worker',
      rawRoleStage: 'worker:dbb3-worker',
      startedAt: STARTED_AT,
      status: 'failed',
    }],
    isChinese: true,
    now: STARTED_AT + 1_000,
  });
  assert.equal(failed[0]?.state, 'failed');
  assert.equal(teamMemberStateLabel('executing', true), '执行中');
  assert.equal(teamMemberStateLabel('typing', false), 'Typing');
});

test('rework round parsing separates requests from rework execution', () => {
  assert.equal(eventReworkRound({ rawRoleStage: 'worker:pc-worker:rework:2' }), 2);
  // The rejection that requests round N belongs to review round N-1.
  assert.equal(eventReworkRound({ rawRoleStage: 'reviewer:rework-request:1' }), 0);
  assert.equal(eventReworkBadge({ rawRoleStage: 'reviewer:rework-request:1' }), 1);
  assert.equal(eventReworkBadge({ rawRoleStage: 'reviewer:rework:1' }), 1);
  assert.equal(eventReworkBadge({ rawRoleStage: 'worker' }), 0);
});
