import {
  ChevronDown,
  Circle,
  CloudDownload,
  Globe2,
  Languages,
  LogOut,
  Palette,
  Power,
  RotateCw,
  Server,
  UserRound,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { FadeInRight, FadeOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { NativeButton } from '../components/ui/NativeButton';
import { multiplyAlpha } from '../design/control-contracts';
import { THEME_DEFAULT_FONT_ID } from '../design/font-catalog';
import { useTheme } from '../design/ThemeProvider';
import { NativeShell, type NativeShellSlotContext } from '../app/NativeShell';
import {
  BASELINE_PLUGIN_MANIFESTS,
  type ComposedRoute,
  type NativeRouteLocale,
} from '../app/route-composition';
import {
  ChannelsPreviewPage,
  CronPreviewPage,
  McpPreviewPage,
  PairingPreviewPage,
  PluginsPreviewPage,
  SkillsPreviewPage,
  WebhooksPreviewPage,
} from './PreviewAutomationPages';
import {
  AnalyticsPreviewPage,
  ChatPreviewPage,
  FilesPreviewPage,
  LogsPreviewPage,
  ModelsPreviewPage,
  SessionsPreviewPage,
  type PreviewPageProps,
} from './PreviewCorePages';
import {
  AchievementsPreviewPage,
  CollaborationPreviewPage,
  KanbanPreviewPage,
} from './PreviewPluginPages';
import {
  ConfigPreviewPage,
  DocsPreviewPage,
  EnvPreviewPage,
  ProfileBuilderPreviewPage,
  ProfilesPreviewPage,
  SystemPreviewPage,
} from './PreviewSettingsPages';
import { PREVIEW_PROFILES } from './preview-fixtures';
import {
  PreviewBadge,
  PreviewChoice,
  PreviewModal,
  PreviewRow,
  PreviewSegmented,
  PreviewSettingRow,
  PreviewText,
} from './PreviewPrimitives';

type Picker = 'profile' | 'appearance' | 'language' | null;
type SystemAction = 'restart' | 'update' | null;

export function FrontendPreviewApp() {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const [locale, setLocale] = useState<NativeRouteLocale>('zh');
  const [profile, setProfile] = useState('default');
  const [picker, setPicker] = useState<Picker>(null);
  const [systemAction, setSystemAction] = useState<SystemAction>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const slots = {
    profile: (context: NativeShellSlotContext) => (
      <ProfileSlot
        context={context}
        onOpen={() => setPicker('profile')}
        profile={profile}
      />
    ),
    system: (context: NativeShellSlotContext) => (
      <SystemSlot
        context={context}
        onRestart={() => setSystemAction('restart')}
        onUpdate={() => setSystemAction('update')}
      />
    ),
    controls: (context: NativeShellSlotContext) => (
      <ControlsSlot
        context={context}
        locale={locale}
        onLanguage={() => setPicker('language')}
        onTheme={() => setPicker('appearance')}
      />
    ),
    auth: () => <AuthSlot profile={profile} />,
    footer: () => <FooterSlot />,
  };

  return (
    <View style={styles.root}>
      <NativeShell
        config={{ dashboard: { show_token_analytics: true } }}
        locale={locale}
        manifests={BASELINE_PLUGIN_MANIFESTS}
        renderRoute={(route, _label, context) => (
          <PreviewRoute
            navigate={context.navigate}
            notify={notify}
            route={route}
          />
        )}
        slots={slots}
      />

      {toast ? (
        <Reanimated.View
          entering={FadeInRight.duration(200)}
          exiting={FadeOutRight.duration(200)}
          pointerEvents="none"
          style={[
            styles.toast,
            {
              backgroundColor: tokens.colors.popover,
              borderColor: tokens.colors.border,
              bottom: insets.bottom + 16,
              right: insets.right + 16,
            },
          ]}
        >
          <PreviewText>{toast}</PreviewText>
        </Reanimated.View>
      ) : null}

      <ProfilePicker
        onClose={() => setPicker(null)}
        onSelect={(next) => {
          setProfile(next);
          setPicker(null);
          notify(`Managing profile: ${next}`);
        }}
        open={picker === 'profile'}
        profile={profile}
      />
      <AppearancePicker
        onClose={() => setPicker(null)}
        open={picker === 'appearance'}
      />
      <LanguagePicker
        locale={locale}
        onClose={() => setPicker(null)}
        onSelect={(next) => {
          setLocale(next);
          setPicker(null);
        }}
        open={picker === 'language'}
      />
      <ConfirmDialog
        confirmLabel={systemAction === 'update' ? 'Update' : 'Restart'}
        description={systemAction === 'update'
          ? 'Hermes will update and restart the gateway when complete.'
          : 'The gateway will briefly disconnect while it restarts.'}
        onCancel={() => setSystemAction(null)}
        onConfirm={() => {
          notify(systemAction === 'update' ? 'Update preview completed' : 'Gateway restart preview completed');
          setSystemAction(null);
        }}
        open={systemAction !== null}
        title={systemAction === 'update' ? 'Update Hermes?' : 'Restart gateway?'}
      />
    </View>
  );
}

function PreviewRoute({
  navigate,
  notify,
  route,
}: PreviewPageProps & { route: ComposedRoute }) {
  const props = { navigate, notify };
  if (route.source === 'plugin') {
    if (route.pluginName === 'hermes-achievements') return <AchievementsPreviewPage {...props} />;
    if (route.pluginName === 'kanban') return <KanbanPreviewPage {...props} />;
    if (route.pluginName === 'collaboration') return <CollaborationPreviewPage {...props} />;
  }
  switch (route.routeId) {
    case 'chat': return <ChatPreviewPage {...props} />;
    case 'sessions': return <SessionsPreviewPage {...props} />;
    case 'files': return <FilesPreviewPage {...props} />;
    case 'analytics': return <AnalyticsPreviewPage {...props} />;
    case 'models': return <ModelsPreviewPage {...props} />;
    case 'logs': return <LogsPreviewPage {...props} />;
    case 'cron': return <CronPreviewPage {...props} />;
    case 'skills': return <SkillsPreviewPage {...props} />;
    case 'plugins': return <PluginsPreviewPage {...props} />;
    case 'mcp': return <McpPreviewPage {...props} />;
    case 'pairing': return <PairingPreviewPage {...props} />;
    case 'channels': return <ChannelsPreviewPage {...props} />;
    case 'webhooks': return <WebhooksPreviewPage {...props} />;
    case 'system': return <SystemPreviewPage {...props} />;
    case 'profiles': return <ProfilesPreviewPage {...props} />;
    case 'profile-new': return <ProfileBuilderPreviewPage {...props} />;
    case 'config': return <ConfigPreviewPage {...props} />;
    case 'env': return <EnvPreviewPage {...props} />;
    case 'docs': return <DocsPreviewPage />;
    default: return <SessionsPreviewPage {...props} />;
  }
}

function ProfileSlot({
  context,
  onOpen,
  profile,
}: {
  context: NativeShellSlotContext;
  onOpen(): void;
  profile: string;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.slotBlock, { borderBottomColor: tokens.colors.border }]}> 
      <NativeButton
        accessibilityLabel={`Managing profile: ${profile}`}
        ghost
        onPress={onOpen}
        size={context.collapsed ? 'icon' : 'sm'}
      >
        <UserRound />
        {!context.collapsed ? (
          <>
            <PreviewText numberOfLines={1} style={styles.profileLabel}>{profile}</PreviewText>
            <ChevronDown />
          </>
        ) : null}
      </NativeButton>
    </View>
  );
}

