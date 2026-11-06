require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Single source of truth for the posthog-ios native dependency version.
# Used by the `spm_dependency` call below and must match the floor in
# ios/Package.swift; bump this line when picking up a new posthog-ios release.
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
  # React Native 0.87 and 0.88 build a static `spm_dependency` pod into the shared
  # products dir and point the app's `-fmodule-map-file` flags at
  # `<pod>.modulemap`, but the module map is named after the module
  # (`posthog_react_native_plugin`), not the pod, so the flags keep the old
  # `<pod>/<module>.modulemap` path and the build fails with "module map file not
  # found". Rewrite the path with the module name too. React Native fixed this in
  # 0.89 (https://github.com/facebook/react-native/pull/59182), where there's
  # nothing left to rewrite.
  if defined?(::SPMManager) && ::SPMManager.private_method_defined?(:rewrite_aggregate_modulemap_references) &&
     !defined?(::PostHogReactNativePluginModuleMapFix)
    module ::PostHogReactNativePluginModuleMapFix
      private

      def rewrite_aggregate_modulemap_references(installer, pod_names)
        super
        pod = installer.pod_targets.find { |target| target.pod_name == 'posthog-react-native-plugin' }
        return unless pod && pod_names.include?(pod.label)

        old_path = "${PODS_CONFIGURATION_BUILD_DIR}/#{pod.label}/#{pod.product_module_name}.modulemap"
        new_path = "${PODS_CONFIGURATION_BUILD_DIR}/#{pod.product_module_name}.modulemap"
        installer.aggregate_targets.each do |aggregate_target|
          aggregate_target.xcconfigs.each do |config_name, config_file|
            changed = false
            %w[OTHER_CFLAGS OTHER_SWIFT_FLAGS].each do |key|
              value = config_file.attributes[key]
              next unless value&.include?(old_path)

              config_file.attributes[key] = value.gsub(old_path, new_path)
              changed = true
            end
            config_file.save_as(aggregate_target.xcconfig_path(config_name)) if changed
          end
        end
      end
    end
    ::SPMManager.prepend(::PostHogReactNativePluginModuleMapFix)
  end
  s.swift_versions = "5.3"

  install_modules_dependencies(s)
end
