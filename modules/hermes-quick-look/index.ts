import {
  requireNativeView,
  requireOptionalNativeModule,
} from 'expo';
import {
  createElement,
  useEffect,
  useState,
  type ComponentType,
} from 'react';
import { StyleSheet, type ViewProps } from 'react-native';

interface HermesQuickLookViewProps extends ViewProps {
  requestId: number;
  uri?: string;
}

const available = requireOptionalNativeModule('HermesQuickLook') !== null;
const NativeQuickLookView = available
  ? requireNativeView<HermesQuickLookViewProps>('HermesQuickLook')
  : null;

let presentFromHost: ((uri: string) => void) | null = null;

export async function presentQuickLook(
  uri: string,
  _title?: string,
): Promise<boolean> {
  if (!available || !presentFromHost) return false;
  presentFromHost(uri);
  return true;
}

export function HermesQuickLookHost() {
  const [request, setRequest] = useState({ id: 0, uri: undefined as string | undefined });

  useEffect(() => {
    presentFromHost = (uri) => {
      setRequest((current) => ({ id: current.id + 1, uri }));
    };
    return () => {
      presentFromHost = null;
    };
  }, []);

  if (!NativeQuickLookView) return null;
  const Component = NativeQuickLookView as ComponentType<HermesQuickLookViewProps>;
  return createElement(Component, {
    requestId: request.id,
    style: styles.host,
    uri: request.uri,
  });
}

const styles = StyleSheet.create({
  host: {
    height: 1,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 1,
  },
});
