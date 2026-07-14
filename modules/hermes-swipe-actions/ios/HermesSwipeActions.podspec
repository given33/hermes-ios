Pod::Spec.new do |s|
  s.name           = 'HermesSwipeActions'
  s.version        = '1.0.0'
  s.summary        = 'Native SwiftUI swipe actions for Hermes iOS'
  s.description    = 'Hosts Hermes rows in a SwiftUI List and exposes system swipe actions.'
  s.author         = 'Hermes iOS'
  s.homepage       = 'https://github.com/NousResearch/hermes-agent'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
