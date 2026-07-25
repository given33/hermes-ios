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
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { StudioProfileAvatar } from '../components/studio/StudioProfileAvatar';
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

export function AchievementsPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const chinese = locale === 'zh';
  const [visibility, setVisibility] = useState<'all' | 'unlocked' | 'discovered'>('all');
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const visible = PREVIEW_ACHIEVEMENTS.filter((achievement) => (
    visibility === 'all'
    || (visibility === 'unlocked' && achievement.unlocked)
    || (visibility === 'discovered' && !achievement.unlocked)
  ));
  const shareAchievement = async () => {
    if (!shareTarget) return;
    await Share.share({
      message: chinese
        ? `Hermes 成就：${achievementNameZh(shareTarget)} - 已解锁`
        : `Hermes Achievement: ${shareTarget} - Unlocked`,
      title: chinese ? `Hermes 成就：${achievementNameZh(shareTarget)}` : `Hermes Achievement: ${shareTarget}`,
    });
    notify(chinese ? '成就已分享' : 'Achievement shared');
  };
  return (
    <PreviewPage
      actions={<NativeButton ghost haptic="selection" onPress={() => notify(chinese ? '成就扫描已开始' : 'Achievement scan started')} prefix={<RefreshCw />} size="sm">{chinese ? '重新扫描' : 'Rescan'}</NativeButton>}
      eyebrow={chinese ? '智能体成就积分' : 'Agentic Gamerscore'}
      subtitle={chinese ? '根据真实会话历史解锁 Hermes 收藏徽章。' : 'Collectible Hermes badges earned from real session history.'}
      title={chinese ? 'Hermes 成就图鉴' : 'Hermes Achievements'}
    >
      <PreviewGrid minItemWidth={170}>
        <PreviewMetric accent="#ffbd38" icon={Trophy} label={chinese ? '已解锁' : 'Unlocked'} value="12" hint={chinese ? '已获得徽章' : 'earned badges'} />
        <PreviewMetric icon={Eye} label={chinese ? '已发现' : 'Discovered'} value="7" hint={chinese ? '已知但未获得' : 'known, not earned'} />
        <PreviewMetric icon={Sparkles} label={chinese ? '隐藏成就' : 'Secrets'} value="3" hint={chinese ? '仍待发现' : 'still hidden'} />
        <PreviewMetric icon={Award} label={chinese ? '最高等级' : 'Highest tier'} value={chinese ? '黄金' : 'Gold'} hint={chinese ? '青铜至奥林匹克' : 'Copper to Olympian'} />
      </PreviewGrid>
      <PreviewRow style={styles.toolbarBetween}>
        <PreviewSegmented<'all' | 'unlocked' | 'discovered'>
          onChange={setVisibility}
          options={[
            { label: chinese ? '全部' : 'All', value: 'all' },
            { label: chinese ? '已解锁' : 'Unlocked', value: 'unlocked' },
            { label: chinese ? '已发现' : 'Discovered', value: 'discovered' },
          ]}
          value={visibility}
        />
        <PreviewBadge tone="success">{chinese ? '扫描完成' : 'SCAN COMPLETE'}</PreviewBadge>
      </PreviewRow>
      <PreviewGrid minItemWidth={280}>
        {visible.map((achievement) => (
          <PreviewCard
            action={<PreviewBadge tone={achievement.unlocked ? 'success' : 'outline'}>{achievement.unlocked ? (chinese ? '已解锁' : 'UNLOCKED') : (chinese ? '已发现' : 'DISCOVERED')}</PreviewBadge>}
            key={achievement.name}
            subtitle={chinese ? achievementDetailZh(achievement.name) : achievement.detail}
            title={chinese ? achievementNameZh(achievement.name) : achievement.name}
          >
            <View style={styles.achievementMark}>
              <Trophy color={achievement.unlocked ? '#ffbd38' : '#7f8f8f'} size={48} strokeWidth={1.25} />
            </View>
            <PreviewRow style={styles.toolbarBetween}>
              <PreviewBadge tone="warning">{chinese ? achievementTierZh(achievement.tier) : achievement.tier.toUpperCase()}</PreviewBadge>
              <PreviewText variant="mono">{achievement.progress}%</PreviewText>
            </PreviewRow>
            <PreviewProgress color={achievement.unlocked ? '#ffbd38' : undefined} value={achievement.progress} />
            <NativeButton ghost haptic="selection" onPress={() => setShareTarget(achievement.name)} prefix={<Share2 />} size="sm">{chinese ? '分享' : 'Share'}</NativeButton>
          </PreviewCard>
        ))}
      </PreviewGrid>
      <PreviewModal onClose={() => setShareTarget(null)} open={shareTarget !== null} title={chinese ? `分享：${achievementNameZh(shareTarget ?? '')}` : `Share: ${shareTarget ?? ''}`}>
        <View style={styles.shareCard}>
          <Trophy color="#ffbd38" size={56} />
          <PreviewText variant="label">{chinese ? 'Hermes 成就' : 'Hermes Achievement'}</PreviewText>
          <PreviewText variant="heading">{chinese ? achievementNameZh(shareTarget ?? '') : shareTarget}</PreviewText>
          <PreviewBadge tone="warning">{chinese ? '已解锁' : 'UNLOCKED'}</PreviewBadge>
        </View>
        <PreviewRow>
          <NativeButton ghost onPress={() => notify(chinese ? '分享图片已复制' : 'Share image copied')}>{chinese ? '复制图片' : 'Copy image'}</NativeButton>
          <NativeButton haptic="light" onPress={() => void shareAchievement()} prefix={<Share2 />}>{chinese ? '分享' : 'Share'}</NativeButton>
        </PreviewRow>
      </PreviewModal>
    </PreviewPage>
  );
}

