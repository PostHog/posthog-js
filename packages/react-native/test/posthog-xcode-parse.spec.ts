import { execFileSync, execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * These tests validate the sed expressions used in tooling/posthog-xcode.sh
 * to parse a git remote URL into {host, owner/repo}. Rather than re-declare
 * the regexes here (and risk drift), we extract them at test runtime from the
 * shell script itself — so the tests cannot diverge from the source.
 *
 * Also contains regression tests for issue #3682: posthog-xcode.sh was
 * resolving REACT_NATIVE_XCODE to /bin/sh when invoked by the Expo plugin.
 */

const SCRIPT_PATH = path.resolve(__dirname, '..', 'tooling', 'posthog-xcode.sh')

const extractSed = (label: 'GIT_HOST' | 'GIT_REPO_PATH'): string => {
  const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')
  // Match lines like:   GIT_HOST=$(echo "$GIT_REMOTE_URL" | sed -E '<expr>')
  const re = new RegExp(`${label}=\\$\\(echo "\\$GIT_REMOTE_URL" \\| sed -E '([^']+)'\\)`)
  const match = contents.match(re)
  if (!match) {
    throw new Error(`Could not find ${label} sed expression in ${SCRIPT_PATH}`)
  }
  return match[1]
}

const runSed = (sedExpr: string, input: string): string => {
  // Shell-escape the sed expression to pass it through execSync safely.
  const escaped = sedExpr.replace(/'/g, `'\\''`)
  return execSync(`printf %s '${input}' | sed -E '${escaped}'`).toString().trim()
}

const extractCommandErrorBlock = (): string => {
  const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')
  const match = contents.match(/print_prefixed_output\(\) \{[\s\S]+?\n\}\n\nprint_command_error\(\) \{[\s\S]+?\n\}/)
  if (!match) {
    throw new Error(`Could not find posthog-cli error formatting helpers in ${SCRIPT_PATH}`)
  }
  return match[0]
}

describe('posthog-xcode.sh remote URL parsing', () => {
  const HOST_SED = extractSed('GIT_HOST')
  const REPO_SED = extractSed('GIT_REPO_PATH')

  const parse = (url: string): { host: string; repo: string } => ({
    host: runSed(HOST_SED, url),
    repo: runSed(REPO_SED, url),
  })

  const cases: Array<[string, string, string]> = [
    ['git@github.com:PostHog/posthog-js.git', 'github.com', 'PostHog/posthog-js'],
    ['https://github.com/PostHog/posthog-js.git', 'github.com', 'PostHog/posthog-js'],
    ['git@gitlab.com:foo/bar.git', 'gitlab.com', 'foo/bar'],
    ['https://gitlab.com/foo/bar.git', 'gitlab.com', 'foo/bar'],
    ['git@bitbucket.org:foo/bar.git', 'bitbucket.org', 'foo/bar'],
    ['git@git.mycompany.internal:team/repo.git', 'git.mycompany.internal', 'team/repo'],
    ['ssh://git@github.com:22/foo/bar.git', 'github.com', 'foo/bar'],
    ['https://gitlab.com/org/subgroup/repo.git', 'gitlab.com', 'org/subgroup/repo'],
    ['git@gitlab.com:org/subgroup/repo.git', 'gitlab.com', 'org/subgroup/repo'],
    ['https://gitlab.com/org/deep/nested/subgroup/repo.git', 'gitlab.com', 'org/deep/nested/subgroup/repo'],
  ]

  it.each(cases)('parses %s → host=%s repo=%s', (url, expectedHost, expectedRepo) => {
    const { host, repo } = parse(url)
    expect(host).toBe(expectedHost)
    expect(repo).toBe(expectedRepo)
  })

  it('constructs the expected remote_url for github', () => {
    const { host, repo } = parse('git@github.com:PostHog/posthog-js.git')
    expect(`https://${host}/${repo}.git`).toBe('https://github.com/PostHog/posthog-js.git')
  })

  it('constructs the expected remote_url for self-hosted', () => {
    const { host, repo } = parse('git@git.corp.internal:team/repo.git')
    expect(`https://${host}/${repo}.git`).toBe('https://git.corp.internal/team/repo.git')
  })
})

