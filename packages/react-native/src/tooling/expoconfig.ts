// Portions of this file are derived from getsentry/sentry-react-native
// Copyright (c) 2017 Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-react-native/blob/main/LICENSE.md

const { withAppBuildGradle, withProjectBuildGradle, withXcodeProject } = require('@expo/config-plugins')

// Pinned version of the official PostHog Android Gradle plugin (com.posthog.android),
// published to Maven Central. It uploads ProGuard/R8 mapping files and injects a
// matching map-id into the app assets so native crash stack traces can be deobfuscated.
const POSTHOG_ANDROID_GRADLE_PLUGIN_VERSION = '1.2.0'

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

// Adds the PostHog Android Gradle plugin to the project-level buildscript
// classpath. The plugin is published to Maven Central (not the Gradle Plugin
// Portal), so we use the legacy classpath + apply route, which is the most
// reliable across React Native / Expo project layouts. Idempotent.
export function addPostHogAndroidGradlePluginClasspath(projectBuildGradle: string): string {
  if (projectBuildGradle.includes('posthog-android-gradle-plugin')) {
    return projectBuildGradle
  }

  const classpathLine = `        classpath("com.posthog:posthog-android-gradle-plugin:${POSTHOG_ANDROID_GRADLE_PLUGIN_VERSION}")`
  // Insert into the first dependencies { } block inside buildscript { }.
  const pattern = /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/

  if (!pattern.test(projectBuildGradle)) {
    console.warn(
      'PostHog: Could not find a buildscript dependencies block in the project build.gradle; ' +
        'skipping the com.posthog.android classpath. Native symbols will not be uploaded.'
    )
    return projectBuildGradle
  }

  return projectBuildGradle.replace(pattern, `$1\n${classpathLine}`)
}