function SystemSlot({
  context,
  onRestart,
  onUpdate,
}: {
  context: NativeShellSlotContext;
  onRestart(): void;
  onUpdate(): void;
}) {
  const { tokens } = useTheme();
  if (context.collapsed) {
    return (
      <View style={[styles.collapsedSystem, { borderTopColor: tokens.colors.border }]}> 
        <NativeButton accessibilityLabel="System status" ghost onPress={() => context.navigate('/system')} size="icon">
          <Server />
        </NativeButton>
      </View>
    );
  }
  return (
    <View style={[styles.systemSlot, { borderTopColor: tokens.colors.border }]}> 
      <Pressable onPress={() => context.navigate('/system')} style={styles.statusLine}>
        <Circle color={tokens.colors.success} fill={tokens.colors.success} size={8} />
        <PreviewText style={styles.profileLabel} variant="tiny">Gateway running</PreviewText>
        <PreviewText variant="tiny">2 active</PreviewText>
      </Pressable>
      <PreviewRow>
        <NativeButton onPress={onRestart} outlined size="sm"><RotateCw />Restart</NativeButton>
        <NativeButton onPress={onUpdate} outlined size="sm"><CloudDownload />Update</NativeButton>
      </PreviewRow>
    </View>
  );
}

function ControlsSlot({
  context,
  locale,
  onLanguage,
  onTheme,
}: {
  context: NativeShellSlotContext;
  locale: NativeRouteLocale;
  onLanguage(): void;
  onTheme(): void;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.controlsSlot, { borderTopColor: tokens.colors.border }]}> 
      <NativeButton accessibilityLabel="Theme and font" ghost onPress={onTheme} size={context.collapsed ? 'icon' : 'sm'}>
        <Palette />
        {!context.collapsed ? <PreviewText>Theme</PreviewText> : null}
      </NativeButton>
      <NativeButton accessibilityLabel="Language" ghost onPress={onLanguage} size={context.collapsed ? 'icon' : 'sm'}>
        <Languages />
        {!context.collapsed ? <PreviewText>{locale === 'zh' ? '中文' : 'English'}</PreviewText> : null}
      </NativeButton>
    </View>
  );
}

