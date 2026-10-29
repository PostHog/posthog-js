require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Single source of truth for the posthog-ios native dependency version.
# Used by the `spm_dependency` call below and must match the floor in
# ios/Package.swift; bump this line when picking up a new posthog-ios release.
posthog_ios_version = '3.88.2'

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

  # posthog-ios 4.x is published only as a Swift package, not on CocoaPods
  # trunk, so resolve it with React Native's `spm_dependency` helper
  # (react-native and react-native-macos 0.75+).
  unless respond_to?(:spm_dependency, true)
    raise "#{s.name} requires React Native 0.75 or later: it resolves posthog-ios through Swift Package Manager with `spm_dependency`"
  end
  # `spm_dependency` only looks for a target named exactly after this pod in the
  # main Pods project, so it can't find it when CocoaPods splits pods into
  # separate projects or scopes target names (`posthog-react-native-plugin-Pods-App`,
  # `posthog-react-native-plugin-iOS15.1`).
  # Read the Podfile only once CocoaPods has loaded it: autolinking evaluates this
  # podspec while the Podfile is still loading, and `Pod::Config#podfile` would
  # load it again. `pod install` re-evaluates this `:path` podspec afterwards, so
  # the check still runs.
  podfile = Pod::Config.instance.instance_variable_get(:@podfile) rescue nil
  if podfile
    install_options = Pod::Installer::InstallationOptions.from_podfile(podfile)
    if install_options.generate_multiple_pod_projects
      raise "#{s.name} doesn't support `generate_multiple_pod_projects`: React Native's `spm_dependency` can't add posthog-ios to a pod in a separate project. Remove that option from your Podfile's `install!` line."
    end
    unless install_options.deduplicate_targets
      raise "#{s.name} doesn't support `deduplicate_targets => false`: React Native's `spm_dependency` can't add posthog-ios to a scoped pod target. Remove that option from your Podfile's `install!` line."
    end
    # Targets with different platforms or linkage each get their own scoped pod target.
    # Like CocoaPods' resolver, this counts abstract targets that have a platform.
    targets = podfile.target_definition_list.select do |target|
      target.platform && target.dependencies.any? { |dependency| dependency.root_name == s.name }
    end
    if targets.map { |target| [target.platform, target.build_type.to_hash] }.uniq.length > 1
      raise "#{s.name} doesn't support targets with different platforms or `use_frameworks!` linkage: React Native's `spm_dependency` can't add posthog-ios to a scoped pod target. Give #{targets.map(&:name).join(', ')} the same `platform` and `use_frameworks!` in your Podfile."
    end
  end
  spm_dependency(s,
    url: 'https://github.com/PostHog/posthog-ios.git',
    requirement: { kind: 'upToNextMinorVersion', minimumVersion: posthog_ios_version },
    products: ['PostHog']
  )
  s.swift_versions = "5.3"

  install_modules_dependencies(s)
end
