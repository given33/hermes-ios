Pod::Spec.new do |s|
  s.name           = 'HermesIOSControls'
  s.version        = '1.0.0'
  s.summary        = 'Native UIKit controls for Hermes iOS'
  s.description    = 'UISegmentedControl, UISwitch, UISearchBar, UIProgressView, and native selection animations.'
  s.author         = 'Hermes iOS'
  s.homepage       = 'https://github.com/NousResearch/hermes-agent'
  s.platforms      = { :ios => '18.0' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
