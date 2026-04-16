// inspired from https://github.com/getsentry/sentry-react-native/blob/c1981913a90fad31d8e98ec4a7dcb35c7af46a04/packages/core/plugin/src/withSentryIOS.ts#L18

const { withAppBuildGradle, withXcodeProject } = require('@expo/config-plugins')

const resolvePostHogReactNativePackageJsonPath =
  "[\"node\", \"--print\", \"require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')\"].execute().text.trim()"

const withAndroidPlugin = (config: any) => {
  return withAppBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure PostHog in the app gradle because the build.gradle is not groovy')
    }

    const buildGradle = config.modResults.contents
    const applyFrom = `apply from: new File(${resolvePostHogReactNativePackageJsonPath})`

    if (buildGradle.includes(applyFrom)) {
      return config
    }

    // Find the 'android {' block and insert the line directly above it
    const pattern = /^android\s*\{/m

    if (buildGradle.match(pattern)) {
      config.modResults.contents = buildGradle.replace(pattern, `${applyFrom}\n\nandroid {`)
    } else {
      console.warn('PostHog: Could not find "android {" block in build.gradle')
    }

    return config
  })
}

type BuildPhase = { shellScript: string }

export function modifyExistingXcodeBuildScript(script: BuildPhase): void {
  if (!script.shellScript.match(/(packager|scripts)\/react-native-xcode\.sh\b/)) {
    return
  }

  if (script.shellScript.includes('posthog-xcode.sh')) {
    return
  }

  if (script.shellScript.includes('posthog-react-native')) {
    return
  }

  const code = JSON.parse(script.shellScript)
  script.shellScript = JSON.stringify(addPostHogWithBundledScriptsToBundleShellScript(code))
}

const POSTHOG_REACT_NATIVE_XCODE_PATH =
  "`\"$NODE_BINARY\" --print \"require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog-xcode.sh')\"`"

export function addPostHogWithBundledScriptsToBundleShellScript(script: string): string {
  return script.replace(
    /^.*?(packager|scripts)\/react-native-xcode\.sh\s*(\\'\\\\")?/m,
    // eslint-disable-next-line no-useless-escape
    (match: string) => `/bin/sh ${POSTHOG_REACT_NATIVE_XCODE_PATH} ${match}`
  )
}

export function disableUserScriptSandboxing(xcodeProject: any): void {
  // posthog-cli needs to read .git/ for release auto-detection, which the
  // Xcode 14+ user script sandbox blocks.
  //
  // Scope: withXcodeProject only exposes the main app's .xcodeproj (the Pods
  // project is a separate .xcodeproj managed by CocoaPods — not touched here).
  // Within the main .xcodeproj, this iterates ALL build configurations without
  // filtering — that includes the app target, test targets, app extensions, and
  // any other target defined in the project.
  const configurations = xcodeProject.pbxXCBuildConfigurationSection()
  for (const key in configurations) {
    const configuration = configurations[key]
    if (configuration && configuration.buildSettings) {
      configuration.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = '"NO"'
    }
  }
}

type PostHogPluginProps = {
  /**
   * Whether to disable Xcode's user script sandboxing (ENABLE_USER_SCRIPT_SANDBOXING=NO).
   *
   * posthog-cli reads .git/ during sourcemap uploads for release auto-detection;
   * sandboxing (on by default in Xcode 14+) blocks that, so uploads lose git info
   * or fail silently.
   *
   * Default: true (disable sandboxing so uploads "just work").
   * Set to false if your org requires sandboxing stays on —
   * you'll lose automatic git metadata on sourcemap uploads on iOS builds only.
   */
  disableSandboxing?: boolean
}

const withIosPlugin = (config: any, props: PostHogPluginProps = {}) => {
  return withXcodeProject(config, (config: any) => {
    const xcodeProject = config.modResults

    const bundleReactNativePhase = xcodeProject.pbxItemByComment(
      'Bundle React Native code and images',
      'PBXShellScriptBuildPhase'
    )

    modifyExistingXcodeBuildScript(bundleReactNativePhase)

    if (props.disableSandboxing !== false) {
      disableUserScriptSandboxing(xcodeProject)
      console.warn(
        '[posthog-react-native] Setting ENABLE_USER_SCRIPT_SANDBOXING=NO on all Xcode ' +
          'build configurations so sourcemap uploads can resolve git metadata. ' +
          "If your org requires sandboxing to stay enabled, set `{ disableSandboxing: false }` " +
          'on the plugin in app.json — note that stock Expo projects may fail to build under ' +
          'sandboxing until every script build phase declares its input/output files.'
      )
    }

    return config
  })
}

const withPostHogPlugin = (config: any, props: PostHogPluginProps = {}) => {
  config = withAndroidPlugin(config)
  return withIosPlugin(config, props)
}

const postHogPlugin = (config: any, props: PostHogPluginProps = {}): any => {
  return withPostHogPlugin(config, props)
}

// Re-export the plugin function as the default export while keeping the
// named exports above callable from tests.
module.exports = postHogPlugin
module.exports.modifyExistingXcodeBuildScript = modifyExistingXcodeBuildScript
module.exports.addPostHogWithBundledScriptsToBundleShellScript = addPostHogWithBundledScriptsToBundleShellScript
module.exports.disableUserScriptSandboxing = disableUserScriptSandboxing
