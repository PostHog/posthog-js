// Portions of this file are derived from getsentry/sentry-react-native
// Copyright (c) 2017 Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-react-native/blob/main/LICENSE.md

const { withAppBuildGradle, withBaseMod, withGradleProperties, withProjectBuildGradle, withXcodeProject } =
  require('@expo/config-plugins')

// com.posthog.android uploads R8 mapping files and injects a matching map-id so native
// crash stack traces can be deobfuscated. The injected version has to read every gradle
// property the plugin writes, or that half of the build ignores the option: 1.4.0 is the first
// version that reads posthog.dotenvFile. 1.6.0 is the first version that ignores
// posthog.releaseMode with a deprecation warning, so the R8 mapping always binds to the release.
const POSTHOG_ANDROID_GRADLE_PLUGIN_VERSION = '1.6.0'

const resolvePostHogReactNativePackageJsonPath =
  "[\"node\", \"--print\", \"require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog.gradle')\"].execute().text.trim()"

const POSTHOG_ANDROID_SKIP_ON_CONFLICT_PROPERTY = 'posthogReactNativeSkipOnConflict'

const POSTHOG_HERMES_RELEASE_MODE_GRADLE_PROPERTY = 'posthog.hermesReleaseMode'

/**
 * How the release a build belongs to gets associated with the exceptions it reports. This steers
 * the Hermes source map upload only. iOS dSYMs and Android R8 mappings always bind to the release
 * their build creates.
 *
 * `event`, the default, uploads the maps release-independent and lets each event resolve its own
 * release from the app version and namespace the SDK already sends. `symbol-set` stamps the release
 * onto the uploaded maps instead, and an exception inherits the release of the maps its frames
 * resolved against.
 */
export type PostHogReleaseMode = 'symbol-set' | 'event'

// Exported so a test can hold the copies in posthog-xcode.sh, posthog.gradle and the generated
// dSYM phase to this list, because nothing else fails when they drift.
export const POSTHOG_RELEASE_MODES: PostHogReleaseMode[] = ['symbol-set', 'event']

// Empty/whitespace-only values (easy to produce from templated app.config values) count as unset
// and fall through to the next source. A configured mode is written into the bundle phase, and that
// beats POSTHOG_RELEASE_MODE at build time, so this reads the variable rather than leaving an Expo
// build with no way to opt out. Undefined means nothing configured a mode: the prebuild then writes
// nothing, and the build scripts apply the event default themselves, which they can soften to a
// bound upload when the installed posthog-cli predates the flag. An unrecognized value stops the
// prebuild rather than falling back, so a typo cannot silently leave a build binding its maps to a
// release it meant to keep independent.
export function resolveReleaseModeProp(releaseMode?: string, environmentMode?: string): PostHogReleaseMode | undefined {
  const trimmed = releaseMode?.trim() || environmentMode?.trim()
  if (!trimmed) {
    return undefined
  }
  if (!POSTHOG_RELEASE_MODES.includes(trimmed as PostHogReleaseMode)) {
    throw new Error(
      `[posthog-react-native] releaseMode must be one of ${POSTHOG_RELEASE_MODES.join(', ')}, was '${trimmed}'`
    )
  }
  return trimmed as PostHogReleaseMode
}

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
  // Expo evaluates mods in key-insertion order, so this plugin must register before anything
  // else touches appBuildGradle — otherwise the flag is read before projectBuildGradle sets it.
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

export function modifyExistingXcodeBuildScript(
  script: BuildPhase | undefined,
  skipOnConflict = false,
  releaseMode?: PostHogReleaseMode
): void {
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
    const code = migrateLegacyPostHogWrapperInvocation(JSON.parse(script.shellScript))
    script.shellScript = JSON.stringify(updatePostHogBundlePhaseExports(code, skipOnConflict, releaseMode))
    return
  }

  if (script.shellScript.includes('posthog-react-native')) {
    return
  }

  const code = JSON.parse(script.shellScript)
  script.shellScript = JSON.stringify(
    addPostHogWithBundledScriptsToBundleShellScript(code, skipOnConflict, releaseMode)
  )
}