// Applies the com.posthog.android plugin in the app module. Idempotent.
export function applyPostHogAndroidGradlePlugin(appBuildGradle: string): string {
  if (/apply plugin: ["']com\.posthog\.android["']/.test(appBuildGradle)) {
    return appBuildGradle
  }

  const applyLine = 'apply plugin: "com.posthog.android"'

  // Apply right after com.android.application so the plugin can hook AGP variants.
  const appPluginPattern = /^([ \t]*apply plugin: ["']com\.android\.application["'].*)$/m
  if (appPluginPattern.test(appBuildGradle)) {
    return appBuildGradle.replace(appPluginPattern, `$1\n${applyLine}`)
  }

  // Fallback: insert directly above the android { } block.
  const androidBlockPattern = /^android\s*\{/m
  if (androidBlockPattern.test(appBuildGradle)) {
    return appBuildGradle.replace(androidBlockPattern, `${applyLine}\n\nandroid {`)
  }

  console.warn('PostHog: Could not find where to apply com.posthog.android in the app build.gradle')
  return appBuildGradle
}

const withAndroidNativeSymbolsPlugin = (config: any) => {
  config = withProjectBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure the PostHog Android Gradle plugin because the project build.gradle is not groovy')
      return config
    }
    config.modResults.contents = addPostHogAndroidGradlePluginClasspath(config.modResults.contents)
    return config
  })

  return withAppBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure the PostHog Android Gradle plugin because the app build.gradle is not groovy')
      return config
    }
    config.modResults.contents = applyPostHogAndroidGradlePlugin(config.modResults.contents)
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

const REACT_NATIVE_XCODE_LINE =
  /^([ \t]*)(?![A-Za-z_][A-Za-z0-9_]*=)(?:\/bin\/sh\s+)?([^\n]*(?:packager|scripts)\/react-native-xcode\.sh\b[^\n]*)$/m

export function addPostHogWithBundledScriptsToBundleShellScript(script: string): string {
  // Capture the full RN script invocation. Expo uses a backtick-wrapped
  // node --print command, so matching only up to react-native-xcode.sh cuts the
  // command substitution in half and leaves the generated shell invalid.
  return script.replace(
    REACT_NATIVE_XCODE_LINE,
    (_match: string, indent: string, rnCommand: string) =>
      `${indent}/bin/sh ${POSTHOG_REACT_NATIVE_XCODE_PATH} ${rnCommand}`
  )
}

const POSTHOG_DSYM_BUILD_PHASE_NAME = 'Upload PostHog Debug Symbols'

// Shell script for the dSYM upload build phase. It reuses upload-symbols.sh
// shipped inside the posthog-ios dependency rather than re-implementing dSYM
// upload here. The script self-guards to Release builds, locates posthog-cli,
// and reads $DWARF_DSYM_FOLDER_PATH itself — we only need to locate it for the
// two supported integrations (CocoaPods and SwiftPM).
//
// `includeSource` opts into POSTHOG_INCLUDE_SOURCE (read by upload-symbols.sh),
// which uploads native source files for source-code context around crashes.
// This is iOS only — the Android proguard upload has no source-inclusion flag.
export function buildDsymUploadShellScript(includeSource = false): string {
  const lines = [
    '# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.',
    '# upload-symbols.sh ships inside the posthog-ios dependency.',
  ]

  if (includeSource) {
    lines.push(
      '# Also upload native source files for source-code context around crashes.',
      'export POSTHOG_INCLUDE_SOURCE=1'
    )
  }

  lines.push(
    'PODS_SCRIPT="${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"',
    'SPM_SCRIPT="${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh"',
    'if [ -f "$PODS_SCRIPT" ]; then',
    '  /bin/sh "$PODS_SCRIPT"',
    'elif [ -f "$SPM_SCRIPT" ]; then',
    '  /bin/sh "$SPM_SCRIPT"',
    'else',
    '  echo "warning: PostHog upload-symbols.sh not found in Pods or SwiftPM checkouts; skipping dSYM upload."',
    'fi'
  )

  return lines.join('\n')
}

// Adds a Run Script build phase that uploads dSYMs to PostHog. Idempotent: a
// phase with the same name is only added once. Appended last so it runs after
// the dSYM bundle is produced.
export function addDsymUploadBuildPhase(xcodeProject: any, includeSource = false): void {
  const existing = xcodeProject.pbxItemByComment(POSTHOG_DSYM_BUILD_PHASE_NAME, 'PBXShellScriptBuildPhase')
  if (existing) {
    return
  }

  xcodeProject.addBuildPhase([], 'PBXShellScriptBuildPhase', POSTHOG_DSYM_BUILD_PHASE_NAME, null, {
    shellPath: '/bin/sh',
    shellScript: buildDsymUploadShellScript(includeSource),
  })
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
   *
   * Note that this setting is recommended in the Expo docs:
   * https://docs.expo.dev/brownfield/integrated-approach/#configuring-your-xcode-project
   */
  disableSandboxing?: boolean

  /**
   * Whether to upload native debug symbols so native crashes can be symbolicated.
   *
   * When enabled, the plugin wires the native symbol-upload tooling that the
   * native PostHog SDKs already ship:
   *  - iOS: a build phase that runs posthog-ios's `upload-symbols.sh`
   *    (`posthog-cli dsym upload`).
   *  - Android: the official `com.posthog.android` Gradle plugin, which uploads
   *    ProGuard/R8 mapping files and injects the matching map-id into the app.
   *
   * Pass `{ includeSource: true }` to also upload native source files so PostHog
   * can show source-code context around native crashes. This is **iOS only** —
   * the Android proguard upload has no source-inclusion equivalent, so the flag
   * is ignored there. Note it uploads your source code to PostHog, hence opt-in.
   *
   * Default: false. Pair this with `errorTracking.autocapture.nativeCrashes` at
   * runtime — without uploaded symbols, native stack traces won't be symbolicated.
   * Requires `posthog-cli` to be available and authenticated during release builds.
   */
  uploadNativeSymbols?: boolean | { includeSource?: boolean }
}

// Normalizes the uploadNativeSymbols prop (boolean | { includeSource }) into a
// flat shape. `includeSource` is iOS-only and ignored on Android.
export function resolveNativeSymbolUpload(prop: PostHogPluginProps['uploadNativeSymbols']): {
  enabled: boolean
  includeSource: boolean
} {
  if (prop === true) {
    return { enabled: true, includeSource: false }
  }
  if (prop && typeof prop === 'object') {
    return { enabled: true, includeSource: prop.includeSource === true }
  }
  return { enabled: false, includeSource: false }
}

const withIosPlugin = (config: any, props: PostHogPluginProps = {}) => {
  return withXcodeProject(config, (config: any) => {
    const xcodeProject = config.modResults

    const bundleReactNativePhase = xcodeProject.pbxItemByComment(
      'Bundle React Native code and images',
      'PBXShellScriptBuildPhase'
    )

    modifyExistingXcodeBuildScript(bundleReactNativePhase)

    const nativeSymbols = resolveNativeSymbolUpload(props.uploadNativeSymbols)
    if (nativeSymbols.enabled) {
      addDsymUploadBuildPhase(xcodeProject, nativeSymbols.includeSource)
    }

    if (props.disableSandboxing !== false) {
      disableUserScriptSandboxing(xcodeProject)
      console.warn(
        '[posthog-react-native] Setting ENABLE_USER_SCRIPT_SANDBOXING=NO on all Xcode ' +
          'build configurations so sourcemap uploads can resolve git metadata. ' +
          'If your org requires sandboxing to stay enabled, set `{ disableSandboxing: false }` ' +
          'on the plugin in app.json — note that stock Expo projects may fail to build under ' +
          'sandboxing until every script build phase declares its input/output files.'
      )
    }

    return config
  })
}

const withPostHogPlugin = (config: any, props: PostHogPluginProps = {}) => {
  config = withAndroidPlugin(config)
  // includeSource is iOS-only, so on Android we only care whether upload is enabled.
  if (resolveNativeSymbolUpload(props.uploadNativeSymbols).enabled) {
    config = withAndroidNativeSymbolsPlugin(config)
  }
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
module.exports.buildDsymUploadShellScript = buildDsymUploadShellScript
module.exports.addDsymUploadBuildPhase = addDsymUploadBuildPhase
module.exports.resolveNativeSymbolUpload = resolveNativeSymbolUpload
module.exports.addPostHogAndroidGradlePluginClasspath = addPostHogAndroidGradlePluginClasspath
module.exports.applyPostHogAndroidGradlePlugin = applyPostHogAndroidGradlePlugin
