Pod::Spec.new do |s|
  s.name           = 'HermesSwipeActions'
  s.version        = '1.0.0'
  s.summary        = 'Native UIKit swipe actions for Hermes iOS'
  s.description    = 'Hosts Hermes rows in UITableViewCell and exposes UISwipeActionsConfiguration.'
  s.author         = 'Hermes iOS'
  s.homepage       = 'https://github.com/NousResearch/hermes-agent'
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
