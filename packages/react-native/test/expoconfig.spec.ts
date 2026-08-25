import { withXcodeProject } from '@expo/config-plugins'
import { spawnSync } from 'child_process'

import * as postHogExpoPluginModule from '../src/tooling/expoconfig'
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
  modifyExistingXcodeBuildScript,
  moveDsymUploadBuildPhaseToEnd,
  resolveDotenvFileProp,
  resolveNativeSymbolUpload,
  updateDotenvFileGradleProperties,
} from '../src/tooling/expoconfig'

const postHogExpoPlugin = (postHogExpoPluginModule as any).default

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

const SENTRY_REACT_NATIVE_XCODE_PATH =
  "`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('@sentry/react-native/package.json')) + '/scripts/sentry-xcode.sh'\"`"

// Mirrors @sentry/react-native's Expo config-plugin transformation so these
// tests cover both plugin execution orders without adding Sentry as a dependency.
const addSentryWithBundledScriptsToBundleShellScript = (script: string): string =>
  script.replace(
    /^.*?(packager|scripts)\/react-native-xcode\.sh\s*(\\'\\\\")?/m,
    (match) => `/bin/sh ${SENTRY_REACT_NATIVE_XCODE_PATH} ${match}`
  )

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
    expect(wrapped.startsWith('/bin/sh ')).toBe(false)
    expect(wrapped.indexOf('posthog-xcode.sh')).toBeLessThan(wrapped.indexOf('react-native-xcode.sh'))
  })

  it('supports the alternative packager/ path', () => {
    const original = '"node_modules/react-native/packager/react-native-xcode.sh"'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)
    expect(wrapped).toContain('posthog-xcode.sh')
    expect(wrapped).toContain('packager/react-native-xcode.sh')
  })

  it('preserves a shell-prefixed React Native command for argument forwarding', () => {
    const original = '/bin/sh "$PODS_ROOT/../.."/node_modules/react-native/scripts/react-native-xcode.sh'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)

    expect(wrapped).toContain('/bin/sh "$PODS_ROOT/../.."/node_modules/react-native/scripts/react-native-xcode.sh')
    expectValidShellSyntax(wrapped)
  })

  it('composes outside an existing Sentry wrapper', () => {
    const reactNativeCommand = '../node_modules/react-native/scripts/react-native-xcode.sh'
    const sentryWrapped = `/bin/sh ${SENTRY_REACT_NATIVE_XCODE_PATH} ${reactNativeCommand}`
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(sentryWrapped)

    expect(wrapped.indexOf('posthog-xcode.sh')).toBeLessThan(wrapped.indexOf('sentry-xcode.sh'))
    expect(wrapped).toContain(`/bin/sh ${SENTRY_REACT_NATIVE_XCODE_PATH} ${reactNativeCommand}`)
    expectValidShellSyntax(wrapped)
  })

  it('remains composable when Sentry wraps it afterwards', () => {
    const reactNativeCommand = '../node_modules/react-native/scripts/react-native-xcode.sh'
    const postHogWrapped = addPostHogWithBundledScriptsToBundleShellScript(reactNativeCommand)
    const sentryWrapped = addSentryWithBundledScriptsToBundleShellScript(postHogWrapped)

    expect(sentryWrapped).toBe(`/bin/sh ${SENTRY_REACT_NATIVE_XCODE_PATH} ${postHogWrapped}`)
    expect(sentryWrapped).not.toContain(`${SENTRY_REACT_NATIVE_XCODE_PATH} /bin/sh`)
    expectValidShellSyntax(sentryWrapped)
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

  it('exports skipOnConflict before the wrapped command so outer wrappers inherit it', () => {
    const original = 'node_modules/react-native/scripts/react-native-xcode.sh'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original, true)

    expect(wrapped).toContain('export POSTHOG_SKIP_ON_CONFLICT=1\n')
    expect(wrapped).not.toContain('--posthog-skip-on-conflict')
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
    expect(parsed).toContain('export POSTHOG_SKIP_ON_CONFLICT=1')
  })

  it('updates skipOnConflict on an already wrapped bundle phase', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script)
    modifyExistingXcodeBuildScript(script, true)
    let parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('export POSTHOG_SKIP_ON_CONFLICT=1')

    modifyExistingXcodeBuildScript(script, false)
    parsed = JSON.parse(script.shellScript)
    expect(parsed).not.toContain('POSTHOG_SKIP_ON_CONFLICT')
  })

  it('migrates an existing shell-prefixed PostHog wrapper to a composable invocation', () => {
    const reactNativeCommand = '../node_modules/react-native/scripts/react-native-xcode.sh'
    const oldWrapped = `/bin/sh ${addPostHogWithBundledScriptsToBundleShellScript(reactNativeCommand)}`
    const script = { shellScript: JSON.stringify(oldWrapped) }

    modifyExistingXcodeBuildScript(script)

    const parsed = JSON.parse(script.shellScript)
    expect(parsed.startsWith('/bin/sh ')).toBe(false)
    expect(parsed).toContain('posthog-xcode.sh')
  })

  it('migrates a shell-prefixed wrapper and legacy skip argument together', () => {
    const reactNativeCommand = '../node_modules/react-native/scripts/react-native-xcode.sh'
    const currentWrapped = addPostHogWithBundledScriptsToBundleShellScript(reactNativeCommand)
    const legacyWrapped = `/bin/sh ${currentWrapped.replace(
      ` ${reactNativeCommand}`,
      ` --posthog-skip-on-conflict -- ${reactNativeCommand}`
    )}`
    const script = { shellScript: JSON.stringify(legacyWrapped) }

    modifyExistingXcodeBuildScript(script, true)

    const parsed = JSON.parse(script.shellScript)
    expect(parsed.startsWith('/bin/sh ')).toBe(false)
    expect(parsed).not.toContain('--posthog-skip-on-conflict --')
    expect(parsed).toContain('export POSTHOG_SKIP_ON_CONFLICT=1')
    expect(parsed).toContain(` ${reactNativeCommand}`)
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

const mockXcodeProjectForBuildPhase = (existingPhase: any = undefined, buildPhases: any[] = []) => ({
  pbxItemByComment: jest.fn(() => existingPhase),
  addBuildPhase: jest.fn(),
  getFirstTarget: jest.fn(() => ({ firstTarget: { buildPhases } })),
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
    expect(opts.inputPaths).toEqual([
      '"$(DWARF_DSYM_FOLDER_PATH)/$(DWARF_DSYM_FILE_NAME)/Contents/Resources/DWARF/$(EXECUTABLE_NAME)"',
    ])
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
    const existing: any = {
      isa: 'PBXShellScriptBuildPhase',
      shellScript: encodePbx(buildDsymUploadShellScript()),
      inputPaths: ['"$(SRCROOT)/custom-input"'],
    }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, false, true)
    expect(xp.addBuildPhase).not.toHaveBeenCalled()
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript(false, true)))
    expect(existing.inputPaths).toEqual([
      '"$(SRCROOT)/custom-input"',
      '"$(DWARF_DSYM_FOLDER_PATH)/$(DWARF_DSYM_FILE_NAME)/Contents/Resources/DWARF/$(EXECUTABLE_NAME)"',
    ])

    addDsymUploadBuildPhase(xp, false, false)
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript()))
  })

  it('moves an existing plugin-generated phase after extension embedding', () => {
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: encodePbx(buildDsymUploadShellScript()) }
    const buildPhases = [
      { value: 'SOURCES', comment: 'Sources' },
      { value: 'POSTHOG', comment: 'Upload PostHog Debug Symbols' },
      { value: 'EXTENSION', comment: 'Embed App Extensions' },
    ]
    const xp = mockXcodeProjectForBuildPhase(existing, buildPhases)

    addDsymUploadBuildPhase(xp)

    expect(buildPhases.map((phase) => phase.comment)).toEqual([
      'Sources',
      'Embed App Extensions',
      'Upload PostHog Debug Symbols',
    ])
  })

  it('moves a newly added phase again after a later plugin appends extension embedding', () => {
    let existing: any
    const buildPhases = [{ value: 'SOURCES', comment: 'Sources' }]
    const xp = mockXcodeProjectForBuildPhase(undefined, buildPhases)
    xp.pbxItemByComment.mockImplementation(() => existing)
    xp.addBuildPhase.mockImplementation((_files, _isa, comment, _target, options) => {
      existing = {
        isa: 'PBXShellScriptBuildPhase',
        shellScript: encodePbx(options.shellScript),
      }
      buildPhases.push({ value: 'POSTHOG', comment })
    })

    addDsymUploadBuildPhase(xp)
    buildPhases.push({ value: 'EXTENSION', comment: 'Embed App Extensions' })
    moveDsymUploadBuildPhaseToEnd(xp)

    expect(buildPhases.map((phase) => phase.comment)).toEqual([
      'Sources',
      'Embed App Extensions',
      'Upload PostHog Debug Symbols',
    ])
  })

  it('finalizes phase ordering after all Expo Xcode project mods', async () => {
    jest.useRealTimers()
    let uploadPhase: any
    const bundlePhase = {
      shellScript: JSON.stringify('../node_modules/react-native/scripts/react-native-xcode.sh'),
    }
    const buildPhases: any[] = [{ value: 'SOURCES', comment: 'Sources' }]
    const xcodeProject = {
      pbxItemByComment: jest.fn((comment: string) => {
        if (comment === 'Bundle React Native code and images') {
          return bundlePhase
        }
        if (comment === 'Upload PostHog Debug Symbols') {
          return uploadPhase
        }
      }),
      addBuildPhase: jest.fn((_files, _isa, comment, _target, options) => {
        uploadPhase = {
          isa: 'PBXShellScriptBuildPhase',
          shellScript: encodePbx(options.shellScript),
        }
        buildPhases.push({ value: 'POSTHOG', comment })
      }),
      getFirstTarget: jest.fn(() => ({ firstTarget: { buildPhases } })),
      pbxXCBuildConfigurationSection: jest.fn(() => ({})),
    }

    let config: any = { name: 'Test', slug: 'test' }
    config = withXcodeProject(config, (config: any) => {
      buildPhases.push({ value: 'EXTENSION', comment: 'Embed App Extensions' })
      return config
    })
    config = postHogExpoPlugin(config, {
      disableSandboxing: false,
      uploadNativeSymbols: true,
    })

    await config.mods.ios.xcodeproj({ ...config, modRequest: {}, modResults: xcodeProject })

    expect(buildPhases.map((phase) => phase.comment)).toEqual([
      'Sources',
      'Embed App Extensions',
      'Upload PostHog Debug Symbols',
    ])
    jest.useFakeTimers()
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
    const existing: any = { isa: 'PBXShellScriptBuildPhase', shellScript: customized }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp, false, true)
    expect(xp.addBuildPhase).not.toHaveBeenCalled()
    expect(existing.shellScript).toBe(customized)
    expect(existing.inputPaths).toBeUndefined()
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
