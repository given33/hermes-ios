import * as Clipboard from 'expo-clipboard';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { IOSPressable } from '../components/ios/IOSPressable';
import { StudioRoleAvatar } from '../components/studio/StudioRoleAvatar';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import type { NativeThemeTokens } from '../design/theme-types';
import {
  formatTeamElapsed,
  teamMemberRoleLabel,
  teamMemberStateLabel,
  teamNodeLabel,
  teamRoster,
  type TeamMemberLiveState,
  type TeamParticipantIdentity,
  type TeamRosterEntry,
  type TeamTimelineEvent,
} from './team-participants-model';

const BODY_MEDIUM = 'HermesGoogle-IBMPlexSans-500-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const MONO_REGULAR = 'HermesTerminal-JetBrainsMono-400-Normal';

const LIVE_STATES: ReadonlySet<TeamMemberLiveState> = new Set([
  'executing',
  'reporting',
  'reviewing',
  'thinking',
  'typing',
]);

function stateColor(state: TeamMemberLiveState, tokens: NativeThemeTokens): string {
  if (state === 'done') return tokens.colors.success;
  if (state === 'failed') return tokens.colors.destructive;
  if (state === 'idle') return tokens.colors.textTertiary;
  return tokens.colors.primary;
}

interface TeamParticipantsStripProps {
  events: readonly TeamTimelineEvent[];
  isChinese: boolean;
  nowMs?: number;
  /** Called after the long-press participant copy lands on the clipboard. */
  onMemberCopied?: (entry: TeamRosterEntry) => void;
  participants?: readonly TeamParticipantIdentity[];
}

/**
 * Group-chat roster for one hosted agent team: every member joins with its
 * server identity and shows role, node, live state, elapsed time, and rework
 * rounds. All states come from persisted server events (or their fixtures);
 * nothing is animated into existence client side.
 */
export function TeamParticipantsStrip({
  events,
  isChinese,
  nowMs,
  onMemberCopied,
  participants,
}: TeamParticipantsStripProps) {
  const { tokens } = useTheme();
  const entries = useMemo(
    () => teamRoster({
      events,
      isChinese,
      now: nowMs ?? Date.now(),
      participants,
    }),
    [events, isChinese, nowMs, participants],
  );
  if (!entries.length) return null;
  const copyMemberInfo = async (entry: TeamRosterEntry) => {
    // Parity contract: long press copies the participant identity card.
    await Clipboard.setStringAsync([
      entry.displayName,
      `member_id: ${entry.id}`,
      `role: ${entry.role}`,
      `node: ${teamNodeLabel(entry.node)}`,
      `avatar_seed: ${entry.avatarSeed}`,
    ].join('\n'));
    onMemberCopied?.(entry);
  };
  return (
    <ScrollView
      accessibilityLabel={isChinese
        ? `${entries.length} 位团队成员`
        : `${entries.length} team members`}
      contentContainerStyle={styles.strip}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {entries.map((entry) => (
        <TeamMemberCard
          entry={entry}
          isChinese={isChinese}
          key={entry.id}
          onLongPress={() => { void copyMemberInfo(entry); }}
          tokens={tokens}
        />
      ))}
    </ScrollView>
  );
}

function TeamMemberCard({
  entry,
  isChinese,
  onLongPress,
  tokens,
}: {
  entry: TeamRosterEntry;
  isChinese: boolean;
  onLongPress: () => void;
  tokens: NativeThemeTokens;
}) {
  const accent = stateColor(entry.state, tokens);
  const live = LIVE_STATES.has(entry.state);
  return (
    <IOSPressable
      accessibilityLabel={isChinese
        ? `长按复制 ${entry.displayName} 的成员信息`
        : `Long press to copy ${entry.displayName} participant info`}
      delayLongPress={350}
      haptic="selection"
      onLongPress={onLongPress}
      style={[
        styles.card,
        {
          backgroundColor: tokens.colors.card,
          borderColor: live
            ? multiplyAlpha(tokens.colors.primary, 0.45)
            : tokens.colors.border,
        },
      ]}
    >
      <View style={styles.avatarWrap}>
        <StudioRoleAvatar role={entry.avatarRole} size={30} />
        <View
          style={[
            styles.stateDot,
            { backgroundColor: accent, borderColor: tokens.colors.card },
          ]}
        />
      </View>
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text
            numberOfLines={1}
            style={[styles.name, { color: tokens.colors.foreground }]}
          >
            {entry.displayName}
          </Text>
          <View
            style={[
              styles.roleChip,
              { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.12) },
            ]}
          >
            <Text style={[styles.roleChipText, { color: tokens.colors.primary }]}>
              {teamMemberRoleLabel(entry.role, isChinese)}
            </Text>
          </View>
          <Text style={[styles.node, { color: tokens.colors.textTertiary }]}>
            {teamNodeLabel(entry.node)}
          </Text>
        </View>
        <View style={styles.stateRow}>
          <Text numberOfLines={1} style={[styles.state, { color: accent }]}>
            {teamMemberStateLabel(entry.state, isChinese)}
          </Text>
          {entry.elapsedMs > 0 ? (
            <Text style={[styles.elapsed, { color: tokens.colors.textSecondary }]}>
              {formatTeamElapsed(entry.elapsedMs)}
            </Text>
          ) : null}
          {entry.reworkRounds > 0 ? (
            <View
              style={[
                styles.reworkBadge,
                { backgroundColor: multiplyAlpha(tokens.colors.warning, 0.18) },
              ]}
            >
              <Text style={[styles.reworkBadgeText, { color: tokens.colors.warning }]}>
                {isChinese
                  ? `返工 ×${entry.reworkRounds}`
                  : `Rework ×${entry.reworkRounds}`}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </IOSPressable>
  );
}

const styles = StyleSheet.create({
  avatarWrap: { height: 30, width: 30 },
  card: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  copy: { gap: 2 },
  elapsed: { fontFamily: MONO_REGULAR, fontSize: 10, lineHeight: 13 },
  name: { fontFamily: BODY_SEMIBOLD, fontSize: 12, lineHeight: 16, maxWidth: 132 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  node: { fontFamily: MONO_REGULAR, fontSize: 9, lineHeight: 12 },
  roleChip: { borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 },
  roleChipText: { fontFamily: BODY_SEMIBOLD, fontSize: 9, lineHeight: 12 },
  reworkBadge: { borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 },
  reworkBadgeText: { fontFamily: BODY_SEMIBOLD, fontSize: 9, lineHeight: 12 },
  state: { fontFamily: BODY_MEDIUM, fontSize: 10, lineHeight: 13 },
  stateDot: {
    borderRadius: 5,
    borderWidth: 1.5,
    bottom: -1,
    height: 10,
    position: 'absolute',
    right: -1,
    width: 10,
  },
  stateRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  strip: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
});
