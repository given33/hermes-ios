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

function faceId(
  cssFamily: string,
  weight: number,
  style: NativeFontStyle,
  source: NativeFontSource,
): string {
  return `${source}\u0000${cssFamily}\u0000${weight}\u0000${style}`;
}
