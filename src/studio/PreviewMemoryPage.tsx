import { FileText, Pencil, RefreshCw, Smile, UserRound } from 'lucide-react-native';
import { memo, useCallback, useEffect, useState, type ComponentType } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { HermesApiClient } from '../api/HermesApiClient';
import type { StudioMemoryContent } from '../api/HermesCloudApi';
import { hermesCloudApiFor } from '../api/hermes-api-registry';
import { NativeButton } from '../components/ui/NativeButton';
import { multiplyAlpha } from '../design/control-contracts';
import { MOTION, useMotion } from '../design/motion';
import { useTheme } from '../design/ThemeProvider';
import type { PreviewPageProps } from '../preview/PreviewCorePages';
import { PREVIEW_MEMORY } from '../preview/preview-fixtures';
import { PreviewPage, PreviewText } from './PreviewPrimitives';

type MemorySectionId = 'memory' | 'user' | 'soul';
type MemoryTimestampId = 'memoryMtime' | 'userMtime' | 'soulMtime';

interface MemorySectionDefinition {
  empty: string;
  icon: ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  id: MemorySectionId;
  mtime: MemoryTimestampId;
  placeholder: string;
  title: string;
}

const MEMORY_SECTIONS: readonly MemorySectionDefinition[] = [
  { empty: 'Hermes 还没有保存笔记。', icon: FileText, id: 'memory', mtime: 'memoryMtime', placeholder: '记录 Hermes 应长期保留的事实和经验', title: '我的笔记' },
  { empty: '尚未形成用户画像。', icon: UserRound, id: 'user', mtime: 'userMtime', placeholder: '记录用户偏好、习惯和沟通方式', title: '用户画像' },
  { empty: '尚未设置 Hermes 的灵魂。', icon: Smile, id: 'soul', mtime: 'soulMtime', placeholder: '定义 Hermes 的身份、原则和表达方式', title: '灵魂' },
] as const;

const EMPTY_MEMORY: StudioMemoryContent = {
  memory: '',
  memoryMtime: '',
  soul: '',
  soulMtime: '',
  user: '',
  userMtime: '',
};

export function MemoryPreviewPage({
  client,
  fixtureMode = false,
  locale = 'zh',
  notify,
  profile,
}: PreviewPageProps & {
  client?: HermesApiClient;
  fixtureMode?: boolean;
  profile: string;
}) {
  const [content, setContent] = useState<StudioMemoryContent>(
    fixtureMode ? { ...PREVIEW_MEMORY } : EMPTY_MEMORY,
  );
  const [editing, setEditing] = useState<MemorySectionId | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(Boolean(client));
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!client) {
      setContent(fixtureMode ? { ...PREVIEW_MEMORY } : EMPTY_MEMORY);
      return;
    }
    setLoading(true);
    try {
      setContent(await hermesCloudApiFor(client).getStudioMemory(profile));
    } catch (error) {
      notify(memoryError(error, locale));
    } finally {
      setLoading(false);
    }
  }, [client, fixtureMode, locale, notify, profile]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (client) {
        setContent(await hermesCloudApiFor(client).saveStudioMemory(
          profile,
          editing,
          draft,
        ));
      } else if (fixtureMode) {
        setContent((current) => ({
          ...current,
          [editing]: draft,
          [`${editing}Mtime`]: locale === 'zh' ? '刚刚' : 'Just now',
        } as StudioMemoryContent));
      }
      setEditing(null);
      setDraft('');
      notify(locale === 'zh' ? '记忆已保存' : 'Memory saved');
    } catch (error) {
      notify(memoryError(error, locale));
    } finally {
      setSaving(false);
    }
  }, [client, draft, editing, fixtureMode, locale, notify, profile]);

  // Stable handlers keep the memoized sections' props identical while the
  // draft changes, so typing in one editor re-renders one section, not all
  // three full documents.
  const beginEdit = useCallback((section: MemorySectionId) => {
    setEditing(section);
    setDraft(content[section]);
  }, [content]);
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft('');
  }, []);
  const requestSave = useCallback(() => { void save(); }, [save]);

  return (
    <PreviewPage
      actions={(
        <NativeButton ghost onPress={() => { void load(); }} prefix={<RefreshCw />} size="sm">
          {locale === 'zh' ? '刷新' : 'Refresh'}
        </NativeButton>
      )}
      title={locale === 'zh' ? '记忆' : 'Memory'}
    >
      {loading ? (
        <MemorySkeleton />
      ) : (
        <MemorySections
          content={content}
          draft={draft}
          editing={editing}
          locale={locale}
          onCancel={cancelEdit}
          onChangeDraft={setDraft}
          onEdit={beginEdit}
          onSave={requestSave}
          saving={saving}
        />
      )}
    </PreviewPage>
  );
}

