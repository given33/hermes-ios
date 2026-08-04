import { Package, Pencil, Plus, RefreshCw } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import type { HermesCloudApi, JsonRecord } from '../api/HermesCloudApi';
import { NativeButton } from '../components/ui/NativeButton';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  PreviewBadge,
  PreviewModal,
  PreviewPage,
  PreviewText,
  PreviewToggle,
} from '../studio/PreviewPrimitives';
import {
  DEFAULT_CUSTOM_SKILL_DOCUMENT,
  isValidSkillName,
  materializeSkillDocument,
} from './skill-editor-model';

interface SkillItem {
  bundled: boolean;
  detail: string;
  enabled: boolean;
  id: string;
  name: string;
  source: string;
}

export interface SkillsManagementPageProps {
  api: HermesCloudApi;
  locale?: 'en' | 'zh';
  notify(message: string): void;
  profile: string;
}

export function SkillsManagementPage({
  api,
  locale = 'zh',
  notify,
  profile,
}: SkillsManagementPageProps) {
  const { tokens } = useTheme();
  const chinese = locale === 'zh';
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busySkill, setBusySkill] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorID, setEditorID] = useState('');
  const [editorName, setEditorName] = useState('');
  const [editorCategory, setEditorCategory] = useState('custom');
  const [editorContent, setEditorContent] = useState(DEFAULT_CUSTOM_SKILL_DOCUMENT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getSkills(profile);
      setSkills(normalizeSkills(response.skills));
    } catch (error) {
      notify(errorMessage(error, chinese));
    } finally {
      setLoading(false);
    }
  }, [api, chinese, notify, profile]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return skills;
    return skills.filter((skill) => (
      `${skill.name} ${skill.detail} ${skill.source}`.toLowerCase().includes(normalized)
    ));
  }, [query, skills]);

  const createSkill = useCallback(() => {
    setEditorID('');
    setEditorName('');
    setEditorCategory('custom');
    setEditorContent(DEFAULT_CUSTOM_SKILL_DOCUMENT);
    setEditorOpen(true);
  }, []);

  const editSkill = useCallback(async (skill: SkillItem) => {
    setBusySkill(skill.id);
    try {
      const response = await api.getSkillContent(skill.id, profile);
      setEditorID(skill.id);
      setEditorName(skill.name);
      setEditorCategory('');
      setEditorContent(stringField(response, 'content') || stringField(response, 'text'));
      setEditorOpen(true);
    } catch (error) {
      notify(errorMessage(error, chinese));
    } finally {
      setBusySkill('');
    }
  }, [api, chinese, notify, profile]);

  const toggleSkill = useCallback(async (skill: SkillItem, enabled: boolean) => {
    setBusySkill(skill.id);
    setSkills((current) => current.map((entry) => (
      entry.id === skill.id ? { ...entry, enabled } : entry
    )));
    try {
      await api.toggleSkill(skill.id, enabled, profile);
    } catch (error) {
      setSkills((current) => current.map((entry) => (
        entry.id === skill.id ? { ...entry, enabled: !enabled } : entry
      )));
      notify(errorMessage(error, chinese));
    } finally {
      setBusySkill('');
    }
  }, [api, chinese, notify, profile]);

  const saveSkill = useCallback(async () => {
    const name = editorName.trim();
    const content = materializeSkillDocument(name, editorContent);
    if (!editorID && !isValidSkillName(name)) {
      notify(chinese
        ? 'Skill 名称只能使用小写字母、数字、点、下划线和连字符。'
        : 'Skill names may contain lowercase letters, numbers, dots, underscores, and hyphens.');
      return;
    }
    if (!content.startsWith('---') || !content.includes('\ndescription:') || !content.includes('\n---\n')) {
      notify(chinese ? 'SKILL.md 需要完整的 YAML frontmatter。' : 'SKILL.md requires valid YAML frontmatter.');
      return;
    }
    setSaving(true);
    try {
      if (editorID) {
        await api.updateSkillContent(editorID, content, profile);
      } else {
        await api.createSkill(name, content, editorCategory.trim(), profile);
      }
      setEditorOpen(false);
      notify(chinese ? 'Skill 已保存' : 'Skill saved.');
      await load();
    } catch (error) {
      notify(errorMessage(error, chinese));
    } finally {
      setSaving(false);
    }
  }, [api, chinese, editorCategory, editorContent, editorID, editorName, load, notify, profile]);

  return (
    <PreviewPage
      actions={(
        <View style={styles.actions}>
          <NativeButton
            accessibilityLabel={chinese ? '刷新 Skill' : 'Refresh skills'}
            ghost
            onPress={() => { void load(); }}
            prefix={<RefreshCw />}
            size="sm"
          >
            {chinese ? '刷新' : 'Refresh'}
          </NativeButton>
          <NativeButton onPress={createSkill} prefix={<Plus />} size="sm">
            {chinese ? '新建 Skill' : 'New Skill'}
          </NativeButton>
        </View>
      )}
      subtitle={chinese ? `当前 Profile：${profile}` : `Current profile: ${profile}`}
      title={chinese ? '技能' : 'Skills'}
    >
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder={chinese ? '搜索 Skill' : 'Search skills'}
        placeholderTextColor={tokens.colors.textTertiary}
        style={[
          styles.search,
          {
            backgroundColor: tokens.colors.input,
            borderColor: tokens.colors.border,
            color: tokens.colors.foreground,
          },
        ]}
        value={query}
      />

      <View style={[styles.list, { borderColor: tokens.colors.border }]}>
        {loading ? (
          <View style={styles.loading}><ActivityIndicator /></View>
        ) : filtered.length ? filtered.map((skill, index) => (
          <View
            key={skill.id}
            style={[
              styles.row,
              index < filtered.length - 1 && { borderBottomColor: tokens.colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <View style={[styles.icon, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.12) }]}>
              <Package color={tokens.colors.primary} size={20} strokeWidth={2} />
            </View>
            <View style={styles.copy}>
              <View style={styles.titleRow}>
                <PreviewText variant="heading">{skill.name}</PreviewText>
                <PreviewBadge tone={skill.bundled ? 'outline' : 'default'}>
                  {skill.bundled ? (chinese ? '内置' : 'Built-in') : skill.source || (chinese ? '自定义' : 'Custom')}
                </PreviewBadge>
              </View>
              {skill.detail ? <PreviewText variant="tiny">{skill.detail}</PreviewText> : null}
            </View>
            <NativeButton
              accessibilityLabel={`${chinese ? '编辑' : 'Edit'} ${skill.name}`}
              disabled={busySkill === skill.id}
              ghost
              onPress={() => { void editSkill(skill); }}
              size="icon"
            >
              <Pencil />
            </NativeButton>
            <PreviewToggle
              accessibilityLabel={`${chinese ? '启用' : 'Enable'} ${skill.name}`}
              disabled={busySkill === skill.id}
              onChange={(enabled) => { void toggleSkill(skill, enabled); }}
              value={skill.enabled}
            />
          </View>
        )) : (
          <View style={styles.empty}>
            <PreviewText variant="muted">
              {chinese ? '没有匹配的 Skill' : 'No matching skills.'}
            </PreviewText>
          </View>
        )}
      </View>

      <PreviewModal
        onClose={() => { if (!saving) setEditorOpen(false); }}
        open={editorOpen}
        title={editorID
          ? (chinese ? '编辑 SKILL.md' : 'Edit SKILL.md')
          : (chinese ? '新建 Skill' : 'New Skill')}
      >
        {!editorID ? (
          <>
            <EditorField
              label={chinese ? '名称' : 'Name'}
              onChangeText={setEditorName}
              placeholder="my-skill"
              value={editorName}
            />
            <EditorField
              label={chinese ? '分类（可选）' : 'Category (optional)'}
              onChangeText={setEditorCategory}
              placeholder="custom"
              value={editorCategory}
            />
          </>
        ) : null}
        <View style={styles.editorField}>
          <Text style={[styles.label, { color: tokens.colors.textSecondary }]}>SKILL.md</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setEditorContent}
            style={[
              styles.editor,
              {
                backgroundColor: tokens.colors.input,
                borderColor: tokens.colors.border,
                color: tokens.colors.foreground,
                fontFamily: tokens.typography.fontMono,
              },
            ]}
            textAlignVertical="top"
            value={editorContent}
          />
        </View>
        <NativeButton loading={saving} onPress={() => { void saveSkill(); }}>
          {chinese ? '保存' : 'Save'}
        </NativeButton>
      </PreviewModal>
    </PreviewPage>
  );
}

