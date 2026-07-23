Pod::Spec.new do |s|
  s.name           = 'HermesIOSContext'
  s.version        = '1.0.0'
  s.summary        = 'Native iOS context collectors and standard map surface for Hermes'
  s.description    = 'Adaptive location, encrypted context relay, HealthKit, EventKit, WatchConnectivity, ActivityKit, BackgroundTasks, and AMap with a MapKit fallback.'
  s.author         = 'Hermes iOS'
  s.homepage       = 'https://github.com/given33/hermes-ios'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'AMap3DMap-NO-IDFA', '11.2.000'
  s.frameworks = 'AppIntents', 'ActivityKit', 'BackgroundTasks', 'CoreLocation', 'CoreMotion', 'CryptoKit', 'DeviceActivity', 'EventKit', 'FamilyControls', 'HealthKit', 'MapKit', 'Security', 'UIKit', 'UserNotifications', 'WatchConnectivity'
  s.source_files = '**/*.{h,m,mm,swift}'
end