function achievementNameZh(name: string): string {
  return ({
    'Deep Context': '深度上下文',
    'Native Instinct': '原生直觉',
    'Night Shift': '夜间值守',
    Toolsmith: '工具大师',
  } as Record<string, string>)[name] ?? name;
}

function achievementDetailZh(name: string): string {
  return ({
    'Deep Context': '完成一次输入超过 10 万 Token 的会话。',
    'Native Instinct': '在不依赖浏览器界面的情况下交付一个工作流。',
    'Night Shift': '在午夜至 05:00 之间完成十项任务。',
    Toolsmith: '在 Hermes 会话中累计完成 100 次工具调用。',
  } as Record<string, string>)[name] ?? name;
}

function achievementTierZh(tier: string): string {
  return ({ Copper: '青铜', Diamond: '钻石', Gold: '黄金', Silver: '白银' } as Record<string, string>)[tier] ?? tier;
}

export function KanbanPreviewPage({ locale = 'zh', notify }: PreviewPageProps) {
  const chinese = locale === 'zh';
  const [query, setQuery] = useState('');
  const [newTask, setNewTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [lanes, setLanes] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'review'>('all');
  const [archivedTasks, setArchivedTasks] = useState<ReadonlySet<string>>(() => new Set());
  const visibleColumns = PREVIEW_KANBAN.filter((column) => (
    statusFilter === 'all'
    || (statusFilter === 'running' && column.name === 'Running')
    || (statusFilter === 'review' && ['Triage', 'Ready'].includes(column.name))
  ));
  return (
    <PreviewPage
      actions={(
        <PreviewRow>
          <PreviewBadge tone="outline">Hermes Board · 5 tasks</PreviewBadge>
          <NativeButton outlined onPress={() => notify(chinese ? '已触发任务调度' : 'Dispatch nudged')} size="sm">{chinese ? '调度' : 'Dispatch'}</NativeButton>
          <NativeButton onPress={() => setNewTask(true)} prefix={<Plus />} size="sm">{chinese ? '创建任务' : 'New task'}</NativeButton>
          <NativeButton accessibilityLabel="Refresh board" ghost onPress={() => notify(chinese ? '看板已刷新' : 'Kanban board refreshed')} size="icon"><RefreshCw /></NativeButton>
        </PreviewRow>
      )}
      title={chinese ? '看板' : 'Kanban'}
    >
      <PreviewRow style={styles.toolbarBetween}>
        <View style={styles.kanbanSearch}>
          <PreviewSearch onChangeText={setQuery} placeholder={chinese ? '筛选任务...' : 'Filter cards...'} value={query} />
        </View>
        <PreviewSegmented<'all' | 'running' | 'review'>
          onChange={setStatusFilter}
          options={[
            { label: chinese ? '全部状态' : 'All statuses', value: 'all' },
            { label: chinese ? '运行中' : 'Running', value: 'running' },
            { label: chinese ? '审查' : 'Review', value: 'review' },
          ]}
          value={statusFilter}
        />
        <PreviewSettingRow label={chinese ? '按 Profile 分栏' : 'Lanes by profile'} trailing={<PreviewToggle accessibilityLabel="Lanes by profile" onChange={setLanes} value={lanes} />} />
      </PreviewRow>
      <ScrollView
        contentContainerStyle={styles.board}
        decelerationRate="normal"
        directionalLockEnabled
        horizontal
        scrollEventThrottle={8}
        showsHorizontalScrollIndicator={false}
      >
        {visibleColumns.map((column) => (
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
                .filter((card) => !archivedTasks.has(card.id))
                .filter((card) => `${card.id} ${card.title} ${card.profile}`.toLowerCase().includes(query.toLowerCase()))
                .map((card) => (
                  <PreviewCard key={card.id} style={styles.taskCard}>
                    <PreviewRow style={styles.toolbarBetween}>
                      <PreviewText variant="mono">{card.id}</PreviewText>
                      <PreviewBadge tone={card.priority === 'P0' ? 'danger' : card.priority === 'P1' ? 'warning' : 'outline'}>{card.priority}</PreviewBadge>
                    </PreviewRow>
                    <PreviewText variant="heading">{card.title}</PreviewText>
                    <PreviewRow>
                      <StudioProfileAvatar seed={card.profile} size={18} />
                      <PreviewText variant="tiny">{card.profile}</PreviewText>
                    </PreviewRow>
                    <NativeButton onPress={() => setSelectedTask(card.id)} outlined size="sm">{chinese ? '打开' : 'Open'}</NativeButton>
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
          notify(`Created task: ${taskTitle}`);
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
          <NativeButton onPress={() => notify(`${selectedTask} marked complete`)} prefix={<CheckCircle2 />}>Complete</NativeButton>
          <NativeButton onPress={() => {
            if (!selectedTask) return;
            setArchivedTasks((current) => new Set([...current, selectedTask]));
            notify(`${selectedTask} archived`);
            setSelectedTask(null);
          }} outlined prefix={<Archive />}>Archive</NativeButton>
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
              notify('Group message sent');
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  kanbanSearch: {
    flex: 1,
    minWidth: 220,
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
