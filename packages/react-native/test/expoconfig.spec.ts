import { spawnSync } from 'child_process'

import {
  addDsymUploadBuildPhase,
  addPostHogAndroidGradlePluginClasspath,
  addPostHogWithBundledScriptsToBundleShellScript,
  applyDotenvFileBuildSetting,
  applyPostHogAndroidGradlePlugin,
  buildAndroidDotenvFileGradleValue,
  buildAndroidSkipOnConflictGradleLine,
  buildDsymUploadShellScript,
  buildIosDotenvFileBuildSetting,
  disableUserScriptSandboxing,
  findForeignBundleScriptWrapper,
  modifyExistingXcodeBuildScript,
  resolveDotenvFileProp,
  resolveNativeSymbolUpload,
  updateDotenvFileGradleProperties,
} from '../src/tooling/expoconfig'

type MockBuildConfig = { buildSettings: Record<string, string> }

const mockXcodeProject = (): {
  pbxXCBuildConfigurationSection: () => Record<string, MockBuildConfig>
  configs: Record<string, MockBuildConfig>
} => {
  const configs: Record<string, MockBuildConfig> = {
    '1A:Release': { buildSettings: { PRODUCT_NAME: '"MyApp"' } },
    '2B:Debug': { buildSettings: { PRODUCT_NAME: '"MyApp"' } },
    '3C:Pods-Release': { buildSettings: { PRODUCT_NAME: '"Pods-MyApp"' } },
  }
  return {
    pbxXCBuildConfigurationSection: () => configs,
    configs,
  }
}

describe('disableUserScriptSandboxing', () => {
  it('sets ENABLE_USER_SCRIPT_SANDBOXING="NO" on every build configuration', () => {
    const xp = mockXcodeProject()
    disableUserScriptSandboxing(xp)
    for (const key of Object.keys(xp.configs)) {
      expect(xp.configs[key].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING).toBe('"NO"')
    }
  })

  it('uses the literal quoted "NO" string required by the pbxproj format', () => {
    // Unquoted NO corrupts the project file in some xcode-npm versions.
    const xp = mockXcodeProject()
    disableUserScriptSandboxing(xp)
    expect(xp.configs['1A:Release'].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING).not.toBe('NO')
    expect(xp.configs['1A:Release'].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING).not.toBe(false)
  })

  it('preserves existing build settings', () => {
    const xp = mockXcodeProject()
    disableUserScriptSandboxing(xp)
    expect(xp.configs['1A:Release'].buildSettings.PRODUCT_NAME).toBe('"MyApp"')
  })

  it('is idempotent — running twice yields the same result', () => {
    const xp = mockXcodeProject()
    disableUserScriptSandboxing(xp)
    disableUserScriptSandboxing(xp)
    expect(xp.configs['1A:Release'].buildSettings.ENABLE_USER_SCRIPT_SANDBOXING).toBe('"NO"')
  })
})

