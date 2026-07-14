import { useFonts } from 'expo-font';

import { GENERATED_NATIVE_FONT_ASSETS } from './native-font-assets.generated';

export const WEBUI_FONT_FAMILIES = {
  CollapseRegular: 'Collapse',
  CollapseBold: 'Collapse-Bold',
  RulesCompressedRegular: 'Rules Compressed',
  RulesCompressedMedium: 'Rules Compressed-Medium',
  RulesExpandedRegular: 'Rules Expanded',
  RulesExpandedBold: 'Rules Expanded-Bold',
  MondwestRegular: 'Mondwest',
} as const;

const WEBUI_FONT_ASSETS = {
  [WEBUI_FONT_FAMILIES.CollapseRegular]: require('../../assets/fonts/Collapse-Regular.otf'),
  [WEBUI_FONT_FAMILIES.CollapseBold]: require('../../assets/fonts/Collapse-Bold.otf'),
  [WEBUI_FONT_FAMILIES.RulesCompressedRegular]: require('../../assets/fonts/RulesCompressed-Regular.ttf'),
  [WEBUI_FONT_FAMILIES.RulesCompressedMedium]: require('../../assets/fonts/RulesCompressed-Medium.ttf'),
  [WEBUI_FONT_FAMILIES.RulesExpandedRegular]: require('../../assets/fonts/RulesExpanded-Regular.ttf'),
  [WEBUI_FONT_FAMILIES.RulesExpandedBold]: require('../../assets/fonts/RulesExpanded-Bold.ttf'),
  [WEBUI_FONT_FAMILIES.MondwestRegular]: require('../../assets/fonts/Mondwest-Regular.ttf'),
  ...GENERATED_NATIVE_FONT_ASSETS,
};

export function useWebUiFonts(): boolean {
  const [loaded, error] = useFonts(WEBUI_FONT_ASSETS);
  if (error) throw error;
  return loaded;
}