// Invoked directly so another wrapper receives this script—not /bin/sh—as $1.
// package.json declares it as a bin target so package managers preserve its executable bit.
const POSTHOG_REACT_NATIVE_XCODE_PATH =
  "`\"$NODE_BINARY\" --print \"require('path').join(require('path').dirname(require.resolve('posthog-react-native')), '..', 'tooling', 'posthog-xcode.sh')\"`"

const POSTHOG_SKIP_ON_CONFLICT_EXPORT = 'export POSTHOG_SKIP_ON_CONFLICT=1'
const POSTHOG_RELEASE_MODE_EXPORT_PREFIX = 'export POSTHOG_RELEASE_MODE='

// Exported before the wrapped command so posthog-xcode.sh — and any outer wrapper that re-invokes
// it — sees them. posthog-cli reads POSTHOG_RELEASE_MODE itself, so one export covers the hermes
// clone and upload alike.
function buildBundlePhaseExports(skipOnConflict: boolean, releaseMode?: PostHogReleaseMode): string[] {
  const exports: string[] = []
  if (skipOnConflict) {
    exports.push(POSTHOG_SKIP_ON_CONFLICT_EXPORT)
  }
  if (releaseMode) {
    exports.push(`${POSTHOG_RELEASE_MODE_EXPORT_PREFIX}${releaseMode}`)
  }
  return exports
}

const REACT_NATIVE_XCODE_LINE =
  /^([ \t]*)(?![A-Za-z_][A-Za-z0-9_]*=)([^\n]*(?:packager|scripts)\/react-native-xcode\.sh\b[^\n]*)$/m

function migrateLegacyPostHogWrapperInvocation(script: string): string {
  return script.replace(`/bin/sh ${POSTHOG_REACT_NATIVE_XCODE_PATH}`, POSTHOG_REACT_NATIVE_XCODE_PATH)
}

// Rewrites the managed exports on an already-wrapped bundle phase, so changing an option in
// app.json takes effect without a clean prebuild.
function updatePostHogBundlePhaseExports(
  script: string,
  skipOnConflict: boolean,
  releaseMode?: PostHogReleaseMode
): string {
  const skipArg = '--posthog-skip-on-conflict --'
  const lines = script
    .replace(new RegExp(`\\s*${skipArg}\\s*`, 'g'), ' ')
    .split('\n')
    .filter((line) => line.trim() !== POSTHOG_SKIP_ON_CONFLICT_EXPORT)
    .filter((line) => !line.trim().startsWith(POSTHOG_RELEASE_MODE_EXPORT_PREFIX))

  const exports = buildBundlePhaseExports(skipOnConflict, releaseMode)
  if (exports.length > 0) {
    const commandIndex = lines.findIndex((line) => line.includes(POSTHOG_REACT_NATIVE_XCODE_PATH))
    if (commandIndex !== -1) {
      const indent = lines[commandIndex].match(/^[ \t]*/)?.[0] ?? ''
      lines.splice(commandIndex, 0, ...exports.map((line) => `${indent}${line}`))
    }
  }

  return lines.join('\n')
}

export function addPostHogWithBundledScriptsToBundleShellScript(
  script: string,
  skipOnConflict = false,
  releaseMode?: PostHogReleaseMode
): string {
  // Capture the full RN script invocation. Expo uses a backtick-wrapped
  // node --print command, so matching only up to react-native-xcode.sh cuts the
  // command substitution in half and leaves the generated shell invalid.
  return script.replace(REACT_NATIVE_XCODE_LINE, (_match: string, indent: string, rnCommand: string) => {
    const exports = buildBundlePhaseExports(skipOnConflict, releaseMode)
      .map((line) => `${indent}${line}\n`)
      .join('')
    return `${exports}${indent}${POSTHOG_REACT_NATIVE_XCODE_PATH} ${rnCommand}`
  })
}