// Extracts the argument that would become $1 inside posthog-xcode.sh when
// the wrapped line is executed by the shell. The shell runs:
//   /bin/sh <posthog-xcode.sh-path> <...rest>
// so $1 is the token immediately after the posthog-xcode.sh path.
const extractArg1 = (wrappedLine: string): string => {
  // The line looks like: /bin/sh `<node eval>` <arg1> ...
  // Split on the backtick-delimited posthog-xcode.sh path expression, then
  // take the first whitespace-separated token from whatever follows it.
  const afterPosthog = wrappedLine.split(/`[^`]+`/)[1] ?? ''
  return afterPosthog.trim().split(/\s+/)[0]
}

const expectValidShellSyntax = (script: string): void => {
  const result = spawnSync('/bin/sh', ['-n'], { input: script, encoding: 'utf8' })
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
}

describe('addPostHogWithBundledScriptsToBundleShellScript', () => {
  it('wraps the react-native-xcode.sh invocation with posthog-xcode.sh', () => {
    const original = '"../node_modules/react-native/scripts/react-native-xcode.sh"'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)
    expect(wrapped).toContain('posthog-xcode.sh')
    expect(wrapped).toContain('react-native-xcode.sh')
    expect(wrapped.startsWith('/bin/sh ')).toBe(true)
    expect(wrapped.indexOf('posthog-xcode.sh')).toBeLessThan(wrapped.indexOf('react-native-xcode.sh'))
  })

  it('supports the alternative packager/ path', () => {
    const original = '"node_modules/react-native/packager/react-native-xcode.sh"'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)
    expect(wrapped).toContain('posthog-xcode.sh')
    expect(wrapped).toContain('packager/react-native-xcode.sh')
  })

  // Regression tests for issue #3682:
  // When the Expo bundle phase already contains a /bin/sh prefix (common in
  // Expo SDK 53+ and plain RN projects), posthog-xcode.sh receives /bin/sh as
  // $1, which makes the REACT_NATIVE_XCODE variable resolve to /bin/sh instead
  // of react-native-xcode.sh, silently breaking the PACKAGER_SOURCEMAP_FILE patch.
  it.each([
    ['simple path (no shell prefix)', '../node_modules/react-native/scripts/react-native-xcode.sh'],
    [
      'shell-prefixed command (Expo SDK 53+ / plain RN)',
      '/bin/sh "$PODS_ROOT/../.."/node_modules/react-native/scripts/react-native-xcode.sh',
    ],
  ])('arg1 passed to posthog-xcode.sh is react-native-xcode.sh path, not /bin/sh — %s', (_desc, original) => {
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)
    const arg1 = extractArg1(wrapped)
    expect(arg1).toContain('react-native-xcode.sh')
    expect(arg1).not.toBe('/bin/sh')
  })

  it('preserves the full Expo backtick command when wrapping react-native-xcode.sh', () => {
    const original =
      "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"`"

    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)

    expect(wrapped).toContain('posthog-xcode.sh')
    expect(wrapped).toContain(
      "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"`"
    )
    expect(wrapped).not.toContain("` '/scripts/react-native-xcode.sh'\"`")
    expectValidShellSyntax(wrapped)
  })

  it('passes skipOnConflict before the react-native-xcode.sh command', () => {
    const original = 'node_modules/react-native/scripts/react-native-xcode.sh'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original, true)

    expect(wrapped).toContain('--posthog-skip-on-conflict -- node_modules/react-native/scripts/react-native-xcode.sh')
    expectValidShellSyntax(wrapped)
  })
})

describe('modifyExistingXcodeBuildScript', () => {
  it('wraps the bundle phase shellScript', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script)
    const parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('posthog-xcode.sh')
  })

  it('wraps the bundle phase shellScript with skipOnConflict', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script, true)
    const parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('--posthog-skip-on-conflict --')
  })

  it('updates skipOnConflict on an already wrapped bundle phase', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script)
    modifyExistingXcodeBuildScript(script, true)
    let parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('--posthog-skip-on-conflict --')

    modifyExistingXcodeBuildScript(script, false)
    parsed = JSON.parse(script.shellScript)
    expect(parsed).not.toContain('--posthog-skip-on-conflict --')
  })

  it('wraps Expo backtick bundle phase shellScript without creating invalid shell syntax', () => {
    const expoBundleScript = [
      'if [[ -z "$CLI_PATH" ]]; then',
      '  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve(\'@expo/cli\')")"',
      'fi',
      '',
      "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"`",
      '',
    ].join('\n')
    const script = { shellScript: JSON.stringify(expoBundleScript) }

    modifyExistingXcodeBuildScript(script)

    const parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('posthog-xcode.sh')
    expect(parsed).toContain(
      "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"`"
    )
    expectValidShellSyntax(parsed)
  })

  it('is idempotent — re-running does not double-wrap', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script)
    const firstPass = script.shellScript
    modifyExistingXcodeBuildScript(script)
    expect(script.shellScript).toBe(firstPass)
  })

  it('skips already posthog-react-native-wrapped scripts without parsing them', () => {
    const script = { shellScript: 'posthog-react-native node_modules/react-native/scripts/react-native-xcode.sh' }
    const original = script.shellScript
    expect(() => modifyExistingXcodeBuildScript(script)).not.toThrow()
    expect(script.shellScript).toBe(original)
  })

  it('skips scripts that do not invoke react-native-xcode.sh', () => {
    const script = { shellScript: JSON.stringify('echo "hello"') }
    const original = script.shellScript
    modifyExistingXcodeBuildScript(script)
    expect(script.shellScript).toBe(original)
  })

  it('warns instead of throwing when the bundle phase is missing', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => modifyExistingXcodeBuildScript(undefined)).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Bundle React Native code and images'))
    warn.mockRestore()
  })
})

