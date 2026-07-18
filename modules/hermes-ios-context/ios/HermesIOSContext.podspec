Pod::Spec.new do |s|
  s.name           = 'HermesIOSContext'
  s.version        = '1.0.0'
  s.summary        = 'Native iOS context collectors and MapKit surface for Hermes'
  s.description    = 'Adaptive location, encrypted context relay, HealthKit, EventKit, WatchConnectivity, ActivityKit, BackgroundTasks, and a standard MapKit view.'
  s.author         = 'Hermes iOS'
  s.homepage       = 'https://github.com/given33/hermes-ios'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AppIntents', 'ActivityKit', 'BackgroundTasks', 'CoreLocation', 'CoreMotion', 'DeviceActivity', 'EventKit', 'FamilyControls', 'HealthKit', 'MapKit', 'Security', 'UIKit', 'UserNotifications', 'WatchConnectivity'
  s.source_files = '**/*.{h,m,mm,swift}'
end
