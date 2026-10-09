require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Single source of truth for the posthog-ios native dependency version.
# Used by both the SPM and CocoaPods resolution paths below; bump this
# line when picking up a new posthog-ios release.
posthog_ios_version = '4.0.0'

Pod::Spec.new do |s|
  s.name         = "posthog-react-native-plugin"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => '15.0', :osx => '11.0' }
  s.source       = { :git => "https://github.com/PostHog/posthog-js.git", :tag => "@posthog/react-native-plugin@#{s.version}" }

  s.source_files = "ios/PosthogReactNativePlugin.{swift,h,hpp,m,mm,c,cpp}"

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
  s.swift_versions = "5.3"

  install_modules_dependencies(s)
end
