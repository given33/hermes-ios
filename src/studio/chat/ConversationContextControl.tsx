import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { useTheme } from '../../design/ThemeProvider';

export function ConversationContextControl({ isChinese, percent, usedTokens, maxTokens }: {
  isChinese: boolean;
  percent?: number;
  usedTokens?: number;
  maxTokens?: number;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const { width } = useWindowDimensions();
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const value = typeof percent === 'number' && Number.isFinite(percent) && percent >= 0
    ? Math.min(100, percent) : undefined;
  const color = value !== undefined && value >= 85 ? tokens.colors.destructive : tokens.colors.textSecondary;
  const circumference = 2 * Math.PI * 9;
  return <>
    <View ref={anchor} collapsable={false}><IOSPressable
      accessibilityRole="button"
      accessibilityLabel={isChinese ? '查看会话上下文' : 'View conversation context'}
      accessibilityValue={{ text: value === undefined ? (isChinese ? '暂无用量数据' : 'Usage unavailable') : `${Math.round(value)}%` }}
      onPress={() => anchor.current?.measureInWindow((x, y) => {
        setPosition({ left: Math.max(12, Math.min(x - 190, width - 272)), top: Math.max(12, y - 112) });
        setOpen(true);
      })}
      style={{ alignItems: 'center', justifyContent: 'center', width: 36, height: 36 }}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={9} stroke={tokens.colors.border} strokeWidth={2.5} fill="none" />
        {value !== undefined ? <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.5} fill="none"
          strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - value / 100)}
          rotation={-90} origin="12,12" strokeLinecap="round" /> : null}
      </Svg>
    </IOSPressable></View>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityLabel={isChinese ? '关闭上下文信息' : 'Close context information'} onPress={() => setOpen(false)} style={{ flex: 1 }}>
        <View style={{ position: 'absolute', ...position, width: 260, maxWidth: width - 24, padding: 14, gap: 10,
          borderRadius: 8, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.card,
          shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 12, elevation: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: tokens.colors.foreground }}>{isChinese ? '上下文' : 'Context'}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontSize: 12, color: tokens.colors.textSecondary }}>{isChinese ? '已使用' : 'Used'}</Text>
            <Text style={{ fontSize: 12, color: tokens.colors.foreground }}>{value === undefined ? '--' : `${Math.round(value)}%`}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontSize: 12, color: tokens.colors.textSecondary }}>{isChinese ? '长度' : 'Length'}</Text>
            <Text style={{ fontSize: 12, color: tokens.colors.foreground }}>{formatContextTokens(usedTokens)} / {formatContextTokens(maxTokens)}</Text>
          </View>
        </View>
      </Pressable>
    </Modal>
  </>;
}

function formatContextTokens(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? `${Number((value / 1000).toFixed(1))}k`
    : '--';
}
