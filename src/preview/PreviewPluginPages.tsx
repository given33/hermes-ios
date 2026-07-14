import {
  Archive,
  Award,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Columns3,
  Eye,
  Filter,
  ListFilter,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  Star,
  Trophy,
  UserRound,
  Users,
  Zap,
} from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { useTheme } from '../design/ThemeProvider';
import type { PreviewPageProps } from './PreviewCorePages';
import {
  PREVIEW_ACHIEVEMENTS,
  PREVIEW_KANBAN,
  PREVIEW_PROFILES,
} from './preview-fixtures';
import {
  PreviewBadge,
  PreviewCard,
  PreviewDataRow,
  PreviewGrid,
  PreviewMetric,
  PreviewModal,
  PreviewPage,
  PreviewProgress,
  PreviewRow,
  PreviewSearch,
  PreviewSegmented,
  PreviewSettingRow,
  PreviewText,
  PreviewToggle,
} from './PreviewPrimitives';

export function AchievementsPreviewPage({ notify }: PreviewPageProps) {
  const [visibility, setVisibility] = useState<'all' | 'unlocked' | 'discovered'>('all');
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const visible = PREVIEW_ACHIEVEMENTS.filter((achievement) => (
    visibility === 'all'
    || (visibility === 'unlocked' && achievement.unlocked)
    || (visibility === 'discovered' && !achievement.unlocked)
  ));
  return (
    <PreviewPage
      actions={<NativeButton onPress={() => notify('Achievement scan preview started')} outlined size="sm"><RefreshCw />Rescan</NativeButton>}
      eyebrow="Agentic Gamerscore"
      subtitle="Collectible Hermes badges earned from real session history."
      title="Hermes Achievements"
    >
      <PreviewGrid minItemWidth={170}>
        <PreviewMetric accent="#ffbd38" icon={Trophy} label="Unlocked" value="12" hint="earned badges" />
        <PreviewMetric icon={Eye} label="Discovered" value="7" hint="known, not earned" />
        <PreviewMetric icon={Sparkles} label="Secrets" value="3" hint="still hidden" />
        <PreviewMetric icon={Award} label="Highest tier" value="Gold" hint="Copper to Olympian" />
      </PreviewGrid>
      <PreviewRow style={styles.toolbarBetween}>
        <PreviewSegmented<'all' | 'unlocked' | 'discovered'>
          onChange={setVisibility}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Unlocked', value: 'unlocked' },
            { label: 'Discovered', value: 'discovered' },
          ]}
          value={visibility}
        />
        <PreviewBadge tone="success">SCAN COMPLETE</PreviewBadge>
      </PreviewRow>
      <PreviewGrid minItemWidth={280}>
        {visible.map((achievement) => (
          <PreviewCard
            action={<PreviewBadge tone={achievement.unlocked ? 'success' : 'outline'}>{achievement.unlocked ? 'UNLOCKED' : 'DISCOVERED'}</PreviewBadge>}
            key={achievement.name}
            subtitle={achievement.detail}
            title={achievement.name}
          >
            <View style={styles.achievementMark}>
              <Trophy color={achievement.unlocked ? '#ffbd38' : '#7f8f8f'} size={48} strokeWidth={1.25} />
            </View>
            <PreviewRow style={styles.toolbarBetween}>
              <PreviewBadge tone="warning">{achievement.tier.toUpperCase()}</PreviewBadge>
              <PreviewText variant="mono">{achievement.progress}%</PreviewText>
            </PreviewRow>
            <PreviewProgress color={achievement.unlocked ? '#ffbd38' : undefined} value={achievement.progress} />
            <NativeButton onPress={() => setShareTarget(achievement.name)} outlined size="sm"><Share2 />Share</NativeButton>
          </PreviewCard>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setShareTarget(null)} open={shareTarget !== null} title={`Share: ${shareTarget ?? ''}`}>
        <View style={styles.shareCard}>
          <Trophy color="#ffbd38" size={56} />
          <PreviewText variant="label">Hermes Achievement</PreviewText>
          <PreviewText variant="heading">{shareTarget}</PreviewText>
          <PreviewBadge tone="warning">UNLOCKED</PreviewBadge>
        </View>
        <PreviewRow>
          <NativeButton onPress={() => notify('Share image copied')} outlined>Copy image</NativeButton>
          <NativeButton onPress={() => notify('Achievement share sheet opened')}><Share2 />Share</NativeButton>
        </PreviewRow>
      </PreviewModal>
    </PreviewPage>
  );
}

