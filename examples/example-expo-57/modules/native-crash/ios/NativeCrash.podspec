Pod::Spec.new do |s|
  s.name           = 'NativeCrash'
  s.version        = '1.0.0'
  s.summary        = 'Native crash triggers for testing PostHog native error tracking'
  s.description    = 'Local Expo module that triggers genuine native iOS crashes for testing.'
  s.author         = 'PostHog'
  s.homepage       = 'https://posthog.com'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
