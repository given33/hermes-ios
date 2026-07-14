import { useEffect, useRef } from 'react';
import {
  ActionSheetIOS,
  Platform,
  StyleSheet,
} from 'react-native';

import {
  hasNativeConfirmationDialog,
  HermesConfirmationDialogView,
  type HermesConfirmationDialogAction,
} from '../../../modules/hermes-ios-controls';

export interface IOSActionSheetAction extends HermesConfirmationDialogAction {}

export function IOSActionSheet({
  actions,
  cancelLabel = 'Cancel',
  onOpenChange,
  onSelect,
  open,
  title,
}: {
  actions: readonly IOSActionSheetAction[];
  cancelLabel?: string;
  onOpenChange(open: boolean): void;
  onSelect(id: string): void;
  open: boolean;
  title: string;
}) {
  const fallbackPresented = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'ios' || hasNativeConfirmationDialog) return;
    if (!open) {
      fallbackPresented.current = false;
      return;
    }
    if (fallbackPresented.current) return;
    fallbackPresented.current = true;
    const cancelButtonIndex = actions.length;
    const destructiveButtonIndex = actions.findIndex((action) => action.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex,
        destructiveButtonIndex: destructiveButtonIndex >= 0
          ? destructiveButtonIndex
          : undefined,
        options: [...actions.map((action) => action.title), cancelLabel],
        title,
      },
      (index) => {
        const action = actions[index];
        if (action) onSelect(action.id);
        onOpenChange(false);
      },
    );
  }, [actions, cancelLabel, onOpenChange, onSelect, open, title]);

  if (Platform.OS !== 'ios' || !hasNativeConfirmationDialog) return null;
  return (
    <HermesConfirmationDialogView
      actions={[...actions]}
      cancelTitle={cancelLabel}
      onAction={(event) => onSelect(event.nativeEvent.id)}
      onOpenChange={(event) => onOpenChange(event.nativeEvent.open)}
      open={open}
      style={styles.host}
      title={title}
    />
  );
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