// Fixtures for issue #4285: composing with another config plugin (Sentry) that
// also wraps the React Native bundle phase.
const EXPO_RN_XCODE_LINE =
  "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"`"
const SENTRY_XCODE_PATH =
  "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('@sentry/react-native/package.json')) + '/scripts/sentry-xcode.sh'\"`"

const expoBundlePhase = (rnLine: string): string =>
  [
    'if [[ -z "$CLI_PATH" ]]; then',
    '  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve(\'@expo/cli\')")"',
    'fi',
    '',
    rnLine,
    '',
  ].join('\n')

// Mirrors @sentry/react-native's addSentryWithBundledScriptsToBundleShellScript:
// it prepends its wrapper to the whole matched react-native-xcode.sh line, keeping
// the previous command as positional arguments.
const simulateSentryWrap = (script: string): string =>
  script.replace(
    /^.*(?:packager|scripts)\/react-native-xcode\.sh.*$/m,
    (match) => `/bin/sh ${SENTRY_XCODE_PATH} ${match}`
  )

describe('findForeignBundleScriptWrapper', () => {
  it('returns null for an unwrapped simple react-native-xcode.sh path', () => {
    expect(findForeignBundleScriptWrapper('"../node_modules/react-native/scripts/react-native-xcode.sh"')).toBeNull()
  })

  it('returns null for the plain Expo backtick invocation', () => {
    expect(findForeignBundleScriptWrapper(expoBundlePhase(EXPO_RN_XCODE_LINE))).toBeNull()
  })

  it('returns null for a /bin/sh-prefixed react-native-xcode.sh command (issue #3682 shape)', () => {
    expect(
      findForeignBundleScriptWrapper(
        '/bin/sh "$PODS_ROOT/../.."/node_modules/react-native/scripts/react-native-xcode.sh'
      )
    ).toBeNull()
  })

  it('returns null when there is no react-native-xcode.sh invocation at all', () => {
    expect(findForeignBundleScriptWrapper('echo "hello"')).toBeNull()
  })

  it('detects the Sentry Expo backtick wrapper', () => {
    const script = expoBundlePhase(simulateSentryWrap(EXPO_RN_XCODE_LINE))
    expect(findForeignBundleScriptWrapper(script)).toBe('sentry-xcode.sh')
  })

  it('detects a plain-path foreign wrapper', () => {
    expect(
      findForeignBundleScriptWrapper(
        '/bin/sh ../node_modules/@sentry/react-native/scripts/sentry-xcode.sh ../node_modules/react-native/scripts/react-native-xcode.sh'
      )
    ).toBe('sentry-xcode.sh')
  })
})

