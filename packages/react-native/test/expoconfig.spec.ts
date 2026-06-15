import { spawnSync } from 'child_process'

import {
  addDsymUploadBuildPhase,
  addPostHogAndroidGradlePluginClasspath,
  addPostHogWithBundledScriptsToBundleShellScript,
  applyPostHogAndroidGradlePlugin,
  buildDsymUploadShellScript,
  disableUserScriptSandboxing,
  modifyExistingXcodeBuildScript,
  resolveNativeSymbolUpload,
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
})

describe('modifyExistingXcodeBuildScript', () => {
  it('wraps the bundle phase shellScript', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script)
    const parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('posthog-xcode.sh')
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

  it('skips scripts that do not invoke react-native-xcode.sh', () => {
    const script = { shellScript: JSON.stringify('echo "hello"') }
    const original = script.shellScript
    modifyExistingXcodeBuildScript(script)
    expect(script.shellScript).toBe(original)
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

  it('is idempotent — does not add a second phase when one already exists', () => {
    const xp = mockXcodeProjectForBuildPhase({ isa: 'PBXShellScriptBuildPhase' })
    addDsymUploadBuildPhase(xp)
    expect(xp.addBuildPhase).not.toHaveBeenCalled()
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
    const contents = 'plugins {\n  id "com.android.application"\n}'
    const result = addPostHogAndroidGradlePluginClasspath(contents)
    expect(result.contents).toBe(contents)
    expect(result.classpathPresent).toBe(false)
  })

  it('does not place the classpath in a later block when buildscript has no dependencies block', () => {
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
