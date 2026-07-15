Pod::Spec.new do |s|
  s.name           = 'HermesIOSControls'
  s.version        = '1.0.0'
  s.summary        = 'Native SwiftUI controls for Hermes iOS'
  s.description    = 'SwiftUI search, selection, text input, press feedback, drawer, and dialog presentation.'
  s.author         = 'Hermes iOS'
  s.homepage       = 'https://github.com/NousResearch/hermes-agent'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.resources = 'Resources/**/*'
end
