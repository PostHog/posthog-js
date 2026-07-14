// Portions of this file are derived from getsentry/sentry-react-native
// Copyright (c) 2017 Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-react-native/blob/main/LICENSE.md

const { withAppBuildGradle, withProjectBuildGradle, withXcodeProject } = require('@expo/config-plugins')

// com.posthog.android uploads R8 mapping files and injects a matching map-id so native
// crash stack traces can be deobfuscated.
const POSTHOG_ANDROID_GRADLE_PLUGIN_VERSION = '1.2.0'

const resolvePostHogReactNativePackageJsonPath =
  "[\"node\", \"--print\", \"require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')\"].execute().text.trim()"

const POSTHOG_ANDROID_SKIP_ON_CONFLICT_PROPERTY = 'posthogReactNativeSkipOnConflict'

export function buildAndroidSkipOnConflictGradleLine(skipOnConflict: boolean): string | null {
  if (!skipOnConflict) {
    return null
  }
  return `project.ext.${POSTHOG_ANDROID_SKIP_ON_CONFLICT_PROPERTY} = true`
}

const withAndroidPlugin = (config: any, skipOnConflict = false) => {
  return withAppBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure PostHog in the app gradle because the build.gradle is not groovy')
    }

    const buildGradle = config.modResults.contents
    const applyFrom = `apply from: new File(${resolvePostHogReactNativePackageJsonPath})`
    const skipOnConflictLine = buildAndroidSkipOnConflictGradleLine(skipOnConflict)
    const applyBlock = skipOnConflictLine ? `${skipOnConflictLine}\n${applyFrom}` : applyFrom
    const skipOnConflictPattern = new RegExp(
      `^project\\.ext\\.${POSTHOG_ANDROID_SKIP_ON_CONFLICT_PROPERTY}\\s*=\\s*(true|false)\\n?`,
      'm'
    )

    if (buildGradle.includes(applyFrom)) {
      let contents = buildGradle.replace(skipOnConflictPattern, '')
      if (skipOnConflictLine) {
        contents = contents.replace(applyFrom, `${skipOnConflictLine}\n${applyFrom}`)
      }
      config.modResults.contents = contents
      return config
    }

    // Find the 'android {' block and insert the line directly above it
    const pattern = /^android\s*\{/m

    if (buildGradle.match(pattern)) {
      config.modResults.contents = buildGradle.replace(pattern, `${applyBlock}\n\nandroid {`)
    } else {
      console.warn('PostHog: Could not find "android {" block in build.gradle')
    }

    return config
  })
}

