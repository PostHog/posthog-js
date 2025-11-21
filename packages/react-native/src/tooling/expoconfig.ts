const { withAppBuildGradle, withXcodeProject } = require('@expo/config-plugins')

const withAndroidPlugin = (config: any) => {
  return withAppBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure PostHog in the app gradle because the build.gradle is not groovy')
    }

    const buildGradle = config.modResults.contents
    const lineToAdd = 'apply from: "../../node_modules/posthog-react-native/tooling/posthog.gradle"'

    if (buildGradle.includes(lineToAdd)) {
      return config
    }

    // Find the 'android {' block and insert the line directly above it
    const pattern = /^android\s*\{/m

    if (buildGradle.match(pattern)) {
      config.modResults.contents = buildGradle.replace(pattern, `${lineToAdd}\n\nandroid {`)
    } else {
      console.warn('PostHog: Could not find "android {" block in build.gradle')
    }

    return config
  })
}

const withIosPlugin = (config: any) => {
  return withXcodeProject(config, (config: any) => {
    const xcodeProject = config.modResults
    const buildPhases = xcodeProject.hash.project.objects.PBXShellScriptBuildPhase

    for (const key in buildPhases) {
      const buildPhase = buildPhases[key]
      const name = buildPhase.name ? buildPhase.name.replace(/"/g, '') : ''

      if (name === 'Bundle React Native code and images') {
        let script = buildPhase.shellScript

        const oldSearch =
          "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'"

        const newReplace =
          "require('path').dirname(require.resolve('posthog-react-native')) + '/../tooling/posthog-xcode.sh'"

        if (!script.includes('posthog-xcode.sh')) {
          if (script.includes(oldSearch)) {
            script = script.replace(oldSearch, newReplace)
            buildPhase.shellScript = script
          } else {
            console.warn(
              'PostHog: Could not find exact match for React Native script path. Verify your build phase script content.'
            )
          }
        }
        break
      }
    }
    return config
  })
}

const withPostHogPlugin = (config: any) => {
  console.log('test plugin called')
  config = withAndroidPlugin(config)
  return withIosPlugin(config)
}

module.exports = (config: any) => {
  return withPostHogPlugin(config)
}
