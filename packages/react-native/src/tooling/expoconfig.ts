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

const withIosPlugin = (config: any) => {
  return withXcodeProject(config, (config: any) => {
    const xcodeProject = config.modResults

    const bundleReactNativePhase = xcodeProject.pbxItemByComment(
      'Bundle React Native code and images',
      'PBXShellScriptBuildPhase'
    )

    modifyExistingXcodeBuildScript(bundleReactNativePhase)

    return config
  })
}

const withPostHogPlugin = (config: any) => {
  config = withAndroidPlugin(config)
  // return config
  return withIosPlugin(config)
}

module.exports = (config: any) => {
  return withPostHogPlugin(config)
}