export function KanbanPreviewPage({ notify }: PreviewPageProps) {
  const [query, setQuery] = useState('');
  const [newTask, setNewTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [lanes, setLanes] = useState(false);
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <NativeButton onPress={() => setNewTask(true)} size="sm"><Plus />New task</NativeButton>
          <NativeButton accessibilityLabel="Refresh board" ghost onPress={() => notify('Kanban board refreshed')} size="icon"><RefreshCw /></NativeButton>
        </PreviewRow>
      )}
      subtitle="Multi-agent workflow board with task ownership, dependencies, comments, and run history."
      title="Kanban"
    >
      <PreviewCard>
        <PreviewRow style={styles.toolbarBetween}>
          <PreviewSearch onChangeText={setQuery} placeholder="Filter cards..." value={query} />
          <PreviewSettingRow label="Lanes by profile" trailing={<PreviewToggle accessibilityLabel="Lanes by profile" onChange={setLanes} value={lanes} />} />
          <PreviewBadge tone="outline">Native iOS</PreviewBadge>
        </PreviewRow>
      </PreviewCard>
      <ScrollView
        contentContainerStyle={styles.board}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {PREVIEW_KANBAN.map((column) => (
          <View key={column.name} style={styles.column}>
            <View style={styles.columnHeader}>
              <PreviewRow>
                <PreviewText variant="label">{column.name}</PreviewText>
                <PreviewBadge tone="outline">{column.cards.length}</PreviewBadge>
              </PreviewRow>
              <NativeButton accessibilityLabel={`Add task to ${column.name}`} ghost onPress={() => setNewTask(true)} size="icon"><Plus /></NativeButton>
            </View>
            <View style={styles.columnCards}>
              {column.cards
                .filter((card) => `${card.id} ${card.title} ${card.profile}`.toLowerCase().includes(query.toLowerCase()))
                .map((card) => (
                  <PreviewCard key={card.id} style={styles.taskCard}>
                    <PreviewRow style={styles.toolbarBetween}>
                      <PreviewText variant="mono">{card.id}</PreviewText>
                      <PreviewBadge tone={card.priority === 'P0' ? 'danger' : card.priority === 'P1' ? 'warning' : 'outline'}>{card.priority}</PreviewBadge>
                    </PreviewRow>
                    <PreviewText variant="heading">{card.title}</PreviewText>
                    <PreviewRow>
                      <UserRound size={14} />
                      <PreviewText variant="tiny">{card.profile}</PreviewText>
                    </PreviewRow>
                    <NativeButton onPress={() => setSelectedTask(card.id)} outlined size="sm">Open</NativeButton>
                  </PreviewCard>
                ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <PreviewModal onClose={() => setNewTask(false)} open={newTask} title="New task">
        <NativeInput onChangeText={setTaskTitle} placeholder="Task title..." value={taskTitle} />
        <NativeInput multiline placeholder="Description and acceptance criteria" />
        <PreviewSettingRow label="Assignee" trailing={<PreviewBadge>ios-native</PreviewBadge>} />
        <PreviewSettingRow label="Priority" trailing={<PreviewBadge tone="warning">P1</PreviewBadge>} />
        <NativeInput placeholder="Workspace path, e.g. ~/projects/my-app" />
        <NativeButton disabled={!taskTitle.trim()} onPress={() => {
          notify(`Previewed task creation: ${taskTitle}`);
          setTaskTitle('');
          setNewTask(false);
        }}>Create task</NativeButton>
      </PreviewModal>
      <PreviewModal onClose={() => setSelectedTask(null)} open={selectedTask !== null} title={selectedTask ?? ''}>
        <PreviewText variant="heading">Complete frontend fixture routes</PreviewText>
        <PreviewBadge tone="success">RUNNING</PreviewBadge>
        <PreviewDataRow label="Assignee" value="ios-native" />
        <PreviewDataRow label="Workspace" mono value="~/hermes-ios" />
        <PreviewDataRow label="Created by" value="default" />
        <PreviewText variant="label">Comments</PreviewText>
        <PreviewCard>
          <PreviewText variant="muted">default · 14:01</PreviewText>
          <PreviewText>Keep all WebUI routes represented in the native preview.</PreviewText>
        </PreviewCard>
        <NativeInput placeholder="Add comment..." />
        <PreviewRow>
          <NativeButton onPress={() => notify(`${selectedTask} marked complete`)}><CheckCircle2 />Complete</NativeButton>
          <NativeButton outlined><Archive />Archive</NativeButton>
        </PreviewRow>
      </PreviewModal>
    </PreviewPage>
  );
}

export function CollaborationPreviewPage({ notify }: PreviewPageProps) {
  const [channel, setChannel] = useState<'general' | 'ios' | 'research'>('general');
  const [draft, setDraft] = useState('');
  return (
    <PreviewPage
      actions={<PreviewBadge tone="success">3 PROFILES ONLINE</PreviewBadge>}
      subtitle="Group chat and shared workflow slot provided by the collaboration plugin."
      title="Group Chat & Workflow"
    >
      <PreviewSegmented<'general' | 'ios' | 'research'>
        onChange={setChannel}
        options={[
          { label: '# general', value: 'general' },
          { label: '# ios-native', value: 'ios' },
          { label: '# research', value: 'research' },
        ]}
        value={channel}
      />
      <View style={styles.collaborationLayout}>
        <PreviewCard style={styles.collaborationChat} title={`# ${channel}`}>
          <GroupMessage profile="default" time="14:01" text="The shell contract is stable. Start the frontend-only page surfaces." />
          <GroupMessage profile="ios-native" time="14:04" text="Core routes are rendered with local fixtures and native controls." />
          <GroupMessage profile="researcher" time="14:05" text="WebUI source ownership and plugin ordering remain unchanged." />
          <PreviewRow>
            <NativeInput onChangeText={setDraft} placeholder={`Message #${channel}`} style={styles.flexInput} value={draft} />
            <NativeButton accessibilityLabel="Send message" disabled={!draft.trim()} onPress={() => {
              notify('Group message staged locally');
              setDraft('');
            }} size="icon"><Send /></NativeButton>
          </PreviewRow>
        </PreviewCard>
        <PreviewCard style={styles.collaborationMembers} title="Profiles">
          {PREVIEW_PROFILES.map((profile) => (
            <PreviewSettingRow
              key={profile.name}
              detail={profile.model}
              label={profile.name}
              trailing={<PreviewBadge tone={profile.active ? 'success' : 'outline'}>{profile.active ? 'LEAD' : 'ONLINE'}</PreviewBadge>}
            />
          ))}
        </PreviewCard>
      </View>
    </PreviewPage>
  );
}

function GroupMessage({ profile, text, time }: { profile: string; text: string; time: string }) {
  return (
    <View style={styles.groupMessage}>
      <View style={styles.groupAvatar}><UserRound size={15} /></View>
      <View style={styles.flexCopy}>
        <PreviewRow><PreviewText variant="heading">{profile}</PreviewText><PreviewText variant="tiny">{time}</PreviewText></PreviewRow>
        <PreviewText>{text}</PreviewText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbarBetween: {
    justifyContent: 'space-between',
  },
  achievementMark: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 88,
  },
  shareCard: {
    alignItems: 'center',
    backgroundColor: '#041c1c',
    gap: 10,
    justifyContent: 'center',
    minHeight: 260,
    padding: 24,
  },
  board: {
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 8,
  },
  column: {
    gap: 8,
    width: 286,
  },
  columnHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 42,
  },
  columnCards: {
    gap: 8,
  },
  taskCard: {
    minHeight: 168,
  },
  collaborationLayout: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  collaborationChat: {
    flex: 3,
    minWidth: 280,
  },
  collaborationMembers: {
    flex: 1,
    minWidth: 240,
  },
  groupMessage: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  groupAvatar: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  flexCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  flexInput: {
    flex: 1,
    minWidth: 160,
  },
});
