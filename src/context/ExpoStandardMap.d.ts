import type * as Location from 'expo-location';
import type { ComponentType } from 'react';

import type { IOSCoordinate, IOSTodayPlace } from '../../modules/hermes-ios-context';

export interface ExpoStandardMapProps {
  centerRequest: number;
  location: Location.LocationObject | null;
  locale: 'en' | 'zh';
  onLocate(): void;
  places: IOSTodayPlace[];
  track: IOSCoordinate[];
}

export const ExpoStandardMap: ComponentType<ExpoStandardMapProps>;