function EditorField({
  label,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  onChangeText(value: string): void;
  placeholder: string;
  value: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={styles.editorField}>
      <Text style={[styles.label, { color: tokens.colors.textSecondary }]}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.colors.textTertiary}
        style={[
          styles.input,
          {
            backgroundColor: tokens.colors.input,
            borderColor: tokens.colors.border,
            color: tokens.colors.foreground,
          },
        ]}
        value={value}
      />
    </View>
  );
}

function normalizeSkills(rows: readonly JsonRecord[]): SkillItem[] {
  return rows.flatMap((entry, index) => {
    const id = stringField(entry, 'name') || stringField(entry, 'id') || `skill-${index}`;
    if (!id) return [];
    return [{
      bundled: entry.bundled === true || entry.source === 'bundled' || entry.provenance === 'bundled',
      detail: stringField(entry, 'description') || stringField(entry, 'detail'),
      enabled: entry.enabled !== false && entry.disabled !== true,
      id,
      name: stringField(entry, 'display_name') || id,
      source: stringField(entry, 'source') || stringField(entry, 'provenance'),
    }];
  });
}

function stringField(value: JsonRecord, key: string): string {
  const field = value[key];
  return typeof field === 'string' ? field : '';
}

function errorMessage(error: unknown, chinese: boolean): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return chinese ? 'Skill 操作失败，请稍后重试。' : 'The skill operation failed. Try again.';
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  search: { borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, fontSize: 14, height: 40, letterSpacing: 0, paddingHorizontal: 12 },
  list: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  loading: { alignItems: 'center', minHeight: 120, justifyContent: 'center' },
  empty: { alignItems: 'center', minHeight: 120, justifyContent: 'center', padding: 20 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 76, paddingHorizontal: 12, paddingVertical: 10 },
  icon: { alignItems: 'center', borderRadius: 7, height: 38, justifyContent: 'center', width: 38 },
  copy: { flex: 1, gap: 4, minWidth: 0 },
  titleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  editorField: { gap: 7 },
  label: { fontSize: 12, letterSpacing: 0 },
  input: { borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, fontSize: 14, height: 40, letterSpacing: 0, paddingHorizontal: 11 },
  editor: { borderRadius: 7, borderWidth: StyleSheet.hairlineWidth, fontSize: 12, letterSpacing: 0, minHeight: 360, padding: 12 },
});
