import { GENERATED_NATIVE_FONT_FACES } from './native-font-faces.generated';

export type NativeFontStyle = 'normal' | 'italic';
export type NativeFontSource =
  | 'tracked-ui'
  | 'google'
  | 'tracked-terminal';

export interface NativeFontFace {
  source: NativeFontSource;
  cssFamily: string;
  weight: number;
  style: NativeFontStyle;
  runtimeFamily: string;
  assetFile: string;
}

export const NATIVE_FONT_FACES: readonly NativeFontFace[] =
  GENERATED_NATIVE_FONT_FACES;

const FACE_BY_CSS_ID = new Map(
  NATIVE_FONT_FACES.map((face) => [
    faceId(face.cssFamily, face.weight, face.style, face.source),
    face.runtimeFamily,
  ]),
);

export function resolveNativeFontFamily(
  cssFamily: string,
  weight: number,
  style: NativeFontStyle = 'normal',
  source: NativeFontSource = 'google',
): string | undefined {
  return FACE_BY_CSS_ID.get(faceId(cssFamily, weight, style, source));
}

const NATIVE_SOURCE_PRIORITY: readonly NativeFontSource[] = [
  'google',
  'tracked-terminal',
  'tracked-ui',
];

const IOS_STACK_FAMILIES: Readonly<Record<string, string | null>> = {
  '-apple-system': null,
  'system-ui': null,
  'sans-serif': null,
  'ui-monospace': 'Menlo',
  'sf mono': 'Menlo',
  'cascadia mono': 'Menlo',
  menlo: 'Menlo',
  consolas: 'Menlo',
  monospace: 'Menlo',
  georgia: 'Georgia',
  cambria: 'Georgia',
  'times new roman': 'Times New Roman',
  times: 'Times New Roman',
  serif: 'Times New Roman',
  'courier new': 'Courier New',
  courier: 'Courier New',
  'helvetica neue': 'Helvetica Neue',
  arial: 'Arial',
};

export function resolveNativeFontStack(
  cssStack: string,
  weight: number,
  style: NativeFontStyle = 'normal',
): string | undefined {
  for (const cssFamily of parseCssFontStack(cssStack)) {
    for (const source of NATIVE_SOURCE_PRIORITY) {
      const exact = resolveNativeFontFamily(cssFamily, weight, style, source);
      if (exact) return exact;
    }

    const candidates = NATIVE_FONT_FACES.filter(
      (face) => face.cssFamily === cssFamily && face.style === style,
    ).sort((left, right) => (
      Math.abs(left.weight - weight) - Math.abs(right.weight - weight)
      || NATIVE_SOURCE_PRIORITY.indexOf(left.source)
        - NATIVE_SOURCE_PRIORITY.indexOf(right.source)
    ));
    if (candidates[0]) return candidates[0].runtimeFamily;

    const iosFamily = IOS_STACK_FAMILIES[cssFamily.toLowerCase()];
    if (iosFamily !== undefined) return iosFamily ?? undefined;
  }
  return undefined;
}

function parseCssFontStack(stack: string): string[] {
  const families: string[] = [];
  const matcher = /\s*(?:"([^"]+)"|'([^']+)'|([^,]+))\s*(?:,|$)/g;
  for (const match of stack.matchAll(matcher)) {
    const family = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (family) families.push(family);
  }
  return families;
}

function faceId(
  cssFamily: string,
  weight: number,
  style: NativeFontStyle,
  source: NativeFontSource,
): string {
  return `${source}\u0000${cssFamily}\u0000${weight}\u0000${style}`;
}