const POSTHOG_DSYM_BUILD_PHASE_NAME = 'Upload PostHog Debug Symbols'
const POSTHOG_DSYM_INPUT_PATH =
  '"$(DWARF_DSYM_FOLDER_PATH)/$(DWARF_DSYM_FILE_NAME)/Contents/Resources/DWARF/$(EXECUTABLE_NAME)"'

// Shell script for the dSYM upload build phase. It locates and runs posthog-ios's
// upload-symbols.sh (CocoaPods or SwiftPM) rather than re-implementing dSYM upload.
// `includeSource` (iOS only) opts into POSTHOG_INCLUDE_SOURCE to also upload native source.
export function buildDsymUploadShellScript(includeSource = false, skipOnConflict = false): string {
  return composeDsymUploadShellScript(includeSource, skipOnConflict)
}

// The phase as SDKs without release-mode support wrote it: the same script with no release-mode
// block. isPluginGeneratedDsymUploadBuildPhase compares against this exact text, so a change here
// makes the plugin stop recognizing the phases it wrote before, and stop refreshing them.
function composeDsymUploadShellScript(includeSource: boolean, skipOnConflict: boolean): string {
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

// The release-mode block exactly as 4.64.0 through 4.66.x wrote it into the dSYM phase. Its
// POSTHOG_NO_RELEASE_BIND export still steers the posthog-ios this plugin pins, so a phase carrying
// the block must stay recognized and get rewritten to the block-free script. Verbatim on purpose.
function legacyDsymReleaseModeLines(releaseMode?: PostHogReleaseMode): string[] {
  return [
    releaseMode
      ? `POSTHOG_RESOLVED_RELEASE_MODE="${releaseMode}"`
      : 'POSTHOG_RESOLVED_RELEASE_MODE="${POSTHOG_RELEASE_MODE:-}"',
    'case "$POSTHOG_RESOLVED_RELEASE_MODE" in',
    '  ""|symbol-set) ;;',
    '  event)',
    '    # Upload dSYMs without binding them to a release, so each crash resolves its own from the',
    '    # app version and namespace the SDK sends. posthog-ios versions whose upload-symbols.sh',
    '    # does not read this variable ignore it and keep binding the dSYMs.',
    '    export POSTHOG_NO_RELEASE_BIND=1',
    '    ;;',
    '  *)',
    "    echo \"error: posthog release mode must be 'symbol-set' or 'event', was '$POSTHOG_RESOLVED_RELEASE_MODE'\"",
    '    exit 1',
    '    ;;',
    'esac',
  ]
}

// The phase as the release-mode era wrote it: the current script with the mode block ahead of the
// upload lines. Derived from composeDsymUploadShellScript, so the shared lines stay a compatibility
// contract: a change to them needs the old text kept as a variant, or these phases go unrecognized.
// The verbatim fixtures in expoconfig.spec.ts hold this derivation to the published 4.66.3 text.
function buildLegacyReleaseModeDsymUploadShellScript(
  includeSource: boolean,
  skipOnConflict: boolean,
  releaseMode?: PostHogReleaseMode
): string {
  const lines = composeDsymUploadShellScript(includeSource, skipOnConflict).split('\n')
  const uploadIndex = lines.findIndex((line) => line.startsWith('PODS_SCRIPT='))
  lines.splice(uploadIndex, 0, ...legacyDsymReleaseModeLines(releaseMode))
  return lines.join('\n')
}

// xcode's addBuildPhase stores shellScript quote-escaped with literal newlines; in-place
// refreshes must match or the stored pbxproj representation churns.
function encodePbxShellScript(script: string): string {
  return '"' + script.replace(/"/g, '\\"') + '"'
}

// Undoes any quoted pbxproj encoding of shellScript. Handles both the literal-newline
// form xcode's addBuildPhase writes and the \n-escaped form Xcode itself writes, so a
// pristine phase is recognized regardless of which tool last serialized the project.
function decodePbxShellScript(stored: string): string {
  if (!stored.startsWith('"') || !stored.endsWith('"')) {
    return stored
  }
  return stored.slice(1, -1).replace(/\\(.)/g, (_match, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch))
}

function isPluginGeneratedDsymUploadBuildPhase(phase: any): boolean {
  if (typeof phase?.shellScript !== 'string') {
    return false
  }
  const stored = decodePbxShellScript(phase.shellScript)
  return [false, true].some((source) =>
    [false, true].some(
      (skip) =>
        stored === buildDsymUploadShellScript(source, skip) ||
        [undefined, ...POSTHOG_RELEASE_MODES].some(
          (mode) => stored === buildLegacyReleaseModeDsymUploadShellScript(source, skip, mode)
        )
    )
  )
}

export function moveDsymUploadBuildPhaseToEnd(xcodeProject: any): void {
  const existing = xcodeProject.pbxItemByComment(POSTHOG_DSYM_BUILD_PHASE_NAME, 'PBXShellScriptBuildPhase')
  if (!isPluginGeneratedDsymUploadBuildPhase(existing)) {
    return
  }

  const buildPhases = xcodeProject.getFirstTarget?.().firstTarget?.buildPhases
  if (Array.isArray(buildPhases)) {
    const phaseIndex = buildPhases.findIndex((phase: any) => phase.comment === POSTHOG_DSYM_BUILD_PHASE_NAME)
    if (phaseIndex !== -1 && phaseIndex !== buildPhases.length - 1) {
      buildPhases.push(...buildPhases.splice(phaseIndex, 1))
    }
  }
}

// Keeps the upload phase last and declares the main DWARF as an input, matching the native iOS
// setup guide. Both are required: the input makes Xcode wait for dSYM generation, while placing
// the phase after extension embedding avoids dependency cycles in apps with app extensions.
// Re-runs refresh only a still-plugin-generated phase, also one an older SDK wrote, so user
// customizations remain untouched.
export function addDsymUploadBuildPhase(xcodeProject: any, includeSource = false, skipOnConflict = false): void {
  const existing = xcodeProject.pbxItemByComment(POSTHOG_DSYM_BUILD_PHASE_NAME, 'PBXShellScriptBuildPhase')
  if (existing) {
    if (isPluginGeneratedDsymUploadBuildPhase(existing)) {
      existing.shellScript = encodePbxShellScript(buildDsymUploadShellScript(includeSource, skipOnConflict))
      existing.inputPaths = Array.from(
        new Set([...(Array.isArray(existing.inputPaths) ? existing.inputPaths : []), POSTHOG_DSYM_INPUT_PATH])
      )
    }
  } else {
    xcodeProject.addBuildPhase([], 'PBXShellScriptBuildPhase', POSTHOG_DSYM_BUILD_PHASE_NAME, null, {
      inputPaths: [POSTHOG_DSYM_INPUT_PATH],
      shellPath: '/bin/sh',
      shellScript: buildDsymUploadShellScript(includeSource, skipOnConflict),
    })
  }

  moveDsymUploadBuildPhaseToEnd(xcodeProject)
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

const POSTHOG_DOTENV_BUILD_SETTING = 'POSTHOG_CLI_DOTENV_FILE'
const POSTHOG_DOTENV_GRADLE_PROPERTY = 'posthog.dotenvFile'

// Strips a leading ./ so relative props join cleanly onto their per-platform prefix.
function normalizeDotenvFileProp(dotenvFile: string): string {
  return dotenvFile.replace(/^\.\//, '')
}

// Empty/whitespace-only values (easy to produce from templated app.config values)
// count as unset — mirrors the trim guard in posthog.gradle.
export function resolveDotenvFileProp(dotenvFile?: string): string | undefined {
  const trimmed = dotenvFile?.trim()
  return trimmed ? trimmed : undefined
}

// Posix root or a Windows drive prefix — enough without pulling in `path`,
// whose isAbsolute is platform-bound while prebuild can run anywhere.
function isAbsoluteDotenvPath(dotenvFile: string): boolean {
  return dotenvFile.startsWith('/') || /^[A-Za-z]:[\\/]/.test(dotenvFile)
}

// pbxproj stores build-setting values quoted; escape so paths with quotes or
// backslashes survive serialization. $(SRCROOT) is the generated ios/ dir, so
// project-root-relative props live one level up.
export function buildIosDotenvFileBuildSetting(dotenvFile: string): string {
  const value = isAbsoluteDotenvPath(dotenvFile) ? dotenvFile : `$(SRCROOT)/../${normalizeDotenvFileProp(dotenvFile)}`
  return '"' + value.replace(/(["\\])/g, '\\$1') + '"'
}

// Xcode exports build settings as env vars to every Run Script phase, so one
// setting feeds both the bundle-phase hermes upload and the dSYM upload phase;
// posthog-cli (>= 0.8.4) reads POSTHOG_CLI_DOTENV_FILE itself, no script
// changes needed. Removing the prop removes the setting again so changes take
// effect without a clean prebuild.
export function applyDotenvFileBuildSetting(xcodeProject: any, dotenvFile?: string): void {
  const configurations = xcodeProject.pbxXCBuildConfigurationSection()
  for (const key in configurations) {
    const configuration = configurations[key]
    if (configuration && configuration.buildSettings) {
      if (dotenvFile) {
        configuration.buildSettings[POSTHOG_DOTENV_BUILD_SETTING] = buildIosDotenvFileBuildSetting(dotenvFile)
      } else {
        delete configuration.buildSettings[POSTHOG_DOTENV_BUILD_SETTING]
      }
    }
  }
}

type GradlePropertiesItem = { type: string; key?: string; value?: string }

// gradle.properties lives in android/, so a project-root-relative prop becomes ../<path>.
export function buildAndroidDotenvFileGradleValue(dotenvFile: string): string {
  return isAbsoluteDotenvPath(dotenvFile) ? dotenvFile : `../${normalizeDotenvFileProp(dotenvFile)}`
}

// Managed posthog.dotenvFile entry in android/gradle.properties, consumed by
// both gradle hooks (the SDK's posthog.gradle hermes upload and the
// com.posthog.android mapping upload). Added when the prop is set, removed
// when it isn't.
export function updateDotenvFileGradleProperties(
  properties: GradlePropertiesItem[],
  dotenvFile?: string
): GradlePropertiesItem[] {
  const rest = properties.filter((item) => !(item.type === 'property' && item.key === POSTHOG_DOTENV_GRADLE_PROPERTY))
  if (!dotenvFile) {
    return rest
  }
  rest.push({
    type: 'property',
    key: POSTHOG_DOTENV_GRADLE_PROPERTY,
    value: buildAndroidDotenvFileGradleValue(dotenvFile),
  })
  return rest
}

// Managed posthog.hermesReleaseMode entry in android/gradle.properties, read by the SDK's
// posthog.gradle hermes upload. The key is deliberately not posthog.releaseMode:
// com.posthog.android below 1.6.0 reads that one for the R8 mapping upload, and the mode must not
// reach it. A posthog.releaseMode entry is deprecated user-owned config, so the prebuild leaves it
// alone. posthog.gradle reads it as a fallback with a warning, and com.posthog.android 1.6.0
// warns about it and ignores it.
export function updateHermesReleaseModeGradleProperties(
  properties: GradlePropertiesItem[],
  releaseMode?: PostHogReleaseMode
): GradlePropertiesItem[] {
  const rest = properties.filter(
    (item) => !(item.type === 'property' && item.key === POSTHOG_HERMES_RELEASE_MODE_GRADLE_PROPERTY)
  )
  if (!releaseMode) {
    return rest
  }
  rest.push({ type: 'property', key: POSTHOG_HERMES_RELEASE_MODE_GRADLE_PROPERTY, value: releaseMode })
  return rest
}

const withPostHogGradleProperties = (config: any, dotenvFile?: string, releaseMode?: PostHogReleaseMode) => {
  return withGradleProperties(config, (config: any) => {
    config.modResults = updateDotenvFileGradleProperties(config.modResults, dotenvFile)
    config.modResults = updateHermesReleaseModeGradleProperties(config.modResults, releaseMode)
    return config
  })
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
   * to `posthog-cli dsym upload` on posthog-ios >= 3.64.7 (with posthog-cli >= 0.7.12) and
   * ignores it on older versions, where dSYM conflicts keep failing the build.
   *
   * Default: false.
   */
  skipOnConflict?: boolean

  /**
   * Path to a dotenv file with POSTHOG_CLI_* credentials (API key, project id,
   * optional host), relative to the project root — or absolute.
   *
   * The path reaches every upload hook as POSTHOG_CLI_DOTENV_FILE: on iOS as a
   * build setting (Xcode exports it to the bundle and dSYM script phases), on
   * Android as a `posthog.dotenvFile` entry in android/gradle.properties read
   * by the SDK's `posthog.gradle` hermes upload and, on gradle plugin >= 1.4.0,
   * by the `com.posthog.android` mapping upload. Process env always wins inside
   * the CLI; a missing file is a warning, not a build failure.
   *
   * Requires posthog-cli >= 0.8.4 — older CLIs ignore the variable and fall
   * back to their other credential sources. With `disableSandboxing: false`,
   * Xcode's script sandbox can block reading the file, which is a hard CLI
   * error (an unreadable-but-present file does not fall through).
   */
  dotenvFile?: string

  /**
   * How the release a build belongs to gets associated with the exceptions it reports.
   *
   * This steers the Hermes source map upload only. iOS dSYMs and Android R8 mappings always bind to
   * the release their build creates. The R8 half of that needs the `com.posthog.android` gradle
   * plugin 1.6.0, which ignores the deprecated `posthog.releaseMode` key. A fresh prebuild injects
   * that version, but a project whose android/build.gradle already carries an older classpath line
   * keeps it: bump the line by hand or prebuild with `--clean`.
   *
   * `event` (the default; still EXPERIMENTAL while the rollout settles) uploads the maps
   * release-independent, and each event resolves its own release from the `$app_namespace` /
   * `$app_version` / `$app_build` the SDK sends. Use it when two releases can ship identical
   * JavaScript: the map id comes from content, so in `symbol-set` mode both releases report
   * whichever one uploaded first.
   *
   * Event mode's release link depends on those coordinates reaching each exception. The SDK reads
   * them from the optional `expo-application` or `react-native-device-info` module, and a plain
   * `customAppProperties` object replaces the defaults rather than merging. An install with neither
   * module — or a `customAppProperties` that drops the keys — still symbolicates, but its JavaScript
   * exceptions carry no release. Keep a metadata module (or those keys) to attribute event-mode
   * exceptions to a release; `symbol-set` instead stamps the release onto the uploaded maps from the
   * build settings and does not need them.
   *
   * When this prop is absent, the prebuild reads `POSTHOG_RELEASE_MODE`; set the variable before
   * you run the prebuild. A configured mode is written into the build files and beats the variable
   * at build time. With neither configured, the prebuild writes nothing, the build scripts apply
   * the `event` default at build time, and `POSTHOG_RELEASE_MODE` also still works there.
   *
   * Event mode needs posthog-cli >= 0.16.0, which carries `--release-mode` on the `hermes`
   * commands. A configured `event` fails the build on an older one and names the upgrade. The
   * unconfigured default softens instead: the build warns and uploads the maps bound to the
   * release, as it did before the default changed. That floor lives in posthog-xcode.sh and
   * posthog.gradle: update them and this line together.
   */
  releaseMode?: PostHogReleaseMode
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

// Expo's standard mods run their action before the previously registered action. This wrapper
// deliberately runs its action after the rest of the Xcode mod chain, so later config plugins
// cannot leave a newly created extension-embedding phase after the PostHog upload phase.
const withFinalizedXcodeProject = (config: any, action: (config: any) => any) => {
  return withBaseMod(config, {
    platform: 'ios',
    mod: 'xcodeproj',
    async action(config: any) {
      const { nextMod, ...modRequest } = config.modRequest
      const results = await nextMod({ ...config, modRequest })
      return action(results)
    },
  })
}

const withIosPlugin = (config: any, props: PostHogPluginProps = {}) => {
  const nativeSymbols = resolveNativeSymbolUpload(props.uploadNativeSymbols)

  config = withXcodeProject(config, (config: any) => {
    const xcodeProject = config.modResults

    const bundleReactNativePhase = xcodeProject.pbxItemByComment(
      'Bundle React Native code and images',
      'PBXShellScriptBuildPhase'
    )

    modifyExistingXcodeBuildScript(bundleReactNativePhase, props.skipOnConflict === true, props.releaseMode)

    if (nativeSymbols.enabled) {
      addDsymUploadBuildPhase(
        xcodeProject,
        nativeSymbols.includeSource,
        props.skipOnConflict === true
      )
    }

    applyDotenvFileBuildSetting(xcodeProject, props.dotenvFile)

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

  if (nativeSymbols.enabled) {
    config = withFinalizedXcodeProject(config, (config: any) => {
      moveDsymUploadBuildPhaseToEnd(config.modResults)
      return config
    })
  }

  return config
}

const withPostHogPlugin = (config: any, rawProps: PostHogPluginProps = {}) => {
  const props = {
    ...rawProps,
    dotenvFile: resolveDotenvFileProp(rawProps.dotenvFile),
    releaseMode: resolveReleaseModeProp(rawProps.releaseMode, process.env.POSTHOG_RELEASE_MODE),
  }
  // Must register first: it inserts the projectBuildGradle mod key ahead of appBuildGradle,
  // and expo evaluates mods in key-insertion order. Registering withAndroidPlugin first would
  // make appBuildGradle run before projectBuildGradle, so `classpathPresent` would still be
  // false and `apply plugin: "com.posthog.android"` would silently never be written.
  // includeSource is iOS-only, so on Android we only care whether upload is enabled.
  if (resolveNativeSymbolUpload(props.uploadNativeSymbols).enabled) {
    config = withAndroidNativeSymbolsPlugin(config)
  }
  config = withAndroidPlugin(config, props.skipOnConflict === true)
  // Runs unconditionally so removing the prop also removes the managed entry.
  config = withPostHogGradleProperties(config, props.dotenvFile, props.releaseMode)
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
module.exports.moveDsymUploadBuildPhaseToEnd = moveDsymUploadBuildPhaseToEnd
module.exports.resolveNativeSymbolUpload = resolveNativeSymbolUpload
module.exports.buildAndroidSkipOnConflictGradleLine = buildAndroidSkipOnConflictGradleLine
module.exports.addPostHogAndroidGradlePluginClasspath = addPostHogAndroidGradlePluginClasspath
module.exports.applyPostHogAndroidGradlePlugin = applyPostHogAndroidGradlePlugin
module.exports.buildIosDotenvFileBuildSetting = buildIosDotenvFileBuildSetting
module.exports.applyDotenvFileBuildSetting = applyDotenvFileBuildSetting
module.exports.resolveDotenvFileProp = resolveDotenvFileProp
module.exports.buildAndroidDotenvFileGradleValue = buildAndroidDotenvFileGradleValue
module.exports.updateDotenvFileGradleProperties = updateDotenvFileGradleProperties
module.exports.POSTHOG_RELEASE_MODES = POSTHOG_RELEASE_MODES
module.exports.resolveReleaseModeProp = resolveReleaseModeProp
module.exports.updateHermesReleaseModeGradleProperties = updateHermesReleaseModeGradleProperties
