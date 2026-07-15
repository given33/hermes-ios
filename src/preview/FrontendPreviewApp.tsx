import {
  ChevronDown,
  Circle,
  Download,
  Globe2,
  Languages,
  Palette,
  RotateCw,
  Server,
  UserRound,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Reanimated, {
  Easing,
  FadeInRight,
  FadeOutRight,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  HermesSwiftUIRouteView,
  hasNativeSwiftUIPartialFrontend,
} from '../../modules/hermes-ios-controls';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { IOSPressable } from '../components/ios/IOSPressable';
import { NativeButton } from '../components/ui/NativeButton';
import { multiplyAlpha } from '../design/control-contracts';
import { THEME_DEFAULT_FONT_ID } from '../design/font-catalog';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { resolveSwiftUIThemeProps } from '../design/swiftui-theme';
import { useTheme } from '../design/ThemeProvider';
import { IOS_MOTION } from '../design/ios-motion';
import { NativeLocalizationProvider } from '../i18n/NativeLocalization';
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
  FilesPreviewPage,
  LogsPreviewPage,
  ModelsPreviewPage,
  SessionsPreviewPage,
  type PreviewPageProps,
} from './PreviewCorePages';
import { ChatPreviewPage } from './PreviewChatPage';
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
  const useSwiftUIRoutes =
    Platform.OS === 'ios' && hasNativeSwiftUIPartialFrontend;
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
        locale={locale}
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
    footer: () => <FooterSlot />,
  };

  return (
    <NativeLocalizationProvider locale={locale}>
      <View style={styles.root}>
      <NativeShell
        config={{ dashboard: { show_token_analytics: true } }}
        initialPath="/chat"
        locale={locale ?? 'zh'}
        manifests={BASELINE_PLUGIN_MANIFESTS}
        nativeRouteChrome={useSwiftUIRoutes}
        renderRoute={(route, _label, context) => (
          <PreviewRoute
            key={route.path}
            locale={locale}
            navigate={context.navigate}
            notify={notify}
            openNavigation={context.openNavigation}
            route={route}
          />
        )}
        slots={slots}
      />

      {toast ? (
        <Reanimated.View
          entering={FadeInRight
            .duration(IOS_MOTION.duration.toast)
            .easing(Easing.bezier(...IOS_MOTION.curve.decelerate))}
          exiting={FadeOutRight
            .duration(IOS_MOTION.duration.control)
            .easing(Easing.bezier(...IOS_MOTION.curve.standard))}
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
        cancelLabel={locale === 'zh' ? '取消' : 'Cancel'}
        confirmLabel={systemAction === 'update'
          ? locale === 'zh' ? '立即更新' : 'Update now'
          : locale === 'zh' ? '重启网关' : 'Restart gateway'}
        description={systemAction === 'update'
          ? locale === 'zh'
            ? "这将运行 'hermes update'，完成后重启网关。"
            : "This will run 'hermes update' and restart the gateway when it finishes."
          : locale === 'zh'
            ? '这将重启 Hermes 网关进程。已连接的渠道和活跃会话随后会自动重新连接。'
            : 'This restarts the Hermes gateway process. Connected channels and active sessions will reconnect afterward.'}
        onCancel={() => setSystemAction(null)}
        onConfirm={() => {
          notify(systemAction === 'update'
            ? locale === 'zh' ? 'Hermes 更新已开始' : 'Hermes update started'
            : locale === 'zh' ? '网关重启已开始' : 'Gateway restart started');
          setSystemAction(null);
        }}
        open={systemAction !== null}
        title={systemAction === 'update'
          ? locale === 'zh' ? '更新 Hermes？' : 'Update Hermes?'
          : locale === 'zh' ? '重启网关？' : 'Restart gateway?'}
      />
      </View>
    </NativeLocalizationProvider>
  );
}

function PreviewRoute({
  locale,
  navigate,
  notify,
  openNavigation,
  route,
}: PreviewPageProps & { openNavigation?(): void; route: ComposedRoute }) {
  const { tokens } = useTheme();
  const props = { locale, navigate, notify };
  if (
    Platform.OS === 'ios'
    && hasNativeSwiftUIPartialFrontend
    && route.routeId !== 'chat'
  ) {
    return (
      <HermesSwiftUIRouteView
        key={route.path}
        {...resolveSwiftUIThemeProps(tokens)}
        locale={locale ?? 'zh'}
        onAction={(event) => notify(event.nativeEvent.payload || event.nativeEvent.action)}
        onOpenNavigation={openNavigation}
        path={route.path}
        pluginName={route.pluginName ?? ''}
        routeId={route.routeId ?? ''}
        style={styles.nativeRoute}
      />
    );
  }
  if (route.source === 'plugin') {
    if (route.pluginName === 'hermes-achievements') return <AchievementsPreviewPage {...props} />;
    if (route.pluginName === 'kanban') return <KanbanPreviewPage {...props} />;
    if (route.pluginName === 'collaboration') return <CollaborationPreviewPage {...props} />;
  }
  switch (route.routeId) {
    case 'chat': return <ChatPreviewPage {...props} openNavigation={openNavigation} />;
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
        prefix={!context.collapsed ? <UserRound /> : undefined}
        size={context.collapsed ? 'icon' : 'sm'}
        suffix={!context.collapsed ? <ChevronDown /> : undefined}
      >
        {context.collapsed ? <UserRound /> : profile}
      </NativeButton>
    </View>
  );
}

function SystemSlot({
  context,
  locale,
  onRestart,
  onUpdate,
}: {
  context: NativeShellSlotContext;
  locale: NativeRouteLocale;
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
      <PreviewText style={styles.systemHeading} variant="label">
        {locale === 'zh' ? '系统' : 'System'}
      </PreviewText>
      <IOSPressable onPress={() => context.navigate('/sessions')} style={styles.statusSummary}>
        <PreviewText variant="tiny">
          {locale === 'zh' ? '网关状态：' : 'Gateway status: '}
          <PreviewText color={tokens.colors.success} variant="tiny">
            {locale === 'zh' ? '运行中' : 'Running'}
          </PreviewText>
        </PreviewText>
        <PreviewText variant="tiny">
          {locale === 'zh' ? '活跃会话：2' : 'Active sessions: 2'}
        </PreviewText>
      </IOSPressable>
      <SystemActionRow
        icon={RotateCw}
        label={locale === 'zh' ? '重启网关' : 'Restart gateway'}
        onPress={onRestart}
      />
      <SystemActionRow
        icon={Download}
        label={locale === 'zh' ? '更新 Hermes' : 'Update Hermes'}
        onPress={onUpdate}
      />
    </View>
  );
}

function SystemActionRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof RotateCw;
  label: string;
  onPress(): void;
}) {
  const { tokens } = useTheme();
  const rootSize = Number.parseFloat(tokens.typography.baseSize) || 15;
  const font = resolveNativeFontStack(tokens.typography.fontDisplay, 400);
  return (
    <IOSPressable
      accessibilityRole="button"
      onPress={onPress}
      pressedStyle={{
        backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.05),
      }}
      style={[
        styles.systemAction,
      ]}
    >
      <Icon color={tokens.colors.textSecondary} size={rootSize * 0.875} />
      <PreviewText
        style={{
          color: tokens.colors.textSecondary,
          fontFamily: font,
          fontSize: rootSize * 0.75,
          letterSpacing: rootSize * 0.075,
        }}
      >
        {label}
      </PreviewText>
    </IOSPressable>
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
  const { availableThemes, themeName, tokens } = useTheme();
  const themeLabel = availableThemes.find((theme) => theme.name === themeName)?.label
    ?? themeName;
  return (
    <View style={[styles.controlsSlot, { borderTopColor: tokens.colors.border }]}> 
      <SidebarControl
        accessibilityLabel="Theme and font"
        collapsed={context.collapsed}
        icon={Palette}
        label={themeLabel}
        onPress={onTheme}
      />
      <SidebarControl
        accessibilityLabel="Language"
        collapsed={context.collapsed}
        icon={Languages}
        label={locale === 'zh' ? '中文' : 'EN'}
        onPress={onLanguage}
      />
    </View>
  );
}