describe('modifyExistingXcodeBuildScript with a foreign bundle-phase wrapper (issue #4285)', () => {
  const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1

  it('does not nest inside a Sentry-wrapped bundle phase (Sentry plugin applied first)', () => {
    const sentryWrapped = expoBundlePhase(simulateSentryWrap(EXPO_RN_XCODE_LINE))
    const script = { shellScript: JSON.stringify(sentryWrapped) }
    const original = script.shellScript

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    modifyExistingXcodeBuildScript(script)
    warn.mockRestore()

    expect(script.shellScript).toBe(original)
    expect(script.shellScript).not.toContain('posthog-xcode.sh')
    expectValidShellSyntax(JSON.parse(script.shellScript))
  })

  it('warns with the foreign wrapper name and the incompatibility explanation', () => {
    const sentryWrapped = expoBundlePhase(simulateSentryWrap(EXPO_RN_XCODE_LINE))
    const script = { shellScript: JSON.stringify(sentryWrapped) }

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    modifyExistingXcodeBuildScript(script)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sentry-xcode.sh'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('main.jsbundle'))
    warn.mockRestore()
  })

  it('still honors skipOnConflict updates for phases PostHog already owns', () => {
    // The foreign-wrapper guard must not shadow the existing posthog-xcode.sh
    // maintenance path.
    const script = { shellScript: JSON.stringify(expoBundlePhase(EXPO_RN_XCODE_LINE)) }
    modifyExistingXcodeBuildScript(script)
    modifyExistingXcodeBuildScript(script, true)
    expect(JSON.parse(script.shellScript)).toContain('--posthog-skip-on-conflict --')
  })

  it('does not wrap again after Sentry wrapped a PostHog-wrapped phase (PostHog plugin applied first)', () => {
    // This is the plugin order from the issue report: PostHog's mod runs first,
    // then Sentry nests around it. PostHog cannot repair Sentry's outer wrapper,
    // but re-running prebuild must not nest a second PostHog wrapper on top.
    const script = { shellScript: JSON.stringify(expoBundlePhase(EXPO_RN_XCODE_LINE)) }
    modifyExistingXcodeBuildScript(script)
    expect(JSON.parse(script.shellScript)).toContain('posthog-xcode.sh')

    script.shellScript = JSON.stringify(simulateSentryWrap(JSON.parse(script.shellScript)))
    const afterSentry = script.shellScript

    modifyExistingXcodeBuildScript(script)

    expect(script.shellScript).toBe(afterSentry)
    expect(countOccurrences(script.shellScript, 'posthog-xcode.sh')).toBe(1)
    expect(countOccurrences(script.shellScript, 'sentry-xcode.sh')).toBe(1)
  })
})

const mockXcodeProjectForBuildPhase = (
  existingPhase: any = undefined
): { pbxItemByComment: jest.Mock; addBuildPhase: jest.Mock } => ({
  pbxItemByComment: jest.fn(() => existingPhase),
  addBuildPhase: jest.fn(),
})

describe('buildDsymUploadShellScript', () => {
  it('produces valid shell syntax with and without source', () => {
    expectValidShellSyntax(buildDsymUploadShellScript())
    expectValidShellSyntax(buildDsymUploadShellScript(true))
    expectValidShellSyntax(buildDsymUploadShellScript(false, true))
    expectValidShellSyntax(buildDsymUploadShellScript(true, true))
  })

  it('reuses posthog-ios upload-symbols.sh and probes both Pods and SwiftPM paths', () => {
    const script = buildDsymUploadShellScript()
    expect(script).toContain('upload-symbols.sh')
    expect(script).toContain('${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh')
    expect(script).toContain('SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh')
  })

  it('does not set POSTHOG_INCLUDE_SOURCE by default', () => {
    expect(buildDsymUploadShellScript()).not.toContain('POSTHOG_INCLUDE_SOURCE')
    expect(buildDsymUploadShellScript(false)).not.toContain('POSTHOG_INCLUDE_SOURCE')
  })

  it('exports POSTHOG_INCLUDE_SOURCE=1 when includeSource is requested', () => {
    expect(buildDsymUploadShellScript(true)).toContain('export POSTHOG_INCLUDE_SOURCE=1')
  })

  it('does not set POSTHOG_SKIP_ON_CONFLICT by default', () => {
    expect(buildDsymUploadShellScript()).not.toContain('POSTHOG_SKIP_ON_CONFLICT')
    expect(buildDsymUploadShellScript(true, false)).not.toContain('POSTHOG_SKIP_ON_CONFLICT')
  })

  it('exports POSTHOG_SKIP_ON_CONFLICT=1 when skipOnConflict is requested', () => {
    expect(buildDsymUploadShellScript(false, true)).toContain('export POSTHOG_SKIP_ON_CONFLICT=1')
    expect(buildDsymUploadShellScript(true, true)).toContain('export POSTHOG_SKIP_ON_CONFLICT=1')
  })
})

