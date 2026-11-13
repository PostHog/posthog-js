# Evaluates the plugin podspec against Podfiles built with the real CocoaPods
# DSL and checks which ones `pod install` would reject.
# Run: ruby packages/react-native-plugin/scripts/check-podspec-guards.rb
require 'cocoapods'

PODSPEC = File.expand_path('../posthog-react-native-plugin.podspec', __dir__)
PLUGIN = 'posthog-react-native-plugin'

# React Native's helpers, which the podspec calls; the guards run before them.
def spm_dependency(*, **); end
def install_modules_dependencies(*); end

def evaluate(podfile)
  Pod::Config.instance.instance_variable_set(:@podfile, podfile)
  Pod::Specification.from_file(PODSPEC)
  nil
rescue StandardError => e
  e.message
ensure
  Pod::Config.instance.instance_variable_set(:@podfile, nil)
end

CASES = {
  'plugin alone installs' => [nil, proc {
    platform :ios, '15.1'
    target('App') { pod PLUGIN, path: '..' }
  }],
  'plugin with posthog-react-native-session-replay is rejected' => ['`posthog-react-native-session-replay` pod', proc {
    platform :ios, '15.1'
    target 'App' do
      pod PLUGIN, path: '..'
      pod 'posthog-react-native-session-replay', path: '../replay'
    end
  }],
  "plugin with pod 'PostHog' is rejected" => ['`PostHog` pod', proc {
    platform :ios, '15.1'
    target 'App' do
      pod PLUGIN, path: '..'
      pod 'PostHog', '~> 3.58'
    end
  }],
  "pod 'PostHog' in a target without the plugin installs" => [nil, proc {
    platform :ios, '15.1'
    target('App') { pod PLUGIN, path: '..' }
    target('Widget') { pod 'PostHog', '~> 3.58' }
  }],
  "pod 'PostHog' in a target that inherits the plugin is rejected" => ['`PostHog` pod', proc {
    platform :ios, '15.1'
    target 'App' do
      pod PLUGIN, path: '..'
      target 'AppTests' do
        inherit! :complete
        pod 'PostHog', '~> 3.58'
      end
    end
  }],
  "plugin in a target that inherits pod 'PostHog' is rejected" => ['`PostHog` pod', proc {
    platform :ios, '15.1'
    target 'App' do
      pod 'PostHog', '~> 3.58'
      target 'AppTests' do
        inherit! :complete
        pod PLUGIN, path: '..'
      end
    end
  }]
}.freeze

failures = CASES.reject do |name, (expected, dsl)|
  error = evaluate(Pod::Podfile.new(&dsl))
  passed = expected ? error&.include?(expected) : error.nil?
  puts "#{passed ? 'ok  ' : 'FAIL'} #{name}#{passed ? '' : ": got #{error.inspect}"}"
  passed
end
exit(failures.empty? ? 0 : 1)
