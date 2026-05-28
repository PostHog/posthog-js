import {
  addPostHogWithBundledScriptsToBundleShellScript,
  disableUserScriptSandboxing,
  modifyExistingXcodeBuildScript,
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

  it('arg1 passed to posthog-xcode.sh is react-native-xcode.sh path, not /bin/sh — simple path (no shell prefix)', () => {
    // Typical Expo bundle phase: just the bare path, no /bin/sh prefix.
    const original = '../node_modules/react-native/scripts/react-native-xcode.sh'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)
    const arg1 = extractArg1(wrapped)
    // $1 must point at the RN script, not at an interpreter
    expect(arg1).toContain('react-native-xcode.sh')
    expect(arg1).not.toBe('/bin/sh')
  })

  it('arg1 passed to posthog-xcode.sh is react-native-xcode.sh path, not /bin/sh — shell-prefixed command (Expo SDK 53+ / plain RN)', () => {
    // This is the format that triggers issue #3682:
    // the bundle phase already starts with "/bin/sh", so after wrapping,
    // $1 inside posthog-xcode.sh becomes "/bin/sh" instead of the RN script path.
    const original = '/bin/sh "$PODS_ROOT/../.."/node_modules/react-native/scripts/react-native-xcode.sh'
    const wrapped = addPostHogWithBundledScriptsToBundleShellScript(original)
    const arg1 = extractArg1(wrapped)
    expect(arg1).toContain('react-native-xcode.sh')
    expect(arg1).not.toBe('/bin/sh')
  })
})

describe('modifyExistingXcodeBuildScript', () => {
  it('wraps the bundle phase shellScript', () => {
    const script = { shellScript: JSON.stringify('"../node_modules/react-native/scripts/react-native-xcode.sh"') }
    modifyExistingXcodeBuildScript(script)
    const parsed = JSON.parse(script.shellScript)
    expect(parsed).toContain('posthog-xcode.sh')
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