function AuthSlot({ profile }: { profile: string }) {
  return (
    <View style={styles.authSlot}>
      <PreviewRow>
        <View style={styles.authAvatar}><UserRound size={15} /></View>
        <View style={styles.profileLabel}>
          <PreviewText numberOfLines={1}>{profile}</PreviewText>
          <PreviewText variant="tiny">Frontend preview</PreviewText>
        </View>
        <NativeButton accessibilityLabel="Sign out" disabled ghost size="icon"><LogOut /></NativeButton>
      </PreviewRow>
    </View>
  );
}

function FooterSlot() {
  return (
    <View style={styles.footerSlot}>
      <PreviewText variant="tiny">v2.0.0-beta.1</PreviewText>
      <PreviewText variant="tiny">Nous Research</PreviewText>
    </View>
  );
}

function ProfilePicker({
  onClose,
  onSelect,
  open,
  profile,
}: {
  onClose(): void;
  onSelect(profile: string): void;
  open: boolean;
  profile: string;
}) {
  return (
    <PreviewModal onClose={onClose} open={open} title="Managing profile">
      <PreviewText variant="muted">Configuration, keys, skills, MCP, models, and new conversations apply to this profile.</PreviewText>
      {PREVIEW_PROFILES.map((item) => (
        <PreviewChoice
          description={item.description}
          key={item.name}
          label={item.name}
          onPress={() => onSelect(item.name)}
          selected={item.name === profile}
        />
      ))}
    </PreviewModal>
  );
}

function AppearancePicker({ onClose, open }: { onClose(): void; open: boolean }) {
  const {
    availableThemes,
    fontChoices,
    fontId,
    setFont,
    setTheme,
    themeName,
  } = useTheme();
  const [tab, setTab] = useState<'theme' | 'font'>('theme');
  return (
    <PreviewModal onClose={onClose} open={open} title="Appearance">
      <PreviewSegmented<'theme' | 'font'>
        onChange={setTab}
        options={[{ label: 'Theme', value: 'theme' }, { label: 'Font', value: 'font' }]}
        value={tab}
      />
      {tab === 'theme' ? availableThemes.map((theme) => {
        const definition = theme.definition;
        const swatches = definition?.swatchColors ?? (definition ? [
          definition.palette.background.hex,
          definition.palette.midground.hex,
          definition.palette.warmGlow,
        ] : undefined);
        return (
          <PreviewChoice
            description={theme.description}
            key={theme.name}
            label={theme.label}
            onPress={() => void setTheme(theme.name)}
            selected={theme.name === themeName}
            swatches={swatches}
          />
        );
      }) : (
        <>
          <PreviewChoice
            description="Use the typeface defined by the active theme"
            label="Theme default"
            onPress={() => void setFont(THEME_DEFAULT_FONT_ID)}
            selected={fontId === THEME_DEFAULT_FONT_ID}
          />
          {fontChoices.map((font) => (
            <PreviewChoice
              description={font.category}
              key={font.id}
              label={font.label}
              onPress={() => void setFont(font.id)}
              selected={fontId === font.id}
            />
          ))}
        </>
      )}
    </PreviewModal>
  );
}

function LanguagePicker({
  locale,
  onClose,
  onSelect,
  open,
}: {
  locale: NativeRouteLocale;
  onClose(): void;
  onSelect(locale: NativeRouteLocale): void;
  open: boolean;
}) {
  return (
    <PreviewModal onClose={onClose} open={open} title="Switch language">
      <PreviewChoice label="中文" onPress={() => onSelect('zh')} selected={locale === 'zh'} />
      <PreviewChoice label="English" onPress={() => onSelect('en')} selected={locale === 'en'} />
    </PreviewModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  slotBlock: {
    borderBottomWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  profileLabel: {
    flex: 1,
    minWidth: 0,
  },
  systemSlot: {
    borderTopWidth: 1,
    gap: 7,
    padding: 8,
  },
  collapsedSystem: {
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: 6,
  },
  statusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minHeight: 24,
  },
  controlsSlot: {
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 6,
  },
  authSlot: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  authAvatar: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  footerSlot: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  toast: {
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.28)',
    maxWidth: 340,
    minWidth: 220,
    paddingHorizontal: 14,
    paddingVertical: 11,
    position: 'absolute',
    zIndex: 200,
  },
});