// Index of the `}` matching the `{` at openBraceIndex, or -1 if unbalanced. Manual scan
// (not regex) to avoid ReDoS; counts all braces, fine for the generated gradle we target.
function matchingBraceIndex(s: string, openBraceIndex: number): number {
  let depth = 0
  for (let i = openBraceIndex; i < s.length; i++) {
    if (s[i] === '{') {
      depth++
    } else if (s[i] === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

// Published to Maven Central (not the Gradle Plugin Portal), so we use the legacy buildscript
// classpath + apply route. Idempotent. `classpathPresent` tells the caller to only `apply
// plugin` when the classpath is in the file, else the build can't resolve it.
export function addPostHogAndroidGradlePluginClasspath(projectBuildGradle: string): {
  contents: string
  classpathPresent: boolean
} {
  if (projectBuildGradle.includes('posthog-android-gradle-plugin')) {
    return { contents: projectBuildGradle, classpathPresent: true }
  }

  const classpathLine = `        classpath("com.posthog:posthog-android-gradle-plugin:${POSTHOG_ANDROID_GRADLE_PLUGIN_VERSION}")`

  // First `dependencies {` inside the `buildscript {}` block. Bounding to the buildscript body
  // avoids a backtracking regex (ReDoS) and mis-placing into a later block (e.g. allprojects).
  const buildscriptMatch = /buildscript\s*\{/.exec(projectBuildGradle)
  const buildscriptOpenBrace = buildscriptMatch ? buildscriptMatch.index + buildscriptMatch[0].length - 1 : -1
  const buildscriptEnd = buildscriptOpenBrace === -1 ? -1 : matchingBraceIndex(projectBuildGradle, buildscriptOpenBrace)
  const buildscriptBody = buildscriptEnd === -1 ? '' : projectBuildGradle.slice(buildscriptOpenBrace, buildscriptEnd)
  const dependenciesMatch = buildscriptBody ? /dependencies\s*\{/.exec(buildscriptBody) : null

  if (!dependenciesMatch) {
    console.warn(
      'PostHog: Could not find a buildscript dependencies block in the project build.gradle; ' +
        'skipping the com.posthog.android classpath. Native symbols will not be uploaded.'
    )
    return { contents: projectBuildGradle, classpathPresent: false }
  }

  const insertAt = buildscriptOpenBrace + dependenciesMatch.index + dependenciesMatch[0].length
  return {
    contents: `${projectBuildGradle.slice(0, insertAt)}\n${classpathLine}${projectBuildGradle.slice(insertAt)}`,
    classpathPresent: true,
  }
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
  // Couple the classpath and `apply plugin`: applying without the classpath breaks the build.
  // Expo compiles projectBuildGradle before appBuildGradle, so this flag is set before it's read.
  let classpathPresent = false

  config = withProjectBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure the PostHog Android Gradle plugin because the project build.gradle is not groovy')
      return config
    }
    const result = addPostHogAndroidGradlePluginClasspath(config.modResults.contents)
    config.modResults.contents = result.contents
    classpathPresent = result.classpathPresent
    return config
  })

  return withAppBuildGradle(config, (config: any) => {
    if (config.modResults.language !== 'groovy') {
      console.warn('Cannot configure the PostHog Android Gradle plugin because the app build.gradle is not groovy')
      return config
    }
    if (!classpathPresent) {
      // No classpath (kts, or no buildscript dependencies block) → applying would break the build.
      return config
    }
    config.modResults.contents = applyPostHogAndroidGradlePlugin(config.modResults.contents)
    return config
  })
}

type BuildPhase = { shellScript: string }

export function modifyExistingXcodeBuildScript(script: BuildPhase | undefined, skipOnConflict = false): void {
  if (!script?.shellScript) {
    console.warn(
      "[posthog-react-native] Could not find the 'Bundle React Native code and images' build phase; " +
        'skipping sourcemap upload setup.'
    )
    return
  }

  if (!script.shellScript.match(/(packager|scripts)\/react-native-xcode\.sh\b/)) {
    return
  }

  if (script.shellScript.includes('posthog-xcode.sh')) {
    const code = JSON.parse(script.shellScript)
    script.shellScript = JSON.stringify(updatePostHogSkipOnConflictArg(code, skipOnConflict))
    return
  }

  if (script.shellScript.includes('posthog-react-native')) {
    return
  }

  const code = JSON.parse(script.shellScript)
  script.shellScript = JSON.stringify(addPostHogWithBundledScriptsToBundleShellScript(code, skipOnConflict))
}

const POSTHOG_REACT_NATIVE_XCODE_PATH =
  "`\"$NODE_BINARY\" --print \"require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog-xcode.sh')\"`"

const REACT_NATIVE_XCODE_LINE =
  /^([ \t]*)(?![A-Za-z_][A-Za-z0-9_]*=)(?:\/bin\/sh\s+)?([^\n]*(?:packager|scripts)\/react-native-xcode\.sh\b[^\n]*)$/m

function updatePostHogSkipOnConflictArg(script: string, skipOnConflict: boolean): string {
  const skipArg = '--posthog-skip-on-conflict --'
  const withoutSkipArg = script.replace(new RegExp(`\\s*${skipArg}\\s*`, 'g'), ' ')
  if (!skipOnConflict) {
    return withoutSkipArg
  }
  return withoutSkipArg.replace(`${POSTHOG_REACT_NATIVE_XCODE_PATH} `, `${POSTHOG_REACT_NATIVE_XCODE_PATH} ${skipArg} `)
}

export function addPostHogWithBundledScriptsToBundleShellScript(script: string, skipOnConflict = false): string {
  const postHogArgs = skipOnConflict ? '--posthog-skip-on-conflict -- ' : ''

  // Capture the full RN script invocation. Expo uses a backtick-wrapped
  // node --print command, so matching only up to react-native-xcode.sh cuts the
  // command substitution in half and leaves the generated shell invalid.
  return script.replace(
    REACT_NATIVE_XCODE_LINE,
    (_match: string, indent: string, rnCommand: string) =>
      `${indent}/bin/sh ${POSTHOG_REACT_NATIVE_XCODE_PATH} ${postHogArgs}${rnCommand}`
  )
}

const POSTHOG_DSYM_BUILD_PHASE_NAME = 'Upload PostHog Debug Symbols'

// Shell script for the dSYM upload build phase. It locates and runs posthog-ios's
// upload-symbols.sh (CocoaPods or SwiftPM) rather than re-implementing dSYM upload.
// `includeSource` (iOS only) opts into POSTHOG_INCLUDE_SOURCE to also upload native source.
export function buildDsymUploadShellScript(includeSource = false, skipOnConflict = false): string {
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

  if (skipOnConflict) {
    lines.push(
      '# Skip dSYMs that already exist in PostHog with different content instead of failing the build.',
      'export POSTHOG_SKIP_ON_CONFLICT=1'
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

// xcode's addBuildPhase stores shellScript quote-escaped with literal newlines; in-place
// refreshes must match or the stored pbxproj representation churns.
function encodePbxShellScript(script: string): string {
  return '"' + script.replace(/"/g, '\\"') + '"'
}

// Appends a Run Script build phase that uploads dSYMs; appended last so it runs after the
// dSYM bundle is produced. Re-runs refresh a still-plugin-generated script so option
// changes take effect without a clean prebuild.
export function addDsymUploadBuildPhase(xcodeProject: any, includeSource = false, skipOnConflict = false): void {
  const existing = xcodeProject.pbxItemByComment(POSTHOG_DSYM_BUILD_PHASE_NAME, 'PBXShellScriptBuildPhase')
  if (existing) {
    const generatedVariants = [false, true].flatMap((source) =>
      [false, true].map((skip) => encodePbxShellScript(buildDsymUploadShellScript(source, skip)))
    )
    if (generatedVariants.includes(existing.shellScript)) {
      existing.shellScript = encodePbxShellScript(buildDsymUploadShellScript(includeSource, skipOnConflict))
    }
    return
  }

  xcodeProject.addBuildPhase([], 'PBXShellScriptBuildPhase', POSTHOG_DSYM_BUILD_PHASE_NAME, null, {
    shellPath: '/bin/sh',
    shellScript: buildDsymUploadShellScript(includeSource, skipOnConflict),
  })
}

export function disableUserScriptSandboxing(xcodeProject: any): void {
  // posthog-cli reads .git/ for release auto-detection, which the Xcode 14+ user script
  // sandbox blocks. Applies to all configs in the main app's .xcodeproj (Pods project is
  // separate and untouched).
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

  /**
   * Whether to skip uploads whose content already exists in PostHog instead of failing the build.
   *
   * Appends `--skip-on-conflict` to `posthog-cli hermes upload` on iOS and Android. When
   * `uploadNativeSymbols` is enabled, also sets `POSTHOG_SKIP_ON_CONFLICT=1` in the iOS dSYM
   * upload build phase; posthog-ios's `upload-symbols.sh` forwards it as `--skip-on-conflict`
   * to `posthog-cli dsym upload` on versions that support the variable (with posthog-cli
   * >= 0.7.12) and ignores it on older versions, where dSYM conflicts keep failing the build.
   *
   * Default: false.
   */
  skipOnConflict?: boolean
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

    modifyExistingXcodeBuildScript(bundleReactNativePhase, props.skipOnConflict === true)

    const nativeSymbols = resolveNativeSymbolUpload(props.uploadNativeSymbols)
    if (nativeSymbols.enabled) {
      addDsymUploadBuildPhase(xcodeProject, nativeSymbols.includeSource, props.skipOnConflict === true)
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
  config = withAndroidPlugin(config, props.skipOnConflict === true)
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
module.exports.buildAndroidSkipOnConflictGradleLine = buildAndroidSkipOnConflictGradleLine
module.exports.addPostHogAndroidGradlePluginClasspath = addPostHogAndroidGradlePluginClasspath
module.exports.applyPostHogAndroidGradlePlugin = applyPostHogAndroidGradlePlugin
