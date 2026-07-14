import { useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { HERMES_ORIGIN } from '../config';
import {
  hasNativeSwiftUIFrontend,
  hasNativeSwiftUILogin,
  HermesSwiftUIFrontendView,
  HermesSwiftUILoginView,
} from '../../modules/hermes-ios-controls';
import {
  pickNativeFrontendAttachments,
  type NativeFrontendAttachment,
} from './native-frontend-attachments';

const FRONTEND_PREVIEW = process.env.EXPO_PUBLIC_FRONTEND_PREVIEW === '1';

export function HermesNativeApp() {
  if (Platform.OS !== 'ios') return null;
  if (FRONTEND_PREVIEW && hasNativeSwiftUIFrontend) {
    return <NativeSwiftUIFrontend />;
  }
  return (
    <AuthProvider>
      <NativeAuthRoot />
    </AuthProvider>
  );
}

function NativeAuthRoot() {
  const { state, client, logout, provision, unlock } = useAuth();
  if (
    state.status !== 'authenticated'
    && Platform.OS === 'ios'
    && hasNativeSwiftUILogin
  ) {
    const locked = state.status === 'locked';
    return (
      <HermesSwiftUILoginView
        baseUrl={locked ? state.baseUrl : HERMES_ORIGIN}
        busy={state.status === 'loading' ? false : state.busy}
        errorMessage={state.status === 'loading' ? '' : state.error ?? ''}
        loading={state.status === 'loading'}
        locked={locked}
        locale="zh"
        onLogout={() => void logout()}
        onProvision={(event) => {
          void provision(event.nativeEvent.baseUrl, event.nativeEvent.apiKey);
        }}
        onUnlock={() => void unlock()}
        style={styles.nativeContent}
      />
    );
  }
  if (state.status !== 'authenticated') return null;
  if (!client) return null;
  if (Platform.OS === 'ios' && hasNativeSwiftUIFrontend) {
    return <NativeSwiftUIFrontend />;
  }
  return null;
}

function NativeSwiftUIFrontend() {
  const [attachments, setAttachments] = useState<NativeFrontendAttachment[]>([]);
  const [actionError, setActionError] = useState('');

  const handleAction = async (action: string, payload?: string) => {
    if (action === 'clear-attachments') {
      setAttachments([]);
      return;
    }
    if (action === 'dismiss-error') {
      setActionError('');
      return;
    }
    if (action === 'remove-attachment') {
      setAttachments((current) => {
        return current.filter((attachment) => attachment.id !== payload);
      });
      return;
    }
    if (action === 'photo-library' || action === 'camera') {
      const selected = await pickNativeFrontendAttachments(
        action,
        attachments.length,
      );
      if (selected) setAttachments((current) => [...current, ...selected]);
      return;
    }
    if (action === 'file-picker') {
      const selected = await pickNativeFrontendAttachments(
        action,
        attachments.length,
      );
      if (selected) setAttachments((current) => [...current, ...selected]);
    }
  };

  return (
    <HermesSwiftUIFrontendView
      accessibilityLabel="Hermes SwiftUI frontend"
      attachmentIds={attachments.map((attachment) => attachment.id)}
      attachmentNames={attachments.map((attachment) => attachment.name)}
      errorMessage={actionError}
      locale="zh"
      onAction={(event) => {
        void handleAction(event.nativeEvent.action, event.nativeEvent.payload)
          .catch(() => {
            setActionError('无法打开系统选择器，请检查照片、相机或文件访问权限。');
          });
      }}
      style={styles.nativeContent}
    />
  );
}

const styles = StyleSheet.create({
  nativeContent: {
    flex: 1,
  },
});