describe('addDsymUploadBuildPhase', () => {
  it('adds a shell-script build phase when none exists', () => {
    const xp = mockXcodeProjectForBuildPhase(undefined)
    addDsymUploadBuildPhase(xp)

    expect(xp.addBuildPhase).toHaveBeenCalledTimes(1)
    const [files, isa, comment, , opts] = xp.addBuildPhase.mock.calls[0]
    expect(files).toEqual([])
    expect(isa).toBe('PBXShellScriptBuildPhase')
    expect(comment).toBe('Upload PostHog Debug Symbols')
    expect(opts.shellPath).toBe('/bin/sh')
    expect(opts.shellScript).toContain('upload-symbols.sh')
    expect(opts.shellScript).not.toContain('POSTHOG_INCLUDE_SOURCE')
  })

  it('forwards includeSource into the phase script', () => {
    const xp = mockXcodeProjectForBuildPhase(undefined)
    addDsymUploadBuildPhase(xp, true)
    const [, , , , opts] = xp.addBuildPhase.mock.calls[0]
    expect(opts.shellScript).toContain('export POSTHOG_INCLUDE_SOURCE=1')
  })

  it('forwards skipOnConflict into the phase script', () => {
    const xp = mockXcodeProjectForBuildPhase(undefined)
    addDsymUploadBuildPhase(xp, false, true)
    const [, , , , opts] = xp.addBuildPhase.mock.calls[0]
    expect(opts.shellScript).toContain('export POSTHOG_SKIP_ON_CONFLICT=1')
    expect(opts.shellScript).not.toContain('POSTHOG_INCLUDE_SOURCE')
  })

  it('is idempotent — does not add a second phase when one already exists', () => {
    const xp = mockXcodeProjectForBuildPhase({ isa: 'PBXShellScriptBuildPhase' })
    addDsymUploadBuildPhase(xp)
    expect(xp.addBuildPhase).not.toHaveBeenCalled()
  })

  // xcode's addBuildPhase stores shellScript quote-escaped with literal newlines.
  const encodePbx = (script: string): string => '"' + script.replace(/"/g, '\\"') + '"'

  it('refreshes an existing plugin-generated phase script so option changes take effect', () => {
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: encodePbx(buildDsymUploadShellScript()) }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, false, true)
    expect(xp.addBuildPhase).not.toHaveBeenCalled()
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript(false, true)))

    addDsymUploadBuildPhase(xp, false, false)
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript()))
  })

  it('refreshing with unchanged options preserves the stored pbxproj representation', () => {
    const stored = encodePbx(buildDsymUploadShellScript(true))
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: stored }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, true)
    expect(existing.shellScript).toBe(stored)
  })

  it('recognizes a pristine phase stored in Xcode-style \\n-escaped encoding', () => {
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: JSON.stringify(buildDsymUploadShellScript()) }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, false, true)
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript(false, true)))
  })

  it('recognizes a pristine phase stored without pbxproj quoting', () => {
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: buildDsymUploadShellScript(true) }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, false, true)
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript(false, true)))
  })

  it('leaves a user-customized phase script untouched', () => {
    const customized = encodePbx(`${buildDsymUploadShellScript()}\necho "my custom step"`)
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: customized }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, false, true)
    expect(xp.addBuildPhase).not.toHaveBeenCalled()
    expect(existing.shellScript).toBe(customized)
  })
})

describe('resolveNativeSymbolUpload', () => {
  it('treats undefined and false as disabled', () => {
    expect(resolveNativeSymbolUpload(undefined)).toEqual({ enabled: false, includeSource: false })
    expect(resolveNativeSymbolUpload(false)).toEqual({ enabled: false, includeSource: false })
  })

  it('treats true as enabled without source', () => {
    expect(resolveNativeSymbolUpload(true)).toEqual({ enabled: true, includeSource: false })
  })

  it('reads includeSource from the options object', () => {
    expect(resolveNativeSymbolUpload({ includeSource: true })).toEqual({ enabled: true, includeSource: true })
    expect(resolveNativeSymbolUpload({ includeSource: false })).toEqual({ enabled: true, includeSource: false })
    expect(resolveNativeSymbolUpload({})).toEqual({ enabled: true, includeSource: false })
  })
})

describe('buildAndroidSkipOnConflictGradleLine', () => {
  it.each([
    [false, null],
    [true, 'project.ext.posthogReactNativeSkipOnConflict = true'],
  ])('serializes skipOnConflict=%s', (skipOnConflict, expected) => {
    expect(buildAndroidSkipOnConflictGradleLine(skipOnConflict)).toBe(expected)
  })
})