// Ambient placeholder while the server memory loads: same card geometry as
// the loaded sections so the page does not reflow, with a soft opacity pulse.
// Under Reduce Motion the pulse loop never starts (a static placeholder is
// rendered), which the parity contract requires of ambient animation.
function MemorySkeleton() {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const motion = useMotion();
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    if (motion.reduceMotion) {
      pulse.value = 0.55;
      return undefined;
    }
    pulse.value = withRepeat(
      withTiming(1, {
        duration: MOTION.duration.skeleton / 2,
        easing: Easing.bezier(...MOTION.easing.standard),
      }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [motion.reduceMotion, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <View style={[styles.sections, width < 860 && styles.sectionsCompact]}>
      {MEMORY_SECTIONS.map((section) => (
        <Reanimated.View
          key={section.id}
          style={[
            styles.section,
            styles.skeletonSection,
            { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border },
            pulseStyle,
          ]}
        >
          <View style={[styles.skeletonBar, { backgroundColor: tokens.colors.muted }]} />
          <View style={[styles.skeletonBar, styles.skeletonBarWide, { backgroundColor: tokens.colors.muted }]} />
          <View style={[styles.skeletonBar, { backgroundColor: tokens.colors.muted }]} />
        </Reanimated.View>
      ))}
    </View>
  );
}

function MemorySections({
  content,
  draft,
  editing,
  locale,
  onCancel,
  onChangeDraft,
  onEdit,
  onSave,
  saving,
}: {
  content: StudioMemoryContent;
  draft: string;
  editing: MemorySectionId | null;
  locale: 'en' | 'zh';
  onCancel(): void;
  onChangeDraft(value: string): void;
  onEdit(section: MemorySectionId): void;
  onSave(): void;
  saving: boolean;
}) {
  const { width } = useWindowDimensions();
  const motion = useMotion();
  return (
    <Reanimated.View
      entering={motion.animate(FadeIn.duration(MOTION.duration.transition))}
      style={[styles.sections, width < 860 && styles.sectionsCompact]}
    >
      {MEMORY_SECTIONS.map((section) => (
        <MemorySection
          content={content[section.id]}
          definition={section}
          // Only the section being edited sees the live draft (and the saving
          // flag); the other two keep identical props so memo() skips
          // re-rendering their full documents on every keystroke.
          draft={editing === section.id ? draft : ''}
          editing={editing === section.id}
          key={section.id}
          locale={locale}
          mtime={content[section.mtime]}
          onCancel={onCancel}
          onChangeDraft={onChangeDraft}
          onEdit={onEdit}
          onSave={onSave}
          saving={editing === section.id ? saving : false}
        />
      ))}
    </Reanimated.View>
  );
}

const MemorySection = memo(function MemorySection({
  content,
  definition,
  draft,
  editing,
  locale,
  mtime,
  onCancel,
  onChangeDraft,
  onEdit,
  onSave,
  saving,
}: {
  content: string;
  definition: MemorySectionDefinition;
  draft: string;
  editing: boolean;
  locale: 'en' | 'zh';
  mtime: string;
  onCancel(): void;
  onChangeDraft(value: string): void;
  onEdit(section: MemorySectionId): void;
  onSave(): void;
  saving: boolean;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const Icon = definition.icon;
  return (
    <View style={[styles.section, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
      <View
        style={[
          styles.sectionHeader,
          {
            backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.035),
            borderBottomColor: tokens.colors.border,
          },
        ]}
      >
        <View style={styles.sectionTitle}>
          <Icon color={tokens.colors.textSecondary} size={16} strokeWidth={1.6} />
          <PreviewText variant="heading">{definition.title}</PreviewText>
          {mtime ? <PreviewText variant="tiny">{mtime}</PreviewText> : null}
        </View>
        {!editing ? (
          <NativeButton ghost onPress={() => onEdit(definition.id)} prefix={<Pencil />} size="sm">
            {locale === 'zh' ? '编辑' : 'Edit'}
          </NativeButton>
        ) : null}
      </View>
      {editing ? (
        // Editor and read view cross-fade on the control timing instead of
        // popping; the entering prop is dropped entirely under Reduce Motion.
        <Reanimated.View
          entering={motion.animate(FadeIn.duration(MOTION.duration.control))}
          style={styles.editor}
        >
          <TextInput
            multiline
            onChangeText={onChangeDraft}
            placeholder={definition.placeholder}
            placeholderTextColor={tokens.colors.textTertiary}
            style={[
              styles.input,
              {
                backgroundColor: tokens.colors.background,
                borderColor: tokens.colors.border,
                color: tokens.colors.foreground,
              },
            ]}
            textAlignVertical="top"
            value={draft}
          />
          <View style={styles.actions}>
            <NativeButton disabled={saving} onPress={onCancel} size="sm">{locale === 'zh' ? '取消' : 'Cancel'}</NativeButton>
            <NativeButton disabled={saving} onPress={onSave} size="sm">{locale === 'zh' ? '保存' : 'Save'}</NativeButton>
          </View>
        </Reanimated.View>
      ) : (
        <Reanimated.View
          entering={motion.animate(FadeIn.duration(MOTION.duration.control))}
          style={styles.body}
        >
          <PreviewText style={styles.bodyText} variant={content ? 'body' : 'muted'}>
            {content || definition.empty}
          </PreviewText>
        </Reanimated.View>
      )}
    </View>
  );
});

function memoryError(error: unknown, locale: 'en' | 'zh'): string {
  const detail = error instanceof Error ? error.message : String(error);
  return locale === 'zh' ? `记忆操作失败：${detail}` : `Memory operation failed: ${detail}`;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  body: { flex: 1, minHeight: 250, padding: 16 },
  bodyText: { lineHeight: 24 },
  editor: { flex: 1, gap: 10, minHeight: 300, padding: 14 },
  input: { borderRadius: 6, borderWidth: 1, flex: 1, fontSize: 13, lineHeight: 21, minHeight: 240, padding: 12 },
  section: { borderRadius: 7, borderWidth: 1, flex: 1, minHeight: 360, minWidth: 0, overflow: 'hidden' },
  sectionHeader: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 12 },
  sectionTitle: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 8, minWidth: 0 },
  sections: { alignItems: 'stretch', flexDirection: 'row', gap: 16, minHeight: 500 },
  sectionsCompact: { flexDirection: 'column' },
  skeletonBar: { borderRadius: 4, height: 12, width: '52%' },
  skeletonBarWide: { width: '84%' },
  skeletonSection: { gap: 12, padding: 16 },
});
