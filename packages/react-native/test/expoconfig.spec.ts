import { execFileSync, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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

  it('waits for matching app and dSYM UUIDs without adding an Xcode input dependency', () => {
    const script = buildDsymUploadShellScript()
    expect(script).toContain('xcrun dwarfdump --uuid "$POSTHOG_MAIN_DWARF"')
    expect(script).toContain('xcrun dwarfdump --uuid "$POSTHOG_APP_EXECUTABLE"')
    expect(script).toContain('POSTHOG_DSYM_MAX_ATTEMPTS=60')
  })

  it('passes Expo source Info.plist versions to posthog-ios', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-dsym-version-'))
    const plistBuddy = path.join(tempDir, 'plist-buddy')
    const fakeBin = path.join(tempDir, 'bin')
    const podsRoot = path.join(tempDir, 'Pods')
    const infoPlist = path.join(tempDir, 'App', 'Info.plist')
    const dwarfFolder = path.join(tempDir, 'dSYMs')
    const dwarfFileName = 'ExampleApp.app.dSYM'
    const executableName = 'ExampleApp'
    const dwarfFile = path.join(dwarfFolder, dwarfFileName, 'Contents', 'Resources', 'DWARF', executableName)
    const uploadScript = path.join(podsRoot, 'PostHog', 'build-tools', 'upload-symbols.sh')
    const targetBuildDir = path.join(tempDir, 'build')
    const executablePath = 'ExampleApp.app/ExampleApp'
    const appExecutable = path.join(targetBuildDir, executablePath)
    const dwarfdumpAttempts = path.join(tempDir, 'dwarfdump-attempts')

    try {
      fs.mkdirSync(fakeBin, { recursive: true })
      fs.mkdirSync(path.dirname(infoPlist), { recursive: true })
      fs.mkdirSync(path.dirname(dwarfFile), { recursive: true })
      fs.mkdirSync(path.dirname(uploadScript), { recursive: true })
      fs.mkdirSync(path.dirname(appExecutable), { recursive: true })
      fs.writeFileSync(infoPlist, '')
      fs.writeFileSync(dwarfFile, 'valid dwarf')
      fs.writeFileSync(appExecutable, 'valid executable')
      fs.writeFileSync(
        plistBuddy,
        '#!/bin/sh\ncase "$2" in\n  *CFBundleShortVersionString*) printf 2.10.0 ;;\n  *CFBundleVersion*) printf 154 ;;\nesac\n',
        { mode: 0o755 }
      )
      fs.writeFileSync(
        path.join(fakeBin, 'xcrun'),
        '#!/bin/sh\ncase "$3" in\n  *dSYMs*)\n    attempts=$(cat "$TEST_DWARFDUMP_ATTEMPTS" 2>/dev/null || printf 0)\n    attempts=$((attempts + 1))\n    printf %s "$attempts" > "$TEST_DWARFDUMP_ATTEMPTS"\n    if [ "$attempts" -lt 3 ]; then\n      printf "UUID: OLD-UUID (arm64) %s\\n" "$3"\n    else\n      printf "UUID: CURRENT-UUID (arm64) %s\\n" "$3"\n    fi\n    ;;\n  *) printf "UUID: CURRENT-UUID (arm64) %s\\n" "$3" ;;\nesac\n',
        { mode: 0o755 }
      )
      fs.writeFileSync(path.join(fakeBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      fs.writeFileSync(uploadScript, '#!/bin/sh\nprintf "%s|%s" "$MARKETING_VERSION" "$CURRENT_PROJECT_VERSION"\n')

      const output = execFileSync('/bin/sh', ['-c', buildDsymUploadShellScript()], {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PODS_ROOT: podsRoot,
          BUILD_DIR: path.join(tempDir, 'Build', 'Products'),
          SRCROOT: tempDir,
          INFOPLIST_FILE: 'App/Info.plist',
          POSTHOG_PLIST_BUDDY: plistBuddy,
          MARKETING_VERSION: '1.0',
          CURRENT_PROJECT_VERSION: '1',
          CONFIGURATION: 'Release-Staging',
          DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
          DWARF_DSYM_FOLDER_PATH: dwarfFolder,
          DWARF_DSYM_FILE_NAME: dwarfFileName,
          EXECUTABLE_NAME: executableName,
          TARGET_BUILD_DIR: targetBuildDir,
          EXECUTABLE_PATH: executablePath,
          TEST_DWARFDUMP_ATTEMPTS: dwarfdumpAttempts,
        },
      }).toString()

      expect(output).toBe('2.10.0|154')
      expect(fs.readFileSync(dwarfdumpAttempts, 'utf8')).toBe('3')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not upload when the main app dSYM stays invalid', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-dsym-invalid-'))
    const fakeBin = path.join(tempDir, 'bin')
    const podsRoot = path.join(tempDir, 'Pods')
    const dwarfFolder = path.join(tempDir, 'dSYMs')
    const dwarfFileName = 'ExampleApp.app.dSYM'
    const executableName = 'ExampleApp'
    const dwarfFile = path.join(dwarfFolder, dwarfFileName, 'Contents', 'Resources', 'DWARF', executableName)
    const uploadScript = path.join(podsRoot, 'PostHog', 'build-tools', 'upload-symbols.sh')
    const targetBuildDir = path.join(tempDir, 'build')
    const executablePath = 'ExampleApp.app/ExampleApp'
    const appExecutable = path.join(targetBuildDir, executablePath)
    const uploadMarker = path.join(tempDir, 'upload-ran')

    try {
      fs.mkdirSync(fakeBin, { recursive: true })
      fs.mkdirSync(path.dirname(dwarfFile), { recursive: true })
      fs.mkdirSync(path.dirname(uploadScript), { recursive: true })
      fs.mkdirSync(path.dirname(appExecutable), { recursive: true })
      fs.writeFileSync(dwarfFile, 'invalid dwarf')
      fs.writeFileSync(appExecutable, 'valid executable')
      fs.writeFileSync(path.join(fakeBin, 'xcrun'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      fs.writeFileSync(path.join(fakeBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      fs.writeFileSync(uploadScript, '#!/bin/sh\ntouch "$TEST_UPLOAD_MARKER"\n')

      const result = spawnSync('/bin/sh', ['-c', buildDsymUploadShellScript()], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PODS_ROOT: podsRoot,
          BUILD_DIR: path.join(tempDir, 'Build', 'Products'),
          CONFIGURATION: 'Release',
          DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
          INFOPLIST_FILE: '',
          DWARF_DSYM_FOLDER_PATH: dwarfFolder,
          DWARF_DSYM_FILE_NAME: dwarfFileName,
          EXECUTABLE_NAME: executableName,
          TARGET_BUILD_DIR: targetBuildDir,
          EXECUTABLE_PATH: executablePath,
          TEST_UPLOAD_MARKER: uploadMarker,
        },
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('warning: Main app dSYM was not ready')
      expect(fs.existsSync(uploadMarker)).toBe(false)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
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
    expect(opts.inputPaths).toBeUndefined()
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
  const legacyDsymUploadShellScript = [
    '# Upload iOS dSYMs to PostHog so native crashes can be symbolicated.',
    '# upload-symbols.sh ships inside the posthog-ios dependency.',
    'PODS_SCRIPT="${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh"',
    'SPM_SCRIPT="${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh"',
    'if [ -f "$PODS_SCRIPT" ]; then',
    '  /bin/sh "$PODS_SCRIPT"',
    'elif [ -f "$SPM_SCRIPT" ]; then',
    '  /bin/sh "$SPM_SCRIPT"',
    'else',
    '  echo "warning: PostHog upload-symbols.sh not found in Pods or SwiftPM checkouts; skipping dSYM upload."',
    'fi',
  ].join('\n')

  it('migrates the previous plugin-generated phase to the readiness and version fixes', () => {
    const existing = { isa: 'PBXShellScriptBuildPhase', shellScript: encodePbx(legacyDsymUploadShellScript) }
    const xp = mockXcodeProjectForBuildPhase(existing)

    addDsymUploadBuildPhase(xp)

    expect(xp.addBuildPhase).not.toHaveBeenCalled()
    expect(existing.shellScript).toBe(encodePbx(buildDsymUploadShellScript()))
  })

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