describe('addPostHogAndroidGradlePluginClasspath', () => {
  const projectBuildGradle = [
    'buildscript {',
    '    repositories {',
    '        google()',
    '        mavenCentral()',
    '    }',
    '    dependencies {',
    '        classpath("com.android.tools.build:gradle")',
    '    }',
    '}',
  ].join('\n')

  it('adds the plugin classpath inside the buildscript dependencies block', () => {
    const { contents, classpathPresent } = addPostHogAndroidGradlePluginClasspath(projectBuildGradle)
    expect(classpathPresent).toBe(true)
    expect(contents).toContain('classpath("com.posthog:posthog-android-gradle-plugin:')
    // inserted before the buildscript closing brace
    expect(contents.indexOf('posthog-android-gradle-plugin')).toBeLessThan(contents.lastIndexOf('\n}'))
  })

  it('is idempotent and reports the classpath as present', () => {
    const once = addPostHogAndroidGradlePluginClasspath(projectBuildGradle)
    const twice = addPostHogAndroidGradlePluginClasspath(once.contents)
    expect(twice.contents).toBe(once.contents)
    expect(twice.classpathPresent).toBe(true)
  })

  it('leaves contents unchanged and reports not present when there is no buildscript dependencies block', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const contents = 'plugins {\n  id "com.android.application"\n}'
    const result = addPostHogAndroidGradlePluginClasspath(contents)
    expect(result.contents).toBe(contents)
    expect(result.classpathPresent).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find a buildscript dependencies block'))
  })

  it('does not place the classpath in a later block when buildscript has no dependencies block', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const contents = [
      'buildscript {',
      '    repositories { google() }',
      '}',
      'allprojects {',
      '    dependencies {',
      '    }',
      '}',
    ].join('\n')
    const result = addPostHogAndroidGradlePluginClasspath(contents)
    // The only dependencies block is in allprojects, outside buildscript — must not be used.
    expect(result.classpathPresent).toBe(false)
    expect(result.contents).toBe(contents)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find a buildscript dependencies block'))
  })
})

describe('buildIosDotenvFileBuildSetting', () => {
  it('anchors relative paths one level above the generated ios/ dir', () => {
    expect(buildIosDotenvFileBuildSetting('.env')).toBe('"$(SRCROOT)/../.env"')
    expect(buildIosDotenvFileBuildSetting('config/.env.posthog')).toBe('"$(SRCROOT)/../config/.env.posthog"')
  })

  it('strips a leading ./ before joining', () => {
    expect(buildIosDotenvFileBuildSetting('./.env')).toBe('"$(SRCROOT)/../.env"')
  })

  it('passes absolute paths through unanchored', () => {
    expect(buildIosDotenvFileBuildSetting('/secrets/.env')).toBe('"/secrets/.env"')
  })

  it('escapes quotes and backslashes for the pbxproj serialization', () => {
    expect(buildIosDotenvFileBuildSetting('we"ird\\path.env')).toBe('"$(SRCROOT)/../we\\"ird\\\\path.env"')
  })
})

describe('applyDotenvFileBuildSetting', () => {
  it('sets POSTHOG_CLI_DOTENV_FILE on every build configuration', () => {
    const xp = mockXcodeProject()
    applyDotenvFileBuildSetting(xp, '.env')
    for (const key of Object.keys(xp.configs)) {
      expect(xp.configs[key].buildSettings.POSTHOG_CLI_DOTENV_FILE).toBe('"$(SRCROOT)/../.env"')
    }
  })

  it('removes the setting again when the prop is absent', () => {
    const xp = mockXcodeProject()
    applyDotenvFileBuildSetting(xp, '.env')
    applyDotenvFileBuildSetting(xp)
    for (const key of Object.keys(xp.configs)) {
      expect(xp.configs[key].buildSettings).not.toHaveProperty('POSTHOG_CLI_DOTENV_FILE')
    }
  })

  it('preserves existing build settings', () => {
    const xp = mockXcodeProject()
    applyDotenvFileBuildSetting(xp, '.env')
    expect(xp.configs['1A:Release'].buildSettings.PRODUCT_NAME).toBe('"MyApp"')
  })

  it('is idempotent — running twice yields the same result', () => {
    const xp = mockXcodeProject()
    applyDotenvFileBuildSetting(xp, '.env')
    applyDotenvFileBuildSetting(xp, '.env')
    expect(xp.configs['1A:Release'].buildSettings.POSTHOG_CLI_DOTENV_FILE).toBe('"$(SRCROOT)/../.env"')
  })
})