describe('posthog-xcode.sh bundle command composition', () => {
  const scriptContents = fs.readFileSync(SCRIPT_PATH, 'utf8')

  const extractReactNativeXcodeResolutionBlock = (): string => {
    const match = scriptContents.match(/REACT_NATIVE_XCODE_DEFAULT="[^"]+"[\s\S]+?\n\s*done/)
    if (!match) throw new Error('Could not locate REACT_NATIVE_XCODE resolution in posthog-xcode.sh')
    return match[0]
  }

  const resolveReactNativeXcode = (args: string[]): string => {
    const script = `${extractReactNativeXcodeResolutionBlock()}\nprintf '%s' "$REACT_NATIVE_XCODE"`
    return execFileSync('/bin/bash', ['-c', script, 'posthog-xcode-test', ...args]).toString()
  }

  it.each([
    ['direct RN script', ['../node_modules/react-native/scripts/react-native-xcode.sh']],
    ['shell-prefixed RN script', ['/bin/sh', '../node_modules/react-native/scripts/react-native-xcode.sh']],
    [
      'nested source-map wrapper',
      [
        '/bin/sh',
        '../node_modules/@sentry/react-native/scripts/sentry-xcode.sh',
        '../node_modules/react-native/scripts/react-native-xcode.sh',
      ],
    ],
  ])('locates react-native-xcode.sh in a %s command', (_desc, args) => {
    expect(resolveReactNativeXcode(args)).toBe('../node_modules/react-native/scripts/react-native-xcode.sh')
  })

  it('falls back to the standard RN script when an outer wrapper does not forward arguments', () => {
    expect(resolveReactNativeXcode([])).toBe('../node_modules/react-native/scripts/react-native-xcode.sh')
  })

  it('forwards nested commands, preserves the Hermes map, and resolves a hoisted fallback', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-composition-'))
    const derivedDir = path.join(tempDir, 'derived')
    const configurationDir = path.join(tempDir, 'configuration')
    const homeDir = path.join(tempDir, 'home')
    const iosDir = path.join(tempDir, 'packages', 'example', 'ios')
    const tracePath = path.join(tempDir, 'trace.log')
    const wrapperPath = path.join(tempDir, 'sentry-xcode.sh')
    const reactNativeRoot = path.join(tempDir, 'node_modules', 'react-native')
    const reactNativePath = path.join(reactNativeRoot, 'scripts', 'react-native-xcode.sh')
    const cliPath = path.join(homeDir, '.posthog', 'posthog-cli')

    try {
      for (const directory of [
        derivedDir,
        configurationDir,
        iosDir,
        path.dirname(reactNativePath),
        path.dirname(cliPath),
      ]) {
        fs.mkdirSync(directory, { recursive: true })
      }
      fs.writeFileSync(wrapperPath, '#!/bin/sh\necho wrapper >> "$TRACE_PATH"\n"$@"\n', { mode: 0o755 })
      fs.writeFileSync(path.join(reactNativeRoot, 'package.json'), '{}')
      fs.writeFileSync(
        reactNativePath,
        '#!/bin/sh\necho react-native >> "$TRACE_PATH"\nrm "$PACKAGER_SOURCEMAP_FILE"\n',
        { mode: 0o755 }
      )
      fs.writeFileSync(cliPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 })

      const env = {
        ...process.env,
        CONFIGURATION_BUILD_DIR: configurationDir,
        DERIVED_FILE_DIR: derivedDir,
        HOME: homeDir,
        NODE_BINARY: process.execPath,
        SKIP_BUNDLING: '1',
        TRACE_PATH: tracePath,
      }

      execFileSync(SCRIPT_PATH, ['/bin/sh', wrapperPath, reactNativePath], {
        cwd: iosDir,
        env,
        stdio: 'pipe',
      })

      expect(fs.readFileSync(tracePath, 'utf8').trim().split('\n')).toEqual(['wrapper', 'react-native'])
      expect(fs.readFileSync(reactNativePath, 'utf8')).toContain('#rm "$PACKAGER_SOURCEMAP_FILE"')

      // Sentry only passes its $1 script path to sentry-cli. When Sentry wraps
      // PostHog, posthog-xcode.sh is therefore invoked without the original RN
      // argument and must execute the standard script itself.
      fs.writeFileSync(tracePath, '')
      execFileSync(SCRIPT_PATH, [], { cwd: iosDir, env, stdio: 'pipe' })
      expect(fs.readFileSync(tracePath, 'utf8').trim()).toBe('react-native')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('posthog-xcode.sh release version resolution', () => {
  const scriptContents = fs.readFileSync(SCRIPT_PATH, 'utf8')

  const extractReleaseInfoBlock = (): string => {
    const match = scriptContents.match(
      /resolve_posthog_ios_release_info\(\) \{[\s\S]+?\n\}\n\nresolve_posthog_ios_release_info/
    )
    if (!match) throw new Error('Could not locate iOS release info resolution in posthog-xcode.sh')
    return match[0]
  }

  const resolveReleaseInfo = (
    tempDir: string,
    plistVersion: string,
    plistBuild: string,
    marketingVersion = '1.0',
    projectVersion = '1',
    buildSettings: Record<string, string> = {}
  ): string => {
    const plistBuddy = path.join(tempDir, 'plist-buddy')
    const infoPlist = path.join(tempDir, 'ExampleApp', 'Info.plist')
    fs.mkdirSync(path.dirname(infoPlist), { recursive: true })
    fs.writeFileSync(infoPlist, '')
    fs.writeFileSync(
      plistBuddy,
      '#!/bin/sh\ncase "$2" in\n  *CFBundleShortVersionString*) printf %s "$TEST_PLIST_VERSION" ;;\n  *CFBundleVersion*) printf %s "$TEST_PLIST_BUILD" ;;\nesac\n',
      { mode: 0o755 }
    )

    const script = `${extractReleaseInfoBlock()}\nprintf '%s|%s' "$POSTHOG_RELEASE_VERSION" "$POSTHOG_BUILD_VERSION"`
    return execFileSync('/bin/bash', ['-c', script], {
      env: {
        ...process.env,
        SRCROOT: tempDir,
        INFOPLIST_FILE: 'ExampleApp/Info.plist',
        POSTHOG_PLIST_BUDDY: plistBuddy,
        MARKETING_VERSION: marketingVersion,
        CURRENT_PROJECT_VERSION: projectVersion,
        TEST_PLIST_VERSION: plistVersion,
        TEST_PLIST_BUILD: plistBuild,
        ...buildSettings,
      },
    }).toString()
  }

  it('prefers Expo source Info.plist versions over generated Xcode defaults', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(resolveReleaseInfo(tempDir, '2.10.0', '154')).toBe('2.10.0|154')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('resolves custom Xcode build settings referenced by the source Info.plist', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(
        resolveReleaseInfo(tempDir, '$(APP_VERSION)', '${BUILD_NUMBER}', '1.0', '1', {
          APP_VERSION: '9.9.9',
          BUILD_NUMBER: '321',
        })
      ).toBe('9.9.9|321')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('resolves compound Xcode build settings referenced by the source Info.plist', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(
        resolveReleaseInfo(tempDir, '$(VERSION_MAJOR).$(VERSION_MINOR)', '$(BUILD_PREFIX)$(BUILD_NUMBER)', '1.0', '1', {
          VERSION_MAJOR: '2',
          VERSION_MINOR: '10.0',
          BUILD_PREFIX: '1',
          BUILD_NUMBER: '54',
        })
      ).toBe('2.10.0|154')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('keeps Xcode versions when Info.plist preprocessing is enabled', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(
        resolveReleaseInfo(tempDir, 'APP_VERSION', 'APP_BUILD', '1.0', '1', {
          INFOPLIST_PREPROCESS: 'YES',
        })
      ).toBe('1.0|1')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('keeps Xcode versions when source Info.plist values are unresolved', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-xcode-version-'))
    try {
      expect(resolveReleaseInfo(tempDir, '$(MISSING_VERSION)', '$(A)-$(B)')).toBe('1.0|1')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('posthog-xcode.sh skipOnConflict upload flag', () => {
  it('passes --skip-on-conflict only to hermes upload', () => {
    const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')

    expect(contents).toContain('POSTHOG_UPLOAD_ARGS+=(--skip-on-conflict)')
    expect(contents).toContain(
      'CLI_UPLOAD_OUTPUT=$("$PH_CLI_PATH" hermes upload --directory "$DERIVED_FILE_DIR" "${CLI_RELEASE_ARGS[@]}" "${POSTHOG_UPLOAD_ARGS[@]}" 2>&1)'
    )
    expect(contents).not.toContain('hermes clone --skip-on-conflict')
  })
})

describe('posthog-xcode.sh posthog-cli error formatting', () => {
  it('uses multiline Xcode error formatting for clone and upload failures', () => {
    const contents = fs.readFileSync(SCRIPT_PATH, 'utf8')

    expect(contents).toContain('print_command_error "posthog-cli hermes clone" "$CLONE_EXIT_CODE" "$CLI_CLONE_OUTPUT"')
    expect(contents).toContain(
      'print_command_error "posthog-cli hermes upload" "$UPLOAD_EXIT_CODE" "$CLI_UPLOAD_OUTPUT"'
    )
  })

  it('prefixes every captured posthog-cli failure line as an Xcode error', () => {
    const helperBlock = extractCommandErrorBlock()
    const script = `${helperBlock}
CLI_OUTPUT=$(printf '%s\\n%s\\n%s\\n' \
  '2026-06-04T20:42:06Z  INFO posthog_cli::utils::auth: Using token from environment' \
  '2026-06-04T20:42:07Z ERROR posthog_cli::commands: msg="Oops! real failure"' \
  'Oops! real failure')
print_command_error "posthog-cli hermes upload" "42" "$CLI_OUTPUT"`

    const output = execFileSync('/bin/bash', ['-c', script]).toString().trim().split('\n')

    expect(output).toEqual([
      'error: posthog-cli hermes upload failed with exit code 42',
      'error: posthog-cli hermes upload - 2026-06-04T20:42:06Z  INFO posthog_cli::utils::auth: Using token from environment',
      'error: posthog-cli hermes upload - 2026-06-04T20:42:07Z ERROR posthog_cli::commands: msg="Oops! real failure"',
      'error: posthog-cli hermes upload - Oops! real failure',
    ])
    expect(output.every((line) => line.startsWith('error: '))).toBe(true)
  })
})