function SidebarControl({
  accessibilityLabel,
  collapsed,
  icon: Icon,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  collapsed: boolean;
  icon: typeof Palette;
  label: string;
  onPress(): void;
}) {
  const { tokens } = useTheme();
  return (
    <IOSPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      pressedStyle={{
        backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.06),
      }}
      style={[
        styles.sidebarControl,
        collapsed && styles.sidebarControlCollapsed,
      ]}
    >
      <Icon color={tokens.colors.textSecondary} size={17} />
      {!collapsed ? (
        <PreviewText numberOfLines={1} style={styles.sidebarControlLabel} variant="tiny">
          {label}
        </PreviewText>
      ) : null}
    </IOSPressable>
  );
}

function FooterSlot() {
  const { tokens } = useTheme();
  return (
    <View style={[styles.footerSlot, { borderTopColor: tokens.colors.border }]}>
      <PreviewText style={styles.footerVersion} variant="tiny">v0.9.3</PreviewText>
      <PreviewText numberOfLines={1} style={styles.footerCredit} variant="tiny">Nous Research</PreviewText>
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
  nativeRoute: {
    flex: 1,
  },
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
    paddingBottom: 4,
    paddingTop: 4,
  },
  collapsedSystem: {
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: 6,
  },
  systemHeading: {
    paddingHorizontal: 20,
    paddingVertical: 2,
  },
  statusSummary: {
    gap: 3,
    paddingBottom: 6,
    paddingHorizontal: 20,
    paddingTop: 2,
  },
  systemAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 38,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  controlsSlot: {
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sidebarControl: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    height: 32,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
  },
  sidebarControlCollapsed: {
    paddingHorizontal: 0,
  },
  sidebarControlLabel: {
    flexShrink: 1,
    minWidth: 0,
    textTransform: 'uppercase',
  },
  footerSlot: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  footerVersion: {
    flexShrink: 0,
  },
  footerCredit: {
    flexShrink: 1,
    marginLeft: 12,
    textAlign: 'right',
    textTransform: 'uppercase',
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