describe('resolveDotenvFileProp', () => {
  it('treats undefined, empty, and whitespace-only values as unset', () => {
    expect(resolveDotenvFileProp(undefined)).toBeUndefined()
    expect(resolveDotenvFileProp('')).toBeUndefined()
    expect(resolveDotenvFileProp('   ')).toBeUndefined()
  })

  it('trims surrounding whitespace from real values', () => {
    expect(resolveDotenvFileProp(' .env ')).toBe('.env')
    expect(resolveDotenvFileProp('.env.production')).toBe('.env.production')
  })
})

describe('buildAndroidDotenvFileGradleValue', () => {
  it('anchors relative paths one level above the generated android/ dir', () => {
    expect(buildAndroidDotenvFileGradleValue('.env')).toBe('../.env')
    expect(buildAndroidDotenvFileGradleValue('./.env')).toBe('../.env')
  })

  it('passes absolute paths through unanchored', () => {
    expect(buildAndroidDotenvFileGradleValue('/secrets/.env')).toBe('/secrets/.env')
  })
})

describe('updateDotenvFileGradleProperties', () => {
  const unrelated = [
    { type: 'comment', value: 'Project-wide Gradle settings.' },
    { type: 'property', key: 'android.useAndroidX', value: 'true' },
    { type: 'empty' },
  ]

  it('appends the posthog.dotenvFile entry when the prop is set', () => {
    const result = updateDotenvFileGradleProperties([...unrelated], '.env')
    expect(result).toEqual([...unrelated, { type: 'property', key: 'posthog.dotenvFile', value: '../.env' }])
  })

  it('replaces an existing entry instead of duplicating it', () => {
    const withEntry = updateDotenvFileGradleProperties([...unrelated], '.env')
    const result = updateDotenvFileGradleProperties(withEntry, 'config/.env.posthog')
    expect(result.filter((item) => item.key === 'posthog.dotenvFile')).toEqual([
      { type: 'property', key: 'posthog.dotenvFile', value: '../config/.env.posthog' },
    ])
  })

  it('removes the entry when the prop is absent', () => {
    const withEntry = updateDotenvFileGradleProperties([...unrelated], '.env')
    expect(updateDotenvFileGradleProperties(withEntry)).toEqual(unrelated)
  })

  it('leaves unrelated properties untouched', () => {
    const result = updateDotenvFileGradleProperties([...unrelated], '.env')
    expect(result.slice(0, unrelated.length)).toEqual(unrelated)
  })
})

describe('applyPostHogAndroidGradlePlugin', () => {
  const appBuildGradle = [
    'apply plugin: "com.android.application"',
    'apply plugin: "com.facebook.react"',
    '',
    'android {',
    '    namespace "com.example"',
    '}',
  ].join('\n')

  it('applies the plugin right after com.android.application', () => {
    const result = applyPostHogAndroidGradlePlugin(appBuildGradle)
    expect(result).toContain('apply plugin: "com.posthog.android"')
    const lines = result.split('\n')
    const appIdx = lines.findIndex((l) => l.includes('com.android.application'))
    expect(lines[appIdx + 1]).toContain('com.posthog.android')
  })

  it('is idempotent', () => {
    const once = applyPostHogAndroidGradlePlugin(appBuildGradle)
    const twice = applyPostHogAndroidGradlePlugin(once)
    expect(twice).toBe(once)
  })

  it('falls back to inserting above the android block when com.android.application is absent', () => {
    const contents = 'android {\n    namespace "com.example"\n}'
    const result = applyPostHogAndroidGradlePlugin(contents)
    expect(result).toContain('apply plugin: "com.posthog.android"')
    expect(result.indexOf('com.posthog.android')).toBeLessThan(result.indexOf('android {'))
  })
})
