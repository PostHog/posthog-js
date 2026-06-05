require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
folly_compiler_flags = '-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32'

# Single source of truth for the posthog-ios native dependency version.
# Used by both the SPM and CocoaPods resolution paths below; bump this
# line when picking up a new posthog-ios release.
posthog_ios_version = '3.58.1'

Pod::Spec.new do |s|
  s.name         = "posthog-react-native-plugin"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/PostHog/posthog-react-native-plugin.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{swift,h,hpp,m,mm,c,cpp}"

  # Default: resolve posthog-ios via CocoaPods trunk.
  # Opt-in: set `posthog.useSpm` to `"true"` in the consumer's
  # `ios/Podfile.properties.json` to resolve posthog-ios via Swift Package
  # Manager using the React Native `spm_dependency` helper (RN >= 0.75).
  # The SPM path requires `use_frameworks! :linkage => :dynamic` in the Podfile.
  podfile_properties_path = File.join(Pod::Config.instance.installation_root.to_s, 'Podfile.properties.json')
  podfile_properties = File.exist?(podfile_properties_path) ? (JSON.parse(File.read(podfile_properties_path)) rescue {}) : {}
  posthog_use_spm = podfile_properties['posthog.useSpm'].to_s == 'true'

  if posthog_use_spm && respond_to?(:spm_dependency, true)
    spm_dependency(s,
      url: 'https://github.com/PostHog/posthog-ios.git',
      requirement: { kind: 'upToNextMinorVersion', minimumVersion: posthog_ios_version },
      products: ['PostHog']
    )
  else
    s.dependency 'PostHog', "~> #{posthog_ios_version}"
  end
  s.ios.deployment_target = '13.0'
  s.swift_versions = "5.3"


  # Use install_modules_dependencies helper to install the dependencies if React Native version >=0.71.0.
  # See https://github.com/facebook/react-native/blob/febf6b7f33fdb4904669f99d795eba4c0f95d7bf/scripts/cocoapods/new_architecture.rb#L79.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"

    # Don't install the dependencies when we run `pod install` in the old architecture.
    if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then
      s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
      s.pod_target_xcconfig    = {
          "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
          "OTHER_CPLUSPLUSFLAGS" => "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
          "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
      }
      s.dependency "React-Codegen"
      s.dependency "RCT-Folly"
      s.dependency "RCTRequired"
      s.dependency "RCTTypeSafety"
      s.dependency "ReactCommon/turbomodule/core"
    end
  end
end
